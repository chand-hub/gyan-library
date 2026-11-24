import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  FirebaseConnectionSnapshot,
  getFirebaseConnectionSnapshot,
  googleAuthProvider,
  isTransientFirestoreError,
  logAuditEvent,
  markFirestoreConnected,
  notifyFirestoreTransportError,
  reconnectFirestore,
  subscribeFirebaseConnection,
} from '../lib/firebase';
import { StudentRecord, UserProfile, UserRole } from '../types/library';
import { ensurePublicBootstrap, seedDemoDataset } from '../lib/demoSeed';
import {
  backfillQuestionPublishedFlags,
  ensureExamBootstrap,
  seedExamPlatformData,
} from '../lib/examSeed';

const ADMIN_OWNER_EMAIL = 'educationrevolution90@gmail.com';
const CACHED_CONTEXT_PREFIX = 'vl_auth_ctx_v1_';

interface CachedContextFallback {
  role: UserRole;
  staffPermissions: string[];
  profile: UserProfile | null;
  studentRecord: StudentRecord | null;
}

function saveCachedContext(uid: string, data: CachedContextFallback) {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`${CACHED_CONTEXT_PREFIX}${uid}`, JSON.stringify(data));
    }
  } catch {
    // ignore storage quota errors
  }
}

function loadCachedContext(uid: string): CachedContextFallback | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(`${CACHED_CONTEXT_PREFIX}${uid}`);
    if (!raw) return null;
    return JSON.parse(raw) as CachedContextFallback;
  } catch {
    return null;
  }
}

interface RegistrationDetails {
  fullName: string;
  mobile: string;
  email: string;
  password?: string;
  fatherName: string;
  address: string;
  emergencyContact: string;
  profilePhotoUrl?: string;
  idDocumentUrl?: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  studentRecord: StudentRecord | null;
  effectiveRole: UserRole;
  actualRole: UserRole;
  staffPermissions: string[];
  loading: boolean;
  authError: string | null;
  bootstrapWarning: string | null;
  connectionStatus: FirebaseConnectionSnapshot;
  retryConnection: () => Promise<boolean>;
  clearAuthError: () => void;
  clearBootstrapWarning: () => void;
  setPreviewRole: (role: UserRole | null) => void;
  previewRole: UserRole | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (identifier: string, password: string) => Promise<void>;
  registerStudentWithEmail: (details: RegistrationDetails) => Promise<void>;
  completeStudentProfile: (details: Omit<RegistrationDetails, 'password'>) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [studentRecord, setStudentRecord] = useState<StudentRecord | null>(null);
  const [actualRole, setActualRole] = useState<UserRole>('student');
  const [staffPermissions, setStaffPermissions] = useState<string[]>([]);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapWarning, setBootstrapWarning] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<FirebaseConnectionSnapshot>(() =>
    getFirebaseConnectionSnapshot()
  );

  const bootstrappedUidRef = useRef<string | null>(null);
  const resolvingUidRef = useRef<string | null>(null);
  const needsContextRecoveryRef = useRef<boolean>(false);
  const contextRetryCountRef = useRef<number>(0);
  const contextRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef<User | null>(null);

  useEffect(() => {
    return subscribeFirebaseConnection((snap) => {
      setConnectionStatus(snap);
    });
  }, []);

  const clearContextRetryTimer = () => {
    if (contextRetryTimerRef.current) {
      clearTimeout(contextRetryTimerRef.current);
      contextRetryTimerRef.current = null;
    }
  };

  const resolveUserContext = useCallback(async (user: User) => {
    if (resolvingUidRef.current === user.uid) return;
    resolvingUidRef.current = user.uid;

    const email = (user.email || '').toLowerCase();
    const isOwnerAdmin = email === ADMIN_OWNER_EMAIL && user.emailVerified === true;
    const cached = loadCachedContext(user.uid);

    let resolvedRole: UserRole = isOwnerAdmin ? 'admin' : cached?.role || 'student';
    let resolvedPerms: string[] = cached?.staffPermissions || [];
    let transientFailureOccurred = false;

    try {
      if (!isOwnerAdmin) {
        try {
          const adminDoc = await getDoc(doc(db, 'admins', user.uid));
          markFirestoreConnected();
          if (adminDoc.exists()) {
            resolvedRole = 'admin';
          } else {
            const roleDoc = await getDoc(doc(db, 'user_roles', user.uid));
            if (roleDoc.exists() && roleDoc.data().active === true) {
              const r = roleDoc.data().role;
              if (r === 'admin' || r === 'manager' || r === 'staff') {
                resolvedRole = r;
                resolvedPerms = Array.isArray(roleDoc.data().permissions)
                  ? roleDoc.data().permissions
                  : [];
              }
            }
          }
        } catch (roleErr) {
          if (isTransientFirestoreError(roleErr)) {
            transientFailureOccurred = true;
            notifyFirestoreTransportError(roleErr);
          } else {
            console.warn('Role lookup warning:', roleErr);
          }
        }
      } else if (bootstrappedUidRef.current !== user.uid) {
        // Auto-bootstrap initial demo & competitive exam datasets once per verified admin session
        try {
          const hasSettings = await ensurePublicBootstrap();
          markFirestoreConnected();
          if (!hasSettings) {
            await seedDemoDataset(user.uid);
          }
          const hasExams = await ensureExamBootstrap();
          if (!hasExams) {
            const token = await user.getIdToken();
            await seedExamPlatformData(token);
          } else {
            await backfillQuestionPublishedFlags();
          }
          bootstrappedUidRef.current = user.uid;
          setBootstrapWarning(null);
        } catch (e: any) {
          if (isTransientFirestoreError(e)) {
            transientFailureOccurred = true;
            notifyFirestoreTransportError(e);
            setBootstrapWarning(
              'Cloud Firestore is temporarily offline. Bootstrap will resume automatically once connectivity returns.'
            );
          } else {
            console.error('Auto-bootstrap error:', e);
            setBootstrapWarning(
              e?.message || 'Automatic initial data bootstrap encountered an error.'
            );
          }
        }
      }

      setActualRole(resolvedRole);
      setStaffPermissions(resolvedPerms);

      let loadedProfile: UserProfile | null = cached?.profile || null;
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        markFirestoreConnected();

        if (!userSnap.exists()) {
          const payload = {
            uid: user.uid,
            email: user.email || `${user.uid}@vidhyalibrary.in`,
            displayName: user.displayName || email.split('@')[0] || 'Library Member',
            role: resolvedRole,
            status: 'active' as const,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          if (user.emailVerified || isOwnerAdmin) {
            await setDoc(userRef, payload);
          }
          loadedProfile = { id: user.uid, ...payload };
        } else {
          const data = userSnap.data();
          loadedProfile = {
            id: userSnap.id,
            uid: data.uid,
            email: data.email,
            displayName: data.displayName,
            role: resolvedRole,
            studentDocId: data.studentDocId,
            staffDocId: data.staffDocId,
            status: data.status || 'active',
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        }
      } catch (profileErr) {
        if (isTransientFirestoreError(profileErr)) {
          transientFailureOccurred = true;
          notifyFirestoreTransportError(profileErr);
          if (!loadedProfile) {
            loadedProfile = {
              id: user.uid,
              uid: user.uid,
              email: user.email || `${user.uid}@vidhyalibrary.in`,
              displayName: user.displayName || email.split('@')[0] || 'Library Member',
              role: resolvedRole,
              status: 'active',
              createdAt: null,
              updatedAt: null,
            };
          }
        } else {
          throw profileErr;
        }
      }

      if (loadedProfile) {
        setProfile(loadedProfile);
      }

      let loadedStudent: StudentRecord | null = cached?.studentRecord || null;
      try {
        const q = query(collection(db, 'students'), where('uid', '==', user.uid));
        const sSnap = await getDocs(q);
        markFirestoreConnected();
        if (!sSnap.empty) {
          const first = sSnap.docs[0];
          loadedStudent = { id: first.id, ...(first.data() as Omit<StudentRecord, 'id'>) };
        } else {
          loadedStudent = null;
        }
        setStudentRecord(loadedStudent);
      } catch (studentErr) {
        if (isTransientFirestoreError(studentErr)) {
          transientFailureOccurred = true;
          notifyFirestoreTransportError(studentErr);
          if (loadedStudent) setStudentRecord(loadedStudent);
        } else {
          console.warn('Student profile lookup warning:', studentErr);
        }
      }

      saveCachedContext(user.uid, {
        role: resolvedRole,
        staffPermissions: resolvedPerms,
        profile: loadedProfile,
        studentRecord: loadedStudent,
      });

      if (transientFailureOccurred) {
        needsContextRecoveryRef.current = true;
        if (contextRetryCountRef.current < 3 && !contextRetryTimerRef.current) {
          const attempt = contextRetryCountRef.current;
          contextRetryCountRef.current += 1;
          const delayMs = 3000 * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
          contextRetryTimerRef.current = setTimeout(() => {
            contextRetryTimerRef.current = null;
            if (currentUserRef.current?.uid === user.uid) {
              resolveUserContext(currentUserRef.current).catch(() => {});
            }
          }, delayMs);
        }
      } else {
        needsContextRecoveryRef.current = false;
        contextRetryCountRef.current = 0;
        clearContextRetryTimer();
      }
    } finally {
      if (resolvingUidRef.current === user.uid) {
        resolvingUidRef.current = null;
      }
    }
  }, []);

  // Automatically recover deferred auth/bootstrap context when Firestore comes back online
  useEffect(() => {
    if (
      connectionStatus.state === 'connected' &&
      needsContextRecoveryRef.current &&
      currentUserRef.current
    ) {
      needsContextRecoveryRef.current = false;
      resolveUserContext(currentUserRef.current).catch(() => {});
    }
  }, [connectionStatus.state, resolveUserContext]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      currentUserRef.current = user;
      setFirebaseUser(user);
      if (!user) {
        bootstrappedUidRef.current = null;
        needsContextRecoveryRef.current = false;
        contextRetryCountRef.current = 0;
        clearContextRetryTimer();
        setProfile(null);
        setStudentRecord(null);
        setActualRole('student');
        setStaffPermissions([]);
        setPreviewRole(null);
        setBootstrapWarning(null);
        setLoading(false);
        return;
      }
      try {
        await resolveUserContext(user);
      } catch (err) {
        if (isTransientFirestoreError(err)) {
          notifyFirestoreTransportError(err);
          needsContextRecoveryRef.current = true;
        } else {
          console.error('Auth context resolution error:', err);
        }
      } finally {
        setLoading(false);
      }
    });
    return () => {
      clearContextRetryTimer();
      unsub();
    };
  }, [resolveUserContext]);

  const refreshProfile = async () => {
    if (firebaseUser) {
      await resolveUserContext(firebaseUser);
    }
  };

  const retryConnection = async () => {
    const ok = await reconnectFirestore();
    if (ok && currentUserRef.current) {
      await resolveUserContext(currentUserRef.current).catch(() => {});
    }
    return ok;
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: any) {
      setAuthError(err?.message || 'Google sign-in failed.');
      throw err;
    }
  };

  const signInWithEmail = async (identifier: string, password: string) => {
    setAuthError(null);
    const trimmed = identifier.trim();
    try {
      await signInWithEmailAndPassword(auth, trimmed, password);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setAuthError(
          'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Please enable it or use Google Sign-In.'
        );
      } else {
        setAuthError(err?.message || 'Invalid credentials.');
      }
      throw err;
    }
  };

  const createStudentDocument = async (
    user: User,
    details: Omit<RegistrationDetails, 'password'>
  ) => {
    const uniqueNum = String(Math.floor(100 + (Date.now() % 900000)));
    const studentCode = `VL2026${uniqueNum.slice(-3)}${String(Math.floor(Math.random() * 90 + 10))}`.slice(0, 11);

    const docRef = await addDoc(collection(db, 'students'), {
      uid: user.uid,
      studentCode,
      fullName: details.fullName.trim(),
      mobile: details.mobile.trim(),
      email: (details.email || user.email || '').trim(),
      fatherName: details.fatherName.trim(),
      address: details.address.trim(),
      emergencyContact: details.emergencyContact.trim(),
      ...(details.profilePhotoUrl?.trim() ? { profilePhotoUrl: details.profilePhotoUrl.trim() } : {}),
      ...(details.idDocumentUrl?.trim() ? { idDocumentUrl: details.idDocumentUrl.trim() } : {}),
      membershipStatus: 'none',
      status: 'active',
      isDemo: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'users', user.uid), {
      displayName: details.fullName.trim(),
      studentDocId: docRef.id,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent(
      'STUDENT_REGISTERED',
      'students',
      docRef.id,
      `New student registered with code ${studentCode}`,
      'student'
    );
  };

  const registerStudentWithEmail = async (details: RegistrationDetails) => {
    setAuthError(null);
    if (!details.password || details.password.length < 6) {
      const msg = 'Password must be at least 6 characters.';
      setAuthError(msg);
      throw new Error(msg);
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, details.email.trim(), details.password);
      await updateProfile(cred.user, { displayName: details.fullName.trim() });
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: details.email.trim(),
        displayName: details.fullName.trim(),
        role: 'student',
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await createStudentDocument(cred.user, details);
      await resolveUserContext(cred.user);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setAuthError(
          'Email/Password registration requires enabling the Email/Password provider in Firebase Console -> Authentication. You can register immediately using Google Sign-In instead.'
        );
      } else {
        setAuthError(err?.message || 'Registration failed.');
      }
      throw err;
    }
  };

  const completeStudentProfile = async (details: Omit<RegistrationDetails, 'password'>) => {
    if (!firebaseUser) throw new Error('Must be signed in.');
    await createStudentDocument(firebaseUser, details);
    await resolveUserContext(firebaseUser);
  };

  const sendPasswordReset = async (email: string) => {
    setAuthError(null);
    await sendPasswordResetEmail(auth, email.trim());
  };

  const signOut = async () => {
    setPreviewRole(null);
    await firebaseSignOut(auth);
  };

  const getIdToken = async () => {
    if (!firebaseUser) return null;
    return firebaseUser.getIdToken();
  };

  const effectiveRole: UserRole =
    actualRole === 'admin' && previewRole ? previewRole : actualRole;

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        studentRecord,
        effectiveRole,
        actualRole,
        staffPermissions,
        loading,
        authError,
        bootstrapWarning,
        connectionStatus,
        retryConnection,
        clearAuthError: () => setAuthError(null),
        clearBootstrapWarning: () => setBootstrapWarning(null),
        setPreviewRole,
        previewRole,
        signInWithGoogle,
        signInWithEmail,
        registerStudentWithEmail,
        completeStudentProfile,
        sendPasswordReset,
        signOut,
        refreshProfile,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
