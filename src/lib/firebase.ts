import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
  addDoc,
  collection,
  serverTimestamp,
  enableNetwork,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// 1. Initialize Firebase App strictly once across HMR / module reloads
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// 2. Initialize Firestore once with auto-detected long polling (resilient behind
// Cloud Run / iframe reverse proxies) and multi-tab persistent local cache.
function createOrReuseFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    // Fallback when module is hot-reloaded after Firestore was already initialized
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createOrReuseFirestore();
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export type FirebaseConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface FirebaseConnectionSnapshot {
  state: FirebaseConnectionState;
  projectId: string;
  databaseId: string;
  lastConnectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  retryAttempt: number;
  maxRetries: number;
}

const connectionSnapshot: FirebaseConnectionSnapshot = {
  state: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting',
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  lastConnectedAt: null,
  lastCheckedAt: null,
  lastError: null,
  retryAttempt: 0,
  maxRetries: 5,
};

const connectionListeners = new Set<(snap: FirebaseConnectionSnapshot) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionProbeInFlight: Promise<boolean> | null = null;

function emitConnectionSnapshot() {
  const copy = { ...connectionSnapshot };
  connectionListeners.forEach((listener) => {
    try {
      listener(copy);
    } catch {
      // ignore subscriber callback error
    }
  });
}

export function getFirebaseConnectionSnapshot(): FirebaseConnectionSnapshot {
  return { ...connectionSnapshot };
}

export function subscribeFirebaseConnection(
  listener: (snap: FirebaseConnectionSnapshot) => void
): () => void {
  connectionListeners.add(listener);
  listener(getFirebaseConnectionSnapshot());
  return () => {
    connectionListeners.delete(listener);
  };
}

export function isTransientFirestoreError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string };
  const code = String(anyErr?.code || '').toLowerCase();
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'aborted' ||
    code === 'resource-exhausted' ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('webchannelconnection') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to get document because the client is offline')
  );
}

export function isPermissionFirestoreError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string };
  const code = String(anyErr?.code || '').toLowerCase();
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission-denied')
  );
}

export function markFirestoreConnected(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const changed =
    connectionSnapshot.state !== 'connected' ||
    connectionSnapshot.retryAttempt !== 0 ||
    connectionSnapshot.lastError !== null;

  const now = new Date().toISOString();
  connectionSnapshot.state = 'connected';
  connectionSnapshot.lastConnectedAt = now;
  connectionSnapshot.lastCheckedAt = now;
  connectionSnapshot.lastError = null;
  connectionSnapshot.retryAttempt = 0;

  if (changed) {
    emitConnectionSnapshot();
  }
}

export function notifyFirestoreTransportError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err || 'Firestore transport error');
  connectionSnapshot.lastCheckedAt = new Date().toISOString();
  connectionSnapshot.lastError = msg.slice(0, 220);

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    connectionSnapshot.state = 'offline';
    emitConnectionSnapshot();
    return;
  }

  if (connectionSnapshot.state !== 'reconnecting') {
    connectionSnapshot.state = 'reconnecting';
    emitConnectionSnapshot();
  }
  scheduleBoundedReconnect();
}

function scheduleBoundedReconnect(): void {
  if (reconnectTimer) return;
  if (connectionSnapshot.retryAttempt >= connectionSnapshot.maxRetries) {
    connectionSnapshot.state = 'offline';
    emitConnectionSnapshot();
    return;
  }

  const attempt = connectionSnapshot.retryAttempt;
  const expMs = Math.min(32_000, 2000 * Math.pow(2, attempt));
  const jitterMs = Math.floor(Math.random() * 1200);
  const delayMs = expMs + jitterMs;

  connectionSnapshot.retryAttempt = attempt + 1;
  connectionSnapshot.state = 'reconnecting';
  emitConnectionSnapshot();

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await testConnection();
  }, delayMs);
}

export async function reconnectFirestore(): Promise<boolean> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connectionSnapshot.retryAttempt = 0;
  connectionSnapshot.state = 'connecting';
  emitConnectionSnapshot();
  try {
    await enableNetwork(db);
  } catch {
    // enableNetwork best-effort
  }
  return testConnection();
}

function buildErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function reportFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): string {
  const errInfo = buildErrorInfo(error, operationType, path);
  const raw = errInfo.error.toLowerCase();

  if (isTransientFirestoreError(error)) {
    notifyFirestoreTransportError(error);
    console.warn('Firestore transient connectivity issue:', path, errInfo.error);
    return 'Cloud Firestore is temporarily unreachable. Local cached state is preserved and reconnection will retry automatically.';
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (raw.includes('unauthenticated')) {
    return `Authentication session expired or missing for "${path || 'protected data'}". Please sign in again.`;
  }
  if (raw.includes('permission') || raw.includes('insufficient')) {
    return auth.currentUser
      ? `Access restricted on "${path || 'database'}". Ensure your account email is verified and has the required role permissions.`
      : `Sign in required to access "${path || 'protected library resources'}".`;
  }
  return errInfo.error;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (connectionProbeInFlight) return connectionProbeInFlight;

  connectionProbeInFlight = (async () => {
    try {
      // Probe public readable doc to verify backend reachability without triggering permission-denied logs
      await getDocFromServer(doc(db, 'library_settings', 'main'));
      markFirestoreConnected();
      return true;
    } catch (error) {
      if (isPermissionFirestoreError(error)) {
        // Reaching security rules confirms the Firestore backend is online
        markFirestoreConnected();
        return true;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('the client is offline')) {
        console.warn('Firestore connection probe reported client offline; scheduling bounded recovery.');
      }
      notifyFirestoreTransportError(error);
      return false;
    } finally {
      connectionProbeInFlight = null;
    }
  })();

  return connectionProbeInFlight;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    reconnectFirestore().catch(() => {});
  });
  window.addEventListener('offline', () => {
    connectionSnapshot.state = 'offline';
    connectionSnapshot.lastError = 'Browser reported network offline.';
    connectionSnapshot.lastCheckedAt = new Date().toISOString();
    emitConnectionSnapshot();
  });
}

testConnection();

export async function logAuditEvent(
  action: string,
  targetType: string,
  targetId: string,
  details: string,
  actorRole: string
): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await addDoc(collection(db, 'audit_logs'), {
      actorUid: auth.currentUser.uid,
      actorEmail: auth.currentUser.email || 'unknown@gyanaddalibrary.in',
      actorRole,
      action: action.slice(0, 120),
      targetType: targetType.slice(0, 80),
      targetId: targetId.slice(0, 128),
      details: details.slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write skipped:', err);
  }
}
