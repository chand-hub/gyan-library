import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  StopCircle,
  Users,
  X,
} from 'lucide-react';
import {
  db,
  isTransientFirestoreError,
  logAuditEvent,
  markFirestoreConnected,
  OperationType,
  reportFirestoreError,
} from '../../lib/firebase';
import { generateAiRequestId } from '../../lib/aiClient';
import {
  FeePaymentRecord,
  FeeReminderRecord,
  FeeSystemSettings,
  MembershipPlan,
  StudentFeeRecord,
  StudentRecord,
  WhatsAppMessageLog,
} from '../../types/library';

interface FeeReminderPanelProps {
  students: StudentRecord[];
  plans: MembershipPlan[];
  actorUid: string;
  actorEmail: string;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface WhatsAppConfigStatus {
  configured: boolean;
  phoneNumberIdConfigured: boolean;
  businessAccountConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  appSecretConfigured: boolean;
  apiVersion: string;
  webhookPath: string;
}

type SubTab = 'ledger' | 'payments' | 'logs' | 'settings';

const DEFAULT_SETTINGS: FeeSystemSettings = {
  id: 'fee_automation',
  autoReminderEnabled: true,
  globalPaused: false,
  reminderIntervalHours: 24,
  timezone: 'Asia/Kolkata',
  sendWindowStartHour: 0,
  sendWindowEndHour: 24,
  triggerOnDueOrOverdueOnly: true,
  templateName: 'vidhya_fee_reminder',
  languageCode: 'en',
  messageTemplatePreview:
    'Hello, this is a fee reminder from VIDHYA LIBRARY for {{student_name}} ({{class_name}}). Monthly Fee: Rs.{{monthly_fee}}, Paid: Rs.{{total_paid}}, Pending Balance: Rs.{{due_amount}}, Due Date: {{due_date}}. Please clear your balance at the desk or online. Reply STOP to opt out.',
  updatedAt: null,
};

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || `fee_${Date.now()}`;
}

function stripUndefined<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function formatPaymentStatusBadge(status: StudentFeeRecord['paymentStatus']) {
  switch (status) {
    case 'paid':
      return {
        label: 'Paid',
        cls: 'bg-success-container text-on-success-container',
      };
    case 'partially_paid':
      return {
        label: 'Partially Paid',
        cls: 'bg-warning-container text-on-warning-container',
      };
    case 'overdue':
      return {
        label: 'Overdue',
        cls: 'bg-error-container text-on-error-container',
      };
    default:
      return {
        label: 'Unpaid',
        cls: 'bg-surface-container-high text-primary',
      };
  }
}

function formatReminderStatusBadge(status: StudentFeeRecord['reminderStatus']) {
  switch (status) {
    case 'active':
      return {
        label: 'Active (24h)',
        cls: 'bg-secondary-container text-on-secondary-container',
      };
    case 'paused':
      return {
        label: 'Paused',
        cls: 'bg-warning-container text-on-warning-container',
      };
    case 'stopped':
      return {
        label: 'Stopped (Settled)',
        cls: 'bg-success-container text-on-success-container',
      };
    case 'opted_out':
      return {
        label: 'Opted Out',
        cls: 'bg-surface-variant text-on-surface-variant',
      };
    case 'invalid_number':
      return {
        label: 'Invalid Number',
        cls: 'bg-error-container text-on-error-container',
      };
    default:
      return {
        label: status,
        cls: 'bg-surface-variant text-on-surface-variant',
      };
  }
}

function formatDeliveryBadge(status: FeeReminderRecord['status'] | WhatsAppMessageLog['status']) {
  switch (status) {
    case 'read':
      return 'bg-success-container text-on-success-container';
    case 'delivered':
      return 'bg-secondary-container text-on-secondary-container';
    case 'sent':
      return 'bg-tertiary-container text-on-tertiary-container';
    case 'queued':
      return 'bg-warning-container text-on-warning-container';
    case 'failed':
      return 'bg-error-container text-on-error-container';
    default:
      return 'bg-surface-variant text-on-surface-variant';
  }
}

export const FeeReminderPanel: React.FC<FeeReminderPanelProps> = ({
  students,
  plans,
  actorUid,
  actorEmail,
  getIdToken,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('ledger');
  const [studentFees, setStudentFees] = useState<StudentFeeRecord[]>([]);
  const [payments, setPayments] = useState<FeePaymentRecord[]>([]);
  const [reminders, setReminders] = useState<FeeReminderRecord[]>([]);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppMessageLog[]>([]);
  const [settings, setSettings] = useState<FeeSystemSettings>(DEFAULT_SETTINGS);
  const [waConfig, setWaConfig] = useState<WhatsAppConfigStatus | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | StudentFeeRecord['paymentStatus']>('ALL');
  const [reminderFilter, setReminderFilter] = useState<'ALL' | StudentFeeRecord['reminderStatus']>('ALL');

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [editingFee, setEditingFee] = useState<StudentFeeRecord | null>(null);

  const [paymentModalStudent, setPaymentModalStudent] = useState<StudentFeeRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState<FeePaymentRecord['paymentMethod']>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const [sendModalStudent, setSendModalStudent] = useState<StudentFeeRecord | null>(null);
  const [historyModalStudent, setHistoryModalStudent] = useState<StudentFeeRecord | null>(null);

  // Enroll / Edit Form State
  const [selectedStudentDocId, setSelectedStudentDocId] = useState('');
  const [formStudentUid, setFormStudentUid] = useState('');
  const [formStudentCode, setFormStudentCode] = useState('');
  const [formStudentName, setFormStudentName] = useState('');
  const [formClassName, setFormClassName] = useState('Full-Day AC');
  const [formParentName, setFormParentName] = useState('');
  const [formParentWhatsapp, setFormParentWhatsapp] = useState('');
  const [formStudentWhatsapp, setFormStudentWhatsapp] = useState('');
  const [formMonthlyFee, setFormMonthlyFee] = useState('1500');
  const [formPreviousBalance, setFormPreviousBalance] = useState('0');
  const [formCurrentMonthFee, setFormCurrentMonthFee] = useState('1500');
  const [formDueDate, setFormDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [formAutoReminder, setFormAutoReminder] = useState(true);
  const [formWhatsappConsent, setFormWhatsappConsent] = useState(true);

  // Settings draft
  const [settingsDraft, setSettingsDraft] = useState<FeeSystemSettings>(DEFAULT_SETTINGS);

  // Track existing Firestore doc IDs so createdAt is never overwritten on updates
  const existingFeeIdsRef = useRef<Set<string>>(new Set());
  const existingPaymentIdsRef = useRef<Set<string>>(new Set());
  const existingReminderIdsRef = useRef<Set<string>>(new Set());
  const existingLogIdsRef = useRef<Set<string>>(new Set());
  const hasSyncedInitialRef = useRef(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getIdToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getIdToken]);

  const persistFeeDocToFirestore = useCallback(async (fee: StudentFeeRecord) => {
    const safeId = sanitizeId(fee.id);
    const exists = existingFeeIdsRef.current.has(safeId);
    const payload = stripUndefined({
      studentDocId: fee.studentDocId || safeId,
      studentUid: fee.studentUid || fee.studentDocId || safeId,
      studentCode: fee.studentCode || 'VL0000',
      studentName: fee.studentName || 'Student',
      className: fee.className || 'Library Study Hall',
      parentName: (fee.parentName || '').trim() || 'Guardian',
      parentWhatsapp: fee.parentWhatsapp || '',
      studentWhatsapp: fee.studentWhatsapp || null,
      monthlyFee: Number(fee.monthlyFee || 0),
      previousBalance: Number(fee.previousBalance || 0),
      currentMonthFee: Number(fee.currentMonthFee || 0),
      totalPayable: Number(fee.totalPayable || 0),
      totalPaid: Number(fee.totalPaid || 0),
      remainingBalance: Number(fee.remainingBalance || 0),
      dueDate: String(fee.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
      paymentStatus: fee.paymentStatus,
      reminderStatus: fee.reminderStatus,
      autoReminderEnabled: Boolean(fee.autoReminderEnabled),
      whatsappConsent: Boolean(fee.whatsappConsent),
      optedOut: Boolean(fee.optedOut),
      lastReminderAt: fee.lastReminderAt ?? null,
      nextReminderAt: fee.nextReminderAt ?? null,
      lastReminderError: fee.lastReminderError ?? null,
      reminderCount: Math.max(0, Math.floor(Number(fee.reminderCount || 0))),
      isDemo: Boolean(fee.isDemo),
      updatedAt: serverTimestamp(),
      ...(exists ? {} : { createdAt: serverTimestamp() }),
    });
    await setDoc(doc(db, 'student_fees', safeId), payload, { merge: true });
    existingFeeIdsRef.current.add(safeId);
  }, []);

  const persistStateChangesToFirestore = useCallback(
    async (opts: {
      studentFees?: StudentFeeRecord[];
      payment?: FeePaymentRecord;
      reminder?: FeeReminderRecord;
      reminders?: FeeReminderRecord[];
      log?: WhatsAppMessageLog;
      settings?: FeeSystemSettings;
    }) => {
      try {
        const batch = writeBatch(db);
        let ops = 0;

        if (opts.studentFees) {
          for (const f of opts.studentFees) {
            const safeId = sanitizeId(f.id);
            const exists = existingFeeIdsRef.current.has(safeId);
            batch.set(
              doc(db, 'student_fees', safeId),
              stripUndefined({
                studentDocId: f.studentDocId || safeId,
                studentUid: f.studentUid || f.studentDocId || safeId,
                studentCode: f.studentCode || 'VL0000',
                studentName: f.studentName || 'Student',
                className: f.className || 'Library Study Hall',
                parentName: (f.parentName || '').trim() || 'Guardian',
                parentWhatsapp: f.parentWhatsapp || '',
                studentWhatsapp: f.studentWhatsapp || null,
                monthlyFee: Number(f.monthlyFee || 0),
                previousBalance: Number(f.previousBalance || 0),
                currentMonthFee: Number(f.currentMonthFee || 0),
                totalPayable: Number(f.totalPayable || 0),
                totalPaid: Number(f.totalPaid || 0),
                remainingBalance: Number(f.remainingBalance || 0),
                dueDate: String(f.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
                paymentStatus: f.paymentStatus,
                reminderStatus: f.reminderStatus,
                autoReminderEnabled: Boolean(f.autoReminderEnabled),
                whatsappConsent: Boolean(f.whatsappConsent),
                optedOut: Boolean(f.optedOut),
                lastReminderAt: f.lastReminderAt ?? null,
                nextReminderAt: f.nextReminderAt ?? null,
                lastReminderError: f.lastReminderError ?? null,
                reminderCount: Math.max(0, Math.floor(Number(f.reminderCount || 0))),
                isDemo: Boolean(f.isDemo),
                updatedAt: serverTimestamp(),
                ...(exists ? {} : { createdAt: serverTimestamp() }),
              }),
              { merge: true }
            );
            existingFeeIdsRef.current.add(safeId);
            ops += 1;
          }
        }

        if (opts.payment) {
          const safePid = sanitizeId(opts.payment.id);
          if (!existingPaymentIdsRef.current.has(safePid)) {
            batch.set(
              doc(db, 'fee_payments', safePid),
              stripUndefined({
                studentFeeId: sanitizeId(opts.payment.studentFeeId),
                studentDocId: opts.payment.studentDocId || sanitizeId(opts.payment.studentFeeId),
                studentUid: opts.payment.studentUid || opts.payment.studentDocId || sanitizeId(opts.payment.studentFeeId),
                studentCode: opts.payment.studentCode || 'VL0000',
                studentName: opts.payment.studentName || 'Student',
                amountReceived: Number(opts.payment.amountReceived),
                paymentDate: String(opts.payment.paymentDate).slice(0, 10),
                paymentMethod: opts.payment.paymentMethod,
                transactionRef: opts.payment.transactionRef || null,
                notes: opts.payment.notes || null,
                recordedByUid: opts.payment.recordedByUid || actorUid,
                recordedByEmail: opts.payment.recordedByEmail || actorEmail || null,
                balanceAfterPayment: Number(opts.payment.balanceAfterPayment || 0),
                createdAt: serverTimestamp(),
              })
            );
            existingPaymentIdsRef.current.add(safePid);
            ops += 1;
          }
        }

        const remindersToPersist = [
          ...(opts.reminder ? [opts.reminder] : []),
          ...(opts.reminders || []),
        ];
        const seenRemIds = new Set<string>();
        for (const r of remindersToPersist) {
          const safeRid = sanitizeId(r.id);
          if (seenRemIds.has(safeRid)) continue;
          seenRemIds.add(safeRid);
          const exists = existingReminderIdsRef.current.has(safeRid);
          batch.set(
            doc(db, 'fee_reminders', safeRid),
            stripUndefined({
              studentFeeId: sanitizeId(r.studentFeeId),
              studentDocId: r.studentDocId || sanitizeId(r.studentFeeId),
              studentUid: r.studentUid || r.studentDocId || sanitizeId(r.studentFeeId),
              studentCode: r.studentCode || 'VL0000',
              studentName: r.studentName || 'Student',
              recipientWhatsapp: r.recipientWhatsapp || '',
              dueAmountAtSend: Number(r.dueAmountAtSend || 0),
              dueDate: String(r.dueDate || new Date().toISOString().slice(0, 10)).slice(0, 10),
              templateName: r.templateName || 'vidhya_fee_reminder',
              languageCode: r.languageCode || 'en',
              messagePreview: String(r.messagePreview || 'Fee reminder').slice(0, 2000),
              triggerType: r.triggerType || 'manual',
              idempotencyKey: r.idempotencyKey || safeRid,
              status: r.status,
              wamid: r.wamid ?? null,
              errorMessage: r.errorMessage ?? null,
              retryCount: Math.max(0, Math.floor(Number(r.retryCount || 0))),
              scheduledFor: String(r.scheduledFor || new Date().toISOString()),
              sentAt: r.sentAt ?? null,
              deliveredAt: r.deliveredAt ?? null,
              readAt: r.readAt ?? null,
              updatedAt: serverTimestamp(),
              ...(exists ? {} : { createdAt: serverTimestamp() }),
            }),
            { merge: true }
          );
          existingReminderIdsRef.current.add(safeRid);
          ops += 1;
        }

        if (opts.log) {
          const safeLid = sanitizeId(opts.log.id);
          const exists = existingLogIdsRef.current.has(safeLid);
          batch.set(
            doc(db, 'whatsapp_message_logs', safeLid),
            stripUndefined({
              reminderId: sanitizeId(opts.log.reminderId),
              studentFeeId: sanitizeId(opts.log.studentFeeId),
              studentCode: opts.log.studentCode || 'VL0000',
              studentName: opts.log.studentName || 'Student',
              recipientWhatsapp: opts.log.recipientWhatsapp || '',
              wamid: opts.log.wamid ?? null,
              status: opts.log.status,
              templateName: opts.log.templateName || 'vidhya_fee_reminder',
              messagePreview: String(opts.log.messagePreview || 'Fee reminder').slice(0, 2000),
              dueAmountAtSend: Number(opts.log.dueAmountAtSend || 0),
              errorMessage: opts.log.errorMessage ?? null,
              httpStatus: opts.log.httpStatus !== undefined && opts.log.httpStatus !== null ? Math.floor(Number(opts.log.httpStatus)) : null,
              webhookPayloadSummary: opts.log.webhookPayloadSummary ?? null,
              updatedAt: serverTimestamp(),
              ...(exists ? {} : { createdAt: serverTimestamp() }),
            }),
            { merge: true }
          );
          existingLogIdsRef.current.add(safeLid);
          ops += 1;
        }

        if (opts.settings) {
          batch.set(
            doc(db, 'system_settings', 'fee_automation'),
            {
              autoReminderEnabled: Boolean(opts.settings.autoReminderEnabled),
              globalPaused: Boolean(opts.settings.globalPaused),
              reminderIntervalHours: Math.max(1, Math.floor(Number(opts.settings.reminderIntervalHours || 24))),
              timezone: opts.settings.timezone || 'Asia/Kolkata',
              sendWindowStartHour: Math.max(0, Math.min(23, Math.floor(Number(opts.settings.sendWindowStartHour ?? 0)))),
              sendWindowEndHour: Math.max(0, Math.min(24, Math.floor(Number(opts.settings.sendWindowEndHour ?? 24)))),
              triggerOnDueOrOverdueOnly: Boolean(opts.settings.triggerOnDueOrOverdueOnly),
              templateName: opts.settings.templateName || 'vidhya_fee_reminder',
              languageCode: opts.settings.languageCode || 'en',
              messageTemplatePreview: opts.settings.messageTemplatePreview || DEFAULT_SETTINGS.messageTemplatePreview,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          ops += 1;
        }

        if (ops > 0) {
          await batch.commit();
        }
      } catch (err) {
        console.warn('Firestore fee sync warning:', reportFirestoreError(err, OperationType.WRITE, 'student_fees'));
      }
    },
    [actorEmail, actorUid]
  );

  // Real-time Firestore listeners
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const handleErr = (err: unknown, path: string) => {
      const msg = reportFirestoreError(err, OperationType.LIST, path);
      if (!isTransientFirestoreError(err)) {
        onNotify('err', msg);
      }
    };

    unsubs.push(
      onSnapshot(
        collection(db, 'student_fees'),
        (snap) => {
          markFirestoreConnected();
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudentFeeRecord, 'id'>) }));
          existingFeeIdsRef.current = new Set(list.map((f) => f.id));
          setStudentFees(list);
        },
        (err) => handleErr(err, 'student_fees')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'fee_payments'),
        (snap) => {
          markFirestoreConnected();
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeePaymentRecord, 'id'>) }));
          existingPaymentIdsRef.current = new Set(list.map((p) => p.id));
          list.sort((a, b) => (b.paymentDate || '').localeCompare(a.paymentDate || ''));
          setPayments(list);
        },
        (err) => handleErr(err, 'fee_payments')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'fee_reminders'),
        (snap) => {
          markFirestoreConnected();
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FeeReminderRecord, 'id'>) }));
          existingReminderIdsRef.current = new Set(list.map((r) => r.id));
          list.sort((a, b) => (b.scheduledFor || '').localeCompare(a.scheduledFor || ''));
          setReminders(list);
        },
        (err) => handleErr(err, 'fee_reminders')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'whatsapp_message_logs'),
        (snap) => {
          markFirestoreConnected();
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WhatsAppMessageLog, 'id'>) }));
          existingLogIdsRef.current = new Set(list.map((l) => l.id));
          setWhatsappLogs(list);
        },
        (err) => handleErr(err, 'whatsapp_message_logs')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'system_settings', 'fee_automation'),
        (snap) => {
          markFirestoreConnected();
          if (snap.exists()) {
            const data = { id: snap.id, ...(snap.data() as Omit<FeeSystemSettings, 'id'>) };
            setSettings(data);
            setSettingsDraft(data);
          }
        },
        (err) => handleErr(err, 'system_settings/fee_automation')
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [onNotify]);

  // Fetch Meta WhatsApp config + initial server state
  const refreshServerState = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [cfgRes, stateRes] = await Promise.all([
        fetch('/api/fees/whatsapp-config', { headers }),
        fetch('/api/fees/state', { headers }),
      ]);
      if (cfgRes.ok) {
        setWaConfig(await cfgRes.json());
      }
      if (stateRes.ok) {
        const data = await stateRes.json();
        if (data.whatsappConfig) setWaConfig(data.whatsappConfig);
      }
    } catch {
      // non-fatal during startup
    }
  }, [authHeaders]);

  useEffect(() => {
    refreshServerState();
  }, [refreshServerState]);

  // Sync Firestore fee records -> Express backend scheduler on load/change
  useEffect(() => {
    if (studentFees.length === 0 && hasSyncedInitialRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch('/api/fees/sync', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            studentFees,
            settings,
          }),
        });
        if (!res.ok || cancelled) return;
        hasSyncedInitialRef.current = true;
      } catch {
        // ignore transient sync error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, settings, studentFees]);

  // Computed KPI metrics
  const metrics = useMemo(() => {
    const totalStudents = studentFees.length;
    const totalExpected = studentFees.reduce((acc, f) => acc + Number(f.totalPayable || 0), 0);
    const totalCollected = studentFees.reduce((acc, f) => acc + Number(f.totalPaid || 0), 0);
    const totalOutstanding = studentFees.reduce((acc, f) => acc + Number(f.remainingBalance || 0), 0);
    const paidCount = studentFees.filter((f) => f.paymentStatus === 'paid').length;
    const partialCount = studentFees.filter((f) => f.paymentStatus === 'partially_paid').length;
    const unpaidCount = studentFees.filter((f) => f.paymentStatus === 'unpaid').length;
    const overdueCount = studentFees.filter((f) => f.paymentStatus === 'overdue').length;
    const waSentCount = whatsappLogs.filter((l) => l.status === 'sent' || l.status === 'delivered' || l.status === 'read').length;
    const waFailedCount = whatsappLogs.filter((l) => l.status === 'failed').length;

    return {
      totalStudents,
      totalExpected,
      totalCollected,
      totalOutstanding,
      paidCount,
      partialCount,
      unpaidCount,
      overdueCount,
      waSentCount,
      waFailedCount,
    };
  }, [studentFees, whatsappLogs]);

  const filteredFees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentFees.filter((f) => {
      if (paymentFilter !== 'ALL' && f.paymentStatus !== paymentFilter) return false;
      if (reminderFilter !== 'ALL' && f.reminderStatus !== reminderFilter) return false;
      if (!q) return true;
      return (
        f.studentName.toLowerCase().includes(q) ||
        f.studentCode.toLowerCase().includes(q) ||
        f.className.toLowerCase().includes(q) ||
        f.parentName.toLowerCase().includes(q) ||
        f.parentWhatsapp.toLowerCase().includes(q)
      );
    });
  }, [paymentFilter, reminderFilter, searchQuery, studentFees]);

  const openEnrollModal = (fee?: StudentFeeRecord) => {
    if (fee) {
      setEditingFee(fee);
      setSelectedStudentDocId(fee.studentDocId);
      setFormStudentUid(fee.studentUid);
      setFormStudentCode(fee.studentCode);
      setFormStudentName(fee.studentName);
      setFormClassName(fee.className);
      setFormParentName(fee.parentName);
      setFormParentWhatsapp(fee.parentWhatsapp);
      setFormStudentWhatsapp(fee.studentWhatsapp || '');
      setFormMonthlyFee(String(fee.monthlyFee));
      setFormPreviousBalance(String(fee.previousBalance));
      setFormCurrentMonthFee(String(fee.currentMonthFee));
      setFormDueDate(fee.dueDate);
      setFormAutoReminder(fee.autoReminderEnabled);
      setFormWhatsappConsent(fee.whatsappConsent);
    } else {
      setEditingFee(null);
      const firstStudent = students[0];
      const defaultPlan = plans.find((p) => p.active);
      setSelectedStudentDocId(firstStudent?.id || '');
      setFormStudentUid(firstStudent?.uid || '');
      setFormStudentCode(firstStudent?.studentCode || '');
      setFormStudentName(firstStudent?.fullName || '');
      setFormClassName(firstStudent?.membershipPlanName || defaultPlan?.name || 'Full-Day AC');
      setFormParentName(firstStudent?.fatherName || 'Guardian');
      setFormParentWhatsapp(firstStudent?.mobile || '');
      setFormStudentWhatsapp('');
      const feeAmt = String(defaultPlan?.price ?? 1500);
      setFormMonthlyFee(feeAmt);
      setFormPreviousBalance('0');
      setFormCurrentMonthFee(feeAmt);
      setFormDueDate(new Date().toISOString().slice(0, 10));
      setFormAutoReminder(true);
      setFormWhatsappConsent(true);
    }
    setEnrollOpen(true);
  };

  const handleSelectStudentFromDirectory = (docId: string) => {
    setSelectedStudentDocId(docId);
    const st = students.find((s) => s.id === docId);
    if (!st) return;
    setFormStudentUid(st.uid || st.id);
    setFormStudentCode(st.studentCode);
    setFormStudentName(st.fullName);
    setFormParentName(st.fatherName || 'Guardian');
    setFormParentWhatsapp(st.mobile || '');
    const matchedPlan = plans.find((p) => p.name === st.membershipPlanName);
    if (matchedPlan) {
      setFormClassName(matchedPlan.name);
      setFormMonthlyFee(String(matchedPlan.price));
      setFormCurrentMonthFee(String(matchedPlan.price));
    } else if (st.membershipPlanName) {
      setFormClassName(st.membershipPlanName);
    }
  };

  const handleSaveStudentFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyAction('upsert');
    try {
      const headers = await authHeaders();
      const id = sanitizeId(editingFee?.id || selectedStudentDocId || `fee_${Date.now()}`);
      const res = await fetch('/api/fees/upsert-student', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id,
          studentDocId: selectedStudentDocId || id,
          studentUid: formStudentUid.trim() || selectedStudentDocId || id,
          studentCode: formStudentCode.trim() || 'VL2026000',
          studentName: formStudentName.trim(),
          className: formClassName.trim() || 'Library Study Hall',
          parentName: formParentName.trim() || 'Guardian',
          parentWhatsapp: formParentWhatsapp.trim(),
          studentWhatsapp: formStudentWhatsapp.trim() || undefined,
          monthlyFee: Number(formMonthlyFee || 0),
          previousBalance: Number(formPreviousBalance || 0),
          currentMonthFee: Number(formCurrentMonthFee || 0),
          dueDate: formDueDate,
          autoReminderEnabled: formAutoReminder,
          whatsappConsent: formWhatsappConsent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save student fee profile.');

      await persistFeeDocToFirestore(data.studentFee);
      await logAuditEvent(
        editingFee ? 'UPDATE_STUDENT_FEE' : 'ENROLL_STUDENT_FEE',
        'student_fees',
        id,
        `Fee configured for ${data.studentFee.studentName} (${data.studentFee.studentCode}), Remaining Rs.${data.studentFee.remainingBalance}`,
        'admin'
      );
      setEnrollOpen(false);
      onNotify('ok', `Fee ledger saved for ${data.studentFee.studentName}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save student fee record.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentModalStudent) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      onNotify('err', 'Enter a valid payment amount greater than zero.');
      return;
    }

    setBusyAction('payment');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/fees/record-payment', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          studentFeeId: paymentModalStudent.id,
          amountReceived: amt,
          paymentDate: payDate,
          paymentMethod: payMethod,
          transactionRef: payRef.trim() || undefined,
          notes: payNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment.');

      await persistStateChangesToFirestore({
        studentFees: [data.studentFee],
        payment: data.payment,
        reminders: data.state?.reminders?.filter(
          (r: FeeReminderRecord) => r.studentFeeId === paymentModalStudent.id && r.status === 'cancelled'
        ),
      });

      await logAuditEvent(
        'RECORD_MANUAL_FEE_PAYMENT',
        'fee_payments',
        data.payment.id,
        `Recorded Rs.${data.payment.amountReceived} (${payMethod}) for ${data.studentFee.studentName}. Remaining: Rs.${data.studentFee.remainingBalance}${
          data.autoStopped ? ' · AUTO REMINDERS STOPPED' : ''
        }`,
        'admin'
      );

      setPaymentModalStudent(null);
      setPayAmount('');
      setPayRef('');
      setPayNotes('');

      if (data.autoStopped) {
        onNotify(
          'ok',
          `Full payment recorded for ${data.studentFee.studentName}. Balance is now ₹0 and all automatic WhatsApp reminders have been stopped immediately.`
        );
      } else {
        onNotify(
          'ok',
          `Partial payment of ₹${data.payment.amountReceived.toLocaleString('en-IN')} recorded. Remaining balance: ₹${data.studentFee.remainingBalance.toLocaleString('en-IN')}.`
        );
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to record payment.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleStudentControl = async (
    fee: StudentFeeRecord,
    action: 'pause' | 'resume' | 'stop' | 'opt_out' | 'opt_in'
  ) => {
    setBusyAction(`ctrl_${fee.id}`);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/fees/student-control', {
        method: 'POST',
        headers,
        body: JSON.stringify({ studentFeeId: fee.id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Control action failed.');

      await persistFeeDocToFirestore(data.studentFee);
      await logAuditEvent(
        `FEE_REMINDER_${action.toUpperCase()}`,
        'student_fees',
        fee.id,
        `Changed reminder state for ${fee.studentName} via ${action}`,
        'admin'
      );
      onNotify('ok', `Updated reminder control (${action.replace('_', ' ')}) for ${fee.studentName}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to update reminder control.');
    } finally {
      setBusyAction(null);
    }
  };

  const buildRenderedPreview = (fee: StudentFeeRecord) => {
    return (settings.messageTemplatePreview || DEFAULT_SETTINGS.messageTemplatePreview)
      .replace(/\{\{student_name\}\}/g, fee.studentName)
      .replace(/\{\{class_name\}\}/g, fee.className)
      .replace(/\{\{monthly_fee\}\}/g, String(fee.monthlyFee))
      .replace(/\{\{total_paid\}\}/g, String(fee.totalPaid))
      .replace(/\{\{due_amount\}\}/g, String(fee.remainingBalance))
      .replace(/\{\{due_date\}\}/g, fee.dueDate);
  };

  const handleSendManualReminder = async () => {
    if (!sendModalStudent) return;
    setBusyAction('send_manual');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/fees/send-reminder', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          studentFeeId: sendModalStudent.id,
          idempotencyKey: generateAiRequestId('wa'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch WhatsApp reminder.');

      await persistStateChangesToFirestore({
        studentFees: data.studentFee ? [data.studentFee] : undefined,
        reminder: data.reminder,
        log: data.log,
      });

      setSendModalStudent(null);
      if (data.outcome === 'sent') {
        onNotify(
          'ok',
          `WhatsApp reminder accepted by Meta Cloud API for ${data.studentFee?.studentName || sendModalStudent.studentName} (status: sent, wamid: ${data.reminder?.wamid || 'pending'}).`
        );
      } else if (data.outcome === 'skipped' || data.outcome === 'deduped') {
        onNotify('ok', `Reminder skipped: ${data.reason || 'Already processed or ineligible.'}`);
      } else {
        onNotify('err', data.reason || 'WhatsApp API delivery returned an error.');
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to send WhatsApp reminder.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleBulkOrScheduler = async (endpoint: '/api/fees/send-bulk' | '/api/fees/run-scheduler', label: string) => {
    setBusyAction(endpoint);
    try {
      const headers = await authHeaders();
      const res = await fetch(endpoint, { method: 'POST', headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${label} failed.`);

      if (data.state) {
        await persistStateChangesToFirestore({
          studentFees: data.state.studentFees,
          reminders: data.state.reminders?.slice(0, 20),
        });
        // Persist latest logs from details if returned
        if (Array.isArray(data.details)) {
          for (const d of data.details) {
            if (d.log) {
              await persistStateChangesToFirestore({ log: d.log, reminder: d.reminder });
            }
          }
        }
      }
      onNotify(
        'ok',
        `${label}: evaluated ${data.evaluated}, sent ${data.sent}, skipped ${data.skipped}, failed ${data.failed}.`
      );
    } catch (err: any) {
      onNotify('err', err?.message || `${label} failed.`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveSettings = async (nextSettings: FeeSystemSettings) => {
    setBusyAction('settings');
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/fees/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(nextSettings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update settings.');

      setSettings(data.settings);
      setSettingsDraft(data.settings);
      await persistStateChangesToFirestore({ settings: data.settings });
      await logAuditEvent(
        'UPDATE_FEE_AUTOMATION_SETTINGS',
        'system_settings',
        'fee_automation',
        `Updated 24h WhatsApp settings (globalPaused=${data.settings.globalPaused}, autoReminderEnabled=${data.settings.autoReminderEnabled})`,
        'admin'
      );
      onNotify('ok', 'Automated fee & WhatsApp scheduler settings saved.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to update fee automation settings.');
    } finally {
      setBusyAction(null);
    }
  };

  const studentHistoryPayments = useMemo(
    () =>
      historyModalStudent
        ? payments.filter((p) => p.studentFeeId === historyModalStudent.id)
        : [],
    [historyModalStudent, payments]
  );

  const studentHistoryReminders = useMemo(
    () =>
      historyModalStudent
        ? reminders.filter((r) => r.studentFeeId === historyModalStudent.id)
        : [],
    [historyModalStudent, reminders]
  );

  return (
    <div className="space-y-6">
      {/* Header & Global Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">
            Automated Fee Management & WhatsApp Reminders
          </h1>
          <p className="font-body text-sm text-on-surface-variant mt-0.5">
            Track monthly fees, record manual payments, and dispatch 24-hour Meta WhatsApp Cloud API reminders until balance reaches ₹0.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openEnrollModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-secondary text-on-secondary hover:bg-primary font-label text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Enroll / Edit Student Fee
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => handleBulkOrScheduler('/api/fees/send-bulk', 'Bulk Reminder Dispatch')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-primary text-on-primary hover:bg-primary-container font-label text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            {busyAction === '/api/fees/send-bulk' ? 'Sending...' : 'Send Reminder to All Eligible'}
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => handleBulkOrScheduler('/api/fees/run-scheduler', '24h Scheduler Cycle')}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded bg-surface-container-lowest text-primary border border-outline-variant hover:bg-surface-container-low font-label text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === '/api/fees/run-scheduler' ? 'animate-spin' : ''}`} />
            Run 24h Scheduler
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() =>
              handleSaveSettings({
                ...settings,
                globalPaused: !settings.globalPaused,
              })
            }
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded font-label text-xs font-semibold border transition-colors cursor-pointer ${
              settings.globalPaused
                ? 'bg-success-container text-on-success-container border-success/30'
                : 'bg-warning-container text-on-warning-container border-warning/30'
            }`}
          >
            {settings.globalPaused ? (
              <>
                <PlayCircle className="w-3.5 h-3.5" /> Resume Auto Reminders
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5" /> Pause All Reminders
              </>
            )}
          </button>
        </div>
      </div>

      {/* Meta Cloud API Configuration Status Banner */}
      <div
        className={`rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          waConfig?.configured
            ? 'bg-success-container/35 border-success/40 text-on-surface'
            : 'bg-warning-container/60 border-warning/40 text-on-warning-container'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0">
          {waConfig?.configured ? (
            <ShieldCheck className="w-5 h-5 text-success shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          )}
          <div className="text-xs space-y-1 min-w-0 break-words">
            <p className="font-semibold text-sm">
              {waConfig?.configured
                ? `Official Meta WhatsApp Cloud API (${waConfig.apiVersion}) Connected`
                : 'Meta WhatsApp Cloud API Credentials Not Configured on Server'}
            </p>
            <p className="opacity-90 break-words">
              {waConfig?.configured
                ? `Phone Number ID active · Webhook endpoint: ${waConfig.webhookPath} (${waConfig.webhookVerifyTokenConfigured ? 'Verify Token Set' : 'Verify Token Missing'})`
                : 'Configure server environment variables WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WEBHOOK_VERIFY_TOKEN, and WHATSAPP_APP_SECRET to send live template messages.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 max-w-full">
          <span
            className={`px-2.5 py-1 rounded-full font-label text-[11px] font-semibold max-w-full text-center ${
              settings.globalPaused
                ? 'bg-warning-container text-on-warning-container'
                : 'bg-success-container text-on-success-container'
            }`}
          >
            Scheduler: {settings.globalPaused ? 'Globally Paused' : `Active · Every ${settings.reminderIntervalHours}h (${settings.timezone})`}
          </span>
        </div>
      </div>

      {/* 10 KPI Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
        {[
          { label: 'Enrolled Fee Accounts', value: metrics.totalStudents, tone: 'text-primary' },
          { label: 'Total Fee Expected', value: `₹${metrics.totalExpected.toLocaleString('en-IN')}`, tone: 'text-primary' },
          { label: 'Total Collected', value: `₹${metrics.totalCollected.toLocaleString('en-IN')}`, tone: 'text-success' },
          { label: 'Total Outstanding', value: `₹${metrics.totalOutstanding.toLocaleString('en-IN')}`, tone: 'text-error' },
          { label: 'Paid (Auto-Stopped)', value: metrics.paidCount, tone: 'text-success' },
          { label: 'Partially Paid', value: metrics.partialCount, tone: 'text-warning' },
          { label: 'Unpaid Accounts', value: metrics.unpaidCount, tone: 'text-on-surface' },
          { label: 'Overdue Accounts', value: metrics.overdueCount, tone: 'text-error' },
          { label: 'WhatsApp Dispatched', value: metrics.waSentCount, tone: 'text-secondary' },
          { label: 'Failed Dispatches', value: metrics.waFailedCount, tone: 'text-error' },
        ].map((card) => (
          <div
            key={card.label}
            className="min-w-0 bg-surface-container-lowest rounded-lg border border-outline-variant p-3.5 sm:p-4 shadow-sm"
          >
            <p className="font-label text-xs text-on-surface-variant break-words">{card.label}</p>
            <p className={`font-headline text-lg sm:text-xl font-bold tabular-nums mt-1 ${card.tone}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-outline-variant pb-3">
        {[
          { id: 'ledger', label: `Student Fee Ledger (${studentFees.length})`, icon: Users },
          { id: 'payments', label: `Payment History (${payments.length})`, icon: CreditCard },
          { id: 'logs', label: `Reminder & Delivery Logs (${reminders.length})`, icon: MessageSquare },
          { id: 'settings', label: 'Template & 24h Scheduler', icon: SlidersHorizontal },
        ].map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as SubTab)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded font-label text-xs font-semibold transition-colors cursor-pointer ${
                active
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-lowest text-on-surface-variant border border-outline-variant hover:bg-surface-container-low hover:text-primary'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Sub-Tab 1: Student Fee Ledger */}
      {subTab === 'ledger' && (
        <div className="space-y-4">
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative w-full md:flex-1 md:max-w-md min-w-0">
              <Search className="w-4 h-4 text-outline absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student name, ID, parent, WhatsApp..."
                className="w-full pl-9 pr-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface placeholder:text-outline focus:border-secondary focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 max-w-full">
              <select
                aria-label="Filter by payment status"
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value as any)}
                className="w-full sm:w-auto max-w-full px-3 py-2 rounded border border-outline-variant bg-surface text-xs font-semibold text-on-surface"
              >
                <option value="ALL">Payment: All</option>
                <option value="paid">Paid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="unpaid">Unpaid</option>
                <option value="overdue">Overdue</option>
              </select>

              <select
                aria-label="Filter by reminder status"
                value={reminderFilter}
                onChange={(e) => setReminderFilter(e.target.value as any)}
                className="w-full sm:w-auto max-w-full px-3 py-2 rounded border border-outline-variant bg-surface text-xs font-semibold text-on-surface"
              >
                <option value="ALL">Reminder: All</option>
                <option value="active">Active (24h)</option>
                <option value="paused">Paused</option>
                <option value="stopped">Stopped (₹0)</option>
                <option value="opted_out">Opted Out</option>
                <option value="invalid_number">Invalid Number</option>
              </select>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-surface-container-low border-b border-outline-variant text-xs text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Student</th>
                    <th className="px-4 py-3 font-semibold">Batch / Parent WA</th>
                    <th className="px-4 py-3 font-semibold text-right">Monthly / Prev</th>
                    <th className="px-4 py-3 font-semibold text-right">Paid</th>
                    <th className="px-4 py-3 font-semibold text-right">Remaining</th>
                    <th className="px-4 py-3 font-semibold">Due Date</th>
                    <th className="px-4 py-3 font-semibold">Payment</th>
                    <th className="px-4 py-3 font-semibold">WhatsApp Reminder</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {filteredFees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-on-surface-variant">
                        No student fee accounts match the current filter. Click{' '}
                        <strong className="text-primary">Enroll / Edit Student Fee</strong> to add one.
                      </td>
                    </tr>
                  ) : (
                    filteredFees.map((f) => {
                      const pBadge = formatPaymentStatusBadge(f.paymentStatus);
                      const rBadge = formatReminderStatusBadge(f.reminderStatus);
                      return (
                        <tr key={f.id} className="hover:bg-surface-container-low/60 transition-colors">
                          <td className="px-4 py-3.5">
                            <p className="font-semibold text-on-surface">{f.studentName}</p>
                            <p className="font-mono text-xs text-on-surface-variant">{f.studentCode}</p>
                          </td>
                          <td className="px-4 py-3.5">
                            <p className="text-xs font-medium text-on-surface">{f.className}</p>
                            <p className="font-mono text-xs text-on-surface-variant">
                              {f.parentName}: {f.parentWhatsapp || 'Missing'}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums">
                            <p className="text-on-surface">₹{f.totalPayable.toLocaleString('en-IN')}</p>
                            <p className="text-[11px] text-on-surface-variant">
                              Mo ₹{f.monthlyFee} + Prev ₹{f.previousBalance}
                            </p>
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums font-medium text-success">
                            ₹{f.totalPaid.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums font-bold text-on-surface">
                            ₹{f.remainingBalance.toLocaleString('en-IN')}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs text-on-surface tabular-nums">
                            {f.dueDate}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${pBadge.cls}`}
                            >
                              {pBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${rBadge.cls}`}
                              >
                                {rBadge.label}
                              </span>
                              <p className="text-[11px] text-on-surface-variant tabular-nums">
                                Sent: {f.reminderCount}
                                {f.lastReminderAt ? ` · ${f.lastReminderAt.slice(0, 10)}` : ''}
                              </p>
                              {f.lastReminderError && (
                                <p className="text-[10px] text-error max-w-[180px] truncate" title={f.lastReminderError}>
                                  {f.lastReminderError}
                                </p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {f.remainingBalance > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPaymentModalStudent(f);
                                      setPayAmount(String(f.remainingBalance));
                                      setPayDate(new Date().toISOString().slice(0, 10));
                                    }}
                                    className="px-2.5 py-1.5 rounded bg-secondary text-on-secondary hover:bg-primary text-xs font-semibold whitespace-nowrap cursor-pointer"
                                  >
                                    Record Payment
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setSendModalStudent(f)}
                                    className="px-2.5 py-1.5 rounded bg-surface-container-low text-primary border border-outline-variant hover:bg-surface-container text-xs font-semibold whitespace-nowrap cursor-pointer"
                                  >
                                    Send WA
                                  </button>
                                </>
                              )}

                              {f.remainingBalance > 0 && f.reminderStatus === 'active' && (
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() => handleStudentControl(f, 'pause')}
                                  title="Pause automatic 24h reminders"
                                  className="p-1.5 rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-low cursor-pointer"
                                >
                                  <PauseCircle className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {f.remainingBalance > 0 && (f.reminderStatus === 'paused' || f.reminderStatus === 'stopped') && !f.optedOut && (
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() => handleStudentControl(f, 'resume')}
                                  title="Resume automatic 24h reminders"
                                  className="p-1.5 rounded border border-outline-variant text-success hover:bg-success-container/30 cursor-pointer"
                                >
                                  <PlayCircle className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {f.remainingBalance > 0 && f.reminderStatus !== 'stopped' && (
                                <button
                                  type="button"
                                  disabled={busyAction !== null}
                                  onClick={() => handleStudentControl(f, 'stop')}
                                  title="Stop reminders for this student"
                                  className="p-1.5 rounded border border-outline-variant text-error hover:bg-error-container/30 cursor-pointer"
                                >
                                  <StopCircle className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => setHistoryModalStudent(f)}
                                title="View payment & reminder history"
                                className="p-1.5 rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-low cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => openEnrollModal(f)}
                                title="Edit fee profile"
                                className="p-1.5 rounded border border-outline-variant text-on-surface-variant hover:bg-surface-container-low cursor-pointer"
                              >
                                <Settings className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Payment History */}
      {subTab === 'payments' && (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-outline-variant flex items-center justify-between">
            <h2 className="font-headline text-sm font-bold text-on-surface">
              Recorded Manual Fee Payments (Audit Trail Preserved)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-surface-container-low border-b border-outline-variant text-xs text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Method & Reference</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount Received</th>
                  <th className="px-4 py-3 font-semibold text-right">Balance After</th>
                  <th className="px-4 py-3 font-semibold">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">
                      No manual fee payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-container-low/60">
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-on-surface">{p.paymentDate}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-on-surface">{p.studentName}</p>
                        <p className="font-mono text-xs text-on-surface-variant">{p.studentCode}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-semibold text-on-surface">{p.paymentMethod}</span>
                        {p.transactionRef && (
                          <span className="block font-mono text-on-surface-variant">Ref: {p.transactionRef}</span>
                        )}
                        {p.notes && <span className="block text-on-surface-variant">{p.notes}</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-success">
                        ₹{Number(p.amountReceived).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-on-surface">
                        ₹{Number(p.balanceAfterPayment).toLocaleString('en-IN')}
                        {p.balanceAfterPayment <= 0 && (
                          <span className="ml-1.5 inline-flex px-2 py-0.5 rounded-full text-[10px] bg-success-container text-on-success-container">
                            Settled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant">
                        {p.recordedByEmail || p.recordedByUid}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Reminder & WhatsApp Delivery Logs */}
      {subTab === 'logs' && (
        <div className="space-y-4">
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
            <div className="px-5 py-3.5 border-b border-outline-variant flex items-center justify-between">
              <div>
                <h2 className="font-headline text-sm font-bold text-on-surface">
                  Meta WhatsApp Cloud API Dispatch & Webhook Status Logs
                </h2>
                <p className="text-xs text-on-surface-variant">
                  HTTP 200 acceptance sets status to <span className="font-mono font-semibold">sent</span>; delivery & read receipts update via Meta webhook callbacks.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="bg-surface-container-low border-b border-outline-variant text-xs text-on-surface-variant">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Student & Recipient</th>
                    <th className="px-4 py-3 font-semibold">Trigger</th>
                    <th className="px-4 py-3 font-semibold text-right">Due At Send</th>
                    <th className="px-4 py-3 font-semibold">Delivery Status</th>
                    <th className="px-4 py-3 font-semibold">Message ID / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {reminders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-on-surface-variant">
                        No WhatsApp reminders logged yet.
                      </td>
                    </tr>
                  ) : (
                    reminders.map((r) => (
                      <tr key={r.id} className="hover:bg-surface-container-low/60">
                        <td className="px-4 py-3 font-mono text-xs text-on-surface-variant whitespace-nowrap">
                          {(r.sentAt || r.scheduledFor || '').slice(0, 19).replace('T', ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-on-surface">{r.studentName}</p>
                          <p className="font-mono text-xs text-on-surface-variant">
                            {r.studentCode} · {r.recipientWhatsapp}
                          </p>
                        </td>
                        <td className="px-4 py-3 capitalize text-xs font-medium text-on-surface">
                          {r.triggerType}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-on-surface">
                          ₹{Number(r.dueAmountAtSend).toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${formatDeliveryBadge(
                              r.status
                            )}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs">
                          {r.wamid && (
                            <p className="font-mono text-[11px] text-on-surface truncate" title={r.wamid}>
                              wamid: {r.wamid}
                            </p>
                          )}
                          {r.errorMessage && <p className="text-error">{r.errorMessage}</p>}
                          {!r.errorMessage && (
                            <p className="text-on-surface-variant truncate" title={r.messagePreview}>
                              {r.messagePreview}
                            </p>
                          )}
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

      {/* Sub-Tab 4: Scheduler & Template Settings */}
      {subTab === 'settings' && (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant p-4 sm:p-6 max-w-3xl space-y-5 shadow-sm">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">
              24-Hour Automated Reminder & Meta Template Settings
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Approved Meta template parameters & Indian Standard Time (Asia/Kolkata) dispatch window.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2.5 p-3 rounded border border-outline-variant bg-surface cursor-pointer text-sm text-on-surface">
              <input
                type="checkbox"
                checked={settingsDraft.autoReminderEnabled}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, autoReminderEnabled: e.target.checked })
                }
              />
              <span>Enable 24-hour Auto Scheduler</span>
            </label>

            <label className="flex items-center gap-2.5 p-3 rounded border border-outline-variant bg-surface cursor-pointer text-sm text-on-surface">
              <input
                type="checkbox"
                checked={settingsDraft.triggerOnDueOrOverdueOnly}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    triggerOnDueOrOverdueOnly: e.target.checked,
                  })
                }
              />
              <span>Trigger only on/after Due Date</span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Reminder Interval (Hours)
              </label>
              <input
                type="number"
                min={1}
                max={720}
                value={settingsDraft.reminderIntervalHours}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    reminderIntervalHours: Number(e.target.value || 24),
                  })
                }
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Timezone
              </label>
              <input
                type="text"
                value={settingsDraft.timezone}
                onChange={(e) => setSettingsDraft({ ...settingsDraft, timezone: e.target.value })}
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Send Window Start Hour (0–23 IST)
              </label>
              <input
                type="number"
                min={0}
                max={23}
                value={settingsDraft.sendWindowStartHour}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    sendWindowStartHour: Number(e.target.value || 0),
                  })
                }
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Send Window End Hour (1–24 IST)
              </label>
              <input
                type="number"
                min={1}
                max={24}
                value={settingsDraft.sendWindowEndHour}
                onChange={(e) =>
                  setSettingsDraft({
                    ...settingsDraft,
                    sendWindowEndHour: Number(e.target.value || 24),
                  })
                }
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Meta Approved Template Name
              </label>
              <input
                type="text"
                value={settingsDraft.templateName}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, templateName: e.target.value })
                }
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Template Language Code
              </label>
              <input
                type="text"
                value={settingsDraft.languageCode}
                onChange={(e) =>
                  setSettingsDraft({ ...settingsDraft, languageCode: e.target.value })
                }
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">
              Message Preview Template
            </label>
            <textarea
              rows={3}
              value={settingsDraft.messageTemplatePreview}
              onChange={(e) =>
                setSettingsDraft({ ...settingsDraft, messageTemplatePreview: e.target.value })
              }
              className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
            />
            <p className="text-[11px] text-on-surface-variant mt-1">
              Placeholders: {'{{student_name}}'}, {'{{class_name}}'}, {'{{monthly_fee}}'}, {'{{total_paid}}'}, {'{{due_amount}}'}, {'{{due_date}}'}
            </p>
          </div>

          <button
            type="button"
            disabled={busyAction === 'settings'}
            onClick={() => handleSaveSettings(settingsDraft)}
            className="px-5 py-2.5 rounded bg-secondary text-on-secondary hover:bg-primary font-label text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            {busyAction === 'settings' ? 'Saving...' : 'Save Scheduler & Template Settings'}
          </button>
        </div>
      )}

      {/* Enroll / Edit Modal */}
      {enrollOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/50 p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveStudentFee}
            className="w-full max-w-xl bg-surface-container-lowest border border-outline-variant rounded-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
              <h3 className="font-headline text-lg font-bold text-on-surface break-words min-w-0">
                {editingFee ? `Edit Fee Profile · ${editingFee.studentName}` : 'Enroll Student into Fee Ledger'}
              </h3>
              <button
                type="button"
                onClick={() => setEnrollOpen(false)}
                className="p-1 rounded text-on-surface-variant hover:text-on-surface"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!editingFee && students.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Pick Registered Student
                </label>
                <select
                  value={selectedStudentDocId}
                  onChange={(e) => handleSelectStudentFromDirectory(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName} ({s.studentCode}) · {s.mobile}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Student Name</label>
                <input
                  type="text"
                  required
                  value={formStudentName}
                  onChange={(e) => setFormStudentName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Student ID</label>
                <input
                  type="text"
                  required
                  value={formStudentCode}
                  onChange={(e) => setFormStudentCode(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Batch / Class / Plan</label>
                <input
                  type="text"
                  required
                  value={formClassName}
                  onChange={(e) => setFormClassName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Parent / Guardian Name</label>
                <input
                  type="text"
                  required
                  value={formParentName}
                  onChange={(e) => setFormParentName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Parent WhatsApp (E.164 / 10-digit)
                </label>
                <input
                  type="tel"
                  required
                  value={formParentWhatsapp}
                  onChange={(e) => setFormParentWhatsapp(e.target.value)}
                  placeholder="+919876543210"
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                  Student WhatsApp (Optional)
                </label>
                <input
                  type="tel"
                  value={formStudentWhatsapp}
                  onChange={(e) => setFormStudentWhatsapp(e.target.value)}
                  placeholder="+91..."
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Monthly Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={formMonthlyFee}
                  onChange={(e) => setFormMonthlyFee(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Previous Balance (₹)</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={formPreviousBalance}
                  onChange={(e) => setFormPreviousBalance(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Current Month Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={formCurrentMonthFee}
                  onChange={(e) => setFormCurrentMonthFee(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Due Date</label>
                <input
                  type="date"
                  required
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={formAutoReminder}
                  onChange={(e) => setFormAutoReminder(e.target.checked)}
                />
                Enable 24h Auto Reminders
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={formWhatsappConsent}
                  onChange={(e) => setFormWhatsappConsent(e.target.checked)}
                />
                Parent WhatsApp Opt-In Consent Verified
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setEnrollOpen(false)}
                className="px-4 py-2 rounded border border-outline-variant text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === 'upsert'}
                className="px-5 py-2 rounded bg-secondary text-on-secondary hover:bg-primary text-xs font-semibold disabled:opacity-50"
              >
                {busyAction === 'upsert' ? 'Saving...' : 'Save Fee Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Record Manual Payment Modal */}
      {paymentModalStudent && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/50 p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-md bg-surface-container-lowest border border-outline-variant rounded-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto shadow-xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
              <h3 className="font-headline text-lg font-bold text-on-surface">Record Manual Payment</h3>
              <button
                type="button"
                onClick={() => setPaymentModalStudent(null)}
                className="p-1 text-on-surface-variant hover:text-on-surface shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant space-y-1 text-xs">
              <p className="font-semibold text-sm text-on-surface break-words">
                {paymentModalStudent.studentName} ({paymentModalStudent.studentCode})
              </p>
              <div className="flex flex-wrap justify-between gap-2 text-on-surface-variant">
                <span>Total Payable: ₹{paymentModalStudent.totalPayable.toLocaleString('en-IN')}</span>
                <span>Already Paid: ₹{paymentModalStudent.totalPaid.toLocaleString('en-IN')}</span>
              </div>
              <p className="font-bold text-error text-sm tabular-nums">
                Current Remaining Balance: ₹{paymentModalStudent.remainingBalance.toLocaleString('en-IN')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Amount Received (₹)</label>
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-bold text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Payment Date</label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Payment Method</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as any)}
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                Transaction Reference (Optional)
              </label>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="UPI UTR / Receipt Ref"
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm font-mono text-on-surface"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Notes (Optional)</label>
              <input
                type="text"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="Desk collection note"
                className="w-full px-3 py-2 rounded border border-outline-variant bg-surface text-sm text-on-surface"
              />
            </div>

            {Number(payAmount || 0) >= paymentModalStudent.remainingBalance && (
              <div className="p-3 rounded-lg bg-success-container/60 text-on-success-container text-xs flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This settles the balance to <strong>₹0</strong>. All future automatic 24-hour WhatsApp reminders will stop immediately.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPaymentModalStudent(null)}
                className="px-4 py-2 rounded border border-outline-variant text-xs font-semibold text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyAction === 'payment'}
                className="px-5 py-2 rounded bg-secondary text-on-secondary hover:bg-primary text-xs font-semibold disabled:opacity-50"
              >
                {busyAction === 'payment' ? 'Recording...' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manual WhatsApp Confirmation Modal */}
      {sendModalStudent && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/50 p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-surface-container-lowest border border-outline-variant rounded-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
              <h3 className="font-headline text-lg font-bold text-on-surface">
                Confirm WhatsApp Fee Reminder
              </h3>
              <button
                type="button"
                onClick={() => setSendModalStudent(null)}
                className="p-1 text-on-surface-variant hover:text-on-surface shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-surface-container-low p-3.5 rounded-lg border border-outline-variant">
              <div className="min-w-0">
                <span className="text-on-surface-variant block">Student</span>
                <span className="font-semibold text-on-surface break-words">{sendModalStudent.studentName}</span>
              </div>
              <div className="min-w-0">
                <span className="text-on-surface-variant block">Recipient WhatsApp</span>
                <span className="font-mono font-semibold text-on-surface break-all">
                  {sendModalStudent.parentWhatsapp || sendModalStudent.studentWhatsapp || 'Missing'}
                </span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Remaining Balance</span>
                <span className="font-bold text-error tabular-nums">
                  ₹{sendModalStudent.remainingBalance.toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span className="text-on-surface-variant block">Due Date</span>
                <span className="font-mono font-semibold text-on-surface">{sendModalStudent.dueDate}</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-on-surface-variant mb-1.5">
                Live Template Message Preview ({settings.templateName})
              </p>
              <div className="p-3.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface leading-relaxed break-words">
                {buildRenderedPreview(sendModalStudent)}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSendModalStudent(null)}
                className="px-4 py-2 rounded border border-outline-variant text-xs font-semibold text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busyAction === 'send_manual'}
                onClick={handleSendManualReminder}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded bg-secondary text-on-secondary hover:bg-primary text-xs font-semibold disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {busyAction === 'send_manual' ? 'Dispatching...' : 'Send via Meta Cloud API'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student Payment & Reminder History Modal */}
      {historyModalStudent && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/50 p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant rounded-xl p-4 sm:p-6 space-y-5 max-h-[90dvh] overflow-y-auto my-auto shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
              <div className="min-w-0">
                <h3 className="font-headline text-lg font-bold text-on-surface break-words">
                  Fee & Reminder History · {historyModalStudent.studentName}
                </h3>
                <p className="text-xs text-on-surface-variant font-mono break-words">
                  {historyModalStudent.studentCode} · Remaining ₹{historyModalStudent.remainingBalance.toLocaleString('en-IN')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryModalStudent(null)}
                className="p-1 text-on-surface-variant hover:text-on-surface shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {historyModalStudent.optedOut ? (
                <button
                  type="button"
                  onClick={() => handleStudentControl(historyModalStudent, 'opt_in')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold"
                >
                  <Bell className="w-3.5 h-3.5" /> Restore WhatsApp Opt-In
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleStudentControl(historyModalStudent, 'opt_out')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant text-on-surface-variant text-xs font-semibold"
                >
                  <BellOff className="w-3.5 h-3.5" /> Mark Opted-Out (STOP)
                </button>
              )}
              {historyModalStudent.nextReminderAt && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-surface-container-low text-xs text-on-surface-variant font-mono break-all">
                  <Clock className="w-3.5 h-3.5 shrink-0" /> Next 24h schedule: {historyModalStudent.nextReminderAt.slice(0, 16).replace('T', ' ')}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Manual Payments ({studentHistoryPayments.length})
              </h4>
              {studentHistoryPayments.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No payments recorded for this student yet.</p>
              ) : (
                <div className="divide-y divide-outline-variant border border-outline-variant rounded-lg">
                  {studentHistoryPayments.map((p) => (
                    <div key={p.id} className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="min-w-0 break-words">
                        <span className="font-mono font-semibold text-on-surface">{p.paymentDate}</span>
                        <span className="mx-2 text-outline">·</span>
                        <span className="font-medium text-on-surface">{p.paymentMethod}</span>
                        {p.transactionRef && <span className="ml-2 text-on-surface-variant font-mono break-all">({p.transactionRef})</span>}
                      </div>
                      <div className="text-right tabular-nums shrink-0">
                        <span className="font-bold text-success">+₹{p.amountReceived}</span>
                        <span className="ml-2 text-on-surface-variant">Bal: ₹{p.balanceAfterPayment}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                WhatsApp Reminder Attempts ({studentHistoryReminders.length})
              </h4>
              {studentHistoryReminders.length === 0 ? (
                <p className="text-xs text-on-surface-variant">No reminder attempts yet.</p>
              ) : (
                <div className="divide-y divide-outline-variant border border-outline-variant rounded-lg max-h-56 overflow-y-auto">
                  {studentHistoryReminders.map((r) => (
                    <div key={r.id} className="px-3.5 py-2.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-mono text-on-surface break-words">
                          {(r.sentAt || r.scheduledFor).slice(0, 19).replace('T', ' ')} · {r.triggerType}
                        </p>
                        {r.errorMessage && <p className="text-error truncate">{r.errorMessage}</p>}
                        {r.wamid && <p className="text-on-surface-variant font-mono truncate">wamid: {r.wamid}</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize shrink-0 ${formatDeliveryBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
