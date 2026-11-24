import React, { useEffect, useState } from 'react';
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
import { AuthModal } from './components/AuthModal';
import {
  AnnouncementRecord,
  BookRecord,
  CurrentAffairsItem,
  DigitalGKBook,
  ExamCategory,
  ExamQuestion,
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
        <div className="min-h-screen flex items-center justify-center bg-[#1C0E29] text-white p-6">
          <div className="max-w-md w-full rounded-xl bg-[#3D2C56] border border-[#7C7397] p-6 space-y-4 text-center">
            <h1 className="font-display text-xl font-bold text-white">
              Something went wrong
            </h1>
            <p className="text-xs text-[#CFCEDD] break-words">{this.state.message}</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white"
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
    studentRecord,
    effectiveRole,
    actualRole,
    loading,
    bootstrapWarning,
    connectionStatus,
    retryConnection,
    clearBootstrapWarning,
  } = useAuth();

  const [viewMode, setViewMode] = useState<'public' | 'portal'>('public');
  const [portalInitialTab, setPortalInitialTab] = useState<string>('overview');
  const [darkMode, setDarkMode] = useState(true);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<
    'login' | 'register' | 'reset' | 'complete_profile'
  >('login');

  // Public real-time Firestore state
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [seats, setSeats] = useState<SeatRecord[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);

  // Competitive Exam & Knowledge Platform collections
  const [exams, setExams] = useState<ExamCategory[]>([]);
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [mockTests, setMockTests] = useState<MockTestRecord[]>([]);
  const [currentAffairs, setCurrentAffairs] = useState<CurrentAffairsItem[]>([]);
  const [gkBooks, setGkBooks] = useState<DigitalGKBook[]>([]);

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

  // Redirect signed-in staff/admin automatically on login
  useEffect(() => {
    if (firebaseUser && !loading) {
      if (actualRole !== 'student') {
        setViewMode('portal');
      }
    }
  }, [firebaseUser, actualRole, loading]);

  // 1. Public catalog & website listeners (never require auth)
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
            setSettings({ id: snap.id, ...(snap.data() as Omit<LibrarySettings, 'id'>) });
          }
        },
        onListenerError(OperationType.GET, 'library_settings/main')
      )
    );

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
        collection(db, 'gallery'),
        (snap) => {
          markFirestoreConnected();
          setGallery(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        onListenerError(OperationType.LIST, 'gallery')
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

    return () => unsubs.forEach((u) => u());
  }, []);

  // 2. Role-scoped Current Affairs listener (waits until auth state initialization finishes)
  useEffect(() => {
    if (loading) return;

    const isStaff = Boolean(firebaseUser && actualRole !== 'student');
    const caRef = isStaff
      ? collection(db, 'current_affairs')
      : query(collection(db, 'current_affairs'), where('status', '==', 'published'));

    const unsub = onSnapshot(
      caRef,
      (snap) => {
        markFirestoreConnected();
        setCurrentAffairs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        const msg = reportFirestoreError(err, OperationType.LIST, 'current_affairs');
        if (!isTransientFirestoreError(err)) setFirestoreError(msg);
      }
    );

    return () => unsub();
  }, [loading, firebaseUser?.uid, actualRole]);

  // 3. Authenticated-only Examination collections (questions & mock_tests)
  useEffect(() => {
    if (loading || !firebaseUser) {
      setQuestions([]);
      setMockTests([]);
      return;
    }

    setFirestoreError(null);
    const isStaff = actualRole !== 'student';

    const questionsQuery = isStaff
      ? collection(db, 'questions')
      : query(collection(db, 'questions'), where('published', '==', true));

    const mockTestsQuery = isStaff
      ? collection(db, 'mock_tests')
      : query(collection(db, 'mock_tests'), where('active', '==', true));

    const unsubQuestions = onSnapshot(
      questionsQuery,
      (snap) => {
        markFirestoreConnected();
        setQuestions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        const msg = reportFirestoreError(err, OperationType.LIST, 'questions');
        if (!isTransientFirestoreError(err)) setFirestoreError(msg);
      }
    );

    const unsubMockTests = onSnapshot(
      mockTestsQuery,
      (snap) => {
        markFirestoreConnected();
        setMockTests(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        const msg = reportFirestoreError(err, OperationType.LIST, 'mock_tests');
        if (!isTransientFirestoreError(err)) setFirestoreError(msg);
      }
    );

    return () => {
      unsubQuestions();
      unsubMockTests();
    };
  }, [loading, firebaseUser?.uid, actualRole]);

  const openAuth = (tab: 'login' | 'register' | 'reset' | 'complete_profile') => {
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  };

  return (
    <>
      {/* Mandatory Google Maps Case A Quota Warning Banner */}
      {quotaExceeded && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-amber-400 text-[#0E0713] px-4 py-2 text-xs font-medium flex flex-wrap items-center justify-center gap-2 border-b border-amber-500"
        >
          <span>
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

      {(connectionStatus.state === 'offline' || connectionStatus.state === 'reconnecting') && (
        <div
          role="status"
          className="sticky top-0 z-40 bg-amber-950/95 text-amber-100 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/60"
        >
          <span>
            {connectionStatus.state === 'reconnecting'
              ? `Reconnecting to Cloud Firestore (attempt ${connectionStatus.retryAttempt}/${connectionStatus.maxRetries})... Local cached data remains available.`
              : 'Cloud Firestore offline — showing cached library data. Writes will sync when reconnected.'}
          </span>
          <button
            type="button"
            onClick={() => retryConnection()}
            className="px-2.5 py-1 rounded bg-amber-500 text-[#0E0713] font-bold hover:bg-amber-400"
          >
            Retry Connection
          </button>
        </div>
      )}

      {(firestoreError || bootstrapWarning) && (
        <div
          role="alert"
          className="sticky top-0 z-40 bg-rose-950/95 text-rose-100 px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3 border-b border-rose-500/60"
        >
          <span>{firestoreError || bootstrapWarning}</span>
          <button
            type="button"
            onClick={() => {
              setFirestoreError(null);
              clearBootstrapWarning();
            }}
            className="px-2.5 py-1 rounded bg-rose-800/80 hover:bg-rose-700 text-white font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="min-h-screen flex items-center justify-center bg-[#1C0E29] text-white">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-[#B5ADC6] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold tracking-wider uppercase text-[#CFCEDD]">
              Loading VIDHYA LIBRARY · Gyan Adda...
            </p>
          </div>
        </div>
      ) : viewMode === 'portal' && firebaseUser ? (
        effectiveRole === 'student' ? (
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
            onGoPublic={() => setViewMode('public')}
            onOpenCompleteProfile={() => openAuth('complete_profile')}
          />
        ) : (
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
            onGoPublic={() => setViewMode('public')}
          />
        )
      ) : (
        <PublicWebsite
          settings={settings}
          plans={plans}
          seats={seats}
          gallery={gallery}
          announcements={announcements}
          exams={exams}
          currentAffairs={currentAffairs}
          gkBooks={gkBooks}
          totalBooksCount={books.length}
          totalQuestionsCount={questions.length}
          isSignedIn={Boolean(firebaseUser)}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((v) => !v)}
          onOpenAuth={(tab) => openAuth(tab)}
          onOpenPortal={(initialTab) => {
            if (initialTab) setPortalInitialTab(initialTab);
            if (!firebaseUser) {
              openAuth('login');
            } else {
              setViewMode('portal');
              if (effectiveRole === 'student' && !studentRecord && initialTab !== 'exams') {
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
            setViewMode('portal');
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
