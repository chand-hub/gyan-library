import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Activity,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Cpu,
  CreditCard,
  Database,
  Download,
  FileText,
  FileUp,
  HelpCircle,
  Home,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  MessageSquare,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  db,
  isTransientFirestoreError,
  markFirestoreConnected,
  OperationType,
  reportFirestoreError,
} from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { formatCooldownRemaining, saveStoredAiCooldown, clearStoredAiCooldown } from '../lib/aiClient';
import { downloadCsv } from '../lib/receiptPdf';
import { BrandLogo } from './BrandLogo';
import { StudentsPanel } from './admin/StudentsPanel';
import { SeatManagementPanel } from './admin/SeatManagementPanel';
import { AttendancePanel } from './admin/AttendancePanel';
import { ShiftManagementPanel } from './admin/ShiftManagementPanel';
import { BooksAndIssuesPanel } from './admin/BooksAndIssuesPanel';
import { FinancePanel } from './admin/FinancePanel';
import { SettingsAndOpsPanel } from './admin/SettingsAndOpsPanel';
import { AIPdfImportPanel } from './admin/AIPdfImportPanel';
import { ExamManagementPanel } from './admin/ExamManagementPanel';
import { FeeReminderPanel } from './admin/FeeReminderPanel';
import { FaqManagementPanel } from './admin/FaqManagementPanel';
import { AdminProfilePanel } from './admin/AdminProfilePanel';
import {
  AnnouncementRecord,
  AttendanceRecord,
  AuditLogRecord,
  BookIssueRecord,
  BookRecord,
  CurrentAffairsItem,
  DigitalGKBook,
  EnquiryRecord,
  ExamCategory,
  ExamQuestion,
  ExpenseRecord,
  GalleryItem,
  LibrarySettings,
  MembershipPlan,
  MembershipRecord,
  MockTestRecord,
  PaymentRecord,
  SeatBookingRecord,
  SeatRecord,
  StaffRecord,
  StudentRecord,
  TestAttemptRecord,
  UserRole,
} from '../types/library';

interface AdminDashboardProps {
  settings: LibrarySettings | null;
  plans: MembershipPlan[];
  seats: SeatRecord[];
  books: BookRecord[];
  gallery: GalleryItem[];
  announcements: AnnouncementRecord[];
  exams: ExamCategory[];
  questions: ExamQuestion[];
  mockTests: MockTestRecord[];
  currentAffairs: CurrentAffairsItem[];
  gkBooks: DigitalGKBook[];
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onGoPublic: () => void;
}

type AdminTab =
  | 'overview'
  | 'students'
  | 'attendance'
  | 'shifts'
  | 'fee_reminders'
  | 'finance'
  | 'analytics'
  | 'faqs'
  | 'facilities'
  | 'gallery'
  | 'settings'
  | 'admin_profile'
  | 'change_password'
  | 'seats'
  | 'books'
  | 'pdf_import'
  | 'exam_management'
  | 'staff'
  | 'enquiries'
  | 'announcements'
  | 'notifications'
  | 'audit'
  | 'monitoring';

interface SystemStatusResponse {
  timestamp: string;
  geminiConfigured: boolean;
  ai: {
    circuitState: 'closed' | 'open' | 'half_open';
    cooldownActive: boolean;
    cooldownUntil: string | null;
    cooldownRemainingSeconds: number;
    cooldownReason: string | null;
    totalRequests: number;
    totalFailures: number;
    quotaExhaustedCount: number;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
  };
  pdfJobs: {
    totalJobs: number;
    activeCount: number;
    pausedCount: number;
    completedCount: number;
    failedCount: number;
    aggregate: {
      totalPages: number;
      completedPages: number;
      failedPages: number;
      pendingPages: number;
      extractedQuestions: number;
    };
    lastSuccessfulExtractionAt: string | null;
    latestJob: any;
    jobs: any[];
  };
  currentAffairs: {
    paused: boolean;
    autoPublishEnabled: boolean;
    lastRunAt: string | null;
    lastError: string | null;
  };
}

const CHART_COLORS = ['#002046', '#0051D5', '#004B73', '#006D30', '#9B4500'];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  settings,
  plans,
  seats,
  books,
  gallery,
  announcements,
  exams,
  questions,
  mockTests,
  currentAffairs,
  gkBooks,
  darkMode,
  onToggleDarkMode,
  onGoPublic,
}) => {
  const {
    firebaseUser,
    adminSession,
    profile,
    effectiveRole,
    actualRole,
    staffPermissions,
    previewRole,
    setPreviewRole,
    signOut,
    getIdToken,
    connectionStatus,
    retryConnection,
  } = useAuth();

  const isAdmin = effectiveRole === 'admin';
  const isManagerOrAdmin = effectiveRole === 'admin' || effectiveRole === 'manager';

  const hasStaffPerm = (perm: string) => {
    if (isManagerOrAdmin) return true;
    return staffPermissions.length === 0 || staffPermissions.includes(perm);
  };

  const [tab, setTab] = useState<AdminTab>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifyBanner, setNotifyBanner] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [includeDemoInOverview, setIncludeDemoInOverview] = useState(true);

  // Operational collections
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [staffList, setStaffList] = useState<StaffRecord[]>([]);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [bookings, setBookings] = useState<SeatBookingRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [bookIssues, setBookIssues] = useState<BookIssueRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [enquiries, setEnquiries] = useState<EnquiryRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [attempts, setAttempts] = useState<TestAttemptRecord[]>([]);

  // Backend telemetry snapshot for attendance/shifts/fees when logged in with Mobile+Password
  const [serverAttSummary, setServerAttSummary] = useState<{
    kpis?: { totalRegistered: number; presentToday: number; onLeaveToday: number; absentToday: number; unmarkedToday: number };
    shiftSummary?: Array<{ shiftId: string; shiftName: string; timing: string; totalStudents: number; present: number; leave: number; absent: number }>;
    students?: StudentRecord[];
    records?: AttendanceRecord[];
  } | null>(null);

  // System Monitor state
  const [sysStatus, setSysStatus] = useState<SystemStatusResponse | null>(null);
  const [sysLoading, setSysLoading] = useState(false);
  const [verifyingQuota, setVerifyingQuota] = useState(false);

  const handleNotify = useCallback((type: 'ok' | 'err', msg: string) => {
    setNotifyBanner({ type, msg });
  }, []);

  useEffect(() => {
    if (!firebaseUser || actualRole === 'student') return;
    const unsubs: Array<() => void> = [];

    const onErr = (err: unknown, path: string) => {
      const msg = reportFirestoreError(err, OperationType.LIST, path);
      if (!isTransientFirestoreError(err)) {
        handleNotify('err', msg);
      }
    };

    unsubs.push(
      onSnapshot(
        collection(db, 'students'),
        (snap) => {
          markFirestoreConnected();
          setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'students')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'memberships'),
        (snap) => {
          markFirestoreConnected();
          setMemberships(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'memberships')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'seat_bookings'),
        (snap) => {
          markFirestoreConnected();
          setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'seat_bookings')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'attendance'),
        (snap) => {
          markFirestoreConnected();
          setAttendance(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'attendance')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'book_issues'),
        (snap) => {
          markFirestoreConnected();
          setBookIssues(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'book_issues')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'payments'),
        (snap) => {
          markFirestoreConnected();
          setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'payments')
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'enquiries'),
        (snap) => {
          markFirestoreConnected();
          setEnquiries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        },
        (err) => onErr(err, 'enquiries')
      )
    );

    if (actualRole === 'admin' || actualRole === 'manager') {
      unsubs.push(
        onSnapshot(
          collection(db, 'staff'),
          (snap) => {
            markFirestoreConnected();
            setStaffList(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
          },
          (err) => onErr(err, 'staff')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'expenses'),
          (snap) => {
            markFirestoreConnected();
            setExpenses(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
          },
          (err) => onErr(err, 'expenses')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'test_attempts'),
          (snap) => {
            markFirestoreConnected();
            setAttempts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
          },
          (err) => onErr(err, 'test_attempts')
        )
      );
    }

    if (actualRole === 'admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'audit_logs'),
          (snap) => {
            markFirestoreConnected();
            setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
          },
          (err) => onErr(err, 'audit_logs')
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [firebaseUser?.uid, actualRole, handleNotify]);

  const fetchSystemStatus = useCallback(async () => {
    setSysLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/system-status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Unable to load system status.');
      const data: SystemStatusResponse = await res.json();
      setSysStatus(data);
    } catch (err: any) {
      handleNotify('err', err?.message || 'Failed to fetch system monitor telemetry.');
    } finally {
      setSysLoading(false);
    }
  }, [getIdToken, handleNotify]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch('/api/admin/attendance', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && active) {
          setServerAttSummary(await res.json());
        }
      } catch {
        // Ignore transient network errors
      }
    })();
    return () => {
      active = false;
    };
  }, [getIdToken, tab]);

  useEffect(() => {
    if (tab === 'monitoring' && isAdmin) {
      fetchSystemStatus();
    }
  }, [tab, isAdmin, fetchSystemStatus]);

  const handleVerifyGeminiQuota = async () => {
    setVerifyingQuota(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication token unavailable.');
      const res = await fetch('/api/admin/ai-verify-quota', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clearCooldown: true }),
      });
      const data = await res.json();
      if (data.available) {
        clearStoredAiCooldown();
        handleNotify('ok', `Gemini quota verified (${data.model}). Circuit breaker closed and cooldown cleared.`);
      } else {
        if (data.telemetry?.cooldownUntil) {
          saveStoredAiCooldown({
            cooldownUntil: data.telemetry.cooldownUntil,
            cooldownRemainingSeconds: data.telemetry.cooldownRemainingSeconds,
            reason: data.message,
            category: data.errorCategory,
          });
        }
        handleNotify('err', data.message || 'Gemini quota probe returned unavailable.');
      }
      await fetchSystemStatus();
    } catch (err: any) {
      handleNotify('err', err?.message || 'Quota verification failed.');
    } finally {
      setVerifyingQuota(false);
    }
  };

  const kpis = useMemo(() => {
    const scopeFilter = <T extends { isDemo?: boolean }>(arr: T[]) =>
      includeDemoInOverview ? arr : arr.filter((item) => !item.isDemo);

    const activeStudentsSrc =
      students.length > 0 ? students : serverAttSummary?.students || [];
    const activeAttendanceSrc =
      attendance.length > 0 ? attendance : serverAttSummary?.records || [];

    const scStudents = scopeFilter(activeStudentsSrc as StudentRecord[]);
    const scMemberships = scopeFilter(memberships);
    const scPayments = scopeFilter(payments);
    const scAttendance = scopeFilter(activeAttendanceSrc as AttendanceRecord[]);
    const scIssues = scopeFilter(bookIssues);

    const todayStr = new Date().toISOString().slice(0, 10);
    const activeMembers = scStudents.filter((s) => s.membershipStatus === 'active').length;
    const expiredMemberships =
      scMemberships.filter((m) => m.status === 'expired').length ||
      scStudents.filter((s) => s.membershipStatus === 'expired').length;
    const todayAttendance =
      serverAttSummary?.kpis?.presentToday ??
      scAttendance.filter((a) => a.date === todayStr).length;
    const availableSeats = seats.filter((s) => s.status === 'available').length;
    const occupiedSeats = seats.filter((s) => s.status === 'occupied').length;
    const verifiedRevenue = scPayments
      .filter((p) => p.status === 'verified')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const pendingPayments = scPayments
      .filter((p) => p.status === 'pending')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const issuedBooks = scIssues.filter((i) => i.status === 'issued' || i.status === 'overdue').length;

    return {
      totalStudents: serverAttSummary?.kpis?.totalRegistered ?? scStudents.length,
      activeMembers,
      expiredMemberships,
      todayAttendance,
      availableSeats,
      occupiedSeats,
      verifiedRevenue,
      pendingPayments,
      totalBooks: books.length,
      issuedBooks,
    };
  }, [students, memberships, payments, attendance, bookIssues, seats, books, includeDemoInOverview, serverAttSummary]);

  const planDistributionData = useMemo(() => {
    const counts: Record<string, number> = {};
    memberships
      .filter((m) => (includeDemoInOverview ? true : !m.isDemo))
      .forEach((m) => {
        counts[m.planName] = (counts[m.planName] || 0) + 1;
      });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [memberships, includeDemoInOverview]);

  const seatOccupancyData = useMemo(() => {
    return [
      { name: 'Occupied', count: seats.filter((s) => s.status === 'occupied').length },
      { name: 'Available', count: seats.filter((s) => s.status === 'available').length },
      { name: 'Reserved', count: seats.filter((s) => s.status === 'reserved').length },
      { name: 'Maintenance', count: seats.filter((s) => s.status === 'maintenance').length },
    ];
  }, [seats]);

  const attendanceChartData = useMemo(() => {
    const map: Record<string, number> = {};
    attendance
      .filter((a) => (includeDemoInOverview ? true : !a.isDemo))
      .forEach((a) => {
        map[a.date] = (map[a.date] || 0) + 1;
      });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, checkIns]) => ({ date: date.slice(5), checkIns }));
  }, [attendance, includeDemoInOverview]);

  const navGroups: Array<{
    group: string;
    items: Array<{ id: AdminTab; label: string; icon: React.ReactNode; visible: boolean; badge?: number }>;
  }> = [
    {
      group: 'Core Administration',
      items: [
        { id: 'overview', label: 'Dashboard Overview', icon: <LayoutDashboard className="w-4 h-4" />, visible: true },
        { id: 'students', label: 'Student Management', icon: <Users className="w-4 h-4" />, visible: hasStaffPerm('view_students') },
        { id: 'attendance', label: 'Attendance Management', icon: <CalendarCheck className="w-4 h-4" />, visible: hasStaffPerm('mark_attendance') },
        { id: 'shifts', label: 'Shift Management', icon: <Clock className="w-4 h-4" />, visible: hasStaffPerm('mark_attendance') },
        { id: 'fee_reminders', label: 'Fee Management', icon: <MessageCircle className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'finance', label: 'Payment History', icon: <CreditCard className="w-4 h-4" />, visible: isManagerOrAdmin || hasStaffPerm('record_offline_payments') },
        { id: 'analytics', label: 'Reports & Analytics', icon: <BarChart3 className="w-4 h-4" />, visible: isManagerOrAdmin },
      ],
    },
    {
      group: 'Public Website CMS',
      items: [
        { id: 'faqs', label: 'FAQ Management', icon: <HelpCircle className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'facilities', label: 'Library Facilities', icon: <Sparkles className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'gallery', label: 'Photo Gallery', icon: <ImageIcon className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'settings', label: 'Public Website Settings', icon: <Settings className="w-4 h-4" />, visible: isAdmin },
        { id: 'enquiries', label: 'Enquiries', icon: <MessageSquare className="w-4 h-4" />, visible: hasStaffPerm('view_enquiries') },
      ],
    },
    {
      group: 'Library & Exam Desk',
      items: [
        { id: 'seats', label: 'Study Seats', icon: <LayoutGrid className="w-4 h-4" />, visible: hasStaffPerm('manage_seats') },
        {
          id: 'books',
          label: 'Book Management',
          icon: <BookOpen className="w-4 h-4" />,
          visible: hasStaffPerm('manage_books'),
          badge: kpis.issuedBooks > 0 ? kpis.issuedBooks : undefined,
        },
        { id: 'exam_management', label: 'Exam & News CMS', icon: <Award className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'pdf_import', label: 'AI PDF Importer', icon: <FileUp className="w-4 h-4" />, visible: isManagerOrAdmin },
      ],
    },
    {
      group: 'Security & Account',
      items: [
        { id: 'admin_profile', label: 'Admin Profile & Security', icon: <ShieldCheck className="w-4 h-4" />, visible: isAdmin },
        { id: 'change_password', label: 'Change Password', icon: <KeyRound className="w-4 h-4" />, visible: isAdmin },
        { id: 'staff', label: 'Staff & RBAC', icon: <Shield className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'announcements', label: 'Notices', icon: <Megaphone className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, visible: isManagerOrAdmin },
        { id: 'audit', label: 'Audit Logs', icon: <FileText className="w-4 h-4" />, visible: isAdmin },
        { id: 'monitoring', label: 'System Monitor', icon: <Activity className="w-4 h-4" />, visible: isAdmin },
      ],
    },
  ];

  const actorDisplayName =
    adminSession?.displayName || profile?.displayName || firebaseUser?.email || 'Administrator';
  const userInitials = actorDisplayName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || 'GA';

  const selectTab = (next: AdminTab) => {
    setTab(next);
    setSidebarOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface text-on-surface font-body flex flex-col lg:flex-row">
      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-primary/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Persistent Navy Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 max-w-[85vw] sm:w-64 bg-primary text-on-primary flex flex-col justify-between transform transition-transform duration-200 lg:translate-x-0 lg:static shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col gap-5 p-4 overflow-y-auto">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-2 py-1">
            <BrandLogo variant="light" subtitle="Admin workspace" />
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation menu"
              className="lg:hidden p-1.5 rounded text-on-primary-container hover:text-on-primary hover:bg-primary-container"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Grouped Navigation */}
          <nav aria-label="Primary navigation" className="flex flex-col gap-4">
            {navGroups.map((group) => {
              const visibleItems = group.items.filter((i) => i.visible);
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.group} className="flex flex-col gap-1">
                  <span className="px-3 font-label text-[11px] font-semibold text-on-primary-container uppercase tracking-wider">
                    {group.group}
                  </span>
                  {visibleItems.map((item) => {
                    const active = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => selectTab(item.id)}
                        className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded text-left font-label text-sm font-medium transition-colors cursor-pointer ${
                          active
                            ? 'bg-secondary text-on-secondary font-semibold'
                            : 'text-on-primary-container hover:bg-primary-container hover:text-on-primary'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          {item.icon}
                          <span className="truncate">{item.label}</span>
                        </span>
                        {item.badge !== undefined && (
                          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-warning-container text-on-warning-container text-[11px] font-bold tabular-nums shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-2.5 px-3 py-2 rounded text-left font-label text-sm font-semibold text-error-container hover:bg-error/20 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </nav>
        </div>

        {/* Sidebar User Footer */}
        <div className="p-4 border-t border-primary-container">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded bg-primary-container">
            <div className="w-9 h-9 rounded-full bg-secondary text-on-secondary flex items-center justify-center font-headline text-xs font-bold shrink-0">
              {userInitials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-title text-sm font-semibold text-on-primary truncate">
                {actorDisplayName}
              </span>
              <span className="font-body text-xs text-on-primary-container capitalize truncate">
                Role: {effectiveRole}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Workspace Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 bg-surface-container-lowest border-b border-outline-variant px-3 sm:px-4 lg:px-8 py-2.5 sm:py-3 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded border border-outline-variant text-on-surface hover:bg-surface-container-low shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="font-headline text-sm sm:text-base font-bold text-primary truncate">
                GYAN ADDA LIBRARY
              </p>
              <p className="font-body text-xs text-on-surface-variant capitalize truncate">
                {effectiveRole} Management Console
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2.5 shrink-0 max-w-full">
            <button
              type="button"
              onClick={() => retryConnection().catch(() => {})}
              title={
                connectionStatus.lastError
                  ? `Firestore: ${connectionStatus.state} (${connectionStatus.lastError})`
                  : `Firestore: ${connectionStatus.state}`
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
                  ? 'Firestore Live'
                  : connectionStatus.state === 'offline'
                    ? 'Offline · Retry'
                    : 'Reconnecting'}
              </span>
            </button>

            {actualRole === 'admin' && (
              <select
                aria-label="Preview Role Switcher"
                value={previewRole || 'admin'}
                onChange={(e) => {
                  const val = e.target.value as UserRole;
                  setPreviewRole(val === 'admin' ? null : val);
                  setTab('overview');
                }}
                className="px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded border border-outline-variant bg-surface text-on-surface max-w-[125px] sm:max-w-none"
              >
                <option value="admin">View As: Admin</option>
                <option value="manager">View As: Manager</option>
                <option value="staff">View As: Staff</option>
                <option value="student">View As: Student</option>
              </select>
            )}

            <button
              type="button"
              onClick={onGoPublic}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded border border-outline-variant bg-surface-container-lowest text-xs font-semibold text-primary hover:bg-surface-container-low cursor-pointer shrink-0"
            >
              <Home className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Public Site</span>
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle color theme"
              className="p-2 rounded border border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:text-primary hover:bg-surface-container-low cursor-pointer shrink-0"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {notifyBanner && (
            <div
              className={`p-3.5 rounded-lg border text-xs font-medium flex flex-wrap items-center justify-between gap-2 ${
                notifyBanner.type === 'ok'
                  ? 'bg-success-container/70 border-success/40 text-on-success-container'
                  : 'bg-error-container border-error/40 text-on-error-container'
              }`}
            >
              <span className="min-w-0 break-words">{notifyBanner.msg}</span>
              <button
                type="button"
                onClick={() => setNotifyBanner(null)}
                className="underline font-semibold cursor-pointer shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-headline text-2xl font-bold text-on-surface">
                    Library overview
                  </h1>
                  <p className="text-sm text-on-surface-variant">
                    Real-time metrics across seats, memberships, attendance, competitive exams, books, and verified revenue.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded border border-outline-variant bg-surface-container-lowest text-xs font-medium cursor-pointer text-on-surface">
                    <input
                      type="checkbox"
                      checked={includeDemoInOverview}
                      onChange={(e) => setIncludeDemoInOverview(e.target.checked)}
                    />
                    Include Demo Sample Records
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      downloadCsv(
                        `gyan-adda-executive-summary-${new Date().toISOString().slice(0, 10)}.csv`,
                        ['Metric', 'Value'],
                        [
                          ['Total Students', kpis.totalStudents],
                          ['Active Members', kpis.activeMembers],
                          ['Expired Memberships', kpis.expiredMemberships],
                          ['Today Attendance', kpis.todayAttendance],
                          ['Available Seats', kpis.availableSeats],
                          ['Occupied Seats', kpis.occupiedSeats],
                          ['Verified Revenue (INR)', kpis.verifiedRevenue],
                          ['Pending Payments (INR)', kpis.pendingPayments],
                          ['Total Books', kpis.totalBooks],
                          ['Issued Books', kpis.issuedBooks],
                          ['Exam Questions', questions.length],
                          ['Exam Attempts', attempts.length],
                        ]
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-surface-container-lowest border border-outline-variant text-primary text-xs font-semibold hover:bg-surface-container-low cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Export Report
                  </button>
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
                {[
                  { label: 'Total Students', val: kpis.totalStudents, accent: 'text-primary' },
                  { label: 'Active Members', val: kpis.activeMembers, accent: 'text-success' },
                  { label: 'Expired Plans', val: kpis.expiredMemberships, accent: 'text-warning' },
                  { label: "Today's Attendance", val: kpis.todayAttendance, accent: 'text-secondary' },
                  { label: 'Available Seats', val: kpis.availableSeats, accent: 'text-success' },
                  { label: 'Occupied Seats', val: kpis.occupiedSeats, accent: 'text-primary' },
                  {
                    label: 'Verified Revenue',
                    val: `₹${kpis.verifiedRevenue.toLocaleString('en-IN')}`,
                    accent: 'text-success',
                  },
                  {
                    label: 'Pending Dues',
                    val: `₹${kpis.pendingPayments.toLocaleString('en-IN')}`,
                    accent: 'text-error',
                  },
                  { label: 'Physical Books', val: kpis.totalBooks, accent: 'text-primary' },
                  { label: 'Issued Books', val: kpis.issuedBooks, accent: 'text-secondary' },
                  { label: 'Exam Categories', val: exams.filter((e) => e.active).length, accent: 'text-primary' },
                  { label: 'Question Bank', val: questions.length, accent: 'text-secondary' },
                  { label: 'Test Attempts', val: attempts.length, accent: 'text-primary' },
                  { label: 'Current Affairs', val: currentAffairs.length, accent: 'text-tertiary' },
                  { label: 'Digital GK Books', val: gkBooks.length, accent: 'text-primary' },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="min-w-0 p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm"
                  >
                    <p className="font-label text-xs font-medium text-on-surface-variant truncate">{card.label}</p>
                    <p className={`font-headline text-xl sm:text-2xl font-bold tabular-nums mt-1 break-words ${card.accent}`}>
                      {card.val}
                    </p>
                  </div>
                ))}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                <div className="min-w-0 overflow-hidden p-4 sm:p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
                    Daily Check-In Trend
                  </h3>
                  <div className="h-56 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={attendanceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" strokeOpacity={0.5} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#44474E' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#44474E' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#C4C6CF',
                            color: '#0B1C30',
                            fontSize: '12px',
                            borderRadius: '8px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="checkIns"
                          stroke="#0051D5"
                          fill="#0051D5"
                          fillOpacity={0.18}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="min-w-0 overflow-hidden p-4 sm:p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
                    Seat Occupancy Breakdown
                  </h3>
                  <div className="h-56 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={seatOccupancyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" strokeOpacity={0.5} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#44474E' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#44474E' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#C4C6CF',
                            color: '#0B1C30',
                            fontSize: '12px',
                            borderRadius: '8px',
                          }}
                        />
                        <Bar dataKey="count" fill="#002046" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="min-w-0 overflow-hidden md:col-span-2 xl:col-span-1 p-4 sm:p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
                    Membership Plan Distribution
                  </h3>
                  <div className="h-56 w-full min-w-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={planDistributionData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={72}
                        >
                          {planDistributionData.map((entry, idx) => (
                            <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#FFFFFF',
                            borderColor: '#C4C6CF',
                            color: '#0B1C30',
                            fontSize: '12px',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#44474E' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'analytics' && isManagerOrAdmin && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-headline text-2xl font-bold text-on-surface">
                    Reports &amp; Library Analytics
                  </h1>
                  <p className="text-sm text-on-surface-variant">
                    Shift attendance breakdown, occupancy utilization, and financial collection analytics.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    downloadCsv(
                      `gyan-adda-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
                      ['Metric', 'Value'],
                      [
                        ['Total Registered Students', kpis.totalStudents],
                        ['Present Today (IST)', kpis.todayAttendance],
                        ['On Leave Today', serverAttSummary?.kpis?.onLeaveToday ?? 0],
                        ['Absent Today', serverAttSummary?.kpis?.absentToday ?? 0],
                        ['Verified Revenue (INR)', kpis.verifiedRevenue],
                        ['Pending Dues (INR)', kpis.pendingPayments],
                      ]
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export Analytics CSV
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant mb-3">
                    Shift-Wise Attendance Breakdown
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={serverAttSummary?.shiftSummary || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" strokeOpacity={0.5} />
                        <XAxis dataKey="shiftName" tick={{ fontSize: 10, fill: '#44474E' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#44474E' }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="present" name="Present" fill="#006D30" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="leave" name="Leave" fill="#9B4500" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="absent" name="Absent" fill="#B3261E" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                    Shift Utilization Summary
                  </h3>
                  <div className="divide-y divide-outline-variant/60">
                    {(serverAttSummary?.shiftSummary || []).map((s) => (
                      <div key={s.shiftId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <p className="font-semibold text-primary">{s.shiftName}</p>
                          <p className="font-mono text-[11px] text-on-surface-variant">{s.timing}</p>
                        </div>
                        <div className="font-mono tabular-nums flex items-center gap-3">
                          <span className="text-success font-bold">P: {s.present}</span>
                          <span className="text-warning font-bold">L: {s.leave}</span>
                          <span className="text-error font-bold">A: {s.absent}</span>
                          <span className="text-on-surface-variant">Total: {s.totalStudents}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'fee_reminders' && isManagerOrAdmin && (
            <FeeReminderPanel
              students={students}
              plans={plans}
              actorUid={firebaseUser?.uid || adminSession?.adminId || ''}
              actorEmail={firebaseUser?.email || adminSession?.mobile || ''}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'monitoring' && isAdmin && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-headline text-2xl font-bold text-on-surface">
                    System Health & Quota Monitor
                  </h1>
                  <p className="text-sm text-on-surface-variant">
                    Live Firestore transport status, Gemini API circuit breaker telemetry, PDF checkpoint metrics, and Current Affairs automation.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sysLoading}
                  onClick={fetchSystemStatus}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-surface-container-lowest border border-outline-variant text-primary text-xs font-semibold hover:bg-surface-container-low cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${sysLoading ? 'animate-spin' : ''}`} />
                  Refresh Telemetry
                </button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* Firestore Connection Card */}
                <div className="min-w-0 bg-surface-container-lowest rounded-lg border border-outline-variant p-4 sm:p-5 space-y-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-md bg-surface-container-low text-secondary flex items-center justify-center shrink-0">
                        <Database className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-headline text-base font-bold text-on-surface">
                          Cloud Firestore Connection
                        </h2>
                        <p className="text-xs text-on-surface-variant font-mono break-all">
                          Project: {connectionStatus.projectId}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize shrink-0 ${
                        connectionStatus.state === 'connected'
                          ? 'bg-success-container text-on-success-container'
                          : connectionStatus.state === 'offline'
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-warning-container text-on-warning-container'
                      }`}
                    >
                      {connectionStatus.state}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 text-xs bg-surface-container-low p-3.5 rounded-lg border border-outline-variant">
                    <div className="min-w-0">
                      <span className="text-on-surface-variant block">Database ID</span>
                      <span className="font-mono font-semibold text-on-surface break-all">
                        {connectionStatus.databaseId}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-on-surface-variant block">Last Connected</span>
                      <span className="font-mono text-on-surface break-all">
                        {connectionStatus.lastConnectedAt
                          ? connectionStatus.lastConnectedAt.slice(0, 19).replace('T', ' ')
                          : 'Pending'}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block">Retry Counter</span>
                      <span className="font-mono text-on-surface">
                        {connectionStatus.retryAttempt} / {connectionStatus.maxRetries}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-on-surface-variant block">Last Error</span>
                      <span className="text-on-surface truncate block">
                        {connectionStatus.lastError || 'None'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => retryConnection().catch(() => {})}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-primary text-on-primary hover:bg-primary-container text-xs font-semibold cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Reconnect Firestore Now
                  </button>
                </div>

                {/* Gemini AI Circuit Breaker Card */}
                <div className="min-w-0 bg-surface-container-lowest rounded-lg border border-outline-variant p-4 sm:p-5 space-y-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-10 h-10 rounded-md bg-surface-container-low text-secondary flex items-center justify-center shrink-0">
                        <Cpu className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-headline text-base font-bold text-on-surface">
                          Gemini API Resilience & Quota
                        </h2>
                        <p className="text-xs text-on-surface-variant">
                          Server Key: {sysStatus?.geminiConfigured ? 'Configured' : 'Missing'}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase shrink-0 ${
                        sysStatus?.ai.circuitState === 'closed'
                          ? 'bg-success-container text-on-success-container'
                          : sysStatus?.ai.circuitState === 'open'
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-warning-container text-on-warning-container'
                      }`}
                    >
                      Circuit: {sysStatus?.ai.circuitState || 'loading'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-surface-container-low p-3.5 rounded-lg border border-outline-variant">
                    <div>
                      <span className="text-on-surface-variant block">Cooldown</span>
                      <span className="font-mono font-bold text-on-surface">
                        {sysStatus?.ai.cooldownActive
                          ? formatCooldownRemaining(sysStatus.ai.cooldownRemainingSeconds)
                          : 'None'}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block">Requests / Failures</span>
                      <span className="font-mono text-on-surface">
                        {sysStatus?.ai.totalRequests ?? 0} / {sysStatus?.ai.totalFailures ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block">429 Quota Hits</span>
                      <span className="font-mono text-on-surface">
                        {sysStatus?.ai.quotaExhaustedCount ?? 0}
                      </span>
                    </div>
                  </div>

                  {sysStatus?.ai.lastErrorMessage && (
                    <p className="text-xs text-error bg-error-container/50 p-2.5 rounded border border-error/30 break-words">
                      Last AI Error: {sysStatus.ai.lastErrorMessage}
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={verifyingQuota}
                    onClick={handleVerifyGeminiQuota}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary hover:bg-primary text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {verifyingQuota ? 'Verifying Quota...' : 'Verify Quota & Recover Cooldown'}
                  </button>
                </div>

                {/* PDF Batch Pipeline Card */}
                <div className="min-w-0 bg-surface-container-lowest rounded-lg border border-outline-variant p-4 sm:p-5 space-y-4 shadow-sm">
                  <h2 className="font-headline text-base font-bold text-on-surface">
                    PDF Question Extraction Pipeline
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    {[
                      { label: 'Total Pages', val: sysStatus?.pdfJobs.aggregate.totalPages ?? 0 },
                      { label: 'Completed Pages', val: sysStatus?.pdfJobs.aggregate.completedPages ?? 0 },
                      { label: 'Failed Pages', val: sysStatus?.pdfJobs.aggregate.failedPages ?? 0 },
                      { label: 'Pending Pages', val: sysStatus?.pdfJobs.aggregate.pendingPages ?? 0 },
                    ].map((m) => (
                      <div key={m.label} className="p-3 rounded bg-surface-container-low border border-outline-variant">
                        <span className="text-on-surface-variant block">{m.label}</span>
                        <span className="font-headline text-lg font-bold tabular-nums text-on-surface">
                          {m.val}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-on-surface-variant font-mono break-all">
                    Last Successful Extraction:{' '}
                    {sysStatus?.pdfJobs.lastSuccessfulExtractionAt
                      ? sysStatus.pdfJobs.lastSuccessfulExtractionAt.slice(0, 19).replace('T', ' ')
                      : 'None recorded'}
                  </p>
                </div>

                {/* Current Affairs Scheduler Card */}
                <div className="min-w-0 bg-surface-container-lowest rounded-lg border border-outline-variant p-4 sm:p-5 space-y-4 shadow-sm">
                  <h2 className="font-headline text-base font-bold text-on-surface">
                    Daily Current Affairs Scheduler
                  </h2>
                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 text-xs bg-surface-container-low p-3.5 rounded-lg border border-outline-variant">
                    <div>
                      <span className="text-on-surface-variant block">Status</span>
                      <span className="font-semibold text-on-surface">
                        {sysStatus?.currentAffairs.paused ? 'Paused' : 'Active (IST 07:00)'}
                      </span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block">Auto-Publish</span>
                      <span className="font-semibold text-on-surface">
                        {sysStatus?.currentAffairs.autoPublishEnabled ? 'Enabled' : 'Manual Review'}
                      </span>
                    </div>
                    <div className="min-[360px]:col-span-2 min-w-0">
                      <span className="text-on-surface-variant block">Last Run</span>
                      <span className="font-mono text-on-surface break-all">
                        {sysStatus?.currentAffairs.lastRunAt || 'Not run in current server uptime'}
                      </span>
                    </div>
                  </div>
                  {sysStatus?.currentAffairs.lastError && (
                    <p className="text-xs text-error break-words">{sysStatus.currentAffairs.lastError}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'exam_management' && isManagerOrAdmin && (
            <ExamManagementPanel
              exams={exams}
              questions={questions}
              mockTests={mockTests}
              currentAffairs={currentAffairs}
              gkBooks={gkBooks}
              attempts={attempts}
              actorUid={firebaseUser?.uid || ''}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'pdf_import' && isManagerOrAdmin && (
            <AIPdfImportPanel
              exams={exams}
              existingQuestions={questions}
              actorUid={firebaseUser?.uid || ''}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'students' && (
            <StudentsPanel
              students={students}
              plans={plans}
              seats={seats}
              attendance={attendance}
              payments={payments}
              isManagerOrAdmin={isManagerOrAdmin}
              actorRole={effectiveRole}
              hasFirebaseSession={Boolean(firebaseUser)}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'seats' && (
            <SeatManagementPanel
              seats={seats}
              bookings={bookings}
              students={students}
              canDelete={isAdmin}
              actorRole={effectiveRole}
              onNotify={handleNotify}
            />
          )}

          {tab === 'attendance' && (
            <AttendancePanel
              attendance={attendance}
              students={students}
              actorUid={firebaseUser?.uid || adminSession?.adminId || ''}
              hasFirebaseSession={Boolean(firebaseUser)}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'shifts' && (
            <ShiftManagementPanel
              students={students}
              hasFirebaseSession={Boolean(firebaseUser)}
              isManagerOrAdmin={isManagerOrAdmin}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'faqs' && isManagerOrAdmin && (
            <FaqManagementPanel
              hasFirebaseSession={Boolean(firebaseUser)}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}

          {tab === 'admin_profile' && isAdmin && (
            <AdminProfilePanel mode="profile" onNotify={handleNotify} />
          )}

          {tab === 'change_password' && isAdmin && (
            <AdminProfilePanel mode="password" onNotify={handleNotify} />
          )}

          {tab === 'books' && (
            <BooksAndIssuesPanel
              books={books}
              issues={bookIssues}
              students={students}
              canDelete={isAdmin}
              onNotify={handleNotify}
            />
          )}

          {tab === 'finance' && (
            <FinancePanel
              plans={plans}
              memberships={memberships}
              payments={payments}
              expenses={expenses}
              students={students}
              settings={settings}
              actorUid={firebaseUser?.uid || adminSession?.adminId || ''}
              actorRole={effectiveRole}
              isAdmin={isAdmin}
              isManagerOrAdmin={isManagerOrAdmin}
              onNotify={handleNotify}
            />
          )}

          {(tab === 'staff' ||
            tab === 'enquiries' ||
            tab === 'gallery' ||
            tab === 'facilities' ||
            tab === 'announcements' ||
            tab === 'notifications' ||
            tab === 'audit' ||
            tab === 'settings') && (
            <SettingsAndOpsPanel
              activeSection={tab}
              staffList={staffList}
              enquiries={enquiries}
              gallery={gallery}
              announcements={announcements}
              auditLogs={auditLogs}
              students={students}
              settings={settings}
              actorUid={firebaseUser?.uid || adminSession?.adminId || ''}
              actorRole={effectiveRole}
              isAdmin={isAdmin}
              isManagerOrAdmin={isManagerOrAdmin}
              hasFirebaseSession={Boolean(firebaseUser)}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}
        </main>
      </div>
    </div>
  );
};
