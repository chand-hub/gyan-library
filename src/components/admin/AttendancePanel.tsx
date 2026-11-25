import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileText,
  History,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { db } from '../../lib/firebase';
import {
  AttendanceAuditEntry,
  AttendanceRecord,
  AttendanceStatusCode,
  CustomAttendanceStatus,
  LibraryShift,
  StudentRecord,
} from '../../types/library';
import { downloadCsv } from '../../lib/receiptPdf';

interface AttendancePanelProps {
  attendance: AttendanceRecord[];
  students: StudentRecord[];
  actorUid: string;
  hasFirebaseSession?: boolean;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface ServerIstClock {
  date: string;
  time24: string;
  timeShort: string;
  time12: string;
  iso: string;
  displayIst: string;
}

interface ShiftSummaryItem {
  shiftId: string;
  shiftName: string;
  timing: string;
  totalStudents: number;
  present: number;
  leave: number;
  absent: number;
}

interface AttendanceDashboardPayload {
  serverIst: ServerIstClock;
  targetDate: string;
  kpis: {
    totalRegistered: number;
    presentToday: number;
    onLeaveToday: number;
    absentToday: number;
    unmarkedToday: number;
  };
  shiftSummary: ShiftSummaryItem[];
  shifts: LibraryShift[];
  students: StudentRecord[];
  customStatuses: CustomAttendanceStatus[];
  records: AttendanceRecord[];
  allDateRecords: AttendanceRecord[];
  auditLogs: AttendanceAuditEntry[];
}

type SubTab = 'daily' | 'history' | 'audit';

const STATUS_BADGE_MAP: Record<string, string> = {
  PRESENT: 'bg-success-container text-on-success-container border-success/30',
  LEAVE: 'bg-warning-container text-on-warning-container border-warning/30',
  ABSENT: 'bg-error-container text-on-error-container border-error/30',
  HALF_DAY: 'bg-secondary-container text-on-secondary-container border-secondary/30',
  HOLIDAY: 'bg-tertiary-container text-on-tertiary-container border-tertiary/30',
  OTHER: 'bg-surface-variant text-on-surface border-outline-variant',
};

export const AttendancePanel: React.FC<AttendancePanelProps> = ({
  students: propStudents,
  hasFirebaseSession = false,
  getIdToken,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('daily');
  const [dashboard, setDashboard] = useState<AttendanceDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickIdQuery, setQuickIdQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  // Live IST clock ticking smoothly from server clock offset
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [liveClockStr, setLiveClockStr] = useState('');

  // Status / Leave Modal (also used for Edit / Correction)
  const [statusModalStudent, setStatusModalStudent] = useState<StudentRecord | null>(null);
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [modalStatus, setModalStatus] = useState<AttendanceStatusCode>('LEAVE');
  const [customStatusLabel, setCustomStatusLabel] = useState('');
  const [leaveType, setLeaveType] = useState('Leave');
  const [leaveReason, setLeaveReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Custom Status creator modal
  const [showCustomCreator, setShowCustomCreator] = useState(false);
  const [newCustomLabel, setNewCustomLabel] = useState('');

  // History month filter
  const [historyStudentId, setHistoryStudentId] = useState('ALL');
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;

      if (propStudents.length > 0) {
        await fetch('/api/admin/attendance/sync-students', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            students: propStudents.map((s) => ({
              id: s.id,
              uid: s.uid,
              studentCode: s.studentCode,
              fullName: s.fullName,
              mobile: s.mobile,
              email: s.email,
              seatCode: s.seatCode,
              shiftId: s.shiftId,
              shiftName: s.shiftName,
              shiftTiming: s.shiftTiming,
              membershipPlanName: s.membershipPlanName,
              membershipStatus: s.membershipStatus,
              status: s.status,
            })),
          }),
        }).catch(() => {});
      }

      const params = new URLSearchParams();
      if (dateFilter) params.set('date', dateFilter);
      if (shiftFilter !== 'ALL') params.set('shiftId', shiftFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);

      const res = await fetch(`/api/admin/attendance?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as AttendanceDashboardPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to load attendance register.');

      setDashboard(data);
      if (data.serverIst?.iso) {
        setServerOffsetMs(new Date(data.serverIst.iso).getTime() - Date.now());
      }
      if (!dateFilter && data.targetDate) {
        setDateFilter(data.targetDate);
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to fetch attendance dashboard.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, propStudents, dateFilter, shiftFilter, statusFilter, onNotify]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date(Date.now() + serverOffsetMs);
      setLiveClockStr(
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'medium',
          timeStyle: 'medium',
        }).format(now)
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, [serverOffsetMs]);

  const studentsList = useMemo(() => {
    const backendStudents = dashboard?.students || [];
    if (backendStudents.length > 0) return backendStudents;
    return propStudents;
  }, [dashboard?.students, propStudents]);

  const serverTodayDate = dashboard?.serverIst?.date || new Date().toISOString().slice(0, 10);
  const activeDate = dateFilter || serverTodayDate;

  const dateRecordMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    (dashboard?.allDateRecords || []).forEach((rec) => {
      map.set(rec.studentDocId, rec);
    });
    return map;
  }, [dashboard?.allDateRecords]);

  const filteredStudentsForDaily = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentsList.filter((s) => {
      if (shiftFilter !== 'ALL' && s.shiftId !== shiftFilter) return false;
      const rec = dateRecordMap.get(s.id);
      if (statusFilter === 'UNMARKED' && rec) return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'UNMARKED') {
        if (!rec || (rec.status || 'PRESENT') !== statusFilter) return false;
      }
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q) ||
        (s.mobile || '').toLowerCase().includes(q)
      );
    });
  }, [studentsList, shiftFilter, statusFilter, searchQuery, dateRecordMap]);

  const mirrorAttendanceToFirestore = (rec: AttendanceRecord) => {
    if (!hasFirebaseSession) return;
    setDoc(
      doc(db, 'attendance', rec.id),
      {
        ...rec,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
  };

  const handleMarkPresent = async (student: StudentRecord) => {
    if (activeDate !== serverTodayDate) {
      onNotify(
        'err',
        `One-click Present stamps live server IST time (${serverTodayDate}). For past dates use the Leave / Status modal.`
      );
      return;
    }
    setMarkingId(student.id);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Admin session expired.');
      const res = await fetch('/api/admin/attendance/mark-present', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentDocId: student.id,
          studentUid: student.uid,
          studentCode: student.studentCode,
          studentName: student.fullName,
          shiftId: student.shiftId,
          shiftName: student.shiftName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not record attendance.');

      mirrorAttendanceToFirestore(data.record);
      onNotify(
        'ok',
        `${student.fullName} marked PRESENT at ${data.record.recordedAtIst} IST.`
      );
      await fetchDashboard();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to mark student present.');
    } finally {
      setMarkingId(null);
    }
  };

  const handleQuickCodeSubmit = async (rawInput: string) => {
    let targetCode = rawInput.trim().toUpperCase();
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed?.studentCode) targetCode = String(parsed.studentCode).toUpperCase();
    } catch {
      // Plain student code
    }
    const student = studentsList.find((s) => s.studentCode.toUpperCase() === targetCode);
    if (!student) {
      onNotify('err', `No student found matching ID "${targetCode}".`);
      return;
    }
    setQuickIdQuery('');
    await handleMarkPresent(student);
  };

  useEffect(() => {
    if (!scannerOpen) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
      return;
    }
    const scanner = new Html5QrcodeScanner(
      'ga-qr-reader',
      { fps: 10, qrbox: { width: 220, height: 220 } },
      false
    );
    scanner.render(
      (decoded) => {
        handleQuickCodeSubmit(decoded);
        setScannerOpen(false);
      },
      () => {}
    );
    scannerRef.current = scanner;
    return () => {
      scanner.clear().catch(() => {});
    };
  }, [scannerOpen]);

  const openStatusModal = (student: StudentRecord, initialStatus: AttendanceStatusCode) => {
    setEditingRecord(null);
    setStatusModalStudent(student);
    setModalStatus(initialStatus);
    setCustomStatusLabel('');
    setLeaveType('Leave');
    setLeaveReason('');
    setRemarks('');
    setEntryDate(activeDate);
    setCorrectionReason('');
  };

  const openCorrectionModal = (student: StudentRecord, rec: AttendanceRecord) => {
    setEditingRecord(rec);
    setStatusModalStudent(student);
    setModalStatus(rec.status || 'PRESENT');
    setCustomStatusLabel(rec.customStatusLabel || '');
    setLeaveType(rec.leaveType || 'Leave');
    setLeaveReason(rec.leaveReason || '');
    setRemarks(rec.remarks || '');
    setEntryDate(rec.entryDate || rec.date);
    setCorrectionReason('');
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusModalStudent) return;
    setModalSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Session expired.');

      if (editingRecord) {
        const res = await fetch(`/api/admin/attendance/${encodeURIComponent(editingRecord.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: modalStatus,
            customStatusLabel: modalStatus === 'OTHER' ? customStatusLabel.trim() : undefined,
            leaveType: modalStatus === 'LEAVE' ? leaveType.trim() : undefined,
            leaveReason: modalStatus === 'LEAVE' ? leaveReason.trim() : undefined,
            remarks: remarks.trim(),
            correctionReason: correctionReason.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Correction failed.');
        mirrorAttendanceToFirestore(data.record);
        onNotify('ok', `Attendance corrected for ${statusModalStudent.fullName}.`);
      } else {
        const res = await fetch('/api/admin/attendance/mark-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentDocId: statusModalStudent.id,
            studentUid: statusModalStudent.uid,
            studentCode: statusModalStudent.studentCode,
            studentName: statusModalStudent.fullName,
            date: activeDate,
            status: modalStatus,
            customStatusLabel: modalStatus === 'OTHER' ? customStatusLabel.trim() : undefined,
            leaveType: modalStatus === 'LEAVE' ? leaveType.trim() : undefined,
            leaveReason: modalStatus === 'LEAVE' ? leaveReason.trim() : undefined,
            remarks: remarks.trim(),
            entryDate: entryDate || activeDate,
            shiftId: statusModalStudent.shiftId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to mark status.');
        mirrorAttendanceToFirestore(data.record);
        onNotify('ok', `Marked ${statusModalStudent.fullName} as ${modalStatus} for ${activeDate}.`);
      }
      setStatusModalStudent(null);
      await fetchDashboard();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save attendance status.');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleCreateCustomStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/attendance/statuses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: newCustomLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to create custom status.');
      setNewCustomLabel('');
      setShowCustomCreator(false);
      onNotify('ok', `Custom status "${data.status.label}" added.`);
      await fetchDashboard();
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed creating status.');
    }
  };

  // Monthly history aggregation
  const historyRecords = useMemo(() => {
    return (dashboard?.records || []).filter((r) => {
      if (historyMonth && !r.date.startsWith(historyMonth)) return false;
      if (historyStudentId !== 'ALL' && r.studentDocId !== historyStudentId) return false;
      return true;
    });
  }, [dashboard?.records, historyMonth, historyStudentId]);

  const monthlyStudentSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        studentCode: string;
        studentName: string;
        shiftName: string;
        present: number;
        leave: number;
        absent: number;
        halfDay: number;
        other: number;
      }
    >();
    historyRecords.forEach((r) => {
      const cur = map.get(r.studentDocId) || {
        studentCode: r.studentCode,
        studentName: r.studentName,
        shiftName: r.shiftName || 'Full Day',
        present: 0,
        leave: 0,
        absent: 0,
        halfDay: 0,
        other: 0,
      };
      const st = r.status || 'PRESENT';
      if (st === 'PRESENT') cur.present += 1;
      else if (st === 'LEAVE') cur.leave += 1;
      else if (st === 'ABSENT') cur.absent += 1;
      else if (st === 'HALF_DAY') cur.halfDay += 1;
      else cur.other += 1;
      map.set(r.studentDocId, cur);
    });
    return Array.from(map.values());
  }, [historyRecords]);

  const handleExportCsv = () => {
    const rows = filteredStudentsForDaily.map((s) => {
      const rec = dateRecordMap.get(s.id);
      return [
        s.studentCode,
        s.fullName,
        s.shiftName || 'Full Day',
        activeDate,
        rec ? rec.customStatusLabel || rec.status || 'PRESENT' : 'UNMARKED',
        rec?.recordedAtIst || rec?.checkInTime || '',
        rec?.leaveType || '',
        rec?.leaveReason || rec?.remarks || '',
        rec?.recordedByLabel || '',
      ];
    });
    downloadCsv(
      `gyan-adda-attendance-${activeDate}.csv`,
      ['Student ID', 'Name', 'Shift', 'Date', 'Status', 'Timestamp (IST)', 'Leave Type', 'Reason/Remarks', 'Marked By'],
      rows
    );
  };

  const handleExportPdf = async () => {
    try {
      const pdfDoc = await PDFDocument.create();
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

      let page = pdfDoc.addPage([595.28, 841.89]);
      let y = 795;

      const drawHeader = () => {
        page.drawText('GYAN ADDA LIBRARY — Daily Attendance Report', {
          x: 40,
          y,
          size: 14,
          font: fontBold,
          color: rgb(0, 0.125, 0.275),
        });
        y -= 18;
        page.drawText(`Register Date (IST): ${activeDate}   |   Generated: ${liveClockStr || serverTodayDate}`, {
          x: 40,
          y,
          size: 9,
          font: fontReg,
          color: rgb(0.3, 0.35, 0.42),
        });
        y -= 22;
        page.drawText('ID           Student Name                   Shift                 Status        Time (IST)', {
          x: 40,
          y,
          size: 9,
          font: fontBold,
          color: rgb(0.1, 0.15, 0.25),
        });
        y -= 12;
      };

      drawHeader();

      for (const s of filteredStudentsForDaily) {
        if (y < 55) {
          page = pdfDoc.addPage([595.28, 841.89]);
          y = 795;
          drawHeader();
        }
        const rec = dateRecordMap.get(s.id);
        const stText = rec ? rec.customStatusLabel || rec.status || 'PRESENT' : 'UNMARKED';
        const timeText = rec?.recordedAtIst || rec?.checkInTime || '-';
        const line = `${s.studentCode.padEnd(11).slice(0, 11)}  ${s.fullName
          .padEnd(28)
          .slice(0, 28)}  ${(s.shiftName || 'Full Day').padEnd(18).slice(0, 18)}  ${stText
          .padEnd(11)
          .slice(0, 11)}  ${timeText}`;
        page.drawText(line, {
          x: 40,
          y,
          size: 8.5,
          font: fontReg,
          color: rgb(0.12, 0.14, 0.18),
        });
        y -= 14;
      }

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gyan-adda-attendance-${activeDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onNotify('ok', `Attendance PDF downloaded for ${activeDate}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to generate attendance PDF.');
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white focus:border-secondary focus:outline-none';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      {/* Header & Server Clock */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
              Student Attendance Register
            </h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-secondary/10 border border-secondary/20 text-secondary dark:text-blue-400 text-xs font-mono font-semibold">
              <Clock className="w-3.5 h-3.5" />
              Server IST: {liveClockStr || dashboard?.serverIst?.displayIst || 'Syncing...'}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1">
            Tamper-proof Asia/Kolkata server timestamps · Maximum 1 attendance entry per student per day · Authorized edit audit trail.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomCreator(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Custom Status
          </button>
          <button
            type="button"
            onClick={() => setScannerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" /> {scannerOpen ? 'Close QR' : 'QR Scan Present'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" /> PDF Report
          </button>
          <button
            type="button"
            onClick={fetchDashboard}
            className="p-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-primary dark:text-white cursor-pointer"
            aria-label="Refresh attendance"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'Total Registered', val: dashboard?.kpis.totalRegistered ?? studentsList.length, cls: 'text-primary dark:text-white' },
          { label: 'Present Today', val: dashboard?.kpis.presentToday ?? 0, cls: 'text-success' },
          { label: 'On Leave', val: dashboard?.kpis.onLeaveToday ?? 0, cls: 'text-warning' },
          { label: 'Absent', val: dashboard?.kpis.absentToday ?? 0, cls: 'text-error' },
          { label: 'Unmarked', val: dashboard?.kpis.unmarkedToday ?? 0, cls: 'text-on-surface-variant dark:text-slate-300' },
        ].map((k) => (
          <div
            key={k.label}
            className="p-3.5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant dark:text-slate-400">
              {k.label}
            </p>
            <p className={`font-headline text-2xl font-bold tabular-nums mt-1 ${k.cls}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Shift-wise Summary Strip */}
      {(dashboard?.shiftSummary || []).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {(dashboard?.shiftSummary || []).map((sh) => (
            <button
              key={sh.shiftId}
              type="button"
              onClick={() => setShiftFilter((prev) => (prev === sh.shiftId ? 'ALL' : sh.shiftId))}
              className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                shiftFilter === sh.shiftId
                  ? 'border-secondary bg-secondary/5 dark:bg-secondary/15'
                  : 'border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-900'
              }`}
            >
              <p className="font-semibold text-xs text-primary dark:text-white truncate">{sh.shiftName}</p>
              <p className="text-[11px] font-mono text-on-surface-variant dark:text-slate-400">{sh.timing}</p>
              <div className="flex items-center gap-2.5 mt-2 text-[11px] font-mono tabular-nums">
                <span className="text-success font-semibold">P:{sh.present}</span>
                <span className="text-warning font-semibold">L:{sh.leave}</span>
                <span className="text-error font-semibold">A:{sh.absent}</span>
                <span className="ml-auto text-on-surface-variant dark:text-slate-400">/{sh.totalStudents}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {scannerOpen && (
        <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 max-w-md shadow-sm">
          <div id="ga-qr-reader" className="w-full" />
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-outline-variant dark:border-slate-800 pb-2">
        {[
          { id: 'daily' as SubTab, label: 'Daily Attendance Dashboard', icon: <UserCheck className="w-3.5 h-3.5" /> },
          { id: 'history' as SubTab, label: 'History & Monthly Summary', icon: <Calendar className="w-3.5 h-3.5" /> },
          { id: 'audit' as SubTab, label: `Audit Trail (${dashboard?.auditLogs?.length || 0})`, icon: <History className="w-3.5 h-3.5" /> },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              subTab === t.id
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low dark:hover:bg-slate-800'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: DAILY ATTENDANCE */}
      {subTab === 'daily' && (
        <div className="space-y-4">
          {/* Quick Student ID Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (quickIdQuery.trim()) handleQuickCodeSubmit(quickIdQuery);
            }}
            className="p-3.5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 flex flex-col sm:flex-row gap-2.5"
          >
            <div className="relative flex-1 min-w-0">
              <QrCode className="w-4 h-4 text-outline absolute left-3 top-2.5" />
              <input
                type="text"
                value={quickIdQuery}
                onChange={(e) => setQuickIdQuery(e.target.value)}
                placeholder="Quick Present by Student ID (e.g. VL2026001) or QR payload..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded bg-success text-on-success text-xs font-semibold hover:opacity-90 cursor-pointer shrink-0"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Instant Present (IST)
            </button>
          </form>

          {/* Filters */}
          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 bg-surface-container-low dark:bg-slate-800/80 border-b border-outline-variant dark:border-slate-700 flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-4 h-4 text-outline absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by Name, ID, or Mobile..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
                />
              </div>
              <input
                type="date"
                value={activeDate}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
              />
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
              >
                <option value="ALL">All Shifts</option>
                {(dashboard?.shifts || []).map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
              >
                <option value="ALL">All Statuses</option>
                <option value="PRESENT">Present</option>
                <option value="LEAVE">Leave</option>
                <option value="ABSENT">Absent</option>
                <option value="HALF_DAY">Half Day</option>
                <option value="HOLIDAY">Holiday</option>
                <option value="OTHER">Other</option>
                <option value="UNMARKED">Unmarked</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-container-low/60 dark:bg-slate-800/60 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Student</th>
                    <th className="px-4 py-3 font-semibold">Shift &amp; Seat</th>
                    <th className="px-4 py-3 font-semibold">Status &amp; IST Time</th>
                    <th className="px-4 py-3 font-semibold">Leave / Remarks</th>
                    <th className="px-4 py-3 text-right font-semibold">Mark / Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                  {filteredStudentsForDaily.map((s) => {
                    const rec = dateRecordMap.get(s.id);
                    const recStatus = rec?.status || (rec ? 'PRESENT' : null);
                    const badgeCls = recStatus
                      ? STATUS_BADGE_MAP[recStatus] || STATUS_BADGE_MAP.OTHER
                      : 'bg-surface-container-low text-on-surface-variant border-outline-variant';

                    return (
                      <tr key={s.id} className="hover:bg-surface-container-low/40 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-sm text-primary dark:text-white">
                              {s.fullName}
                            </span>
                            {rec && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/10 text-secondary dark:text-blue-400 font-mono text-[11px] font-semibold">
                                <Clock className="w-3 h-3" />
                                {rec.recordedAtIst || rec.checkInTime} IST
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-on-surface-variant dark:text-slate-400 mt-0.5">
                            {s.studentCode} {s.mobile ? `· ${s.mobile}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-medium text-on-surface dark:text-white">
                            {s.shiftName || 'Full Day'}
                          </span>
                          <span className="block text-[11px] font-mono text-on-surface-variant dark:text-slate-400">
                            Seat: {s.seatCode || 'Unassigned'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {rec ? (
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full border text-[11px] font-bold ${badgeCls}`}>
                              {rec.customStatusLabel || recStatus}
                            </span>
                          ) : (
                            <span className="inline-flex px-2.5 py-0.5 rounded-full border border-dashed border-outline-variant text-[11px] text-on-surface-variant">
                              Unmarked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-on-surface-variant dark:text-slate-300 max-w-xs">
                          {rec?.leaveType && <span className="font-semibold text-warning">{rec.leaveType}: </span>}
                          <span className="break-words">{rec?.leaveReason || rec?.remarks || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          {!rec ? (
                            <>
                              <button
                                type="button"
                                disabled={markingId === s.id}
                                onClick={() => handleMarkPresent(s)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-success text-on-success text-xs font-semibold hover:opacity-90 disabled:opacity-50 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {markingId === s.id ? 'Saving...' : 'Present'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openStatusModal(s, 'LEAVE')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-warning-container text-on-warning-container text-xs font-semibold hover:opacity-90 cursor-pointer"
                              >
                                Leave
                              </button>
                              <button
                                type="button"
                                onClick={() => openStatusModal(s, 'ABSENT')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-outline-variant dark:border-slate-700 text-xs font-semibold text-on-surface-variant hover:text-primary cursor-pointer"
                              >
                                Status
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openCorrectionModal(s, rec)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-outline-variant dark:border-slate-700 text-xs font-semibold text-secondary hover:bg-surface-container-low cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" /> Correct
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredStudentsForDaily.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-xs text-on-surface-variant dark:text-slate-400">
                        No students found for this date/shift filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: HISTORY & MONTHLY SUMMARY */}
      {subTab === 'history' && (
        <div className="space-y-5">
          <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Month</label>
              <input
                type="month"
                value={historyMonth}
                onChange={(e) => setHistoryMonth(e.target.value)}
                className="px-3 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Student</label>
              <select
                value={historyStudentId}
                onChange={(e) => setHistoryStudentId(e.target.value)}
                className="px-3 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800"
              >
                <option value="ALL">All Students</option>
                {studentsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.studentCode} — {s.fullName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-container-low dark:bg-slate-800/80 uppercase text-on-surface-variant border-b border-outline-variant dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Shift</th>
                  <th className="px-4 py-3 text-right">Present</th>
                  <th className="px-4 py-3 text-right">Leave</th>
                  <th className="px-4 py-3 text-right">Absent</th>
                  <th className="px-4 py-3 text-right">Half Day</th>
                  <th className="px-4 py-3 text-right">Other</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                {monthlyStudentSummary.map((row) => (
                  <tr key={row.studentCode}>
                    <td className="px-4 py-3 font-semibold">
                      {row.studentName} <span className="font-mono text-secondary ml-1">({row.studentCode})</span>
                    </td>
                    <td className="px-4 py-3">{row.shiftName}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-success">{row.present}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-warning">{row.leave}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-error">{row.absent}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.halfDay}</td>
                    <td className="px-4 py-3 text-right font-mono">{row.other}</td>
                  </tr>
                ))}
                {monthlyStudentSummary.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-on-surface-variant">
                      No monthly attendance logs recorded for {historyMonth}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: IMMUTABLE ATTENDANCE AUDIT TRAIL */}
      {subTab === 'audit' && (
        <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container-low dark:bg-slate-800/80 uppercase text-on-surface-variant border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">Edited At (IST)</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Transition</th>
                <th className="px-4 py-3">Audit Reason</th>
                <th className="px-4 py-3">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {(dashboard?.auditLogs || []).map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 font-mono whitespace-nowrap">{log.editedAtIst}</td>
                  <td className="px-4 py-3 font-semibold">
                    {log.studentName} <span className="font-mono text-secondary">({log.studentCode})</span>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {log.previousStatus} → <span className="font-bold text-primary dark:text-white">{log.newStatus}</span>
                  </td>
                  <td className="px-4 py-3 break-words max-w-xs">{log.reason}</td>
                  <td className="px-4 py-3">{log.editedBy}</td>
                </tr>
              ))}
              {(dashboard?.auditLogs || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-on-surface-variant">
                    No attendance audit entries recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Mark Status / Leave / Authorized Correction Modal */}
      {statusModalStudent && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-5 space-y-4 shadow-2xl my-auto">
            <div className="flex items-start justify-between border-b border-outline-variant dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                  {editingRecord ? 'Authorized Attendance Correction' : 'Mark Attendance Status'}
                </h3>
                <p className="text-xs text-on-surface-variant dark:text-slate-400">
                  {statusModalStudent.fullName} ({statusModalStudent.studentCode}) · {activeDate}
                </p>
              </div>
              <button type="button" onClick={() => setStatusModalStudent(null)} className="text-on-surface-variant hover:text-primary cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStatusSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Attendance Status</label>
                <select
                  value={modalStatus}
                  onChange={(e) => setModalStatus(e.target.value as AttendanceStatusCode)}
                  className={inputCls}
                >
                  <option value="PRESENT">Present (IST Timestamp)</option>
                  <option value="LEAVE">Leave</option>
                  <option value="ABSENT">Absent</option>
                  <option value="HALF_DAY">Half Day</option>
                  <option value="HOLIDAY">Holiday</option>
                  <option value="OTHER">Other / Custom Status</option>
                </select>
              </div>

              {modalStatus === 'OTHER' && (
                <div>
                  <label className="block text-xs font-semibold mb-1">Custom Status Label</label>
                  <input
                    type="text"
                    required
                    value={customStatusLabel}
                    onChange={(e) => setCustomStatusLabel(e.target.value)}
                    placeholder="e.g. Exam Duty / Workshop"
                    list="ga-custom-statuses"
                    className={inputCls}
                  />
                  <datalist id="ga-custom-statuses">
                    {(dashboard?.customStatuses || []).map((cs) => (
                      <option key={cs.id} value={cs.label} />
                    ))}
                  </datalist>
                </div>
              )}

              {modalStatus === 'LEAVE' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1">Leave Type</label>
                      <select
                        value={leaveType}
                        onChange={(e) => setLeaveType(e.target.value)}
                        className={inputCls}
                      >
                        <option value="Leave">Leave</option>
                        <option value="Medical Leave">Medical Leave</option>
                        <option value="Personal Leave">Personal Leave</option>
                        <option value="Emergency Leave">Emergency Leave</option>
                        <option value="Custom Leave">Custom Leave</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1">Entry Date</label>
                      <input
                        type="date"
                        value={entryDate}
                        onChange={(e) => setEntryDate(e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Leave Reason</label>
                    <input
                      type="text"
                      required
                      value={leaveReason}
                      onChange={(e) => setLeaveReason(e.target.value)}
                      placeholder="Brief reason submitted by student/parent"
                      className={inputCls}
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold mb-1">Admin Remarks</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional verification notes"
                  className={inputCls}
                />
              </div>

              {editingRecord && (
                <div className="p-3 rounded bg-warning-container/40 border border-warning/30 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-on-warning-container">
                    <ShieldAlert className="w-3.5 h-3.5" /> Audit Reason (Required for Modification)
                  </label>
                  <input
                    type="text"
                    required
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Why is this attendance entry being modified?"
                    className={inputCls}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={modalSubmitting}
                className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                {modalSubmitting ? 'Recording...' : editingRecord ? 'Save Audited Correction' : 'Save Attendance Entry'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Custom Status Creator */}
      {showCustomCreator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4">
          <div className="w-full max-w-sm bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant p-5 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-primary dark:text-white">
                Add Custom Attendance Status
              </h3>
              <button type="button" onClick={() => setShowCustomCreator(false)} className="cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomStatus} className="space-y-3">
              <input
                type="text"
                required
                value={newCustomLabel}
                onChange={(e) => setNewCustomLabel(e.target.value)}
                placeholder="e.g. Exam Center Leave"
                className={inputCls}
              />
              <button
                type="submit"
                className="w-full py-2 rounded bg-secondary text-on-secondary text-xs font-semibold cursor-pointer"
              >
                Create Custom Status
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
