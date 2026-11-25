import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Menu,
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
  FeePaymentRecord,
  LibrarySettings,
  MembershipPlan,
  MembershipRecord,
  MockTestRecord,
  NotificationRecord,
  PaymentRecord,
  SeatBookingRecord,
  SeatRecord,
  StudentFeeRecord,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [bookings, setBookings] = useState<SeatBookingRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [bookIssues, setBookIssues] = useState<BookIssueRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [studentFees, setStudentFees] = useState<StudentFeeRecord[]>([]);
  const [manualFeePayments, setManualFeePayments] = useState<FeePaymentRecord[]>([]);
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

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 5000);
  }, []);

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
        query(collection(db, 'student_fees'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          setStudentFees(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudentFeeRecord, 'id'>) })));
        },
        (err) => handleSnapErr(err, 'student_fees')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'fee_payments'), where('studentUid', '==', uid)),
        (snap) => {
          markFirestoreConnected();
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeePaymentRecord, 'id'>) }));
          list.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
          setManualFeePayments(list);
        },
        (err) => handleSnapErr(err, 'fee_payments')
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
  }, [firebaseUser?.uid, notify]);

  const activeStudent: StudentRecord | null = studentRecord;
  const activeFeeLedger: StudentFeeRecord | null = studentFees[0] || null;
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

  const totalFeeBalance = useMemo(() => {
    const ledgerBal = studentFees.reduce((s, f) => s + Number(f.remainingBalance || 0), 0);
    return ledgerBal > 0 ? ledgerBal : pendingDues;
  }, [studentFees, pendingDues]);

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
      <div className="min-h-screen bg-surface text-on-surface p-4 sm:p-6">
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
    { id: 'overview', label: 'Dashboard', icon: LayoutGrid },
    { id: 'exams', label: 'Competitive Exams', icon: Award },
    { id: 'performance', label: 'AI Analytics', icon: BarChart3 },
    { id: 'current_affairs', label: 'Current Affairs', icon: Newspaper },
    { id: 'gk_books', label: 'Digital GK Books', icon: BookMarked },
    { id: 'membership', label: 'Membership', icon: CheckCircle2 },
    { id: 'seats', label: 'Seat Booking', icon: Home },
    { id: 'attendance', label: 'My Attendance', icon: CalendarCheck },
    { id: 'payments', label: 'Fees & Receipts', icon: CreditCard },
    { id: 'books', label: 'Library Books', icon: BookOpen },
    { id: 'notifications', label: `Notifications${unreadCount ? ` (${unreadCount})` : ''}`, icon: Bell },
    { id: 'profile', label: 'Profile & Pass', icon: UserIcon },
  ];

  const initials = (activeStudent?.fullName || firebaseUser?.displayName || 'ST')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'ST';

  const selectTab = (next: StudentTab) => {
    setTab(next);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface font-body flex flex-col lg:flex-row">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-primary/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Student Portal Navy Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-primary text-on-primary flex flex-col justify-between transform transition-transform duration-200 lg:translate-x-0 lg:static shrink-0 no-print ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col gap-5 p-4 overflow-y-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <BrandLogo variant="light" subtitle="Student portal" />
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden p-1.5 rounded text-on-primary-container hover:text-on-primary hover:bg-primary-container"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav aria-label="Student navigation" className="flex flex-col gap-1">
            <span className="px-3 mb-1 font-label text-[11px] font-semibold text-on-primary-container uppercase tracking-wider">
              My workspace
            </span>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded text-left font-label text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-secondary text-on-secondary font-semibold'
                      : 'text-on-primary-container hover:bg-primary-container hover:text-on-primary'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-primary-container space-y-2.5">
          {actualRole === 'admin' && (
            <button
              type="button"
              onClick={() => setPreviewRole(null)}
              className="w-full py-2 px-3 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-secondary/90 cursor-pointer"
            >
              Return to Admin Console
            </button>
          )}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded bg-primary-container">
            <div className="w-9 h-9 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-headline text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-title text-sm font-semibold text-on-primary truncate">
                {activeStudent?.fullName || firebaseUser?.displayName || 'Student Member'}
              </span>
              <span className="font-mono text-[11px] text-on-primary-container truncate tabular-nums">
                {activeStudent ? `${activeStudent.studentCode} · ${activeStudent.seatCode || 'No Seat'}` : 'Guest Profile'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded border border-on-primary-container/30 text-xs font-semibold text-on-primary-container hover:bg-primary-container hover:text-on-primary cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-surface-container-lowest border-b border-outline-variant px-4 lg:px-8 py-3 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded border border-outline-variant text-on-surface hover:bg-surface-container-low shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-headline text-base sm:text-lg font-bold text-primary truncate">
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
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-semibold transition-colors cursor-pointer ${
                connectionStatus.state === 'connected'
                  ? 'border-success/30 bg-success-container/60 text-on-success-container'
                  : connectionStatus.state === 'offline'
                    ? 'border-error/40 bg-error-container text-on-error-container'
                    : 'border-warning/40 bg-warning-container text-on-warning-container'
              }`}
            >
              {connectionStatus.state === 'connected' ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : connectionStatus.state === 'offline' ? (
                <WifiOff className="w-3.5 h-3.5" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              )}
              <span>
                {connectionStatus.state === 'connected'
                  ? 'Live Sync'
                  : connectionStatus.state === 'offline'
                    ? 'Offline · Retry'
                    : 'Reconnecting...'}
              </span>
            </button>

            <button
              type="button"
              onClick={onGoPublic}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant bg-surface-container-lowest text-xs font-semibold text-primary hover:bg-surface-container-low cursor-pointer"
            >
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Website</span>
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle color theme"
              className="p-2 rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:text-primary hover:bg-surface-container-low cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={signOut}
              className="lg:hidden px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="p-4 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {feedback && (
            <div
              className={`p-3.5 rounded-lg border text-sm font-medium ${
                feedback.type === 'ok'
                  ? 'bg-success-container/70 border-success/40 text-on-success-container'
                  : 'bg-error-container border-error/40 text-on-error-container'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {!activeStudent && (
            <div className="p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-headline text-xl font-bold text-primary">
                  Complete Your Student Registration
                </h2>
                <p className="text-sm text-on-surface-variant mt-1">
                  Generate your unique Student ID (VL2026XXX) and QR Pass to book seats, record attendance, and activate memberships. Competitive exams and GK notes are already unlocked!
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenCompleteProfile}
                className="px-4 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold whitespace-nowrap shrink-0 hover:bg-primary cursor-pointer"
              >
                Complete Profile
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              {activeStudent && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8 p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col justify-between">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-secondary uppercase tracking-wider">
                          Welcome Back · Gyan Adda Campus
                        </p>
                        <h2 className="mt-1 font-headline text-2xl font-bold text-on-surface">
                          {activeStudent.fullName}
                        </h2>
                        <p className="mt-1 text-xs text-on-surface-variant">
                          Student ID <span className="font-mono font-semibold text-primary">{activeStudent.studentCode}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{activeStudent.email}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{activeStudent.mobile}</span>
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                          activeStudent.membershipStatus === 'active'
                            ? 'bg-success-container text-on-success-container'
                            : 'bg-warning-container text-on-warning-container'
                        }`}
                      >
                        Membership {memberships.find((m) => m.status === 'active')?.status || activeStudent.membershipStatus}
                      </span>
                    </div>

                    <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-outline-variant">
                      <div>
                        <p className="text-xs text-on-surface-variant">Membership</p>
                        <p className="mt-1 text-sm font-bold capitalize text-on-surface">
                          {memberships.find((m) => m.status === 'active')?.planName || activeStudent.membershipStatus}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-on-surface-variant">Expiry Date</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-on-surface">
                          {memberships.find((m) => m.status === 'active')?.expiryDate || activeStudent.membershipExpiry || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-on-surface-variant">Assigned Seat</p>
                        <p className="mt-1 font-mono text-sm font-bold text-primary">
                          {activeStudent.seatCode ||
                            (bookings.find((b) => b.status === 'pending')
                              ? `${bookings.find((b) => b.status === 'pending')?.seatCode} (Pending)`
                              : 'Unassigned')}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-on-surface-variant">Study Hours</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-on-surface">{totalStudyHours} hrs</p>
                      </div>
                    </div>
                  </div>

                  {/* Student QR Pass */}
                  <div className="lg:col-span-4 p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col items-center justify-center text-center">
                    <div className="p-3 bg-white rounded-lg border border-outline-variant">
                      <QRCodeSVG
                        value={JSON.stringify({
                          studentCode: activeStudent.studentCode,
                          uid: activeStudent.uid,
                          studentDocId: activeStudent.id,
                        })}
                        size={132}
                      />
                    </div>
                    <p className="mt-3 font-mono text-sm font-bold text-primary">
                      {activeStudent.studentCode}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Scan at library desk for check-in & book lending
                    </p>
                  </div>
                </div>
              )}

              {/* Quick KPI & Competitive Exam Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeStudent && (
                  <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-on-surface-variant">Daily Attendance</p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-on-surface">
                        {todayOpenRecord ? `In (${todayOpenRecord.checkInTime})` : 'Not Checked In'}
                      </p>
                    </div>
                    {todayOpenRecord ? (
                      <button
                        type="button"
                        onClick={handleCheckOut}
                        className="px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
                      >
                        Check Out
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCheckIn}
                        className="px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container cursor-pointer"
                      >
                        Check In
                      </button>
                    )}
                  </div>
                )}

                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <p className="text-xs text-on-surface-variant">Mock Tests Attempted</p>
                  <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
                    {attempts.filter((a) => a.status === 'submitted').length} Tests
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('exams')}
                    className="mt-1.5 text-xs font-semibold text-secondary hover:underline cursor-pointer"
                  >
                    Launch Exam Portal →
                  </button>
                </div>

                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <p className="text-xs text-on-surface-variant">Fee Balance Due</p>
                  <p
                    className={`mt-1 font-headline text-xl font-bold tabular-nums ${
                      totalFeeBalance > 0 ? 'text-error' : 'text-success'
                    }`}
                  >
                    ₹{totalFeeBalance.toLocaleString('en-IN')}
                  </p>
                  <p className="mt-1 text-[11px] text-on-surface-variant">
                    {activeFeeLedger
                      ? `Due ${activeFeeLedger.dueDate} · WA: ${activeFeeLedger.reminderStatus}`
                      : 'No overdue balance'}
                  </p>
                </div>

                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <p className="text-xs text-on-surface-variant">Active Issued Books</p>
                  <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
                    {bookIssues.filter((i) => i.status === 'issued' || i.status === 'overdue').length} Books
                  </p>
                </div>
              </div>

              {announcements.filter((a) => a.published).length > 0 && (
                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-3">
                  <h3 className="font-headline text-base font-bold text-on-surface">Library Announcements</h3>
                  {announcements
                    .filter((a) => a.published)
                    .map((ann) => (
                      <div key={ann.id} className="pt-3 border-t border-outline-variant">
                        <p className="text-sm font-semibold text-on-surface">{ann.title}</p>
                        <p className="text-xs text-on-surface-variant mt-0.5">{ann.body}</p>
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
              <div className="p-8 rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm text-center space-y-3">
                <BarChart3 className="w-10 h-10 mx-auto text-secondary" />
                <h2 className="font-headline text-xl font-bold text-on-surface">No Completed Test Reports Yet</h2>
                <p className="text-sm text-on-surface-variant">
                  Complete a PYQ test, AI Mock, or Daily Current Affairs Quiz to unlock subject-wise charts and Gemini AI study recommendations.
                </p>
                <button
                  type="button"
                  onClick={() => setTab('exams')}
                  className="px-5 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
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
              className="p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-4 max-w-2xl"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-headline text-xl font-bold text-on-surface">Personal Profile</h2>
                <button
                  type="button"
                  onClick={() =>
                    sendPasswordReset(activeStudent.email).then(() =>
                      notify('ok', 'Password reset email dispatched.')
                    )
                  }
                  className="text-xs font-semibold text-secondary hover:underline cursor-pointer"
                >
                  Send Password Reset Email
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Student ID</label>
                  <input
                    type="text"
                    disabled
                    value={activeStudent.studentCode}
                    className="w-full px-3 py-2 text-sm font-mono rounded border border-outline-variant bg-surface-container-low text-on-surface opacity-80"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Email Address</label>
                  <input
                    type="text"
                    disabled
                    value={activeStudent.email}
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface-container-low text-on-surface opacity-80"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Mobile Number</label>
                  <input
                    type="tel"
                    required
                    value={editMobile}
                    onChange={(e) => setEditMobile(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Emergency Contact</label>
                  <input
                    type="tel"
                    required
                    value={editEmergency}
                    onChange={(e) => setEditEmergency(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">Profile Photo URL</label>
                  <input
                    type="url"
                    value={editPhoto}
                    onChange={(e) => setEditPhoto(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface text-on-surface"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Address</label>
                <input
                  type="text"
                  required
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface text-on-surface"
                />
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="px-5 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
              >
                {savingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          )}

          {tab === 'membership' && (
            <div className="space-y-6">
              <div>
                <h2 className="font-headline text-xl font-bold text-on-surface">
                  Membership Plans & Online Renewal
                </h2>
                <p className="text-sm text-on-surface-variant">
                  Select a plan to renew or activate your library subscription via Razorpay.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {plans
                  .filter((p) => p.active)
                  .map((plan) => (
                    <div
                      key={plan.id}
                      className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col justify-between"
                    >
                      <div>
                        <p className="text-xs text-on-surface-variant">
                          {plan.durationDays} Days · {plan.timings}
                        </p>
                        <h3 className="mt-1 font-headline text-lg font-bold text-primary">{plan.name}</h3>
                        <p className="mt-3 font-headline text-2xl font-bold tabular-nums text-on-surface">
                          ₹{Number(plan.price).toLocaleString('en-IN')}
                        </p>
                        <p className="mt-2 text-xs text-on-surface-variant">{plan.seatAccess}</p>
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
                        className="mt-5 w-full py-2.5 px-4 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
                      >
                        Pay & Activate Plan
                      </button>
                    </div>
                  ))}
              </div>

              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-outline-variant">
                  <h3 className="text-sm font-semibold text-on-surface">Membership History</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low text-xs text-on-surface-variant border-b border-outline-variant">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold">Plan</th>
                        <th className="text-left px-4 py-3 font-semibold">Start</th>
                        <th className="text-left px-4 py-3 font-semibold">Expiry</th>
                        <th className="text-right px-4 py-3 font-semibold">Amount</th>
                        <th className="text-left px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {memberships.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-on-surface-variant">
                            No membership records found yet.
                          </td>
                        </tr>
                      ) : (
                        memberships.map((m) => (
                          <tr key={m.id}>
                            <td className="px-4 py-3 font-medium text-on-surface">{m.planName}</td>
                            <td className="px-4 py-3 tabular-nums text-on-surface-variant">{m.startDate}</td>
                            <td className="px-4 py-3 tabular-nums text-on-surface-variant">{m.expiryDate}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-on-surface">₹{m.amount}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                                  m.status === 'active'
                                    ? 'bg-success-container text-on-success-container'
                                    : 'bg-surface-variant text-on-surface-variant'
                                }`}
                              >
                                {m.status}
                              </span>
                            </td>
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
                  <h2 className="font-headline text-xl font-bold text-on-surface">Interactive Seat Booking</h2>
                  <p className="text-xs text-on-surface-variant">
                    Click any green Available seat to reserve it or request a seat change.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 p-1 bg-surface-container-lowest rounded-lg border border-outline-variant">
                  {['ALL', ...Array.from(new Set(seats.map((s) => s.zone)))].map((z) => (
                    <button
                      key={z}
                      type="button"
                      onClick={() => setZoneFilter(z)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded whitespace-nowrap cursor-pointer ${
                        zoneFilter === z
                          ? 'bg-primary text-on-primary'
                          : 'text-on-surface-variant hover:text-primary'
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
                    ? 'bg-secondary text-on-secondary border-secondary font-bold'
                    : seat.status === 'available'
                      ? 'bg-success-container/70 border-success/40 text-on-success-container hover:bg-success-container cursor-pointer'
                      : seat.status === 'occupied'
                        ? 'bg-error-container/70 border-error/30 text-on-error-container opacity-80 cursor-not-allowed'
                        : seat.status === 'reserved'
                          ? 'bg-warning-container/70 border-warning/30 text-on-warning-container opacity-85 cursor-not-allowed'
                          : 'bg-surface-variant border-outline-variant text-on-surface-variant cursor-not-allowed';

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

              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm">
                <div className="px-5 py-3.5 border-b border-outline-variant">
                  <h3 className="text-sm font-semibold text-on-surface">My Seat Booking Requests</h3>
                </div>
                <div className="divide-y divide-outline-variant">
                  {bookings.length === 0 ? (
                    <p className="p-5 text-sm text-on-surface-variant">No seat bookings yet.</p>
                  ) : (
                    bookings.map((b) => (
                      <div key={b.id} className="px-5 py-3 flex items-center justify-between gap-4 text-sm">
                        <div>
                          <span className="font-mono font-bold text-primary">{b.seatCode}</span>
                          <span className="mx-2 text-outline">·</span>
                          <span className="capitalize text-on-surface-variant">{b.bookingType} request</span>
                          <span className="mx-2 text-outline">·</span>
                          <span className="capitalize font-semibold text-secondary">{b.status}</span>
                        </div>
                        {b.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleCancelBooking(b)}
                            className="px-3 py-1 rounded border border-error/40 text-error text-xs font-semibold hover:bg-error-container cursor-pointer"
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
                  <h2 className="font-headline text-xl font-bold text-on-surface">Attendance & Study Hours</h2>
                  <p className="text-sm text-on-surface-variant tabular-nums">
                    Total Study Hours Logged: <strong className="text-primary">{totalStudyHours} hrs</strong> across{' '}
                    {attendance.length} sessions
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={Boolean(todayOpenRecord)}
                    onClick={handleCheckIn}
                    className="px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Check In Now
                  </button>
                  <button
                    type="button"
                    disabled={!todayOpenRecord}
                    onClick={handleCheckOut}
                    className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Check Out
                  </button>
                </div>
              </div>

              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low text-xs text-on-surface-variant border-b border-outline-variant">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Date</th>
                      <th className="text-left px-4 py-3 font-semibold">Check In</th>
                      <th className="text-left px-4 py-3 font-semibold">Check Out</th>
                      <th className="text-right px-4 py-3 font-semibold">Duration</th>
                      <th className="text-left px-4 py-3 font-semibold">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {attendance.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-on-surface-variant">
                          No attendance logs yet. Click Check In Now when you arrive.
                        </td>
                      </tr>
                    ) : (
                      attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="px-4 py-3 tabular-nums text-on-surface font-medium">{a.date}</td>
                          <td className="px-4 py-3 tabular-nums text-on-surface-variant">{a.checkInTime}</td>
                          <td className="px-4 py-3 tabular-nums text-on-surface-variant">{a.checkOutTime || 'In Progress'}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-on-surface">
                            {a.durationMinutes ? `${a.durationMinutes} min` : '—'}
                          </td>
                          <td className="px-4 py-3 uppercase text-xs font-mono text-secondary">{a.method}</td>
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
              <h2 className="font-headline text-xl font-bold text-on-surface">
                Fee Ledger, Payments & Downloadable Receipts
              </h2>

              {/* Student Automated Fee Ledger & WhatsApp Reminder Status */}
              {studentFees.length > 0 && (
                <div className="space-y-4">
                  {studentFees.map((fee) => (
                    <div
                      key={fee.id}
                      className="rounded-lg bg-surface-container-lowest border border-outline-variant p-5 shadow-sm space-y-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-headline text-base font-bold text-primary">
                            Monthly Fee Account · {fee.className}
                          </h3>
                          <p className="text-xs text-on-surface-variant">
                            Due Date: <span className="font-mono font-semibold text-on-surface">{fee.dueDate}</span> · Parent WA:{' '}
                            <span className="font-mono">{fee.parentWhatsapp || 'Not set'}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                              fee.paymentStatus === 'paid'
                                ? 'bg-success-container text-on-success-container'
                                : fee.paymentStatus === 'overdue'
                                  ? 'bg-error-container text-on-error-container'
                                  : 'bg-warning-container text-on-warning-container'
                            }`}
                          >
                            {fee.paymentStatus.replace(/_/g, ' ')}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-container text-primary">
                            WhatsApp: {fee.reminderStatus.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant block">Monthly Fee</span>
                          <span className="font-headline text-lg font-bold tabular-nums text-on-surface">
                            ₹{Number(fee.monthlyFee).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant block">Total Payable</span>
                          <span className="font-headline text-lg font-bold tabular-nums text-on-surface">
                            ₹{Number(fee.totalPayable).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant block">Total Paid</span>
                          <span className="font-headline text-lg font-bold tabular-nums text-success">
                            ₹{Number(fee.totalPaid).toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="p-3 rounded bg-surface-container-low border border-outline-variant">
                          <span className="text-on-surface-variant block">Remaining Balance</span>
                          <span
                            className={`font-headline text-lg font-bold tabular-nums ${
                              fee.remainingBalance > 0 ? 'text-error' : 'text-success'
                            }`}
                          >
                            ₹{Number(fee.remainingBalance).toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-on-surface-variant">
                        {fee.remainingBalance <= 0
                          ? 'Your fee balance is ₹0. All automatic 24-hour WhatsApp reminders have stopped automatically.'
                          : 'Automated WhatsApp reminders run every 24 hours until the remaining balance is cleared at the desk.'}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Manual Fee Payments History */}
              {manualFeePayments.length > 0 && (
                <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-x-auto shadow-sm">
                  <div className="px-5 py-3.5 border-b border-outline-variant">
                    <h3 className="text-sm font-semibold text-on-surface">Desk & Manual Fee Payment Receipts</h3>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low text-xs text-on-surface-variant border-b border-outline-variant">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold">Date</th>
                        <th className="text-left px-4 py-3 font-semibold">Method</th>
                        <th className="text-left px-4 py-3 font-semibold">Reference / Notes</th>
                        <th className="text-right px-4 py-3 font-semibold">Amount Paid</th>
                        <th className="text-right px-4 py-3 font-semibold">Balance After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {manualFeePayments.map((fp) => (
                        <tr key={fp.id}>
                          <td className="px-4 py-3 font-mono text-xs text-on-surface">{fp.paymentDate}</td>
                          <td className="px-4 py-3 text-xs font-semibold text-on-surface">{fp.paymentMethod}</td>
                          <td className="px-4 py-3 text-xs text-on-surface-variant">
                            {fp.transactionRef ? `Ref: ${fp.transactionRef}` : fp.notes || 'Recorded at desk'}
                          </td>
                          <td className="px-4 py-3 text-right font-bold tabular-nums text-success">
                            ₹{Number(fp.amountReceived).toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-on-surface">
                            ₹{Number(fp.balanceAfterPayment).toLocaleString('en-IN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Online Razorpay Receipts */}
              <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-x-auto shadow-sm">
                <div className="px-5 py-3.5 border-b border-outline-variant">
                  <h3 className="text-sm font-semibold text-on-surface">Membership & Online Receipts</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-surface-container-low text-xs text-on-surface-variant border-b border-outline-variant">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Receipt No.</th>
                      <th className="text-left px-4 py-3 font-semibold">Plan</th>
                      <th className="text-left px-4 py-3 font-semibold">Method</th>
                      <th className="text-right px-4 py-3 font-semibold">Amount</th>
                      <th className="text-left px-4 py-3 font-semibold">Status</th>
                      <th className="text-right px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {payments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-on-surface-variant">
                          No online membership transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3 font-mono text-xs text-on-surface">{p.receiptNumber}</td>
                          <td className="px-4 py-3 text-on-surface">{p.planName}</td>
                          <td className="px-4 py-3 capitalize text-xs text-on-surface-variant">{p.method.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-on-surface">₹{p.amount}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${
                                p.status === 'verified'
                                  ? 'bg-success-container text-on-success-container'
                                  : 'bg-warning-container text-on-warning-container'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setReceiptPreview(p)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" /> View
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadReceiptHtml(p, settings?.libraryName, settings?.address)}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:underline cursor-pointer"
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
                <h2 className="font-headline text-xl font-bold text-on-surface">
                  Physical Book Catalogue & Issued Books
                </h2>
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                  <input
                    type="search"
                    value={bookSearch}
                    onChange={(e) => setBookSearch(e.target.value)}
                    placeholder="Search title, author, ISBN..."
                    className="w-full pl-9 pr-3 py-2 text-sm rounded border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline"
                  />
                </div>
              </div>

              {bookIssues.length > 0 && (
                <div className="rounded-lg bg-surface-container-lowest border border-outline-variant overflow-x-auto shadow-sm">
                  <div className="px-5 py-3 border-b border-outline-variant text-xs font-semibold text-on-surface-variant">
                    My Requested & Issued Books
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low text-xs text-on-surface-variant border-b border-outline-variant">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">Book Title</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Due Date</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Fine</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {bookIssues.map((bi) => (
                        <tr key={bi.id}>
                          <td className="px-4 py-2.5 font-medium text-on-surface">{bi.bookTitle}</td>
                          <td className="px-4 py-2.5 tabular-nums text-on-surface-variant">{bi.dueDate || 'Pending Issue'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-on-surface">₹{bi.fineAmount}</td>
                          <td className="px-4 py-2.5 capitalize font-semibold text-secondary">{bi.status}</td>
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
                    className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <p className="text-xs text-on-surface-variant">
                        {book.categoryName} · Shelf {book.shelfNumber}
                      </p>
                      <h3 className="mt-1 text-sm font-bold text-on-surface">{book.title}</h3>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        {book.author} · {book.publicationYear}
                      </p>
                      <p className="mt-2 font-mono text-[11px] text-outline">ISBN: {book.isbn}</p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-outline-variant flex items-center justify-between">
                      <span className="text-xs font-semibold tabular-nums text-on-surface">
                        {book.availableCopies} / {book.totalCopies} available
                      </span>
                      <button
                        type="button"
                        disabled={book.availableCopies < 1}
                        onClick={() => handleRequestBook(book)}
                        className="px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold disabled:opacity-40 hover:bg-primary cursor-pointer"
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
              <h2 className="font-headline text-xl font-bold text-on-surface">Notifications & Reminders</h2>
              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="p-6 rounded-lg bg-surface-container-lowest border border-outline-variant text-sm text-on-surface-variant">
                    You are all caught up. No notifications right now.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex items-start justify-between gap-4"
                    >
                      <div>
                        <p className="text-xs text-secondary font-semibold capitalize">
                          {n.type.replace(/_/g, ' ')} · {n.read ? 'Read' : 'Unread'}
                        </p>
                        <h4 className="mt-0.5 text-sm font-bold text-on-surface">{n.title}</h4>
                        <p className="mt-1 text-xs text-on-surface-variant">{n.message}</p>
                      </div>
                      {!n.read && n.recipientUid === firebaseUser?.uid && (
                        <button
                          type="button"
                          onClick={() => updateDoc(doc(db, 'notifications', n.id), { read: true })}
                          className="text-xs font-semibold text-secondary hover:underline shrink-0 cursor-pointer"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 p-4">
          <div className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-4 text-on-surface shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-headline text-lg font-bold text-primary">
                Razorpay Membership Checkout
              </h3>
              <button
                type="button"
                onClick={() => setCheckoutPlan(null)}
                className="p-1 text-on-surface-variant hover:text-on-surface"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 rounded-lg bg-surface-container-low border border-outline-variant">
              <p className="text-xs text-on-surface-variant">Selected Plan</p>
              <p className="font-semibold text-sm text-on-surface">{checkoutPlan.name}</p>
              <p className="font-headline text-xl font-bold tabular-nums mt-1 text-primary">
                ₹{Number(checkoutPlan.price).toLocaleString('en-IN')}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-on-surface-variant">Payment Method</p>
              {(
                [
                  ['razorpay_upi', 'UPI (GPay / PhonePe / BHIM)'],
                  ['razorpay_card', 'Debit / Credit Card'],
                  ['razorpay_netbanking', 'Net Banking'],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex items-center gap-3 p-3 rounded border border-outline-variant bg-surface cursor-pointer text-sm text-on-surface"
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
              className="w-full py-2.5 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-60 cursor-pointer"
            >
              {checkoutLoading ? 'Verifying Payment...' : `Pay ₹${checkoutPlan.price} Securely`}
            </button>
          </div>
        </div>
      )}

      {/* Printable Receipt Modal */}
      {receiptPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/50 p-4">
          <div className="w-full max-w-lg bg-white text-on-surface border border-outline-variant rounded-xl p-6 space-y-4 shadow-xl">
            <div className="flex items-start justify-between border-b border-outline-variant pb-4">
              <div>
                <h3 className="font-headline text-xl font-bold text-primary">
                  {settings?.libraryName || 'VIDHYA LIBRARY'}
                </h3>
                <p className="text-xs text-on-surface-variant">Official Payment Receipt</p>
              </div>
              <div className="text-right text-xs">
                <p className="font-mono font-bold text-primary">{receiptPreview.receiptNumber}</p>
                <p className="capitalize font-semibold text-success">{receiptPreview.status}</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Student Name</span>
                <span className="font-semibold text-on-surface">{receiptPreview.studentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Student ID</span>
                <span className="font-mono text-on-surface">{receiptPreview.studentCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Plan</span>
                <span className="text-on-surface">{receiptPreview.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Method</span>
                <span className="capitalize text-on-surface">{receiptPreview.method.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-outline-variant text-base font-bold text-primary">
                <span>Amount Paid</span>
                <span className="tabular-nums">₹{receiptPreview.amount}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptHtml(receiptPreview, settings?.libraryName, settings?.address)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download HTML
              </button>
              <button
                type="button"
                onClick={() => setReceiptPreview(null)}
                className="px-3 py-2 rounded text-xs font-semibold text-on-surface-variant hover:text-on-surface cursor-pointer"
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
