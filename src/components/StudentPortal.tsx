import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Home,
  LayoutGrid,
  LogOut,
  Moon,
  Newspaper,
  Printer,
  RefreshCw,
  Search,
  Sun,
  User as UserIcon,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  db,
  isTransientFirestoreError,
  logAuditEvent,
  markFirestoreConnected,
  OperationType,
  reportFirestoreError,
} from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  AnnouncementRecord,
  AttendanceRecord,
  BookIssueRecord,
  BookRecord,
  CurrentAffairsItem,
  DigitalGKBook,
  ExamCategory,
  ExamQuestion,
  LibrarySettings,
  MembershipPlan,
  MembershipRecord,
  MockTestRecord,
  NotificationRecord,
  PaymentRecord,
  SeatBookingRecord,
  SeatRecord,
  StudentRecord,
  StudyBookmark,
  TestAttemptRecord,
} from '../types/library';
import { BrandLogo } from './BrandLogo';
import { downloadReceiptHtml } from '../lib/receiptPdf';
import { CompetitiveExamHub } from './exam/CompetitiveExamHub';
import { ActiveTestConfig, OnlineExamRunner } from './exam/OnlineExamRunner';
import { PerformanceAnalysisView } from './exam/PerformanceAnalysisView';
import { CurrentAffairsModule } from './exam/CurrentAffairsModule';
import { DigitalGKBookModule } from './exam/DigitalGKBookModule';

interface StudentPortalProps {
  settings: LibrarySettings | null;
  plans: MembershipPlan[];
  seats: SeatRecord[];
  books: BookRecord[];
  announcements: AnnouncementRecord[];
  exams: ExamCategory[];
  questions: ExamQuestion[];
  mockTests: MockTestRecord[];
  currentAffairs: CurrentAffairsItem[];
  gkBooks: DigitalGKBook[];
  initialTab?: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onGoPublic: () => void;
  onOpenCompleteProfile: () => void;
}

type StudentTab =
  | 'overview'
  | 'exams'
  | 'performance'
  | 'current_affairs'
  | 'gk_books'
  | 'membership'
  | 'seats'
  | 'attendance'
  | 'payments'
  | 'books'
  | 'notifications'
  | 'profile';

const VALID_TABS: StudentTab[] = [
  'overview',
  'exams',
  'performance',
  'current_affairs',
  'gk_books',
  'membership',
  'seats',
  'attendance',
  'payments',
  'books',
  'notifications',
  'profile',
];

export const StudentPortal: React.FC<StudentPortalProps> = ({
  settings,
  plans,
  seats,
  books,
  announcements,
  exams,
  questions,
  mockTests,
  currentAffairs,
  gkBooks,
  initialTab,
  darkMode,
  onToggleDarkMode,
  onGoPublic,
  onOpenCompleteProfile,
}) => {
  const {
    firebaseUser,
    studentRecord,
    actualRole,
    setPreviewRole,
    signOut,
    sendPasswordReset,
    refreshProfile,
    getIdToken,
    connectionStatus,
    retryConnection,
  } = useAuth();

  const resolvedInitialTab: StudentTab = VALID_TABS.includes(initialTab as StudentTab)
    ? (initialTab as StudentTab)
    : 'overview';

  const [tab, setTab] = useState<StudentTab>(resolvedInitialTab);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [bookings, setBookings] = useState<SeatBookingRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [bookIssues, setBookIssues] = useState<BookIssueRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);
  const [bookmarks, setBookmarks] = useState<StudyBookmark[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Active CBT & Performance state
  const [activeTest, setActiveTest] = useState<ActiveTestConfig | null>(null);
  const [sessionQuestions, setSessionQuestions] = useState<ExamQuestion[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<TestAttemptRecord | null>(null);

  // Filters
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [bookSearch, setBookSearch] = useState('');
  const [receiptPreview, setReceiptPreview] = useState<PaymentRecord | null>(null);

  // Checkout Modal State (for Razorpay Live / Sandbox verification)
  const [checkoutPlan, setCheckoutPlan] = useState<MembershipPlan | null>(null);
  const [checkoutMethod, setCheckoutMethod] = useState<'razorpay_upi' | 'razorpay_card' | 'razorpay_netbanking'>('razorpay_upi');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Profile edit state
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmergency, setEditEmergency] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (initialTab && VALID_TABS.includes(initialTab as StudentTab)) {
      setTab(initialTab as StudentTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (studentRecord) {
      setEditName(studentRecord.fullName);
      setEditMobile(studentRecord.mobile);
      setEditAddress(studentRecord.address);
      setEditEmergency(studentRecord.emergencyContact);
      setEditPhoto(studentRecord.profilePhotoUrl || '');
    }
  }, [studentRecord]);

  useEffect(() => {
    if (!firebaseUser) return;
    const uid = firebaseUser.uid;

    const handleSnapErr = (err: unknown, path: string) => {
      const msg = reportFirestoreError(err, OperationType.LIST, path);
      if (!isTransientFirestoreError(err)) {
        notify('err', msg);
      }
    };

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'memberships'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setMemberships(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MembershipRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'memberships')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'seat_bookings'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SeatBookingRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'seat_bookings')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'attendance'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setAttendance(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AttendanceRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'attendance')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'book_issues'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setBookIssues(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BookIssueRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'book_issues')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'payments'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'payments')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('recipientUid', 'in', [uid, 'ALL_STUDENTS'])),
        (snap) => {
          markFirestoreConnected();
          setNotifications(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'notifications')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'test_attempts'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          const loaded = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestAttemptRecord, 'id'>) }));
          loaded.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
          setAttempts(loaded);
        },
        (err) => handleSnapErr(err, 'test_attempts')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'study_bookmarks'), where('userUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setBookmarks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyBookmark, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'study_bookmarks')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [firebaseUser?.uid]);

  const activeStudent: StudentRecord | null = studentRecord;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOpenRecord = useMemo(
    () => attendance.find((a) => a.date === todayStr && !a.checkOutTime),
    [attendance, todayStr]
  );

  const totalStudyHours = useMemo(() => {
    const mins = attendance.reduce((acc, a) => acc + (a.durationMinutes || 0), 0);
    return (mins / 60).toFixed(1);
  }, [attendance]);

  const pendingDues = useMemo(
    () => payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0),
    [payments]
  );

  const filteredSeats = useMemo(() => {
    if (zoneFilter === 'ALL') return seats;
    return seats.filter((s) => s.zone === zoneFilter);
  }, [seats, zoneFilter]);

  const filteredBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.categoryName.toLowerCase().includes(q)
    );
  }, [books, bookSearch]);

  const questionsMap = useMemo(() => {
    const map = new Map<string, ExamQuestion>();
    sessionQuestions.forEach((q) => map.set(q.id, q));
    questions.forEach((q) => map.set(q.id, q));
    return map;
  }, [questions, sessionQuestions]);

  const unreadCount = notifications.filter((n) => !n.read && n.recipientUid === firebaseUser?.uid).length;
  const latestAttempt = selectedAttempt || attempts.find((a) => a.status === 'submitted') || null;

  const notify = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  };

  const launchTest = (cfg: ActiveTestConfig) => {
    setSessionQuestions((prev) => {
      const seen = new Set(prev.map((q) => q.id));
      const extras = cfg.questions.filter((q) => !seen.has(q.id));
      return extras.length > 0 ? [...prev, ...extras] : prev;
    });
    setActiveTest(cfg);
  };

  const handlePracticeWeakTopic = (topicOrChapter: string, type: 'topic' | 'chapter') => {
    const pool = questions.filter((q) =>
      type === 'topic' ? q.topic === topicOrChapter : q.chapter === topicOrChapter
    );
    const sourcePool = [...(pool.length ? pool : questions)];
    for (let i = sourcePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sourcePool[i], sourcePool[j]] = [sourcePool[j], sourcePool[i]];
    }
    const chosen = sourcePool.slice(0, 25);
    if (!chosen.length) {
      notify('err', 'No questions available for targeted weak-area practice.');
      return;
    }
    const examMeta = exams.find((e) => e.name === chosen[0].examName);
    launchTest({
      title: `Weak Area Practice: ${topicOrChapter}`,
      examName: chosen[0].examName,
      testType: type,
      mode: 'practice',
      ...(type === 'topic' ? { topic: topicOrChapter } : { chapter: topicOrChapter }),
      questions: chosen,
      durationMinutes: chosen.length * 2,
      marksPerCorrect: examMeta?.marksPerCorrect ?? 2,
      negativeMarks: examMeta?.negativeMarks ?? 0.5,
      isTimed: false,
    });
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStudent) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, 'students', activeStudent.id), {
        fullName: editName.trim(),
        mobile: editMobile.trim(),
        address: editAddress.trim(),
        emergencyContact: editEmergency.trim(),
        ...(editPhoto.trim() ? { profilePhotoUrl: editPhoto.trim() } : {}),
        updatedAt: serverTimestamp(),
      });
      await refreshProfile();
      notify('ok', 'Student profile updated successfully.');
    } catch (err: any) {
      notify('err', err?.message || 'Unable to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleBookSeat = async (seat: SeatRecord) => {
    if (!activeStudent || !firebaseUser) {
      onOpenCompleteProfile();
      return;
    }
    if (seat.status !== 'available') {
      notify('err', `Seat ${seat.seatCode} is currently ${seat.status}. Please select an available seat.`);
      return;
    }
    const existingPending = bookings.find((b) => b.status === 'pending');
    if (existingPending) {
      notify('err', `You already have a pending booking request for seat ${existingPending.seatCode}.`);
      return;
    }

    try {
      await updateDoc(doc(db, 'seats', seat.id), {
        status: 'reserved',
        assignedStudentDocId: activeStudent.id,
        assignedStudentUid: firebaseUser.uid,
        assignedStudentCode: activeStudent.studentCode,
        updatedAt: serverTimestamp(),
      });

      const bookingType = activeStudent.seatCode ? 'change' : 'new';
      await addDoc(collection(db, 'seat_bookings'), {
        seatId: seat.id,
        seatCode: seat.seatCode,
        studentDocId: activeStudent.id,
        studentUid: firebaseUser.uid,
        studentCode: activeStudent.studentCode,
        studentName: activeStudent.fullName,
        bookingType,
        status: 'pending',
        notes: bookingType === 'change' ? `Seat change request from ${activeStudent.seatCode}` : 'Initial seat reservation',
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'notifications'), {
        recipientUid: firebaseUser.uid,
        type: 'seat_allocation',
        title: `Seat ${seat.seatCode} Reserved`,
        message: `Your request for desk ${seat.seatCode} (${seat.zone}) has been submitted for desk confirmation.`,
        read: false,
        channel: 'in_app',
        createdAt: serverTimestamp(),
      });

      notify('ok', `Seat ${seat.seatCode} reserved and submitted for confirmation.`);
    } catch (err: any) {
      notify('err', err?.message || 'Seat booking failed. It may have just been claimed.');
    }
  };

  const handleCancelBooking = async (booking: SeatBookingRecord) => {
    try {
      await updateDoc(doc(db, 'seat_bookings', booking.id), {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'seats', booking.seatId), {
        status: 'available',
        assignedStudentDocId: '',
        assignedStudentUid: '',
        assignedStudentCode: '',
        updatedAt: serverTimestamp(),
      });
      notify('ok', `Booking for ${booking.seatCode} cancelled and seat released.`);
    } catch (err: any) {
      notify('err', err?.message || 'Unable to cancel booking.');
    }
  };

  const handleCheckIn = async () => {
    if (!activeStudent || !firebaseUser) return;
    if (todayOpenRecord) {
      notify('err', 'You are already checked in today. Please check out before starting a new session.');
      return;
    }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const isLate = now.getHours() >= 10;
    try {
      await addDoc(collection(db, 'attendance'), {
        studentDocId: activeStudent.id,
        studentUid: firebaseUser.uid,
        studentCode: activeStudent.studentCode,
        studentName: activeStudent.fullName,
        date: todayStr,
        checkInTime: hhmm,
        durationMinutes: 0,
        method: 'qr',
        isLate,
        markedBy: firebaseUser.uid,
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      notify('ok', `Checked in at ${hhmm}. Have a productive study session.`);
    } catch (err: any) {
      notify('err', err?.message || 'Check-in failed.');
    }
  };

  const handleCheckOut = async () => {
    if (!todayOpenRecord) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const [inH, inM] = todayOpenRecord.checkInTime.split(':').map(Number);
    const startMins = (inH || 0) * 60 + (inM || 0);
    const endMins = now.getHours() * 60 + now.getMinutes();
    const durationMinutes = Math.max(1, endMins - startMins);
    try {
      await updateDoc(doc(db, 'attendance', todayOpenRecord.id), {
        checkOutTime: hhmm,
        durationMinutes,
        updatedAt: serverTimestamp(),
      });
      notify('ok', `Checked out at ${hhmm} (${durationMinutes} mins logged).`);
    } catch (err: any) {
      notify('err', err?.message || 'Check-out failed.');
    }
  };

  const handleRequestBook = async (book: BookRecord) => {
    if (!activeStudent || !firebaseUser) {
      onOpenCompleteProfile();
      return;
    }
    if (book.availableCopies < 1) {
      notify('err', 'No copies are currently available for borrowing.');
      return;
    }
    const alreadyRequested = bookIssues.some(
      (i) => i.bookId === book.id && (i.status === 'requested' || i.status === 'issued')
    );
    if (alreadyRequested) {
      notify('err', 'You already have an active request or issue for this book.');
      return;
    }
    try {
      await addDoc(collection(db, 'book_issues'), {
        bookId: book.id,
        bookTitle: book.title,
        studentDocId: activeStudent.id,
        studentUid: firebaseUser.uid,
        studentCode: activeStudent.studentCode,
        studentName: activeStudent.fullName,
        fineAmount: 0,
        status: 'requested',
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      notify('ok', `Book request submitted for "${book.title}". Collect at desk once approved.`);
    } catch (err: any) {
      notify('err', err?.message || 'Unable to submit book request.');
    }
  };

  const handleCompleteRazorpayCheckout = async () => {
    if (!checkoutPlan || !activeStudent || !firebaseUser) return;
    setCheckoutLoading(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication token unavailable.');

      const receiptNumber = `VL-RCP-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
      const startDate = new Date().toISOString().slice(0, 10);
      const expiryDate = new Date(Date.now() + checkoutPlan.durationDays * 86400000)
        .toISOString()
        .slice(0, 10);

      const paymentRef = await addDoc(collection(db, 'payments'), {
        receiptNumber,
        studentDocId: activeStudent.id,
        studentUid: firebaseUser.uid,
        studentCode: activeStudent.studentCode,
        studentName: activeStudent.fullName,
        planId: checkoutPlan.id,
        planName: checkoutPlan.name,
        amount: checkoutPlan.price,
        method: checkoutMethod,
        status: 'pending',
        notes: 'Online Razorpay initiation',
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const membershipRef = await addDoc(collection(db, 'memberships'), {
        studentDocId: activeStudent.id,
        studentUid: firebaseUser.uid,
        studentCode: activeStudent.studentCode,
        studentName: activeStudent.fullName,
        planId: checkoutPlan.id,
        planName: checkoutPlan.name,
        amount: checkoutPlan.price,
        startDate,
        expiryDate,
        status: 'pending',
        paymentId: paymentRef.id,
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const orderRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: checkoutPlan.price,
          planId: checkoutPlan.id,
          planName: checkoutPlan.name,
          studentCode: activeStudent.studentCode,
          receiptNumber,
        }),
      });
      if (!orderRes.ok) {
        const errBody = await orderRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Failed to create Razorpay order.');
      }
      const orderData = await orderRes.json();

      let rzOrderId = orderData.orderId;
      let rzPaymentId = '';
      let rzSignature = '';

      if (orderData.mode === 'live' && orderData.keyId) {
        await new Promise<void>((resolve, reject) => {
          if ((window as any).Razorpay) return resolve();
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay Checkout SDK.'));
          document.body.appendChild(script);
        });

        const rzResult = await new Promise<{
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }>((resolve, reject) => {
          const rz = new (window as any).Razorpay({
            key: orderData.keyId,
            amount: orderData.amountPaise,
            currency: orderData.currency,
            name: settings?.libraryName || 'VIDHYA LIBRARY',
            description: checkoutPlan.name,
            order_id: orderData.orderId,
            prefill: {
              name: activeStudent.fullName,
              email: activeStudent.email,
              contact: activeStudent.mobile,
            },
            handler: (resp: any) => resolve(resp),
            modal: {
              ondismiss: () => reject(new Error('Payment window closed before completion.')),
            },
          });
          rz.open();
        });

        rzOrderId = rzResult.razorpay_order_id;
        rzPaymentId = rzResult.razorpay_payment_id;
        rzSignature = rzResult.razorpay_signature;
      } else {
        const signRes = await fetch('/api/payments/sandbox-sign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ orderId: rzOrderId }),
        });
        if (!signRes.ok) throw new Error('Sandbox signature generation failed.');
        const signData = await signRes.json();
        rzPaymentId = signData.razorpayPaymentId;
        rzSignature = signData.razorpaySignature;
      }

      const verifyRes = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          razorpayOrderId: rzOrderId,
          razorpayPaymentId: rzPaymentId,
          razorpaySignature: rzSignature,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error || 'Payment signature verification failed.');
      }

      await updateDoc(doc(db, 'payments', paymentRef.id), {
        status: 'verified',
        razorpayOrderId: rzOrderId,
        razorpayPaymentId: rzPaymentId,
        razorpaySignature: rzSignature,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'memberships', membershipRef.id), {
        status: 'active',
        paymentId: paymentRef.id,
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'notifications'), {
        recipientUid: firebaseUser.uid,
        type: 'payment_confirmation',
        title: `Payment Verified · ${receiptNumber}`,
        message: `${checkoutPlan.name} activated until ${expiryDate}. Amount INR ${checkoutPlan.price}.`,
        read: false,
        channel: 'in_app',
        createdAt: serverTimestamp(),
      });

      await logAuditEvent(
        'RAZORPAY_PAYMENT_VERIFIED',
        'payments',
        paymentRef.id,
        `Plan ${checkoutPlan.name} verified (${verifyData.mode})`,
        'student'
      );

      setCheckoutPlan(null);
      notify('ok', `Payment verified and ${checkoutPlan.name} activated!`);
    } catch (err: any) {
      notify('err', err?.message || 'Payment verification failed.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Active full-screen CBT Test Runner takeover
  if (activeTest && firebaseUser) {
    return (
      <div className="min-h-screen bg-[#1C0E29] text-white p-4 sm:p-6">
        <OnlineExamRunner
          config={activeTest}
          studentUid={firebaseUser.uid}
          studentDocId={activeStudent?.id}
          studentCode={activeStudent?.studentCode || 'GUEST'}
          studentName={activeStudent?.fullName || firebaseUser.displayName || 'Aspirant'}
          getIdToken={getIdToken}
          onComplete={(attempt) => {
            setActiveTest(null);
            setSelectedAttempt(attempt);
            setTab('performance');
          }}
          onExit={() => setActiveTest(null)}
        />
      </div>
    );
  }

  const navItems: Array<{ id: StudentTab; label: string; icon: any }> = [
    { id: 'overview', label: 'Overview', icon: LayoutGrid },
    { id: 'exams', label: 'Competitive Exams', icon: Award },
    { id: 'performance', label: 'AI Analytics', icon: BarChart3 },
    { id: 'current_affairs', label: 'Current Affairs', icon: Newspaper },
    { id: 'gk_books', label: 'Digital GK Books', icon: BookMarked },
    { id: 'membership', label: 'Membership', icon: CheckCircle2 },
    { id: 'seats', label: 'Seat Booking', icon: Home },
    { id: 'attendance', label: 'Attendance', icon: CalendarCheck },
    { id: 'payments', label: 'Payments & Receipts', icon: CreditCard },
    { id: 'books', label: 'Library Books', icon: BookOpen },
    { id: 'notifications', label: `Notifications${unreadCount ? ` (${unreadCount})` : ''}`, icon: Bell },
    { id: 'profile', label: 'Profile', icon: UserIcon },
  ];

  return (
    <div className="min-h-screen bg-[#1C0E29] text-white flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-64 bg-[#0E0713] border-b lg:border-b-0 lg:border-r border-[#7C7397]/40 shrink-0 no-print">
        <div className="p-5 border-b border-[#7C7397]/40 flex items-center justify-between">
          <BrandLogo compact />
          <button
            type="button"
            onClick={onGoPublic}
            className="text-xs font-medium text-[#CFCEDD] hover:text-white"
          >
            Website
          </button>
        </div>

        <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#B5ADC6] text-[#0E0713] font-semibold'
                    : 'text-[#CFCEDD] hover:bg-[#3D2C56] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#7C7397]/40 hidden lg:block space-y-2">
          {actualRole === 'admin' && (
            <button
              type="button"
              onClick={() => setPreviewRole(null)}
              className="w-full py-2 px-3 rounded-lg bg-[#514871] border border-[#7C7397] text-white text-xs font-semibold hover:bg-[#675D85]"
            >
              Return to Admin Console
            </button>
          )}
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-[#7C7397]/60 text-xs font-medium text-[#CFCEDD] hover:bg-[#3D2C56] hover:text-white"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-[#0E0713] border-b border-[#7C7397]/40 px-6 flex items-center justify-between gap-4 no-print">
          <div className="min-w-0">
            <h1 className="font-display text-lg font-bold text-white truncate">
              Student Learning Portal {activeStudent ? `· ${activeStudent.studentCode}` : ''}
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                retryConnection().catch(() => {});
              }}
              title={
                connectionStatus.lastError
                  ? `Database status: ${connectionStatus.state} (${connectionStatus.lastError})`
                  : `Database status: ${connectionStatus.state}`
              }
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition-colors ${
                connectionStatus.state === 'connected'
                  ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                  : connectionStatus.state === 'offline'
                    ? 'border-rose-500/50 bg-rose-950/50 text-rose-200 hover:bg-rose-900/60'
                    : 'border-amber-500/50 bg-amber-950/50 text-amber-200'
              }`}
            >
              {connectionStatus.state === 'connected' ? (
                <Wifi className="w-3 h-3" />
              ) : connectionStatus.state === 'offline' ? (
                <WifiOff className="w-3 h-3" />
              ) : (
                <RefreshCw className="w-3 h-3 animate-spin" />
              )}
              <span>
                {connectionStatus.state === 'connected'
                  ? 'Live Sync'
                  : connectionStatus.state === 'offline'
                    ? 'Offline (Cached) · Retry'
                    : 'Reconnecting...'}
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-[#7C7397]/60 text-[#CFCEDD] hover:text-white"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={signOut}
              className="lg:hidden px-3 py-1.5 rounded-lg border border-[#7C7397]/60 text-xs font-medium text-[#CFCEDD]"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="p-6 max-w-6xl w-full mx-auto space-y-6">
          {feedback && (
            <div
              className={`p-3.5 rounded-lg border text-sm ${
                feedback.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/60 text-red-200'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {!activeStudent && (
            <div className="p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold text-white">
                  Complete Your Student Registration
                </h2>
                <p className="text-sm text-[#CFCEDD] mt-1">
                  Generate your unique Student ID (VL2026XXX) and QR Pass to book seats, record attendance, and activate memberships. Competitive exams and GK notes are already unlocked!
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenCompleteProfile}
                className="px-4 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold whitespace-nowrap shrink-0 hover:bg-white"
              >
                Complete Profile
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              {activeStudent && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8 p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex flex-col justify-between">
                    <div>
                      <p className="text-xs font-semibold text-[#B5ADC6]">Welcome Back · Gyan Adda Campus</p>
                      <h2 className="mt-1 font-display text-2xl font-bold text-white">
                        {activeStudent.fullName}
                      </h2>
                      <p className="mt-1 text-xs text-[#CFCEDD]">
                        Student ID <span className="font-mono font-semibold text-white">{activeStudent.studentCode}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{activeStudent.email}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{activeStudent.mobile}</span>
                      </p>
                    </div>

                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-[#7C7397]/30">
                      <div>
                        <p className="text-xs text-[#9993AC]">Membership</p>
                        <p className="mt-1 text-sm font-bold capitalize text-white">
                          {memberships.find((m) => m.status === 'active')?.status || activeStudent.membershipStatus}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#9993AC]">Expiry Date</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-white">
                          {memberships.find((m) => m.status === 'active')?.expiryDate || activeStudent.membershipExpiry || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#9993AC]">Assigned Seat</p>
                        <p className="mt-1 font-mono text-sm font-bold text-white">
                          {activeStudent.seatCode ||
                            (bookings.find((b) => b.status === 'pending')
                              ? `${bookings.find((b) => b.status === 'pending')?.seatCode} (Pending)`
                              : 'Unassigned')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-[#9993AC]">Study Hours</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-white">{totalStudyHours} hrs</p>
                      </div>
                    </div>
                  </div>

                  {/* Student QR Pass */}
                  <div className="lg:col-span-4 p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex flex-col items-center justify-center text-center">
                    <div className="p-3 bg-white rounded-lg border border-[#7C7397]">
                      <QRCodeSVG
                        value={JSON.stringify({
                          studentCode: activeStudent.studentCode,
                          uid: activeStudent.uid,
                          studentDocId: activeStudent.id,
                        })}
                        size={132}
                      />
                    </div>
                    <p className="mt-3 font-mono text-sm font-bold text-white">
                      {activeStudent.studentCode}
                    </p>
                    <p className="text-xs text-[#CFCEDD]">
                      Scan at library desk for check-in & book lending
                    </p>
                  </div>
                </div>
              )}

              {/* Quick KPI & Competitive Exam Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeStudent && (
                  <div className="p-5 rounded-xl bg-[#514871] border border-[#7C7397]/40 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-[#CFCEDD]">Daily Attendance</p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-white">
                        {todayOpenRecord ? `In (${todayOpenRecord.checkInTime})` : 'Not Checked In'}
                      </p>
                    </div>
                    {todayOpenRecord ? (
                      <button
                        type="button"
                        onClick={handleCheckOut}
                        className="px-3 py-1.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
                      >
                        Check Out
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCheckIn}
                        className="px-3 py-1.5 rounded-lg bg-[#0E0713] text-white border border-[#7C7397]/60 text-xs font-semibold"
                      >
                        Check In
                      </button>
                    )}
                  </div>
                )}

                <div className="p-5 rounded-xl bg-[#514871] border border-[#7C7397]/40">
                  <p className="text-xs text-[#CFCEDD]">Mock Tests Attempted</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-white">
                    {attempts.filter((a) => a.status === 'submitted').length} Tests
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('exams')}
                    className="mt-2 text-xs font-semibold text-[#B5ADC6] hover:text-white underline"
                  >
                    Launch Exam Portal →
                  </button>
                </div>

                <div className="p-5 rounded-xl bg-[#514871] border border-[#7C7397]/40">
                  <p className="text-xs text-[#CFCEDD]">Outstanding Dues</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-white">
                    ₹{pendingDues.toLocaleString('en-IN')}
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-[#514871] border border-[#7C7397]/40">
                  <p className="text-xs text-[#CFCEDD]">Active Issued Books</p>
                  <p className="mt-1 text-lg font-bold tabular-nums text-white">
                    {bookIssues.filter((i) => i.status === 'issued' || i.status === 'overdue').length} Books
                  </p>
                </div>
              </div>

              {announcements.filter((a) => a.published).length > 0 && (
                <div className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 space-y-3">
                  <h3 className="text-sm font-semibold text-white">Library Announcements</h3>
                  {announcements
                    .filter((a) => a.published)
                    .map((ann) => (
                      <div key={ann.id} className="pt-3 border-t border-[#7C7397]/30">
                        <p className="text-sm font-medium text-white">{ann.title}</p>
                        <p className="text-xs text-[#CFCEDD] mt-0.5">{ann.body}</p>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {tab === 'exams' && (
            <CompetitiveExamHub
              exams={exams}
              questions={questions}
              mockTests={mockTests}
              attempts={attempts}
              getIdToken={getIdToken}
              onStartTest={launchTest}
              onViewAttemptReport={(att) => {
                setSelectedAttempt(att);
                setTab('performance');
              }}
              onNotify={notify}
            />
          )}

          {tab === 'performance' && (
            latestAttempt ? (
              <PerformanceAnalysisView
                attempt={latestAttempt}
                allAttempts={attempts}
                questionsMap={questionsMap}
                getIdToken={getIdToken}
                onPracticeWeakTopic={handlePracticeWeakTopic}
                onBack={() => setTab('exams')}
              />
            ) : (
              <div className="p-8 rounded-2xl bg-[#3D2C56] border border-[#7C7397]/40 text-center space-y-3">
                <BarChart3 className="w-10 h-10 mx-auto text-[#B5ADC6]" />
                <h2 className="font-display text-xl font-bold text-white">No Completed Test Reports Yet</h2>
                <p className="text-sm text-[#CFCEDD]">
                  Complete a PYQ test, AI Mock, or Daily Current Affairs Quiz to unlock subject-wise charts and Gemini AI study recommendations.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('exams')}
                  className="px-5 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
                >
                  Open Competitive Exam Hub
                </button>
              </div>
            )
          )}

          {tab === 'current_affairs' && (
            <CurrentAffairsModule
              items={currentAffairs}
              questions={questions}
              onStartQuiz={launchTest}
            />
          )}

          {tab === 'gk_books' && (
            <DigitalGKBookModule
              books={gkBooks}
              questions={questions}
              bookmarks={bookmarks}
              userUid={firebaseUser?.uid || null}
              onStartQuiz={launchTest}
              onNotify={notify}
            />
          )}

          {tab === 'profile' && activeStudent && (
            <form
              onSubmit={handleSaveProfile}
              className="p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 space-y-4 max-w-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-bold text-white">Personal Profile</h2>
                <button
                  type="button"
                  onClick={() =>
                    sendPasswordReset(activeStudent.email).then(() =>
                      notify('ok', 'Password reset email dispatched.')
                    )
                  }
                  className="text-xs font-semibold text-[#B5ADC6] hover:text-white hover:underline"
                >
                  Send Password Reset Email
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Student ID</label>
                  <input
                    type="text"
                    disabled
                    value={activeStudent.studentCode}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[#7C7397]/50 bg-[#1C0E29]/70 text-[#CFCEDD] opacity-80"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Email Address</label>
                  <input
                    type="text"
                    disabled
                    value={activeStudent.email}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/50 bg-[#1C0E29]/70 text-[#CFCEDD] opacity-80"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    required
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Emergency Contact</label>
                  <input
                    type="tel"
                    required
                    value={editEmergency}
                    onChange={(e) => setEditEmergency(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Profile Photo URL</label>
                  <input
                    type="url"
                    value={editPhoto}
                    onChange={(e) => setEditPhoto(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Address</label>
                <input
                  type="text"
                  required
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                />
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
              >
                {savingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          )}

          {tab === 'membership' && (
            <div className="space-y-6">
              <div>
                <h2 className="font-display text-xl font-bold text-white">
                  Membership Plans & Online Renewal
                </h2>
                <p className="text-sm text-[#CFCEDD]">
                  Select a plan to renew or activate your library subscription via Razorpay.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {plans
                  .filter((p) => p.active)
                  .map((plan) => (
                    <div
                      key={plan.id}
                      className="p-5 rounded-xl bg-[#514871] border border-[#7C7397]/50 flex flex-col justify-between"
                    >
                      <div>
                        <p className="text-xs text-[#CFCEDD]">
                          {plan.durationDays} Days · {plan.timings}
                        </p>
                        <h3 className="mt-1 font-display text-lg font-bold text-white">{plan.name}</h3>
                        <p className="mt-3 text-2xl font-bold tabular-nums text-white">
                          ₹{Number(plan.price).toLocaleString('en-IN')}
                        </p>
                        <p className="mt-2 text-xs text-[#CFCEDD]">{plan.seatAccess}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!activeStudent) {
                            onOpenCompleteProfile();
                            return;
                          }
                          setCheckoutPlan(plan);
                        }}
                        className="mt-5 w-full py-2 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
                      >
                        Pay & Activate Plan
                      </button>
                    </div>
                  ))}
              </div>

              <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-hidden">
                <div className="px-5 py-4 border-b border-[#7C7397]/30">
                  <h3 className="text-sm font-semibold text-white">Membership History</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#0E0713]/60 text-xs text-[#CFCEDD]">
                      <tr>
                        <th className="text-left px-4 py-3">Plan</th>
                        <th className="text-left px-4 py-3">Start</th>
                        <th className="text-left px-4 py-3">Expiry</th>
                        <th className="text-right px-4 py-3">Amount</th>
                        <th className="text-left px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#7C7397]/25">
                      {memberships.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-[#CFCEDD]">
                            No membership records found yet.
                          </td>
                        </tr>
                      ) : (
                        memberships.map((m) => (
                          <tr key={m.id}>
                            <td className="px-4 py-3 font-medium text-white">{m.planName}</td>
                            <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{m.startDate}</td>
                            <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{m.expiryDate}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-white">₹{m.amount}</td>
                            <td className="px-4 py-3 capitalize font-medium text-[#B5ADC6]">{m.status}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'seats' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-white">Interactive Seat Booking</h2>
                  <p className="text-xs text-[#CFCEDD]">
                    Click any green Available seat to reserve it or request a seat change.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 p-1 bg-[#0E0713] rounded-lg border border-[#7C7397]/40">
                  {['ALL', ...Array.from(new Set(seats.map((s) => s.zone)))].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setZoneFilter(z)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                        zoneFilter === z
                          ? 'bg-[#B5ADC6] text-[#0E0713] font-semibold'
                          : 'text-[#CFCEDD] hover:text-white'
                      }`}
                    >
                      {z === 'ALL' ? 'All Zones' : z}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
                {filteredSeats.map((seat) => {
                  const isMine = seat.assignedStudentUid === firebaseUser?.uid;
                  const cls = isMine
                    ? 'bg-[#B5ADC6] text-[#0E0713] border-white font-bold'
                    : seat.status === 'available'
                      ? 'bg-emerald-950/60 border-emerald-500/70 text-emerald-200 hover:bg-emerald-900/70'
                      : seat.status === 'occupied'
                        ? 'bg-red-950/60 border-red-500/50 text-red-200 opacity-75 cursor-not-allowed'
                        : seat.status === 'reserved'
                          ? 'bg-amber-950/60 border-amber-500/60 text-amber-200 opacity-80 cursor-not-allowed'
                          : 'bg-[#0E0713]/70 border-[#7C7397]/40 text-[#9993AC] cursor-not-allowed';

                  return (
                    <button
                      key={seat.id}
                      type="button"
                      disabled={seat.status !== 'available' && !isMine}
                      onClick={() => seat.status === 'available' && handleBookSeat(seat)}
                      className={`p-2.5 rounded-lg border text-center transition-colors ${cls}`}
                    >
                      <div className="font-mono text-xs font-bold tabular-nums">{seat.seatCode}</div>
                      <div className="text-[10px] mt-0.5 capitalize">{isMine ? 'Yours' : seat.status}</div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-hidden">
                <div className="px-5 py-4 border-b border-[#7C7397]/30">
                  <h3 className="text-sm font-semibold text-white">My Seat Booking Requests</h3>
                </div>
                <div className="divide-y divide-[#7C7397]/25">
                  {bookings.length === 0 ? (
                    <p className="p-5 text-sm text-[#CFCEDD]">No seat bookings yet.</p>
                  ) : (
                    bookings.map((b) => (
                      <div key={b.id} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                        <div>
                          <span className="font-mono font-bold text-white">{b.seatCode}</span>
                          <span className="mx-2 text-[#9993AC]">·</span>
                          <span className="capitalize text-[#CFCEDD]">{b.bookingType} request</span>
                          <span className="mx-2 text-[#9993AC]">·</span>
                          <span className="capitalize font-medium text-[#B5ADC6]">{b.status}</span>
                        </div>
                        {b.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleCancelBooking(b)}
                            className="px-3 py-1 rounded-lg border border-red-400/60 text-red-200 text-xs font-medium hover:bg-red-950/60"
                          >
                            Cancel Request
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'attendance' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold text-white">Attendance & Study Hours</h2>
                  <p className="text-sm text-[#CFCEDD] tabular-nums">
                    Total Study Hours Logged: <strong className="text-white">{totalStudyHours} hrs</strong> across{' '}
                    {attendance.length} sessions
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={Boolean(todayOpenRecord)}
                    onClick={handleCheckIn}
                    className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold disabled:opacity-50"
                  >
                    Check In Now
                  </button>
                  <button
                    type="button"
                    disabled={!todayOpenRecord}
                    onClick={handleCheckOut}
                    className="px-4 py-2 rounded-lg bg-[#514871] border border-[#7C7397] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    Check Out
                  </button>
                </div>
              </div>

              <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0E0713]/60 text-xs text-[#CFCEDD]">
                    <tr>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-left px-4 py-3">Check In</th>
                      <th className="text-left px-4 py-3">Check Out</th>
                      <th className="text-right px-4 py-3">Duration</th>
                      <th className="text-left px-4 py-3">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#7C7397]/25">
                    {attendance.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-[#CFCEDD]">
                          No attendance logs yet. Click Check In Now when you arrive.
                        </td>
                      </tr>
                    ) : (
                      attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-3 tabular-nums text-white">{a.date}</td>
                          <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{a.checkInTime}</td>
                          <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{a.checkOutTime || 'In Progress'}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-white">
                            {a.durationMinutes ? `${a.durationMinutes} min` : '—'}
                          </td>
                          <td className="px-4 py-3 uppercase text-xs font-mono text-[#B5ADC6]">{a.method}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'payments' && (
            <div className="space-y-6">
              <h2 className="font-display text-xl font-bold text-white">
                Payments & Downloadable Receipts
              </h2>
              <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#0E0713]/60 text-xs text-[#CFCEDD]">
                    <tr>
                      <th className="text-left px-4 py-3">Receipt No.</th>
                      <th className="text-left px-4 py-3">Plan</th>
                      <th className="text-left px-4 py-3">Method</th>
                      <th className="text-right px-4 py-3">Amount</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#7C7397]/25">
                    {payments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-[#CFCEDD]">
                          No transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3 font-mono text-xs text-white">{p.receiptNumber}</td>
                          <td className="px-4 py-3 text-[#CFCEDD]">{p.planName}</td>
                          <td className="px-4 py-3 capitalize text-xs text-[#CFCEDD]">{p.method.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-white">₹{p.amount}</td>
                          <td className="px-4 py-3 capitalize font-medium text-[#B5ADC6]">{p.status}</td>
                          <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setReceiptPreview(p)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#B5ADC6] hover:text-white hover:underline"
                            >
                              <FileText className="w-3.5 h-3.5" /> View
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadReceiptHtml(p, settings?.libraryName, settings?.address)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:underline"
                            >
                              <Download className="w-3.5 h-3.5" /> Receipt
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'books' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="font-display text-xl font-bold text-white">
                  Physical Book Catalogue & Issued Books
                </h2>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-[#9993AC] absolute left-3 top-2.5" />
                  <input
                    type="search"
                    value={bookSearch}
                    onChange={(e) => setBookSearch(e.target.value)}
                    placeholder="Search title, author, ISBN..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white placeholder-[#9993AC]"
                  />
                </div>
              </div>

              {bookIssues.length > 0 && (
                <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
                  <div className="px-5 py-3 border-b border-[#7C7397]/30 text-xs font-semibold text-[#CFCEDD]">
                    My Requested & Issued Books
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-[#0E0713]/60 text-xs text-[#CFCEDD]">
                      <tr>
                        <th className="text-left px-4 py-2.5">Book Title</th>
                        <th className="text-left px-4 py-2.5">Due Date</th>
                        <th className="text-right px-4 py-2.5">Fine</th>
                        <th className="text-left px-4 py-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#7C7397]/25">
                      {bookIssues.map((bi) => (
                        <tr key={bi.id}>
                          <td className="px-4 py-2.5 font-medium text-white">{bi.bookTitle}</td>
                          <td className="px-4 py-2.5 tabular-nums text-[#CFCEDD]">{bi.dueDate || 'Pending Issue'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-white">₹{bi.fineAmount}</td>
                          <td className="px-4 py-2.5 capitalize font-medium text-[#B5ADC6]">{bi.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredBooks.map((book) => (
                  <div
                    key={book.id}
                    className="p-4 rounded-xl bg-[#514871] border border-[#7C7397]/40 flex flex-col justify-between"
                  >
                    <div>
                      <p className="text-xs text-[#CFCEDD]">
                        {book.categoryName} · Shelf {book.shelfNumber}
                      </p>
                      <h3 className="mt-1 text-sm font-semibold text-white">{book.title}</h3>
                      <p className="text-xs text-[#CFCEDD] mt-0.5">
                        {book.author} · {book.publicationYear}
                      </p>
                      <p className="mt-2 font-mono text-[11px] text-[#9993AC]">ISBN: {book.isbn}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-[#7C7397]/30 flex items-center justify-between">
                      <span className="text-xs font-medium tabular-nums text-white">
                        {book.availableCopies} / {book.totalCopies} available
                      </span>
                      <button
                        type="button"
                        disabled={book.availableCopies < 1}
                        onClick={() => handleRequestBook(book)}
                        className="px-3 py-1.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold disabled:opacity-40 hover:bg-white"
                      >
                        Request Book
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-bold text-white">Notifications & Reminders</h2>
              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 text-sm text-[#CFCEDD]">
                    You are all caught up. No notifications right now.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex items-start justify-between gap-4"
                    >
                      <div>
                        <p className="text-xs text-[#B5ADC6] capitalize">
                          {n.type.replace(/_/g, ' ')} · {n.read ? 'Read' : 'Unread'}
                        </p>
                        <h4 className="mt-0.5 text-sm font-semibold text-white">{n.title}</h4>
                        <p className="mt-1 text-xs text-[#CFCEDD]">{n.message}</p>
                      </div>
                      {!n.read && n.recipientUid === firebaseUser?.uid && (
                        <button
                          type="button"
                          onClick={() => updateDoc(doc(db, 'notifications', n.id), { read: true })}
                          className="text-xs font-medium text-[#B5ADC6] hover:text-white hover:underline shrink-0"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Razorpay Checkout Modal */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md bg-[#3D2C56] border border-[#7C7397] rounded-xl p-6 space-y-4 text-white">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">
                Razorpay Membership Checkout
              </h3>
              <button type="button" onClick={() => setCheckoutPlan(null)} className="p-1 text-[#CFCEDD] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 rounded-lg bg-[#1C0E29] border border-[#7C7397]/50">
              <p className="text-xs text-[#9993AC]">Selected Plan</p>
              <p className="font-semibold text-sm text-white">{checkoutPlan.name}</p>
              <p className="text-xl font-bold tabular-nums mt-1 text-[#B5ADC6]">
                ₹{Number(checkoutPlan.price).toLocaleString('en-IN')}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-[#CFCEDD]">Payment Method</p>
              {(
                [
                  ['razorpay_upi', 'UPI (GPay / PhonePe / BHIM)'],
                  ['razorpay_card', 'Debit / Credit Card'],
                  ['razorpay_netbanking', 'Net Banking'],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[#7C7397]/50 bg-[#1C0E29]/60 cursor-pointer text-sm text-white"
                >
                  <input
                    type="radio"
                    name="rzMethod"
                    checked={checkoutMethod === id}
                    onChange={() => setCheckoutMethod(id)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <button
              type="button"
              disabled={checkoutLoading}
              onClick={handleCompleteRazorpayCheckout}
              className="w-full py-2.5 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white disabled:opacity-60"
            >
              {checkoutLoading ? 'Verifying Payment...' : `Pay ₹${checkoutPlan.price} Securely`}
            </button>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal (keeps clean white paper layout inside printable card) */}
      {receiptPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg bg-white text-[#0E0713] border border-[#7C7397] rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4">
              <div>
                <h3 className="font-display text-xl font-bold text-[#1C0E29]">
                  {settings?.libraryName || 'VIDHYA LIBRARY'}
                </h3>
                <p className="text-xs text-slate-600">Official Payment Receipt</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-mono font-bold">{receiptPreview.receiptNumber}</p>
                <p className="capitalize">{receiptPreview.status}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Student Name</span>
                <span className="font-medium">{receiptPreview.studentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Student ID</span>
                <span className="font-mono">{receiptPreview.studentCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Plan</span>
                <span>{receiptPreview.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Method</span>
                <span className="capitalize">{receiptPreview.method.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-200 text-base font-bold">
                <span>Amount Paid</span>
                <span className="tabular-nums">₹{receiptPreview.amount}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptHtml(receiptPreview, settings?.libraryName, settings?.address)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1C0E29] text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Download HTML
              </button>
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                className="px-3 py-2 rounded-lg text-xs text-slate-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
