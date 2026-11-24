import React, { useEffect, useMemo, useState } from 'react';
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
  Award,
  Bell,
  BookOpen,
  CalendarCheck,
  CreditCard,
  Download,
  FileText,
  FileUp,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  MessageSquare,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
} from 'lucide-react';
import { db, OperationType, reportFirestoreError } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { downloadCsv } from '../lib/receiptPdf';
import { BrandLogo } from './BrandLogo';
import { StudentsPanel } from './admin/StudentsPanel';
import { SeatManagementPanel } from './admin/SeatManagementPanel';
import { AttendancePanel } from './admin/AttendancePanel';
import { BooksAndIssuesPanel } from './admin/BooksAndIssuesPanel';
import { FinancePanel } from './admin/FinancePanel';
import { SettingsAndOpsPanel } from './admin/SettingsAndOpsPanel';
import { AIPdfImportPanel } from './admin/AIPdfImportPanel';
import { ExamManagementPanel } from './admin/ExamManagementPanel';
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
  | 'seats'
  | 'attendance'
  | 'books'
  | 'finance'
  | 'pdf_import'
  | 'exam_management'
  | 'staff'
  | 'enquiries'
  | 'gallery'
  | 'announcements'
  | 'notifications'
  | 'audit'
  | 'settings';

const CHART_COLORS = ['#B5ADC6', '#7C7397', '#059669', '#D97706', '#CFCEDD'];

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
    profile,
    effectiveRole,
    actualRole,
    staffPermissions,
    previewRole,
    setPreviewRole,
    signOut,
    getIdToken,
  } = useAuth();

  const isAdmin = effectiveRole === 'admin';
  const isManagerOrAdmin = effectiveRole === 'admin' || effectiveRole === 'manager';

  const hasStaffPerm = (perm: string) => {
    if (isManagerOrAdmin) return true;
    return staffPermissions.length === 0 || staffPermissions.includes(perm);
  };

  const [tab, setTab] = useState<AdminTab>('overview');
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

  const handleNotify = (type: 'ok' | 'err', msg: string) => {
    setNotifyBanner({ type, msg });
  };

  useEffect(() => {
    if (!firebaseUser || actualRole === 'student') return;
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        collection(db, 'students'),
        (snap) => setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'students'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'memberships'),
        (snap) => setMemberships(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'memberships'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'seat_bookings'),
        (snap) => setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'seat_bookings'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'attendance'),
        (snap) => setAttendance(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'attendance'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'book_issues'),
        (snap) => setBookIssues(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'book_issues'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'payments'),
        (snap) => setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'payments'))
      )
    );
    unsubs.push(
      onSnapshot(
        collection(db, 'enquiries'),
        (snap) => setEnquiries(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'enquiries'))
      )
    );

    if (actualRole === 'admin' || actualRole === 'manager') {
      unsubs.push(
        onSnapshot(
          collection(db, 'staff'),
          (snap) => setStaffList(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
          (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'staff'))
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'expenses'),
          (snap) => setExpenses(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
          (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'expenses'))
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'test_attempts'),
          (snap) => setAttempts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
          (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'test_attempts'))
        )
      );
    }

    if (actualRole === 'admin') {
      unsubs.push(
        onSnapshot(
          collection(db, 'audit_logs'),
          (snap) => setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
          (err) => handleNotify('err', reportFirestoreError(err, OperationType.LIST, 'audit_logs'))
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [firebaseUser?.uid, actualRole]);

  const kpis = useMemo(() => {
    const scopeFilter = <T extends { isDemo?: boolean }>(arr: T[]) =>
      includeDemoInOverview ? arr : arr.filter((item) => !item.isDemo);

    const scStudents = scopeFilter(students);
    const scMemberships = scopeFilter(memberships);
    const scPayments = scopeFilter(payments);
    const scAttendance = scopeFilter(attendance);
    const scIssues = scopeFilter(bookIssues);

    const todayStr = new Date().toISOString().slice(0, 10);
    const activeMembers = scStudents.filter((s) => s.membershipStatus === 'active').length;
    const expiredMemberships =
      scMemberships.filter((m) => m.status === 'expired').length ||
      scStudents.filter((s) => s.membershipStatus === 'expired').length;
    const todayAttendance = scAttendance.filter((a) => a.date === todayStr).length;
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
      totalStudents: scStudents.length,
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
  }, [students, memberships, payments, attendance, bookIssues, seats, books, includeDemoInOverview]);

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

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode; visible: boolean }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" />, visible: true },
    { id: 'exam_management', label: 'Exam & News CMS', icon: <Award className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'pdf_import', label: 'AI PDF Importer', icon: <FileUp className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'students', label: 'Students', icon: <Users className="w-4 h-4" />, visible: hasStaffPerm('view_students') },
    { id: 'seats', label: 'Study Seats', icon: <LayoutGrid className="w-4 h-4" />, visible: hasStaffPerm('manage_seats') },
    { id: 'attendance', label: 'Attendance', icon: <CalendarCheck className="w-4 h-4" />, visible: hasStaffPerm('mark_attendance') },
    { id: 'books', label: 'Books & Issues', icon: <BookOpen className="w-4 h-4" />, visible: hasStaffPerm('manage_books') },
    {
      id: 'finance',
      label: isManagerOrAdmin ? 'Finance & Plans' : 'Desk Payments',
      icon: <CreditCard className="w-4 h-4" />,
      visible: isManagerOrAdmin || hasStaffPerm('record_offline_payments'),
    },
    { id: 'staff', label: 'Staff & RBAC', icon: <Shield className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'enquiries', label: 'Enquiries', icon: <MessageSquare className="w-4 h-4" />, visible: hasStaffPerm('view_enquiries') },
    { id: 'gallery', label: 'Gallery', icon: <ImageIcon className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'announcements', label: 'Notices', icon: <Megaphone className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, visible: isManagerOrAdmin },
    { id: 'audit', label: 'Audit Logs', icon: <FileText className="w-4 h-4" />, visible: isAdmin },
    { id: 'settings', label: 'Library Settings', icon: <Settings className="w-4 h-4" />, visible: isAdmin },
  ];

  return (
    <div className="min-h-screen bg-[#1C0E29] text-white flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0E0713] border-b border-[#7C7397]/40 px-4 lg:px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandLogo />
          <span className="hidden sm:inline text-xs font-semibold tracking-wider uppercase text-[#B5ADC6]">
            · {effectiveRole} Workspace
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {actualRole === 'admin' && (
            <select
              aria-label="Preview Role Switcher"
              value={previewRole || 'admin'}
              onChange={(e) => {
                const val = e.target.value as UserRole;
                setPreviewRole(val === 'admin' ? null : val);
                setTab('overview');
              }}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-[#7C7397] bg-[#3D2C56] text-white"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#7C7397]/60 text-xs font-medium text-[#CFCEDD] hover:bg-[#3D2C56] hover:text-white"
          >
            <Home className="w-3.5 h-3.5" /> Public Site
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar */}
        <aside className="lg:col-span-3 xl:col-span-2 space-y-1">
          <div className="p-3 mb-3 rounded-xl bg-[#0E0713] border border-[#7C7397]/40">
            <p className="text-[11px] uppercase tracking-wider text-[#9993AC] font-semibold">
              Signed In
            </p>
            <p className="text-xs font-bold truncate mt-0.5 text-white">
              {profile?.displayName || firebaseUser?.email}
            </p>
            <p className="text-[11px] text-[#B5ADC6] font-semibold capitalize mt-0.5">
              Role: {effectiveRole}
            </p>
          </div>

          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0">
            {navItems
              .filter((item) => item.visible)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    tab === item.id
                      ? 'bg-[#B5ADC6] text-[#0E0713]'
                      : 'text-[#CFCEDD] hover:bg-[#3D2C56] hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
          </nav>
        </aside>

        {/* Main Workspace */}
        <main className="lg:col-span-9 xl:col-span-10 space-y-6">
          {notifyBanner && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between ${
                notifyBanner.type === 'ok'
                  ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/60 text-red-200'
              }`}
            >
              <span>{notifyBanner.msg}</span>
              <button type="button" onClick={() => setNotifyBanner(null)} className="underline ml-3">
                Dismiss
              </button>
            </div>
          )}

          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="font-display text-2xl font-bold text-white">
                    VIDHYA LIBRARY · Gyan Adda Operations Overview
                  </h1>
                  <p className="text-xs text-[#CFCEDD]">
                    Real-time metrics across seats, memberships, attendance, competitive exams, books, and verified revenue.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#7C7397]/60 bg-[#3D2C56] text-xs font-medium cursor-pointer text-white">
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
                        `vidhya-executive-summary-${new Date().toISOString().slice(0, 10)}.csv`,
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
                  >
                    <Download className="w-3.5 h-3.5" /> Export Report
                  </button>
                </div>
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
                {[
                  { label: 'Total Students', val: kpis.totalStudents },
                  { label: 'Active Members', val: kpis.activeMembers },
                  { label: 'Expired Plans', val: kpis.expiredMemberships },
                  { label: "Today's Attendance", val: kpis.todayAttendance },
                  { label: 'Available Seats', val: kpis.availableSeats },
                  { label: 'Occupied Seats', val: kpis.occupiedSeats },
                  {
                    label: 'Verified Revenue',
                    val: `₹${kpis.verifiedRevenue.toLocaleString('en-IN')}`,
                  },
                  {
                    label: 'Pending Dues',
                    val: `₹${kpis.pendingPayments.toLocaleString('en-IN')}`,
                  },
                  { label: 'Physical Books', val: kpis.totalBooks },
                  { label: 'Issued Books', val: kpis.issuedBooks },
                  { label: 'Exam Categories', val: exams.filter((e) => e.active).length },
                  { label: 'Question Bank', val: questions.length },
                  { label: 'Test Attempts', val: attempts.length },
                  { label: 'Current Affairs', val: currentAffairs.length },
                  { label: 'Digital GK Books', val: gkBooks.length },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="p-4 rounded-xl bg-[#514871] border border-[#7C7397]/40"
                  >
                    <p className="text-[11px] font-medium text-[#CFCEDD]">{card.label}</p>
                    <p className="font-display text-2xl font-bold text-white tabular-nums mt-1">
                      {card.val}
                    </p>
                  </div>
                ))}
              </div>

              {/* Charts Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#CFCEDD] mb-3">
                    Daily Check-In Trend
                  </h3>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={attendanceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#7C7397" strokeOpacity={0.25} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#CFCEDD' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#CFCEDD' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0E0713',
                            borderColor: '#7C7397',
                            color: '#FFFFFF',
                            fontSize: '12px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="checkIns"
                          stroke="#B5ADC6"
                          fill="#B5ADC6"
                          fillOpacity={0.25}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#CFCEDD] mb-3">
                    Seat Occupancy Breakdown
                  </h3>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={seatOccupancyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#7C7397" strokeOpacity={0.25} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#CFCEDD' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#CFCEDD' }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0E0713',
                            borderColor: '#7C7397',
                            color: '#FFFFFF',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="count" fill="#B5ADC6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#CFCEDD] mb-3">
                    Membership Plan Distribution
                  </h3>
                  <div className="h-56 w-full">
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
                            backgroundColor: '#0E0713',
                            borderColor: '#7C7397',
                            color: '#FFFFFF',
                            fontSize: '12px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', color: '#CFCEDD' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
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
              actorUid={firebaseUser?.uid || ''}
              onNotify={handleNotify}
            />
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
              actorUid={firebaseUser?.uid || ''}
              actorRole={effectiveRole}
              isAdmin={isAdmin}
              isManagerOrAdmin={isManagerOrAdmin}
              onNotify={handleNotify}
            />
          )}

          {(tab === 'staff' ||
            tab === 'enquiries' ||
            tab === 'gallery' ||
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
              actorUid={firebaseUser?.uid || ''}
              actorRole={effectiveRole}
              isAdmin={isAdmin}
              isManagerOrAdmin={isManagerOrAdmin}
              getIdToken={getIdToken}
              onNotify={handleNotify}
            />
          )}
        </main>
      </div>
    </div>
  );
};
