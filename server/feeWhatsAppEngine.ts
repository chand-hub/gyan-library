import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  FeePaymentRecord,
  FeePaymentStatus,
  FeeReminderRecord,
  FeeReminderStatus,
  FeeSystemSettings,
  StudentFeeRecord,
  WhatsAppDeliveryStatus,
  WhatsAppMessageLog,
} from '../src/types/library.ts';

export interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
  webhookVerifyToken: string;
  appSecret: string;
  configured: boolean;
}

export interface FeeStoreData {
  settings: FeeSystemSettings;
  studentFees: Record<string, StudentFeeRecord>;
  payments: FeePaymentRecord[];
  reminders: FeeReminderRecord[];
  whatsappLogs: WhatsAppMessageLog[];
  processedIdempotencyKeys: Record<string, { reminderId: string; createdAt: string }>;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
}>;

export interface EngineOptions {
  storePath?: string;
  fetchFn?: FetchLike;
  nowFn?: () => number;
  configProvider?: () => MetaWhatsAppConfig;
  retryDelayMsFn?: (attempt: number) => number;
}

export const DEFAULT_FEE_SYSTEM_SETTINGS: FeeSystemSettings = {
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

export function roundCurrency(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

export function getMetaWhatsAppConfig(): MetaWhatsAppConfig {
  const accessToken = (
    process.env.WHATSAPP_ACCESS_TOKEN ||
    process.env.WHATSAPP_API_TOKEN ||
    ''
  ).trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const businessAccountId = (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim();
  const apiVersion = (process.env.WHATSAPP_API_VERSION || 'v21.0').trim() || 'v21.0';
  const webhookVerifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
  const appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();

  return {
    accessToken,
    phoneNumberId,
    businessAccountId,
    apiVersion,
    webhookVerifyToken,
    appSecret,
    configured: Boolean(accessToken && phoneNumberId),
  };
}

export function getIstDateParts(ms: number): { dateStr: string; hour: number; iso: string } {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return { dateStr, hour, iso: d.toISOString() };
}

export function normalizeWhatsappNumber(raw: string | undefined | null): {
  valid: boolean;
  e164: string;
  digits: string;
  reason?: string;
} {
  const cleaned = String(raw || '').trim();
  if (!cleaned) {
    return { valid: false, e164: '', digits: '', reason: 'WhatsApp number is missing.' };
  }
  const hasPlus = cleaned.startsWith('+');
  let digits = cleaned.replace(/[^0-9]/g, '');

  // Strip leading 00 international prefix if present
  if (!hasPlus && digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  // Auto-normalize 10-digit Indian mobile numbers or 0-prefixed 11-digit Indian numbers
  if (!hasPlus && digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (!hasPlus && digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = `91${digits}`;
  }

  // E.164 requires 8 to 15 digits without leading zero
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) {
    return {
      valid: false,
      e164: '',
      digits: '',
      reason: 'Number does not match valid E.164 WhatsApp format (e.g. +919876543210).',
    };
  }

  // Reject obviously synthetic repeated digits like +910000000000
  if (/^(\d)\1{7,}$/.test(digits) || (digits.startsWith('91') && digits.length !== 12)) {
    return {
      valid: false,
      e164: '',
      digits: '',
      reason: 'Invalid WhatsApp phone length or digits.',
    };
  }

  return {
    valid: true,
    e164: `+${digits}`,
    digits,
  };
}

export function computeFeeStatusAndBalance(
  input: Pick<
    StudentFeeRecord,
    | 'monthlyFee'
    | 'previousBalance'
    | 'currentMonthFee'
    | 'totalPaid'
    | 'dueDate'
    | 'optedOut'
    | 'whatsappConsent'
    | 'parentWhatsapp'
    | 'studentWhatsapp'
    | 'autoReminderEnabled'
    | 'reminderStatus'
  >,
  nowMs: number
): {
  totalPayable: number;
  totalPaid: number;
  remainingBalance: number;
  paymentStatus: FeePaymentStatus;
  reminderStatus: FeeReminderStatus;
  autoReminderEnabled: boolean;
} {
  const prev = roundCurrency(input.previousBalance);
  const curr = roundCurrency(input.currentMonthFee ?? input.monthlyFee);
  const totalPayable = roundCurrency(prev + curr);
  const totalPaid = roundCurrency(input.totalPaid);
  const remainingBalance = roundCurrency(Math.max(0, totalPayable - totalPaid));

  const { dateStr: todayIst } = getIstDateParts(nowMs);
  const dueDate = String(input.dueDate || todayIst).slice(0, 10);

  let paymentStatus: FeePaymentStatus;
  if (remainingBalance <= 0) {
    paymentStatus = 'paid';
  } else if (totalPaid > 0) {
    paymentStatus = 'partially_paid';
  } else if (dueDate < todayIst) {
    paymentStatus = 'overdue';
  } else {
    paymentStatus = 'unpaid';
  }

  const recipientCheck = normalizeWhatsappNumber(input.parentWhatsapp || input.studentWhatsapp);
  let reminderStatus: FeeReminderStatus = input.reminderStatus || 'active';
  let autoReminderEnabled = Boolean(input.autoReminderEnabled);

  if (input.optedOut) {
    reminderStatus = 'opted_out';
    autoReminderEnabled = false;
  } else if (remainingBalance <= 0) {
    reminderStatus = 'stopped';
    autoReminderEnabled = false;
  } else if (!recipientCheck.valid) {
    reminderStatus = 'invalid_number';
  } else if (reminderStatus === 'stopped' || reminderStatus === 'invalid_number') {
    reminderStatus = autoReminderEnabled ? 'active' : 'paused';
  } else if (!autoReminderEnabled && reminderStatus === 'active') {
    reminderStatus = 'paused';
  }

  return {
    totalPayable,
    totalPaid,
    remainingBalance,
    paymentStatus,
    reminderStatus,
    autoReminderEnabled,
  };
}

export function renderReminderPreview(
  template: string,
  record: StudentFeeRecord
): string {
  return String(template || DEFAULT_FEE_SYSTEM_SETTINGS.messageTemplatePreview)
    .replace(/\{\{\s*student_name\s*\}\}/g, record.studentName)
    .replace(/\{\{\s*class_name\s*\}\}/g, record.className || 'Library Study Hall')
    .replace(/\{\{\s*monthly_fee\s*\}\}/g, String(roundCurrency(record.monthlyFee)))
    .replace(/\{\{\s*total_paid\s*\}\}/g, String(roundCurrency(record.totalPaid)))
    .replace(/\{\{\s*due_amount\s*\}\}/g, String(roundCurrency(record.remainingBalance)))
    .replace(/\{\{\s*due_date\s*\}\}/g, record.dueDate || '');
}

export function isRecordEligibleForAutoReminder(
  record: StudentFeeRecord,
  settings: FeeSystemSettings,
  nowMs: number
): { eligible: boolean; reason?: string } {
  if (settings.globalPaused) {
    return { eligible: false, reason: 'Global automatic reminders are paused.' };
  }
  if (!settings.autoReminderEnabled) {
    return { eligible: false, reason: 'Automatic reminder scheduler is disabled.' };
  }
  if (record.remainingBalance <= 0 || record.paymentStatus === 'paid') {
    return { eligible: false, reason: 'Student fee balance is zero (Paid).' };
  }
  if (record.optedOut || record.reminderStatus === 'opted_out') {
    return { eligible: false, reason: 'Recipient opted out of WhatsApp reminders.' };
  }
  if (!record.whatsappConsent) {
    return { eligible: false, reason: 'WhatsApp consent is disabled.' };
  }
  if (record.reminderStatus === 'paused' || record.reminderStatus === 'stopped') {
    return { eligible: false, reason: `Reminder status is ${record.reminderStatus}.` };
  }
  if (!record.autoReminderEnabled) {
    return { eligible: false, reason: 'Auto reminder disabled for student.' };
  }

  const phone = normalizeWhatsappNumber(record.parentWhatsapp || record.studentWhatsapp);
  if (!phone.valid) {
    return { eligible: false, reason: phone.reason || 'Invalid WhatsApp phone number.' };
  }

  const ist = getIstDateParts(nowMs);
  if (
    settings.sendWindowEndHour > settings.sendWindowStartHour &&
    (ist.hour < settings.sendWindowStartHour || ist.hour >= settings.sendWindowEndHour)
  ) {
    return {
      eligible: false,
      reason: `Outside IST reminder send window (${settings.sendWindowStartHour}:00–${settings.sendWindowEndHour}:00).`,
    };
  }

  if (settings.triggerOnDueOrOverdueOnly && record.dueDate && record.dueDate > ist.dateStr) {
    return {
      eligible: false,
      reason: `Due date (${record.dueDate}) is in the future (IST today: ${ist.dateStr}).`,
    };
  }

  const intervalMs = Math.max(1, Number(settings.reminderIntervalHours) || 24) * 3_600_000;
  if (record.lastReminderAt) {
    const lastMs = new Date(record.lastReminderAt).getTime();
    if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) {
      const hoursLeft = ((intervalMs - (nowMs - lastMs)) / 3_600_000).toFixed(1);
      return {
        eligible: false,
        reason: `24-hour interval active (${hoursLeft}h remaining since last reminder).`,
      };
    }
  }

  return { eligible: true };
}

export class FeeWhatsAppEngine {
  private readonly storePath: string;
  private readonly fetchFn: FetchLike;
  private readonly nowFn: () => number;
  private readonly configProvider: () => MetaWhatsAppConfig;
  private readonly retryDelayMsFn: (attempt: number) => number;
  private readonly inFlightStudentLocks = new Set<string>();
  private store: FeeStoreData;

  constructor(options: EngineOptions = {}) {
    this.storePath =
      options.storePath ||
      path.resolve(process.cwd(), '.vidhya-data', 'fee_automation_store.json');
    this.fetchFn = options.fetchFn || ((input, init) => fetch(input, init));
    this.nowFn = options.nowFn || (() => Date.now());
    this.configProvider = options.configProvider || getMetaWhatsAppConfig;
    this.retryDelayMsFn =
      options.retryDelayMsFn || ((attempt) => Math.min(8000, 600 * Math.pow(2, attempt)));
    this.store = this.loadStoreFromDisk();
  }

  private createEmptyStore(): FeeStoreData {
    return {
      settings: { ...DEFAULT_FEE_SYSTEM_SETTINGS },
      studentFees: {},
      payments: [],
      reminders: [],
      whatsappLogs: [],
      processedIdempotencyKeys: {},
    };
  }

  private loadStoreFromDisk(): FeeStoreData {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
        return {
          settings: { ...DEFAULT_FEE_SYSTEM_SETTINGS, ...(raw.settings || {}) },
          studentFees: raw.studentFees || {},
          payments: Array.isArray(raw.payments) ? raw.payments : [],
          reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
          whatsappLogs: Array.isArray(raw.whatsappLogs) ? raw.whatsappLogs : [],
          processedIdempotencyKeys: raw.processedIdempotencyKeys || {},
        };
      }
    } catch (err) {
      console.warn('[FeeWhatsAppEngine] Failed to load persisted store:', err);
    }
    return this.createEmptyStore();
  }

  private persistStore(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${this.storePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), 'utf8');
      fs.renameSync(tmp, this.storePath);
    } catch (err) {
      console.error('[FeeWhatsAppEngine] Failed to persist store:', err);
    }
  }

  public reloadFromDisk(): void {
    this.store = this.loadStoreFromDisk();
  }

  public getState() {
    const fees = Object.values(this.store.studentFees);
    return {
      settings: { ...this.store.settings },
      studentFees: fees,
      payments: [...this.store.payments].sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      ),
      reminders: [...this.store.reminders]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 300),
      whatsappLogs: [...this.store.whatsappLogs]
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .slice(0, 300),
    };
  }

  public getSafeConfigSummary() {
    const cfg = this.configProvider();
    return {
      configured: cfg.configured,
      phoneNumberIdConfigured: Boolean(cfg.phoneNumberId),
      businessAccountConfigured: Boolean(cfg.businessAccountId),
      webhookVerifyTokenConfigured: Boolean(cfg.webhookVerifyToken),
      appSecretConfigured: Boolean(cfg.appSecret),
      apiVersion: cfg.apiVersion,
      webhookPath: '/api/whatsapp/webhook',
    };
  }

  public updateSettings(partial: Partial<FeeSystemSettings>): FeeSystemSettings {
    const nowIso = new Date(this.nowFn()).toISOString();
    this.store.settings = {
      ...this.store.settings,
      ...(typeof partial.autoReminderEnabled === 'boolean'
        ? { autoReminderEnabled: partial.autoReminderEnabled }
        : {}),
      ...(typeof partial.globalPaused === 'boolean' ? { globalPaused: partial.globalPaused } : {}),
      ...(typeof partial.reminderIntervalHours === 'number'
        ? { reminderIntervalHours: Math.max(1, Math.min(168, partial.reminderIntervalHours)) }
        : {}),
      ...(typeof partial.sendWindowStartHour === 'number'
        ? { sendWindowStartHour: Math.max(0, Math.min(23, partial.sendWindowStartHour)) }
        : {}),
      ...(typeof partial.sendWindowEndHour === 'number'
        ? { sendWindowEndHour: Math.max(1, Math.min(24, partial.sendWindowEndHour)) }
        : {}),
      ...(typeof partial.triggerOnDueOrOverdueOnly === 'boolean'
        ? { triggerOnDueOrOverdueOnly: partial.triggerOnDueOrOverdueOnly }
        : {}),
      ...(typeof partial.templateName === 'string' && partial.templateName.trim()
        ? { templateName: partial.templateName.trim().slice(0, 100) }
        : {}),
      ...(typeof partial.languageCode === 'string' && partial.languageCode.trim()
        ? { languageCode: partial.languageCode.trim().slice(0, 20) }
        : {}),
      ...(typeof partial.messageTemplatePreview === 'string' && partial.messageTemplatePreview.trim()
        ? { messageTemplatePreview: partial.messageTemplatePreview.trim().slice(0, 1200) }
        : {}),
      updatedAt: nowIso,
    };
    this.persistStore();
    return { ...this.store.settings };
  }

  public upsertStudentFee(raw: Partial<StudentFeeRecord> & { id: string }): StudentFeeRecord {
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();
    const existing = this.store.studentFees[raw.id];

    const monthlyFee = roundCurrency(raw.monthlyFee ?? existing?.monthlyFee ?? 0);
    const previousBalance = roundCurrency(raw.previousBalance ?? existing?.previousBalance ?? 0);
    const currentMonthFee = roundCurrency(
      raw.currentMonthFee ?? existing?.currentMonthFee ?? monthlyFee
    );
    const totalPaid = roundCurrency(raw.totalPaid ?? existing?.totalPaid ?? 0);
    const dueDate = String(
      raw.dueDate ?? existing?.dueDate ?? getIstDateParts(nowMs).dateStr
    ).slice(0, 10);

    const optedOut = raw.optedOut ?? existing?.optedOut ?? false;
    const whatsappConsent = raw.whatsappConsent ?? existing?.whatsappConsent ?? true;
    const parentWhatsapp = String(raw.parentWhatsapp ?? existing?.parentWhatsapp ?? '').trim();
    const studentWhatsapp = String(raw.studentWhatsapp ?? existing?.studentWhatsapp ?? '').trim();

    const merged: StudentFeeRecord = {
      id: raw.id,
      studentDocId: String(raw.studentDocId ?? existing?.studentDocId ?? raw.id),
      studentUid: String(raw.studentUid ?? existing?.studentUid ?? ''),
      studentCode: String(raw.studentCode ?? existing?.studentCode ?? 'VL0000'),
      studentName: String(raw.studentName ?? existing?.studentName ?? 'Student'),
      className: String(raw.className ?? existing?.className ?? 'Library Study Hall'),
      parentName: String(raw.parentName ?? existing?.parentName ?? ''),
      parentWhatsapp,
      studentWhatsapp,
      monthlyFee,
      previousBalance,
      currentMonthFee,
      totalPayable: 0,
      totalPaid,
      remainingBalance: 0,
      dueDate,
      paymentStatus: 'unpaid',
      reminderStatus: raw.reminderStatus ?? existing?.reminderStatus ?? 'active',
      autoReminderEnabled: raw.autoReminderEnabled ?? existing?.autoReminderEnabled ?? true,
      whatsappConsent,
      optedOut,
      lastReminderAt: raw.lastReminderAt !== undefined ? raw.lastReminderAt : existing?.lastReminderAt ?? null,
      nextReminderAt: raw.nextReminderAt !== undefined ? raw.nextReminderAt : existing?.nextReminderAt ?? null,
      lastReminderError:
        raw.lastReminderError !== undefined
          ? raw.lastReminderError
          : existing?.lastReminderError ?? null,
      reminderCount: Number(raw.reminderCount ?? existing?.reminderCount ?? 0),
      isDemo: Boolean(raw.isDemo ?? existing?.isDemo ?? false),
      createdAt: existing?.createdAt || raw.createdAt || nowIso,
      updatedAt: nowIso,
    };

    const computed = computeFeeStatusAndBalance(merged, nowMs);
    const finalRecord: StudentFeeRecord = {
      ...merged,
      ...computed,
      nextReminderAt: computed.remainingBalance <= 0 ? null : merged.nextReminderAt,
    };

    this.store.studentFees[finalRecord.id] = finalRecord;

    if (finalRecord.remainingBalance <= 0) {
      this.cancelQueuedRemindersForStudent(finalRecord.id, 'Fee fully paid; queued reminder cancelled.');
    }

    this.persistStore();
    return { ...finalRecord };
  }

  public syncFromFrontend(payload: {
    studentFees?: Array<Partial<StudentFeeRecord> & { id: string }>;
    settings?: Partial<FeeSystemSettings>;
  }) {
    if (payload.settings) {
      this.updateSettings(payload.settings);
    }
    if (Array.isArray(payload.studentFees)) {
      for (const item of payload.studentFees) {
        if (item && typeof item.id === 'string' && item.id.trim()) {
          const existing = this.store.studentFees[item.id];
          // Preserve authoritative server totalPaid/lastReminderAt if newer or higher when syncing stale UI
          const mergedItem = {
            ...item,
            ...(existing
              ? {
                  totalPaid: Math.max(roundCurrency(item.totalPaid), roundCurrency(existing.totalPaid)),
                  reminderCount: Math.max(Number(item.reminderCount || 0), Number(existing.reminderCount || 0)),
                  lastReminderAt:
                    existing.lastReminderAt &&
                    (!item.lastReminderAt || existing.lastReminderAt > item.lastReminderAt)
                      ? existing.lastReminderAt
                      : item.lastReminderAt,
                }
              : {}),
          };
          this.upsertStudentFee(mergedItem);
        }
      }
    }
    return this.getState();
  }

  private cancelQueuedRemindersForStudent(studentFeeId: string, reason: string): number {
    const nowIso = new Date(this.nowFn()).toISOString();
    let count = 0;
    for (const r of this.store.reminders) {
      if (r.studentFeeId === studentFeeId && r.status === 'queued') {
        r.status = 'cancelled';
        r.errorMessage = reason;
        r.updatedAt = nowIso;
        count += 1;
      }
    }
    return count;
  }

  public recordManualPayment(input: {
    studentFeeId: string;
    amountReceived: number;
    paymentDate?: string;
    paymentMethod: 'Cash' | 'UPI' | 'Bank Transfer' | 'Other';
    transactionRef?: string;
    notes?: string;
    recordedByUid: string;
    recordedByEmail?: string;
  }): {
    studentFee: StudentFeeRecord;
    payment: FeePaymentRecord;
    autoStopped: boolean;
    cancelledQueuedCount: number;
  } {
    const record = this.store.studentFees[input.studentFeeId];
    if (!record) {
      throw new Error('Student fee record not found.');
    }

    const amount = roundCurrency(input.amountReceived);
    if (amount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }
    if (record.remainingBalance <= 0) {
      throw new Error('Student already has zero remaining balance.');
    }

    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();
    const appliedAmount = Math.min(amount, record.remainingBalance);
    const nextTotalPaid = roundCurrency(record.totalPaid + appliedAmount);

    const updated = computeFeeStatusAndBalance(
      {
        ...record,
        totalPaid: nextTotalPaid,
      },
      nowMs
    );

    const autoStopped = updated.remainingBalance <= 0;
    const updatedRecord: StudentFeeRecord = {
      ...record,
      ...updated,
      nextReminderAt: autoStopped ? null : record.nextReminderAt,
      updatedAt: nowIso,
    };
    this.store.studentFees[record.id] = updatedRecord;

    const paymentRecord: FeePaymentRecord = {
      id: `fpay_${nowMs}_${crypto.randomBytes(3).toString('hex')}`,
      studentFeeId: record.id,
      studentDocId: record.studentDocId,
      studentUid: record.studentUid,
      studentCode: record.studentCode,
      studentName: record.studentName,
      amountReceived: appliedAmount,
      paymentDate: String(input.paymentDate || getIstDateParts(nowMs).dateStr).slice(0, 10),
      paymentMethod: input.paymentMethod,
      transactionRef: (input.transactionRef || '').trim().slice(0, 120),
      notes: (input.notes || '').trim().slice(0, 400),
      recordedByUid: input.recordedByUid,
      recordedByEmail: input.recordedByEmail || '',
      balanceAfterPayment: updatedRecord.remainingBalance,
      createdAt: nowIso,
    };
    this.store.payments.unshift(paymentRecord);

    let cancelledQueuedCount = 0;
    if (autoStopped) {
      cancelledQueuedCount = this.cancelQueuedRemindersForStudent(
        record.id,
        'Stopped automatically because full payment settled remaining balance to ₹0.'
      );
    }

    this.persistStore();

    return {
      studentFee: { ...updatedRecord },
      payment: { ...paymentRecord },
      autoStopped,
      cancelledQueuedCount,
    };
  }

  public setStudentReminderControl(
    studentFeeId: string,
    action: 'pause' | 'resume' | 'stop' | 'opt_out' | 'opt_in'
  ): StudentFeeRecord {
    const rec = this.store.studentFees[studentFeeId];
    if (!rec) throw new Error('Student fee record not found.');
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();

    let nextOptedOut = rec.optedOut;
    let nextAuto = rec.autoReminderEnabled;
    let nextStatus = rec.reminderStatus;

    if (action === 'pause') {
      nextAuto = false;
      nextStatus = 'paused';
    } else if (action === 'stop') {
      nextAuto = false;
      nextStatus = 'stopped';
      this.cancelQueuedRemindersForStudent(studentFeeId, 'Reminder stopped by administrator.');
    } else if (action === 'opt_out') {
      nextOptedOut = true;
      nextAuto = false;
      nextStatus = 'opted_out';
      this.cancelQueuedRemindersForStudent(studentFeeId, 'Recipient opted out.');
    } else if (action === 'opt_in') {
      nextOptedOut = false;
      nextAuto = rec.remainingBalance > 0;
      nextStatus = rec.remainingBalance > 0 ? 'active' : 'stopped';
    } else if (action === 'resume') {
      if (rec.optedOut) {
        throw new Error('Cannot resume reminders while recipient is opted out.');
      }
      if (rec.remainingBalance <= 0) {
        throw new Error('Cannot resume reminders when remaining balance is zero.');
      }
      nextAuto = true;
      nextStatus = 'active';
    }

    const updated = computeFeeStatusAndBalance(
      {
        ...rec,
        optedOut: nextOptedOut,
        autoReminderEnabled: nextAuto,
        reminderStatus: nextStatus,
      },
      nowMs
    );

    const saved: StudentFeeRecord = {
      ...rec,
      ...updated,
      updatedAt: nowIso,
    };
    this.store.studentFees[studentFeeId] = saved;
    this.persistStore();
    return { ...saved };
  }

  public enqueueReminder(studentFeeId: string, triggerType: 'scheduled' | 'manual' | 'bulk'): FeeReminderRecord {
    const rec = this.store.studentFees[studentFeeId];
    if (!rec) throw new Error('Student fee record not found.');
    if (rec.remainingBalance <= 0) {
      throw new Error('Cannot queue reminder when remaining balance is zero.');
    }
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();
    const phone = normalizeWhatsappNumber(rec.parentWhatsapp || rec.studentWhatsapp);
    const reminder: FeeReminderRecord = {
      id: `rem_${nowMs}_${crypto.randomBytes(3).toString('hex')}`,
      studentFeeId: rec.id,
      studentDocId: rec.studentDocId,
      studentUid: rec.studentUid,
      studentCode: rec.studentCode,
      studentName: rec.studentName,
      recipientWhatsapp: phone.e164 || rec.parentWhatsapp || rec.studentWhatsapp || '',
      dueAmountAtSend: rec.remainingBalance,
      dueDate: rec.dueDate,
      templateName: this.store.settings.templateName,
      languageCode: this.store.settings.languageCode,
      messagePreview: renderReminderPreview(this.store.settings.messageTemplatePreview, rec),
      triggerType,
      idempotencyKey: `queue_${rec.id}_${nowMs}`,
      status: 'queued',
      wamid: null,
      errorMessage: null,
      retryCount: 0,
      scheduledFor: nowIso,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.store.reminders.unshift(reminder);
    this.persistStore();
    return { ...reminder };
  }

  public async sendWhatsAppReminder(params: {
    studentFeeId: string;
    triggerType: 'scheduled' | 'manual' | 'bulk';
    idempotencyKey?: string;
    beforeSendHook?: () => Promise<void> | void;
  }): Promise<{
    outcome: 'sent' | 'skipped' | 'deduped' | 'failed';
    reason?: string;
    reminder?: FeeReminderRecord;
    log?: WhatsAppMessageLog;
    studentFee?: StudentFeeRecord;
  }> {
    const key = (params.idempotencyKey || '').trim();
    if (key && this.store.processedIdempotencyKeys[key]) {
      const existingId = this.store.processedIdempotencyKeys[key].reminderId;
      const existingReminder = this.store.reminders.find((r) => r.id === existingId);
      return {
        outcome: 'deduped',
        reason: 'Duplicate trigger blocked by idempotency key.',
        reminder: existingReminder ? { ...existingReminder } : undefined,
        studentFee: this.store.studentFees[params.studentFeeId]
          ? { ...this.store.studentFees[params.studentFeeId] }
          : undefined,
      };
    }

    if (this.inFlightStudentLocks.has(params.studentFeeId)) {
      return {
        outcome: 'deduped',
        reason: 'A WhatsApp reminder dispatch is already in progress for this student.',
      };
    }

    this.inFlightStudentLocks.add(params.studentFeeId);

    try {
      // Optional hook used in automated tests to simulate mid-flight payment arriving before Meta call
      if (params.beforeSendHook) {
        await params.beforeSendHook();
      }

      // CRITICAL: Always re-read the latest balance immediately before dispatching
      const latest = this.store.studentFees[params.studentFeeId];
      if (!latest) {
        return { outcome: 'skipped', reason: 'Student fee record not found.' };
      }

      if (latest.remainingBalance <= 0 || latest.paymentStatus === 'paid') {
        return {
          outcome: 'skipped',
          reason: 'Aborted send: student balance is ₹0 (Paid).',
          studentFee: { ...latest },
        };
      }
      if (latest.optedOut || latest.reminderStatus === 'opted_out') {
        return {
          outcome: 'skipped',
          reason: 'Aborted send: recipient opted out.',
          studentFee: { ...latest },
        };
      }
      if (!latest.whatsappConsent) {
        return {
          outcome: 'skipped',
          reason: 'Aborted send: WhatsApp consent is disabled.',
          studentFee: { ...latest },
        };
      }
      if (
        params.triggerType === 'scheduled' &&
        (latest.reminderStatus === 'paused' || latest.reminderStatus === 'stopped')
      ) {
        return {
          outcome: 'skipped',
          reason: `Aborted scheduled send: reminder status is ${latest.reminderStatus}.`,
          studentFee: { ...latest },
        };
      }

      const phoneCheck = normalizeWhatsappNumber(latest.parentWhatsapp || latest.studentWhatsapp);
      if (!phoneCheck.valid) {
        this.upsertStudentFee({ ...latest, reminderStatus: 'invalid_number' });
        return {
          outcome: 'skipped',
          reason: phoneCheck.reason || 'Invalid WhatsApp phone number.',
          studentFee: { ...this.store.studentFees[latest.id] },
        };
      }

      const cfg = this.configProvider();
      if (!cfg.configured) {
        return {
          outcome: 'failed',
          reason:
            'Official Meta WhatsApp Business Cloud API credentials (WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID) are not configured on the server.',
          studentFee: { ...latest },
        };
      }

      const nowMs = this.nowFn();
      const nowIso = new Date(nowMs).toISOString();
      const effectiveKey =
        key || `${params.triggerType}:${latest.id}:${Math.floor(nowMs / 30_000)}`;
      const templateName = this.store.settings.templateName || 'vidhya_fee_reminder';
      const languageCode = this.store.settings.languageCode || 'en';
      const messagePreview = renderReminderPreview(
        this.store.settings.messageTemplatePreview,
        latest
      );

      const reminderId = `rem_${nowMs}_${crypto.randomBytes(3).toString('hex')}`;
      const logId = `wlog_${nowMs}_${crypto.randomBytes(3).toString('hex')}`;

      const reminder: FeeReminderRecord = {
        id: reminderId,
        studentFeeId: latest.id,
        studentDocId: latest.studentDocId,
        studentUid: latest.studentUid,
        studentCode: latest.studentCode,
        studentName: latest.studentName,
        recipientWhatsapp: phoneCheck.e164,
        dueAmountAtSend: latest.remainingBalance,
        dueDate: latest.dueDate,
        templateName,
        languageCode,
        messagePreview,
        triggerType: params.triggerType,
        idempotencyKey: effectiveKey,
        status: 'queued',
        wamid: null,
        errorMessage: null,
        retryCount: 0,
        scheduledFor: nowIso,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Reserve idempotency key immediately to prevent concurrent duplicates
      this.store.processedIdempotencyKeys[effectiveKey] = {
        reminderId,
        createdAt: nowIso,
      };
      this.store.reminders.unshift(reminder);

      const endpoint = `https://graph.facebook.com/${encodeURIComponent(
        cfg.apiVersion
      )}/${encodeURIComponent(cfg.phoneNumberId)}/messages`;

      const metaPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneCheck.digits,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: latest.studentName },
                { type: 'text', text: latest.className || 'Library Study Hall' },
                { type: 'text', text: `₹${roundCurrency(latest.monthlyFee)}` },
                { type: 'text', text: `₹${roundCurrency(latest.totalPaid)}` },
                { type: 'text', text: `₹${roundCurrency(latest.remainingBalance)}` },
                { type: 'text', text: latest.dueDate || 'Due Now' },
              ],
            },
          ],
        },
      };

      const maxAttempts = 3;
      let lastErrMsg = '';
      let lastHttpStatus: number | null = null;
      let acceptedWamid: string | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Re-verify latest balance right before each HTTP attempt
        const preRetryLatest = this.store.studentFees[params.studentFeeId];
        if (!preRetryLatest || preRetryLatest.remainingBalance <= 0) {
          reminder.status = 'cancelled';
          reminder.errorMessage = 'Aborted before retry: fee balance became zero.';
          reminder.updatedAt = new Date(this.nowFn()).toISOString();
          this.persistStore();
          return {
            outcome: 'skipped',
            reason: reminder.errorMessage,
            reminder: { ...reminder },
            studentFee: preRetryLatest ? { ...preRetryLatest } : undefined,
          };
        }

        try {
          const response = await this.fetchFn(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfg.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(metaPayload),
          });
          lastHttpStatus = response.status;
          const bodyText = await response.text();
          let bodyJson: any = {};
          try {
            bodyJson = bodyText ? JSON.parse(bodyText) : {};
          } catch {
            bodyJson = { raw: bodyText };
          }

          if (response.ok && bodyJson?.messages?.[0]?.id) {
            acceptedWamid = String(bodyJson.messages[0].id);
            break;
          }

          const metaErr = bodyJson?.error?.message || bodyText || `HTTP ${response.status}`;
          lastErrMsg = String(metaErr).slice(0, 400);
          const isTransient = response.status === 429 || response.status >= 500;
          if (!isTransient || attempt === maxAttempts - 1) {
            break;
          }
        } catch (netErr: any) {
          lastErrMsg = String(netErr?.message || 'Network error calling Meta Graph API').slice(0, 400);
          if (attempt === maxAttempts - 1) {
            break;
          }
        }

        reminder.retryCount += 1;
        const waitMs = this.retryDelayMsFn(attempt);
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }

      const finishMs = this.nowFn();
      const finishIso = new Date(finishMs).toISOString();

      if (acceptedWamid) {
        // CRITICAL: HTTP 200 acceptance means SENT — NEVER mark 'delivered' until webhook fires
        reminder.status = 'sent';
        reminder.wamid = acceptedWamid;
        reminder.sentAt = finishIso;
        reminder.updatedAt = finishIso;

        const log: WhatsAppMessageLog = {
          id: logId,
          reminderId: reminder.id,
          studentFeeId: latest.id,
          studentCode: latest.studentCode,
          studentName: latest.studentName,
          recipientWhatsapp: phoneCheck.e164,
          wamid: acceptedWamid,
          status: 'sent',
          templateName,
          messagePreview,
          dueAmountAtSend: latest.remainingBalance,
          errorMessage: null,
          httpStatus: lastHttpStatus,
          webhookPayloadSummary: null,
          createdAt: finishIso,
          updatedAt: finishIso,
        };
        this.store.whatsappLogs.unshift(log);

        const intervalMs =
          Math.max(1, Number(this.store.settings.reminderIntervalHours) || 24) * 3_600_000;
        const nextIso = new Date(finishMs + intervalMs).toISOString();

        // Update student tracking metadata while preserving any payment that landed mid-request
        const afterSendRecord = this.store.studentFees[latest.id];
        if (afterSendRecord) {
          afterSendRecord.lastReminderAt = finishIso;
          afterSendRecord.nextReminderAt =
            afterSendRecord.remainingBalance > 0 ? nextIso : null;
          afterSendRecord.lastReminderError = null;
          afterSendRecord.reminderCount = (afterSendRecord.reminderCount || 0) + 1;
          afterSendRecord.updatedAt = finishIso;
        }

        this.persistStore();
        return {
          outcome: 'sent',
          reminder: { ...reminder },
          log: { ...log },
          studentFee: afterSendRecord ? { ...afterSendRecord } : undefined,
        };
      }

      // Failed delivery attempt
      reminder.status = 'failed';
      reminder.errorMessage = lastErrMsg || 'Meta WhatsApp Cloud API rejected the template message.';
      reminder.updatedAt = finishIso;

      const failLog: WhatsAppMessageLog = {
        id: logId,
        reminderId: reminder.id,
        studentFeeId: latest.id,
        studentCode: latest.studentCode,
        studentName: latest.studentName,
        recipientWhatsapp: phoneCheck.e164,
        wamid: null,
        status: 'failed',
        templateName,
        messagePreview,
        dueAmountAtSend: latest.remainingBalance,
        errorMessage: reminder.errorMessage,
        httpStatus: lastHttpStatus,
        webhookPayloadSummary: null,
        createdAt: finishIso,
        updatedAt: finishIso,
      };
      this.store.whatsappLogs.unshift(failLog);

      const afterFailRecord = this.store.studentFees[latest.id];
      if (afterFailRecord) {
        afterFailRecord.lastReminderError = reminder.errorMessage;
        afterFailRecord.updatedAt = finishIso;
      }

      this.persistStore();
      return {
        outcome: 'failed',
        reason: reminder.errorMessage,
        reminder: { ...reminder },
        log: { ...failLog },
        studentFee: afterFailRecord ? { ...afterFailRecord } : undefined,
      };
    } finally {
      this.inFlightStudentLocks.delete(params.studentFeeId);
    }
  }

  public async runScheduledFeeReminders(options: { triggerType?: 'scheduled' | 'bulk' } = {}): Promise<{
    evaluated: number;
    sent: number;
    skipped: number;
    failed: number;
    details: Array<{ studentFeeId: string; studentCode: string; outcome: string; reason?: string }>;
  }> {
    const nowMs = this.nowFn();
    const intervalMs =
      Math.max(1, Number(this.store.settings.reminderIntervalHours) || 24) * 3_600_000;
    const triggerType = options.triggerType || 'scheduled';
    const records = Object.values(this.store.studentFees);

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const details: Array<{
      studentFeeId: string;
      studentCode: string;
      outcome: string;
      reason?: string;
    }> = [];

    for (const rec of records) {
      if (triggerType === 'scheduled') {
        const check = isRecordEligibleForAutoReminder(rec, this.store.settings, nowMs);
        if (!check.eligible) {
          skipped += 1;
          details.push({
            studentFeeId: rec.id,
            studentCode: rec.studentCode,
            outcome: 'skipped',
            reason: check.reason,
          });
          continue;
        }
      } else {
        // Bulk trigger from admin checks balance/consent/opt-out/phone but can bypass 24h wait if admin requests
        if (rec.remainingBalance <= 0 || rec.paymentStatus === 'paid') {
          skipped += 1;
          details.push({
            studentFeeId: rec.id,
            studentCode: rec.studentCode,
            outcome: 'skipped',
            reason: 'Zero remaining balance.',
          });
          continue;
        }
        if (rec.optedOut || !rec.whatsappConsent) {
          skipped += 1;
          details.push({
            studentFeeId: rec.id,
            studentCode: rec.studentCode,
            outcome: 'skipped',
            reason: 'Opted out or no WhatsApp consent.',
          });
          continue;
        }
      }

      // Deterministic 24-hour cycle bucket prevents restart catch-up duplicates within the same interval
      const bucket =
        triggerType === 'scheduled'
          ? `sched:${rec.id}:${Math.floor(nowMs / intervalMs)}`
          : `bulk:${rec.id}:${Math.floor(nowMs / 60_000)}`;

      const res = await this.sendWhatsAppReminder({
        studentFeeId: rec.id,
        triggerType,
        idempotencyKey: bucket,
      });

      if (res.outcome === 'sent') sent += 1;
      else if (res.outcome === 'failed') failed += 1;
      else skipped += 1;

      details.push({
        studentFeeId: rec.id,
        studentCode: rec.studentCode,
        outcome: res.outcome,
        reason: res.reason,
      });
    }

    return {
      evaluated: records.length,
      sent,
      skipped,
      failed,
      details,
    };
  }

  public verifyWebhookChallenge(queryParams: Record<string, any>): {
    verified: boolean;
    challenge?: string;
    reason?: string;
  } {
    const mode = String(queryParams['hub.mode'] || '');
    const token = String(queryParams['hub.verify_token'] || '');
    const challenge = String(queryParams['hub.challenge'] || '');
    const expected = this.configProvider().webhookVerifyToken;

    if (!expected) {
      return { verified: false, reason: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured.' };
    }
    if (mode !== 'subscribe' || !challenge) {
      return { verified: false, reason: 'Invalid webhook subscription parameters.' };
    }

    const tokenBuf = Buffer.from(token, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    const matches =
      tokenBuf.length === expBuf.length && crypto.timingSafeEqual(tokenBuf, expBuf);

    if (!matches) {
      return { verified: false, reason: 'Webhook verification token mismatch.' };
    }
    return { verified: true, challenge };
  }

  public verifyWebhookSignature(rawBody: Buffer | string | undefined, signatureHeader: string | undefined): boolean {
    const appSecret = this.configProvider().appSecret;
    if (!appSecret) return true; // Optional when user hasn't configured app secret
    if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }
    const expected = `sha256=${crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex')}`;
    const sigBuf = Buffer.from(signatureHeader, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  }

  public processWebhookPayload(payload: any): {
    statusesUpdated: number;
    optOutsProcessed: number;
  } {
    const nowIso = new Date(this.nowFn()).toISOString();
    let statusesUpdated = 0;
    let optOutsProcessed = 0;

    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const val = change?.value || {};
        const statuses = Array.isArray(val.statuses) ? val.statuses : [];

        for (const st of statuses) {
          const wamid = String(st?.id || '').trim();
          const rawStatus = String(st?.status || '').toLowerCase();
          if (!wamid) continue;

          const mappedStatus: WhatsAppDeliveryStatus | null =
            rawStatus === 'sent' ||
            rawStatus === 'delivered' ||
            rawStatus === 'read' ||
            rawStatus === 'failed'
              ? rawStatus
              : null;
          if (!mappedStatus) continue;

          const errInfo = Array.isArray(st.errors) && st.errors[0]
            ? `${st.errors[0].code || ''} ${st.errors[0].title || st.errors[0].message || ''}`.trim()
            : null;

          for (const rem of this.store.reminders) {
            if (rem.wamid === wamid) {
              rem.status = mappedStatus;
              if (mappedStatus === 'delivered' && !rem.deliveredAt) {
                rem.deliveredAt = nowIso;
              }
              if (mappedStatus === 'read') {
                if (!rem.deliveredAt) rem.deliveredAt = nowIso;
                rem.readAt = nowIso;
              }
              if (mappedStatus === 'failed' && errInfo) {
                rem.errorMessage = errInfo;
              }
              rem.updatedAt = nowIso;
              statusesUpdated += 1;
            }
          }

          for (const log of this.store.whatsappLogs) {
            if (log.wamid === wamid) {
              log.status = mappedStatus;
              if (errInfo) log.errorMessage = errInfo;
              log.webhookPayloadSummary = `Meta status=${mappedStatus}${errInfo ? ` (${errInfo})` : ''}`;
              log.updatedAt = nowIso;
            }
          }
        }

        // Handle opt-out keywords from incoming WhatsApp replies
        const messages = Array.isArray(val.messages) ? val.messages : [];
        for (const msg of messages) {
          const fromDigits = String(msg?.from || '').replace(/[^0-9]/g, '');
          const textBody = String(msg?.text?.body || msg?.button?.text || '')
            .trim()
            .toUpperCase();
          if (
            fromDigits &&
            (textBody === 'STOP' || textBody === 'UNSUBSCRIBE' || textBody === 'OPT OUT')
          ) {
            for (const rec of Object.values(this.store.studentFees)) {
              const pDigits = normalizeWhatsappNumber(rec.parentWhatsapp).digits;
              const sDigits = normalizeWhatsappNumber(rec.studentWhatsapp).digits;
              if (pDigits === fromDigits || sDigits === fromDigits) {
                this.setStudentReminderControl(rec.id, 'opt_out');
                optOutsProcessed += 1;
              }
            }
          }
        }
      }
    }

    if (statusesUpdated > 0 || optOutsProcessed > 0) {
      this.persistStore();
    }

    return { statusesUpdated, optOutsProcessed };
  }
}
