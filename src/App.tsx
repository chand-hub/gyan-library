import React, { useCallback, useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  db,
  isTransientFirestoreError,
  markFirestoreConnected,
  OperationType,
  reportFirestoreError,
} from './lib/firebase';
import { PublicWebsite } from './components/PublicWebsite';
import { StudentPortal } from './components/StudentPortal';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginPage } from './components/AdminLoginPage';
import { AuthModal } from './components/AuthModal';
import {
  AnnouncementRecord,
  BookRecord,
  CurrentAffairsItem,
  DigitalGKBook,
  ExamCategory,
  ExamQuestion,
  FaqItem,
  GalleryItem,
  LibrarySettings,
  MembershipPlan,
  MockTestRecord,
  SeatRecord,
} from './types/library';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(err: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : 'Unexpected application error.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface p-6">
          <div className="max-w-md w-full rounded-xl bg-surface-container-lowest border border-outline-variant p-6 space-y-4 text-center shadow-sm">
            <h1 className="font-headline text-xl font-bold text-primary">
              Something went wrong
            </h1>
            <p className="text-xs text-on-surface-variant break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary transition-colors"
            >
              Reload View
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const MainRouter: React.FC = () => {
  const {
    firebaseUser,
    adminSession,
    studentRecord,
    effectiveRole,
    actualRole,
    loading,
    bootstrapWarning,
    connectionStatus,
    retryConnection,
    clearBootstrapWarning,
  } = useAuth();

  const [viewMode, setViewMode] = useState<'public' | 'admin_login' | 'portal'>(() => {
    if (typeof window !== 'undefined' && window.location.pathname === '/admin/login') {
      return 'admin_login';
    }
    return 'public';
  });
  const [portalInitialTab, setPortalInitialTab] = useState<string>('overview');
  const [darkMode, setDarkMode] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<
    'login' | 'register' | 'reset' | 'complete_profile'
  >('login');

  // Public content state (sanitized server API + public Firestore rules)
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [importantQuestions, setImportantQuestions] = useState<FaqItem[]>([]);

  // Authenticated-only library & exam collections
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [seats, setSeats] = useState<SeatRecord[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [exams, setExams] = useState<ExamCategory[]>([]);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [mockTests, setMockTests] = useState<MockTestRecord[]>([]);
  const [currentAffairs, setCurrentAffairs] = useState<CurrentAffairsItem[]>([]);
  const [gkBooks, setGkBooks] = useState<DigitalGKBook[]>([]);

  const syncRouteUrl = useCallback((mode: 'public' | 'admin_login' | 'portal') => {
    setViewMode(mode);
    if (typeof window === 'undefined') return;
    try {
      const targetPath = mode === 'admin_login' ? '/admin/login' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ viewMode: mode }, '', targetPath);
      }
    } catch {
      // Ignore history errors in sandboxed iframes
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (window.location.pathname === '/admin/login') {
        setViewMode('admin_login');
      } else {
        setViewMode('public');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  // Redirect signed-in Admin / Staff automatically into portal
  useEffect(() => {
    if (adminSession) {
      setViewMode('portal');
      return;
    }
    if (firebaseUser && !loading && actualRole !== 'student') {
      setViewMode('portal');
    }
  }, [adminSession, firebaseUser, actualRole, loading]);

  // Fetch sanitized public GYAN ADDA LIBRARY info from server API
  const refreshPublicLibraryInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/public/library-info');
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      if (Array.isArray(data.faqs)) setFaqs(data.faqs);
      if (Array.isArray(data.importantQuestions)) setImportantQuestions(data.importantQuestions);
      if (Array.isArray(data.gallery)) setGallery(data.gallery);
    } catch {
      // Fallback to Firestore public listeners or defaults
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'public') {
      refreshPublicLibraryInfo();
    }
  }, [viewMode, refreshPublicLibraryInfo]);

  // 1. Strict Public Firestore listeners (ONLY library_settings, approved gallery, published faqs)
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const onListenerError = (op: OperationType, path: string) => (err: unknown) => {
      const msg = reportFirestoreError(err, op, path);
      if (!isTransientFirestoreError(err)) {
        setFirestoreError(msg);
      }
    };

    unsubs.push(
      onSnapshot(
        doc(db, 'library_settings', 'main'),
        (snap) => {
          markFirestoreConnected();
          if (snap.exists()) {
            setSettings((prev) => ({
              ...(prev || {}),
              id: snap.id,
              ...(snap.data() as Omit<LibrarySettings, 'id'>),
            }));
          }
        },
        onListenerError(OperationType.GET, 'library_settings/main')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'gallery'), where('approved', '==', true)),
        (snap) => {
          markFirestoreConnected();
          if (!snap.empty) {
            setGallery(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
          }
        },
        () => {
          // Sanitized server /api/public/library-info provides approved gallery cleanly
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'faqs'), where('published', '==', true)),
        (snap) => {
          markFirestoreConnected();
          if (!snap.empty) {
            const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as FaqItem[];
            setFaqs(all.filter((f) => f.section === 'faq'));
            setImportantQuestions(all.filter((f) => f.section === 'important'));
          }
        },
        () => {
          // Sanitized server /api/public/library-info provides published FAQs cleanly
        }
      )
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  // 2. Authenticated-only operational & educational collections (never exposed on unauthenticated public homepage)
  useEffect(() => {
    if (loading || !firebaseUser) {
      setPlans([]);
      setSeats([]);
      setAnnouncements([]);
      setBooks([]);
      setExams([]);
      setGkBooks([]);
      setCurrentAffairs([]);
      setQuestions([]);
      setMockTests([]);
      return;
    }

    setFirestoreError(null);
    const isStaff = actualRole !== 'student';
    const unsubs: Array<() => void> = [];
    const onListenerError = (op: OperationType, path: string) => (err: unknown) => {
      const msg = reportFirestoreError(err, op, path);
      if (!isTransientFirestoreError(err)) {
        setFirestoreError(msg);
      }
    };

    unsubs.push(
      onSnapshot(
        collection(db, 'membership_plans'),
        (snap) => {
          markFirestoreConnected();
          setPlans(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'membership_plans')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'seats'),
        (snap) => {
          markFirestoreConnected();
          setSeats(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'seats')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'announcements'),
        (snap) => {
          markFirestoreConnected();
          setAnnouncements(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'announcements')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'books'),
        (snap) => {
          markFirestoreConnected();
          setBooks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'books')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'exams'),
        (snap) => {
          markFirestoreConnected();
          setExams(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'exams')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'gk_books'),
        (snap) => {
          markFirestoreConnected();
          setGkBooks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'gk_books')
      )
    );

    const caRef = isStaff
      ? collection(db, 'current_affairs')
      : query(collection(db, 'current_affairs'), where('status', '==', 'published'));
    unsubs.push(
      onSnapshot(
        caRef,
        (snap) => {
          markFirestoreConnected();
          setCurrentAffairs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'current_affairs')
      )
    );

    const questionsQuery = isStaff
      ? collection(db, 'questions')
      : query(collection(db, 'questions'), where('published', '==', true));
    unsubs.push(
      onSnapshot(
        questionsQuery,
        (snap) => {
          markFirestoreConnected();
          setQuestions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'questions')
      )
    );

    const mockTestsQuery = isStaff
      ? collection(db, 'mock_tests')
      : query(collection(db, 'mock_tests'), where('active', '==', true));
    unsubs.push(
      onSnapshot(
        mockTestsQuery,
        (snap) => {
          markFirestoreConnected();
          setMockTests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'mock_tests')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [loading, firebaseUser?.uid, actualRole]);

  const openAuth = (tab: 'login' | 'register' | 'reset' | 'complete_profile') => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  const hasAdminOrStaffAccess = Boolean(adminSession) || (Boolean(firebaseUser) && effectiveRole !== 'student');

  return (
    <>
      {quotaExceeded && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-warning-container text-on-warning-container px-4 py-2 text-xs font-medium flex flex-wrap items-center justify-center gap-2 border-b border-warning/30"
        >
          <span className="min-w-0 break-words">
            Map quota limit reached for the preview key. For production deployment, link a Cloud billing-enabled Google Maps API key.
          </span>
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold"
          >
            Learn how to configure billing &amp; keys
          </a>
        </div>
      )}

      {firebaseUser && (connectionStatus.state === 'offline' || connectionStatus.state === 'reconnecting') && (
        <div
          role="status"
          className="sticky top-0 z-40 bg-warning-container text-on-warning-container px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-warning/30"
        >
          <span className="min-w-0 break-words">
            {connectionStatus.state === 'reconnecting'
              ? `Reconnecting to Cloud Firestore (attempt ${connectionStatus.retryAttempt}/${connectionStatus.maxRetries})... Local cached data remains available.`
              : 'Cloud Firestore offline — showing cached library data. Writes will sync when reconnected.'}
          </span>
          <button
            type="button"
            onClick={() => retryConnection()}
            className="px-2.5 py-1 rounded bg-primary text-on-primary font-semibold hover:bg-primary-container shrink-0"
          >
            Retry Connection
          </button>
        </div>
      )}

      {(firestoreError || bootstrapWarning) && (
        <div
          role="alert"
          className="sticky top-0 z-40 bg-error-container text-on-error-container px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-error/30"
        >
          <span className="min-w-0 break-words">{firestoreError || bootstrapWarning}</span>
          <button
            type="button"
            onClick={() => {
              setFirestoreError(null);
              clearBootstrapWarning();
            }}
            className="px-2.5 py-1 rounded bg-error text-on-error font-semibold hover:opacity-90 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading && !adminSession ? (
        <div className="min-h-screen flex items-center justify-center bg-surface text-on-surface">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant">
              Loading GYAN ADDA LIBRARY...
            </p>
          </div>
        </div>
      ) : viewMode === 'admin_login' && !hasAdminOrStaffAccess ? (
        <AdminLoginPage
          onBackToPublic={() => syncRouteUrl('public')}
          onSuccess={() => syncRouteUrl('portal')}
        />
      ) : viewMode === 'portal' && (hasAdminOrStaffAccess || firebaseUser) ? (
        hasAdminOrStaffAccess ? (
          <AdminDashboard
            settings={settings}
            plans={plans}
            seats={seats}
            books={books}
            gallery={gallery}
            announcements={announcements}
            exams={exams}
            questions={questions}
            mockTests={mockTests}
            currentAffairs={currentAffairs}
            gkBooks={gkBooks}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((v) => !v)}
            onGoPublic={() => syncRouteUrl('public')}
          />
        ) : (
          <StudentPortal
            settings={settings}
            plans={plans}
            seats={seats}
            books={books}
            announcements={announcements}
            exams={exams}
            questions={questions}
            mockTests={mockTests}
            currentAffairs={currentAffairs}
            gkBooks={gkBooks}
            initialTab={portalInitialTab}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((v) => !v)}
            onGoPublic={() => syncRouteUrl('public')}
            onOpenCompleteProfile={() => openAuth('complete_profile')}
          />
        )
      ) : (
        <PublicWebsite
          settings={settings}
          faqs={faqs}
          importantQuestions={importantQuestions}
          gallery={gallery}
          isSignedIn={Boolean(firebaseUser || adminSession)}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((v) => !v)}
          onOpenAdminLogin={() =>
            hasAdminOrStaffAccess ? syncRouteUrl('portal') : syncRouteUrl('admin_login')
          }
          onOpenStudentAuth={(tab) => openAuth(tab)}
          onOpenPortal={() => {
            setPortalInitialTab('overview');
            if (!firebaseUser && !adminSession) {
              openAuth('login');
            } else {
              syncRouteUrl('portal');
              if (effectiveRole === 'student' && !studentRecord) {
                openAuth('complete_profile');
              }
            }
          }}
          quotaExceeded={quotaExceeded}
        />
      )}

      {authModalOpen && (
        <AuthModal
          isOpen={authModalOpen}
          initialTab={authModalTab}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            setAuthModalOpen(false);
            syncRouteUrl('portal');
          }}
        />
      )}
    </>
  );
};

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <MainRouter />
      </AuthProvider>
    </AppErrorBoundary>
  );
}
