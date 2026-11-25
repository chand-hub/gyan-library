import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AdminLoginActivity,
  AttendanceAuditEntry,
  AttendanceRecord,
  AttendanceStatusCode,
  CustomAttendanceStatus,
  DEFAULT_FACILITIES,
  DEFAULT_GYAN_ADDA_SETTINGS,
  EnquiryRecord,
  FacilityItem,
  FaqItem,
  GalleryItem,
  LibrarySettings,
  LibraryShift,
} from '../src/types/library.ts';

export interface AdminCredentialState {
  adminId: string;
  displayName: string;
  mobile: string; // normalized 10-digit or E.164 digits
  passwordHash: string; // scrypt$<saltHex>$<hashHex>
  updatedAt: string;
}

export interface AdminOtpState {
  mobile: string;
  otpHash: string;
  salt: string;
  expiresAtMs: number;
  lastSentAtMs: number;
  failedAttempts: number;
  verifiedTokenHash?: string;
  verifiedExpiresAtMs?: number;
}

export interface AdminSessionPayload {
  sub: string;
  role: 'admin';
  mobile: string;
  displayName: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface AdminSystemStore {
  admin: AdminCredentialState | null;
  revokedJtis: Record<string, number>;
  loginActivity: AdminLoginActivity[];
  settings: LibrarySettings;
  faqs: FaqItem[];
  gallery: GalleryItem[];
  enquiries: EnquiryRecord[];
  shifts: LibraryShift[];
  studentShiftAssignments: Record<
    string,
    {
      studentDocId: string;
      studentCode: string;
      studentName: string;
      mobile?: string;
      seatCode?: string;
      shiftId: string;
      shiftName: string;
      shiftTiming: string;
      updatedAt: string;
    }
  >;
  studentsDirectory: Array<{
    id: string;
    uid: string;
    studentCode: string;
    fullName: string;
    mobile: string;
    email?: string;
    seatCode?: string;
    shiftId?: string;
    shiftName?: string;
    shiftTiming?: string;
    membershipPlanName?: string;
    membershipStatus?: string;
    status: string;
  }>;
  customAttendanceStatuses: CustomAttendanceStatus[];
  attendance: AttendanceRecord[];
  attendanceAuditLogs: AttendanceAuditEntry[];
}

export function getIstNow(ms: number = Date.now()): {
  date: string; // YYYY-MM-DD
  time24: string; // HH:mm:ss
  timeShort: string; // HH:mm
  time12: string; // hh:mm:ss AM/PM
  iso: string;
  displayIst: string;
} {
  const d = new Date(ms);
  const partsFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = partsFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  let hr = get('hour');
  if (hr === '24') hr = '00';
  const min = get('minute');
  const sec = get('second');
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time24 = `${hr}:${min}:${sec}`;
  const timeShort = `${hr}:${min}`;

  const time12 = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(d);

  const displayIst = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(d);

  return {
    date,
    time24,
    timeShort,
    time12,
    iso: d.toISOString(),
    displayIst,
  };
}

export function normalizeMobileNumber(raw: unknown): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

export function isValidIndianOrIntlMobile(mobile: string): boolean {
  return /^[6-9]\d{9}$/.test(mobile) || /^\d{10,15}$/.test(mobile);
}

export function hashPasswordScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  try {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, expectedHex] = parts;
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Password must contain at least one letter and one number.';
  }
  return null;
}

export const DEFAULT_FACILITY_ITEMS: FacilityItem[] = [
  {
    id: 'fac_24h',
    name: 'Open 24 Hours Self-Study Access',
    description: 'Continuous quiet study environment accessible day and night across all 7 days.',
    icon: 'Clock',
    available: true,
  },
  {
    id: 'fac_ac',
    name: 'Full Centralized Air Conditioning',
    description: 'Climate-controlled silent study halls calibrated for long, comfortable study hours.',
    icon: 'Wind',
    available: true,
  },
  {
    id: 'fac_wifi',
    name: 'High-Speed Dual-Band Fiber Wi-Fi',
    description: 'Uninterrupted dual-ISP fiber internet for video lectures, online tests, and research.',
    icon: 'Wifi',
    available: true,
  },
  {
    id: 'fac_desk',
    name: 'Individual Partitioned Study Desks',
    description: 'Spacious partitioned desks with personal LED study lamps, comfortable chairs, and charging sockets.',
    icon: 'LampDesk',
    available: true,
  },
  {
    id: 'fac_water',
    name: 'RO Chilled Drinking Water',
    description: 'Hygienic purified chilled & normal drinking water dispensers on the floor.',
    icon: 'Droplets',
    available: true,
  },
  {
    id: 'fac_cctv',
    name: '24/7 HD CCTV Surveillance & Discipline',
    description: 'Round-the-clock monitored campus security, clean washrooms, and dedicated staff assistance.',
    icon: 'ShieldCheck',
    available: true,
  },
];

export const DEFAULT_SHIFTS: LibraryShift[] = [
  {
    id: 'shift_morning',
    name: 'Morning Shift',
    startTime: '06:00',
    endTime: '12:00',
    description: 'Early morning quiet study batch (06:00 AM – 12:00 PM)',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'shift_afternoon',
    name: 'Afternoon Shift',
    startTime: '12:00',
    endTime: '18:00',
    description: 'Midday focus batch (12:00 PM – 06:00 PM)',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'shift_evening',
    name: 'Evening Shift',
    startTime: '16:00',
    endTime: '22:00',
    description: 'Evening batch for college & coaching students (04:00 PM – 10:00 PM)',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'shift_fullday',
    name: 'Full Day',
    startTime: '06:00',
    endTime: '22:00',
    description: 'Full-day uninterrupted desk access (06:00 AM – 10:00 PM)',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'shift_night',
    name: 'Night / 24h Access',
    startTime: '22:00',
    endTime: '06:00',
    description: 'Late-night & 24-hour self-study shift',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const DEFAULT_FAQS: FaqItem[] = [
  {
    id: 'faq_1',
    section: 'faq',
    category: 'Timings',
    question: 'What are the opening and closing times of GYAN ADDA LIBRARY?',
    answer:
      'GYAN ADDA LIBRARY is open 24 hours a day, Monday through Sunday, including holidays. Members can choose Morning, Afternoon, Evening, Full-Day, or 24-Hour access shifts.',
    sortOrder: 1,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_2',
    section: 'faq',
    category: 'Fees',
    question: 'What is the monthly fee structure and how do I enquire about current plans?',
    answer:
      'Monthly self-study charges depend on your selected shift duration (single shift, double shift, full day, or 24-hour locker access). Contact our helpline at +91 87976 40034 or submit an admission enquiry for the exact current fee card.',
    sortOrder: 2,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_3',
    section: 'faq',
    category: 'Admission',
    question: 'What is the admission procedure at GYAN ADDA LIBRARY?',
    answer:
      'Visit our study center at 2nd Floor, Station Rd, Mirzapur Chowk, Darbhanga or submit an online Admission Enquiry. Select your preferred study shift, verify your identity documents at the front desk, and complete registration.',
    sortOrder: 3,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_4',
    section: 'faq',
    category: 'Documents',
    question: 'Which documents are required for new admission?',
    answer:
      'Applicants should carry one valid Government Photo ID (Aadhaar Card / Voter ID / Driving License / Student ID), two recent passport-size photographs, and an active mobile number & emergency guardian contact.',
    sortOrder: 4,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_5',
    section: 'faq',
    category: 'Facilities',
    question: 'What study facilities are provided inside the reading hall?',
    answer:
      'Every desk features comfortable ergonomic seating, individual LED desk lighting, dedicated power charging sockets, centralized air conditioning, RO chilled drinking water, clean sanitized washrooms, and 24/7 CCTV surveillance.',
    sortOrder: 5,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_6',
    section: 'faq',
    category: 'Wi-Fi',
    question: 'Is high-speed Wi-Fi available for online classes and mock tests?',
    answer:
      'Yes. We provide dual-band high-speed fiber Wi-Fi across all study halls so students preparing for UPSC, BPSC, SSC, NEET, JEE, and Banking exams can attend online lectures without buffering.',
    sortOrder: 6,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_7',
    section: 'faq',
    category: 'Attendance',
    question: 'How do library attendance and shift check-ins work?',
    answer:
      'Daily attendance is verified and recorded at the study hall desk according to your assigned shift. Accurate check-in timestamps and leave records help maintain seat discipline and safety.',
    sortOrder: 7,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'faq_8',
    section: 'faq',
    category: 'Contact',
    question: 'How can parents or students reach the library help line?',
    answer:
      'You can call us directly on +91 87976 40034 / +91 87897 02011, message on WhatsApp at +91 87976 40034, or use the Help Line Enquiry form on this website.',
    sortOrder: 8,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  // Important Questions section
  {
    id: 'imp_1',
    section: 'important',
    category: 'Membership',
    question: 'Is membership transferable between students?',
    answer:
      'No. Every GYAN ADDA LIBRARY membership and assigned seat is strictly personal and non-transferable. Sharing ID cards or seat access with unregistered visitors leads to immediate cancellation.',
    sortOrder: 1,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'imp_2',
    section: 'important',
    category: 'Seat Reservation',
    question: 'How does seat reservation and shift allocation work?',
    answer:
      'Seats are allocated strictly against your chosen study shift. Fixed full-day reserved seats remain held for you during active membership; shift-based members must vacate cleanly at the end of their shift window.',
    sortOrder: 2,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'imp_3',
    section: 'important',
    category: 'Discipline & Rules',
    question: 'What are the key library discipline rules inside the reading hall?',
    answer:
      'Pin-drop silence must be maintained at all times. Mobile phones must remain on silent mode, phone calls must be taken outside the hall, eatables are not allowed on study desks, and headphones must be kept at zero external sound leakage.',
    sortOrder: 3,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'imp_4',
    section: 'important',
    category: 'Renewal Policy',
    question: 'When should monthly membership be renewed to keep my reserved seat?',
    answer:
      'Renewals should be completed on or before your billing due date to retain the same desk number. If you plan to be away on leave, please inform the desk administrator in advance so your seat reservation status can be updated.',
    sortOrder: 4,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'imp_5',
    section: 'important',
    category: 'Support',
    question: 'Who do I contact for locker issues, Wi-Fi support, or emergency help?',
    answer:
      'Contact the on-duty floor supervisor at the reception desk or reach our 24-hour help line at +91 87976 40034 / desk@gyanaddalibrary.in.',
    sortOrder: 5,
    published: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

export const DEFAULT_GALLERY_ITEMS: GalleryItem[] = [
  {
    id: 'gal_1',
    title: 'GYAN ADDA LIBRARY · Main Reading Hall',
    category: 'Reading Hall',
    imageUrl: '/assets/aistudio/image_06146a49.png',
    caption: 'Partitioned study desks with ergonomic chairs, warm desk lighting, and quiet academic atmosphere.',
    sortOrder: 1,
    approved: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'gal_2',
    title: 'Silent AC Study Cubicles · Mirzapur Chowk',
    category: 'Silent Zone',
    imageUrl: '/assets/aistudio/image_0b08f282.png',
    caption: 'Climate-controlled individual study cubicles with power points and zero-distraction layout.',
    sortOrder: 2,
    approved: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export class AdminSystemEngine {
  private readonly storePath: string;
  private readonly hmacSecret: string;
  private store: AdminSystemStore;
  private activeOtps = new Map<string, AdminOtpState>();

  constructor(options: { hmacSecret: string; storePath?: string }) {
    this.hmacSecret = options.hmacSecret;
    this.storePath =
      options.storePath || path.resolve(process.cwd(), '.vidhya-data', 'admin_system_store.json');
    this.store = this.loadOrInitStore();
    this.seedFromEnvIfPresent();
  }

  private createDefaultStore(): AdminSystemStore {
    return {
      admin: null,
      revokedJtis: {},
      loginActivity: [],
      settings: {
        ...DEFAULT_GYAN_ADDA_SETTINGS,
        facilities: [...DEFAULT_FACILITIES],
        facilityItems: [...DEFAULT_FACILITY_ITEMS],
        updatedAt: new Date().toISOString(),
      },
      faqs: [...DEFAULT_FAQS],
      gallery: [...DEFAULT_GALLERY_ITEMS],
      enquiries: [],
      shifts: [...DEFAULT_SHIFTS],
      studentShiftAssignments: {},
      studentsDirectory: [],
      customAttendanceStatuses: [],
      attendance: [],
      attendanceAuditLogs: [],
    };
  }

  private loadOrInitStore(): AdminSystemStore {
    const defaults = this.createDefaultStore();
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<AdminSystemStore>;
        return {
          admin: parsed.admin || null,
          revokedJtis: parsed.revokedJtis || {},
          loginActivity: Array.isArray(parsed.loginActivity) ? parsed.loginActivity : [],
          settings: {
            ...defaults.settings,
            ...(parsed.settings || {}),
            facilityItems:
              Array.isArray(parsed.settings?.facilityItems) &&
              parsed.settings.facilityItems.length > 0
                ? parsed.settings.facilityItems
                : defaults.settings.facilityItems,
          },
          faqs: Array.isArray(parsed.faqs) && parsed.faqs.length > 0 ? parsed.faqs : defaults.faqs,
          gallery:
            Array.isArray(parsed.gallery) && parsed.gallery.length > 0
              ? parsed.gallery
              : defaults.gallery,
          enquiries: Array.isArray(parsed.enquiries) ? parsed.enquiries : [],
          shifts:
            Array.isArray(parsed.shifts) && parsed.shifts.length > 0
              ? parsed.shifts
              : defaults.shifts,
          studentShiftAssignments: parsed.studentShiftAssignments || {},
          studentsDirectory: Array.isArray(parsed.studentsDirectory) ? parsed.studentsDirectory : [],
          customAttendanceStatuses: Array.isArray(parsed.customAttendanceStatuses)
            ? parsed.customAttendanceStatuses
            : [],
          attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
          attendanceAuditLogs: Array.isArray(parsed.attendanceAuditLogs)
            ? parsed.attendanceAuditLogs
            : [],
        };
      }
    } catch (err) {
      console.warn('[AdminSystemEngine] Failed loading store, initializing defaults:', err);
    }
    this.store = defaults;
    this.persist();
    return defaults;
  }

  private seedFromEnvIfPresent() {
    const envMobile = normalizeMobileNumber(process.env.ADMIN_MOBILE);
    const envHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
    if (!this.store.admin && envMobile && envHash.startsWith('scrypt$')) {
      this.store.admin = {
        adminId: 'admin_primary',
        displayName: 'Library Administrator',
        mobile: envMobile,
        passwordHash: envHash,
        updatedAt: new Date().toISOString(),
      };
      this.persist();
    }
  }

  private persist() {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.storePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.storePath);
    } catch (err) {
      console.error('[AdminSystemEngine] Failed persisting store:', err);
    }
  }

  private recordLoginActivity(entry: Omit<AdminLoginActivity, 'id' | 'timestampIso' | 'timestampIst'>) {
    const nowIst = getIstNow();
    const full: AdminLoginActivity = {
      id: `act_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ...entry,
      timestampIso: nowIst.iso,
      timestampIst: `${nowIst.date} ${nowIst.time12} IST`,
    };
    this.store.loginActivity.unshift(full);
    if (this.store.loginActivity.length > 200) {
      this.store.loginActivity = this.store.loginActivity.slice(0, 200);
    }
    this.persist();
  }

  private signAdminToken(admin: AdminCredentialState): { token: string; expiresAt: string } {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 12 * 60 * 60; // 12h session
    const payload: AdminSessionPayload = {
      sub: admin.adminId,
      role: 'admin',
      mobile: admin.mobile,
      displayName: admin.displayName,
      jti: crypto.randomBytes(12).toString('hex'),
      iat: nowSec,
      exp: expSec,
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(`adm_v1.${encoded}`)
      .digest('hex');
    return {
      token: `adm_v1.${encoded}.${sig}`,
      expiresAt: new Date(expSec * 1000).toISOString(),
    };
  }

  public verifyAdminToken(token: string): AdminSessionPayload | null {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3 || parts[0] !== 'adm_v1') return null;
      const [, encoded, sig] = parts;
      const expectedSig = crypto
        .createHmac('sha256', this.hmacSecret)
        .update(`adm_v1.${encoded}`)
        .digest('hex');
      const sigBuf = Buffer.from(sig, 'utf8');
      const expBuf = Buffer.from(expectedSig, 'utf8');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return null;
      }
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AdminSessionPayload;
      if (!parsed.jti || !parsed.exp || parsed.role !== 'admin') return null;
      if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
      if (this.store.revokedJtis[parsed.jti]) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  public revokeToken(token: string) {
    const payload = this.verifyAdminToken(token);
    if (payload) {
      this.store.revokedJtis[payload.jti] = payload.exp;
      const nowSec = Math.floor(Date.now() / 1000);
      for (const [k, exp] of Object.entries(this.store.revokedJtis)) {
        if (exp <= nowSec) delete this.store.revokedJtis[k];
      }
      this.persist();
    }
  }

  public getAuthStatus(): {
    hasAdminConfigured: boolean;
    smsGatewayConfigured: boolean;
    maskedMobile: string | null;
  } {
    const mobile = this.store.admin?.mobile || '';
    const masked =
      mobile.length >= 6
        ? `${mobile.slice(0, 2)}${'*'.repeat(Math.max(2, mobile.length - 5))}${mobile.slice(-3)}`
        : null;
    return {
      hasAdminConfigured: Boolean(this.store.admin),
      smsGatewayConfigured: Boolean((process.env.SMS_API_KEY || '').trim()),
      maskedMobile: masked,
    };
  }

  public setupFirstAdmin(input: {
    mobile: string;
    password: string;
    displayName?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (this.store.admin) {
      throw Object.assign(new Error('Admin account is already initialized. Please sign in.'), {
        statusCode: 409,
      });
    }
    const mobile = normalizeMobileNumber(input.mobile);
    if (!isValidIndianOrIntlMobile(mobile)) {
      throw Object.assign(new Error('Enter a valid 10-digit registered mobile number.'), {
        statusCode: 400,
      });
    }
    const pwdErr = validatePasswordStrength(input.password);
    if (pwdErr) {
      throw Object.assign(new Error(pwdErr), { statusCode: 400 });
    }
    const admin: AdminCredentialState = {
      adminId: 'admin_primary',
      displayName: (input.displayName || 'GYAN ADDA Admin').trim().slice(0, 80),
      mobile,
      passwordHash: hashPasswordScrypt(input.password),
      updatedAt: new Date().toISOString(),
    };
    this.store.admin = admin;
    this.persist();
    this.recordLoginActivity({
      mobile,
      action: 'admin_setup',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Primary administrator mobile & password initialized.',
    });
    const session = this.signAdminToken(admin);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        adminId: admin.adminId,
        displayName: admin.displayName,
        mobile: admin.mobile,
        updatedAt: admin.updatedAt,
      },
    };
  }

  public loginWithMobilePassword(input: {
    mobile: string;
    password: string;
    ip?: string;
    userAgent?: string;
  }) {
    const mobile = normalizeMobileNumber(input.mobile);
    if (!this.store.admin) {
      throw Object.assign(
        new Error('Administrator credentials are not configured yet. Complete first-run setup first.'),
        { statusCode: 400 }
      );
    }
    const okMobile = mobile === this.store.admin.mobile;
    const okPwd = verifyPasswordScrypt(String(input.password || ''), this.store.admin.passwordHash);
    if (!okMobile || !okPwd) {
      this.recordLoginActivity({
        mobile: mobile || String(input.mobile || '').slice(0, 20),
        action: 'mobile_password_login',
        status: 'failed',
        ip: input.ip || 'unknown',
        userAgent: input.userAgent || 'unknown',
        details: 'Invalid mobile number or password attempt.',
      });
      throw Object.assign(new Error('Invalid mobile number or password.'), { statusCode: 401 });
    }

    this.recordLoginActivity({
      mobile: this.store.admin.mobile,
      action: 'mobile_password_login',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Signed in via Mobile + Password.',
    });

    const session = this.signAdminToken(this.store.admin);
    return {
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        adminId: this.store.admin.adminId,
        displayName: this.store.admin.displayName,
        mobile: this.store.admin.mobile,
        updatedAt: this.store.admin.updatedAt,
      },
    };
  }

  public getAdminProfile() {
    return {
      configured: Boolean(this.store.admin),
      admin: this.store.admin
        ? {
            adminId: this.store.admin.adminId,
            displayName: this.store.admin.displayName,
            mobile: this.store.admin.mobile,
            updatedAt: this.store.admin.updatedAt,
          }
        : null,
      smsGatewayConfigured: Boolean((process.env.SMS_API_KEY || '').trim()),
      loginActivity: this.store.loginActivity.slice(0, 60),
    };
  }

  public initializeOrUpdateFromAuthenticatedOwner(input: {
    mobile: string;
    newPassword: string;
    displayName?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const mobile = normalizeMobileNumber(input.mobile);
    if (!isValidIndianOrIntlMobile(mobile)) {
      throw Object.assign(new Error('Enter a valid 10-digit mobile number.'), { statusCode: 400 });
    }
    const pwdErr = validatePasswordStrength(input.newPassword);
    if (pwdErr) throw Object.assign(new Error(pwdErr), { statusCode: 400 });
    this.store.admin = {
      adminId: this.store.admin?.adminId || 'admin_primary',
      displayName: (input.displayName || this.store.admin?.displayName || 'GYAN ADDA Admin')
        .trim()
        .slice(0, 80),
      mobile,
      passwordHash: hashPasswordScrypt(input.newPassword),
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    this.recordLoginActivity({
      mobile,
      action: 'password_changed',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Mobile/password credential updated by verified owner session.',
    });
    return this.getAdminProfile();
  }

  public changePassword(input: {
    currentPassword: string;
    newPassword: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!this.store.admin) {
      throw Object.assign(new Error('Admin mobile/password account is not set up yet.'), {
        statusCode: 400,
      });
    }
    if (!verifyPasswordScrypt(input.currentPassword, this.store.admin.passwordHash)) {
      throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 401 });
    }
    const pwdErr = validatePasswordStrength(input.newPassword);
    if (pwdErr) throw Object.assign(new Error(pwdErr), { statusCode: 400 });
    this.store.admin.passwordHash = hashPasswordScrypt(input.newPassword);
    this.store.admin.updatedAt = new Date().toISOString();
    this.persist();
    this.recordLoginActivity({
      mobile: this.store.admin.mobile,
      action: 'password_changed',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Administrator password updated.',
    });
    return { updated: true, updatedAt: this.store.admin.updatedAt };
  }

  public changeMobile(input: {
    currentPassword: string;
    newMobile: string;
    displayName?: string;
    ip?: string;
    userAgent?: string;
  }) {
    if (!this.store.admin) {
      throw Object.assign(new Error('Admin mobile/password account is not set up yet.'), {
        statusCode: 400,
      });
    }
    if (!verifyPasswordScrypt(input.currentPassword, this.store.admin.passwordHash)) {
      throw Object.assign(new Error('Current password verification failed.'), { statusCode: 401 });
    }
    const mobile = normalizeMobileNumber(input.newMobile);
    if (!isValidIndianOrIntlMobile(mobile)) {
      throw Object.assign(new Error('Enter a valid 10-digit mobile number.'), { statusCode: 400 });
    }
    const oldMobile = this.store.admin.mobile;
    this.store.admin.mobile = mobile;
    if (input.displayName?.trim()) {
      this.store.admin.displayName = input.displayName.trim().slice(0, 80);
    }
    this.store.admin.updatedAt = new Date().toISOString();
    this.persist();
    this.recordLoginActivity({
      mobile,
      action: 'mobile_changed',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: `Registered mobile updated from ***${oldMobile.slice(-4)} to ***${mobile.slice(-4)}.`,
    });
    return this.getAdminProfile();
  }

  // Real SMS OTP Reset (NEVER generates/returns fake OTPs)
  private async sendRealSmsOtp(mobile: string, otp: string): Promise<void> {
    const apiKey = (process.env.SMS_API_KEY || '').trim();
    if (!apiKey) {
      throw Object.assign(
        new Error(
          'Real SMS OTP delivery requires configuring SMS_API_KEY (and optional SMS_PROVIDER_URL / SMS_SENDER_ID) in server environment secrets. No simulated OTPs are issued.'
        ),
        { statusCode: 503 }
      );
    }

    const customUrl = (process.env.SMS_PROVIDER_URL || '').trim();
    const senderId = (process.env.SMS_SENDER_ID || 'GYANADDA').trim();
    const message = `GYAN ADDA LIBRARY Admin password reset OTP is ${otp}. Valid for 5 minutes. Do not share with anyone.`;

    const targetUrl = customUrl || 'https://www.fast2sms.com/dev/bulkV2';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: apiKey,
      'x-api-key': apiKey,
    };

    const body = customUrl
      ? JSON.stringify({
          to: mobile.length === 10 ? `+91${mobile}` : `+${mobile}`,
          senderId,
          templateId: (process.env.SMS_TEMPLATE_ID || '').trim() || undefined,
          otp,
          message,
        })
      : JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: mobile.slice(-10),
        });

    const smsRes = await fetch(targetUrl, { method: 'POST', headers, body });
    if (!smsRes.ok) {
      const errTxt = await smsRes.text().catch(() => '');
      throw Object.assign(
        new Error(`SMS gateway rejected OTP dispatch (${smsRes.status}): ${errTxt.slice(0, 140)}`),
        { statusCode: 502 }
      );
    }
  }

  public async requestPasswordResetOtp(input: { mobile: string; ip?: string; userAgent?: string }) {
    const smsKey = (process.env.SMS_API_KEY || '').trim();
    if (!smsKey) {
      throw Object.assign(
        new Error(
          'SMS OTP gateway is not configured on the server (SMS_API_KEY missing). Configure SMS_API_KEY in server secrets or sign in with your verified Google Owner Admin account to reset credentials.'
        ),
        { statusCode: 503 }
      );
    }
    const mobile = normalizeMobileNumber(input.mobile);
    if (!isValidIndianOrIntlMobile(mobile)) {
      throw Object.assign(new Error('Enter a valid registered mobile number.'), { statusCode: 400 });
    }

    const existingOtp = this.activeOtps.get(mobile);
    const now = Date.now();
    if (existingOtp && now - existingOtp.lastSentAtMs < 60_000) {
      const waitSec = Math.ceil((60_000 - (now - existingOtp.lastSentAtMs)) / 1000);
      throw Object.assign(
        new Error(`Please wait ${waitSec}s before requesting another OTP.`),
        { statusCode: 429 }
      );
    }

    // Generic response if mobile doesn't match configured admin (prevents account enumeration)
    if (!this.store.admin || mobile !== this.store.admin.mobile) {
      return {
        sent: true,
        message: 'If this mobile number is registered as Admin, an OTP has been dispatched via SMS.',
      };
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(8).toString('hex');
    const otpHash = crypto.createHash('sha256').update(`${salt}:${otp}`).digest('hex');

    await this.sendRealSmsOtp(mobile, otp);

    this.activeOtps.set(mobile, {
      mobile,
      otpHash,
      salt,
      expiresAtMs: now + 5 * 60_000,
      lastSentAtMs: now,
      failedAttempts: 0,
    });

    this.recordLoginActivity({
      mobile,
      action: 'otp_requested',
      status: 'info',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Password reset SMS OTP sent.',
    });

    return {
      sent: true,
      message: 'If this mobile number is registered as Admin, an OTP has been dispatched via SMS.',
      expiresInSeconds: 300,
    };
  }

  public verifyResetOtp(input: { mobile: string; otp: string }) {
    const mobile = normalizeMobileNumber(input.mobile);
    const entry = this.activeOtps.get(mobile);
    const now = Date.now();
    if (!entry || entry.expiresAtMs < now) {
      throw Object.assign(new Error('OTP expired or not requested. Please request a new OTP.'), {
        statusCode: 400,
      });
    }
    if (entry.failedAttempts >= 5) {
      this.activeOtps.delete(mobile);
      throw Object.assign(new Error('Too many failed OTP attempts. Please request a new OTP.'), {
        statusCode: 429,
      });
    }
    const candidateHash = crypto
      .createHash('sha256')
      .update(`${entry.salt}:${String(input.otp || '').trim()}`)
      .digest('hex');
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(entry.otpHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      entry.failedAttempts += 1;
      throw Object.assign(
        new Error(`Invalid OTP (${5 - entry.failedAttempts} attempt(s) remaining).`),
        { statusCode: 400 }
      );
    }

    const resetToken = crypto.randomBytes(24).toString('hex');
    entry.verifiedTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    entry.verifiedExpiresAtMs = now + 10 * 60_000;
    return { verified: true, resetToken };
  }

  public resetPasswordWithOtp(input: {
    mobile: string;
    resetToken: string;
    newPassword: string;
    ip?: string;
    userAgent?: string;
  }) {
    const mobile = normalizeMobileNumber(input.mobile);
    const entry = this.activeOtps.get(mobile);
    const now = Date.now();
    if (!entry || !entry.verifiedTokenHash || (entry.verifiedExpiresAtMs || 0) < now) {
      throw Object.assign(new Error('OTP verification expired. Please restart password recovery.'), {
        statusCode: 400,
      });
    }
    const tokenHash = crypto
      .createHash('sha256')
      .update(String(input.resetToken || ''))
      .digest('hex');
    const a = Buffer.from(tokenHash, 'hex');
    const b = Buffer.from(entry.verifiedTokenHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw Object.assign(new Error('Invalid reset verification token.'), { statusCode: 401 });
    }

    const pwdErr = validatePasswordStrength(input.newPassword);
    if (pwdErr) throw Object.assign(new Error(pwdErr), { statusCode: 400 });
    if (!this.store.admin || this.store.admin.mobile !== mobile) {
      throw Object.assign(new Error('Admin record not found.'), { statusCode: 404 });
    }

    this.store.admin.passwordHash = hashPasswordScrypt(input.newPassword);
    this.store.admin.updatedAt = new Date().toISOString();
    this.activeOtps.delete(mobile);
    this.persist();
    this.recordLoginActivity({
      mobile,
      action: 'password_reset_otp',
      status: 'success',
      ip: input.ip || 'unknown',
      userAgent: input.userAgent || 'unknown',
      details: 'Password reset completed via SMS OTP verification.',
    });
    return { reset: true };
  }

  // =========================================================================
  // PUBLIC WEBSITE CONTENT (STRICTLY NO PRIVATE STUDENT / SEAT / FEE LEAKAGE)
  // =========================================================================
  public getSanitizedPublicInfo() {
    const s = this.store.settings;
    const facilityItems = (s.facilityItems || DEFAULT_FACILITY_ITEMS).filter((f) => f.available);
    const publishedFaqs = this.store.faqs
      .filter((f) => f.published && f.section === 'faq')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const publishedImportant = this.store.faqs
      .filter((f) => f.published && f.section === 'important')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const approvedGallery = this.store.gallery
      .filter((g) => g.approved !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    return {
      settings: {
        libraryName: s.libraryName || 'GYAN ADDA LIBRARY',
        tagline: s.tagline,
        address: s.address,
        nearbyLandmarks: s.nearbyLandmarks || 'In front of Poor Home Road, near Mirzapur Chowk & Darbhanga Junction',
        phone: s.phone,
        whatsapp: s.whatsapp,
        email: s.email,
        openingHours: s.openingHours,
        is24HourAccess: s.is24HourAccess,
        mapLat: s.mapLat,
        mapLng: s.mapLng,
        mapUrl: s.mapUrl,
        ratingText: s.ratingText,
        facilities: facilityItems.map((f) => f.name),
        facilityItems,
        termsText: s.termsText,
        privacyText: s.privacyText,
      },
      faqs: publishedFaqs,
      importantQuestions: publishedImportant,
      gallery: approvedGallery,
    };
  }

  public getAdminPublicContent() {
    return {
      settings: this.store.settings,
      faqs: [...this.store.faqs].sort((a, b) => a.sortOrder - b.sortOrder),
      gallery: [...this.store.gallery].sort((a, b) => a.sortOrder - b.sortOrder),
      enquiries: [...this.store.enquiries],
    };
  }

  public updatePublicSettings(patch: Partial<LibrarySettings>) {
    const cur = this.store.settings;
    const facilityItems = Array.isArray(patch.facilityItems)
      ? patch.facilityItems.map((f, idx) => ({
          id: String(f.id || `fac_${idx}_${Date.now()}`),
          name: String(f.name || '').trim().slice(0, 120),
          description: String(f.description || '').trim().slice(0, 300),
          icon: String(f.icon || 'Sparkles').trim().slice(0, 40),
          imageUrl: f.imageUrl ? String(f.imageUrl).trim().slice(0, 1000) : undefined,
          available: f.available !== false,
        })).filter((f) => f.name)
      : cur.facilityItems || DEFAULT_FACILITY_ITEMS;

    const facilitiesStrings = Array.isArray(patch.facilities)
      ? patch.facilities.map((x) => String(x || '').trim()).filter(Boolean)
      : facilityItems.filter((f) => f.available).map((f) => f.name);

    this.store.settings = {
      ...cur,
      libraryName: String(patch.libraryName ?? cur.libraryName).trim() || 'GYAN ADDA LIBRARY',
      tagline: String(patch.tagline ?? cur.tagline).trim(),
      address: String(patch.address ?? cur.address).trim(),
      nearbyLandmarks: String(patch.nearbyLandmarks ?? cur.nearbyLandmarks ?? '').trim(),
      phone: String(patch.phone ?? cur.phone).trim(),
      whatsapp: String(patch.whatsapp ?? cur.whatsapp).trim(),
      email: String(patch.email ?? cur.email).trim(),
      openingHours: String(patch.openingHours ?? cur.openingHours).trim(),
      is24HourAccess:
        typeof patch.is24HourAccess === 'boolean' ? patch.is24HourAccess : cur.is24HourAccess,
      mapLat: Number.isFinite(Number(patch.mapLat)) ? Number(patch.mapLat) : cur.mapLat,
      mapLng: Number.isFinite(Number(patch.mapLng)) ? Number(patch.mapLng) : cur.mapLng,
      mapUrl: String(patch.mapUrl ?? cur.mapUrl ?? '').trim(),
      ratingText: String(patch.ratingText ?? cur.ratingText ?? '').trim(),
      facilities: facilitiesStrings,
      facilityItems,
      termsText: String(patch.termsText ?? cur.termsText ?? '').trim(),
      privacyText: String(patch.privacyText ?? cur.privacyText ?? '').trim(),
      updatedAt: new Date().toISOString(),
    };
    this.persist();
    return this.store.settings;
  }

  public upsertFaq(input: Partial<FaqItem>) {
    const now = new Date().toISOString();
    const id = String(input.id || `faq_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`);
    const existingIdx = this.store.faqs.findIndex((f) => f.id === id);
    const question = String(input.question || '').trim();
    const answer = String(input.answer || '').trim();
    if (!question || !answer) {
      throw Object.assign(new Error('Question and answer text are required.'), { statusCode: 400 });
    }
    const item: FaqItem = {
      id,
      section: input.section === 'important' ? 'important' : 'faq',
      category: String(input.category || 'General').trim().slice(0, 60),
      question: question.slice(0, 300),
      answer: answer.slice(0, 2000),
      sortOrder: Number.isFinite(Number(input.sortOrder))
        ? Number(input.sortOrder)
        : existingIdx >= 0
          ? this.store.faqs[existingIdx].sortOrder
          : this.store.faqs.length + 1,
      published: input.published !== false,
      createdAt: existingIdx >= 0 ? this.store.faqs[existingIdx].createdAt : now,
      updatedAt: now,
    };
    if (existingIdx >= 0) this.store.faqs[existingIdx] = item;
    else this.store.faqs.push(item);
    this.persist();
    return item;
  }

  public deleteFaq(id: string) {
    this.store.faqs = this.store.faqs.filter((f) => f.id !== id);
    this.persist();
  }

  public upsertGalleryItem(input: Partial<GalleryItem>) {
    const now = new Date().toISOString();
    const id = String(input.id || `gal_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`);
    const idx = this.store.gallery.findIndex((g) => g.id === id);
    const title = String(input.title || '').trim();
    const imageUrl = String(input.imageUrl || '').trim();
    if (!title || !imageUrl) {
      throw Object.assign(new Error('Photo title and image URL are required.'), { statusCode: 400 });
    }
    const item: GalleryItem = {
      id,
      title: title.slice(0, 120),
      category: String(input.category || 'Campus').trim().slice(0, 60),
      imageUrl: imageUrl.slice(0, 1000),
      caption: String(input.caption || '').trim().slice(0, 300),
      sortOrder: Number.isFinite(Number(input.sortOrder))
        ? Number(input.sortOrder)
        : idx >= 0
          ? this.store.gallery[idx].sortOrder
          : this.store.gallery.length + 1,
      approved: input.approved !== false,
      createdAt: idx >= 0 ? this.store.gallery[idx].createdAt : now,
    };
    if (idx >= 0) this.store.gallery[idx] = item;
    else this.store.gallery.push(item);
    this.persist();
    return item;
  }

  public deleteGalleryItem(id: string) {
    this.store.gallery = this.store.gallery.filter((g) => g.id !== id);
    this.persist();
  }

  public submitPublicEnquiry(input: {
    name: string;
    email?: string;
    phone: string;
    subject: string;
    message: string;
  }) {
    const now = new Date().toISOString();
    const name = String(input.name || '').trim();
    const phone = String(input.phone || '').trim();
    const message = String(input.message || '').trim();
    if (!name || !phone || !message) {
      throw Object.assign(new Error('Name, phone number, and message are required.'), {
        statusCode: 400,
      });
    }
    const enq: EnquiryRecord = {
      id: `enq_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      name: name.slice(0, 120),
      email: String(input.email || 'visitor@gyanaddalibrary.in').trim().slice(0, 200),
      phone: phone.slice(0, 20),
      subject: String(input.subject || 'Admission Enquiry').trim().slice(0, 150),
      message: message.slice(0, 1000),
      status: 'new',
      createdAt: now,
      updatedAt: now,
    };
    this.store.enquiries.unshift(enq);
    this.persist();
    return enq;
  }

  public updateEnquiryStatus(id: string, status: 'new' | 'contacted' | 'resolved') {
    const enq = this.store.enquiries.find((e) => e.id === id);
    if (!enq) throw Object.assign(new Error('Enquiry not found.'), { statusCode: 404 });
    enq.status = status;
    enq.updatedAt = new Date().toISOString();
    this.persist();
    return enq;
  }

  // =========================================================================
  // SHIFT MANAGEMENT & STUDENT SHIFT ASSIGNMENTS
  // =========================================================================
  public listShifts() {
    return {
      shifts: this.store.shifts,
      assignments: this.store.studentShiftAssignments,
    };
  }

  public upsertShift(input: Partial<LibraryShift>) {
    const now = new Date().toISOString();
    const name = String(input.name || '').trim();
    const startTime = String(input.startTime || '').trim();
    const endTime = String(input.endTime || '').trim();
    if (!name || !startTime || !endTime) {
      throw Object.assign(new Error('Shift name, start time, and end time are required.'), {
        statusCode: 400,
      });
    }
    const id = String(input.id || `shift_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`);
    const idx = this.store.shifts.findIndex((s) => s.id === id);
    const shift: LibraryShift = {
      id,
      name: name.slice(0, 80),
      startTime: startTime.slice(0, 20),
      endTime: endTime.slice(0, 20),
      description: String(input.description || '').trim().slice(0, 240),
      active: input.active !== false,
      createdAt: idx >= 0 ? this.store.shifts[idx].createdAt : now,
      updatedAt: now,
    };
    if (idx >= 0) this.store.shifts[idx] = shift;
    else this.store.shifts.push(shift);

    // Propagate updated shift name/timing to assigned students
    for (const key of Object.keys(this.store.studentShiftAssignments)) {
      if (this.store.studentShiftAssignments[key].shiftId === shift.id) {
        this.store.studentShiftAssignments[key].shiftName = shift.name;
        this.store.studentShiftAssignments[key].shiftTiming = `${shift.startTime} – ${shift.endTime}`;
      }
    }
    this.persist();
    return shift;
  }

  public deleteShift(id: string) {
    this.store.shifts = this.store.shifts.filter((s) => s.id !== id);
    this.persist();
  }

  public assignStudentShift(input: {
    studentDocId: string;
    studentCode: string;
    studentName: string;
    mobile?: string;
    seatCode?: string;
    shiftId: string;
  }) {
    const shift = this.store.shifts.find((s) => s.id === input.shiftId);
    if (!shift) {
      throw Object.assign(new Error('Selected shift does not exist.'), { statusCode: 404 });
    }
    const timing = `${shift.startTime} – ${shift.endTime}`;
    const assignment = {
      studentDocId: input.studentDocId,
      studentCode: input.studentCode,
      studentName: input.studentName,
      mobile: input.mobile,
      seatCode: input.seatCode,
      shiftId: shift.id,
      shiftName: shift.name,
      shiftTiming: timing,
      updatedAt: new Date().toISOString(),
    };
    this.store.studentShiftAssignments[input.studentDocId] = assignment;
    const dirStudent = this.store.studentsDirectory.find((s) => s.id === input.studentDocId);
    if (dirStudent) {
      dirStudent.shiftId = shift.id;
      dirStudent.shiftName = shift.name;
      dirStudent.shiftTiming = timing;
    }
    this.persist();
    return assignment;
  }

  public syncStudentsDirectory(
    students: Array<{
      id: string;
      uid: string;
      studentCode: string;
      fullName: string;
      mobile: string;
      email?: string;
      seatCode?: string;
      shiftId?: string;
      shiftName?: string;
      shiftTiming?: string;
      membershipPlanName?: string;
      membershipStatus?: string;
      status: string;
    }>
  ) {
    const defaultShift = this.store.shifts[3] || this.store.shifts[0];
    this.store.studentsDirectory = students.map((st) => {
      const existingAssign = this.store.studentShiftAssignments[st.id];
      const resolvedShiftId = st.shiftId || existingAssign?.shiftId || defaultShift?.id || 'shift_fullday';
      const resolvedShift = this.store.shifts.find((s) => s.id === resolvedShiftId) || defaultShift;
      const shiftName = st.shiftName || existingAssign?.shiftName || resolvedShift?.name || 'Full Day';
      const shiftTiming =
        st.shiftTiming ||
        existingAssign?.shiftTiming ||
        (resolvedShift ? `${resolvedShift.startTime} – ${resolvedShift.endTime}` : '06:00 – 22:00');
      if (!existingAssign && st.id) {
        this.store.studentShiftAssignments[st.id] = {
          studentDocId: st.id,
          studentCode: st.studentCode,
          studentName: st.fullName,
          mobile: st.mobile,
          seatCode: st.seatCode,
          shiftId: resolvedShiftId,
          shiftName,
          shiftTiming,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...st,
        shiftId: resolvedShiftId,
        shiftName,
        shiftTiming,
      };
    });
    this.persist();
    return this.store.studentsDirectory;
  }

  // =========================================================================
  // ATTENDANCE MANAGEMENT (TAMPER-PROOF SERVER IST CLOCK + 1 RECORD PER DAY)
  // =========================================================================
  public getAttendanceDashboard(params?: { date?: string; shiftId?: string; status?: string }) {
    const ist = getIstNow();
    const targetDate = params?.date || ist.date;

    const students = this.store.studentsDirectory.map((st) => {
      const assign = this.store.studentShiftAssignments[st.id];
      return {
        ...st,
        shiftId: assign?.shiftId || st.shiftId || 'shift_fullday',
        shiftName: assign?.shiftName || st.shiftName || 'Full Day',
        shiftTiming: assign?.shiftTiming || st.shiftTiming || '06:00 – 22:00',
      };
    });

    const dateRecords = this.store.attendance.filter((r) => r.date === targetDate);
    const presentCount = dateRecords.filter((r) => (r.status || 'PRESENT') === 'PRESENT').length;
    const leaveCount = dateRecords.filter((r) => r.status === 'LEAVE').length;
    const absentCount = dateRecords.filter((r) => r.status === 'ABSENT').length;

    const shiftSummary = this.store.shifts.map((shift) => {
      const assignedInShift = students.filter((s) => s.shiftId === shift.id);
      const recsInShift = dateRecords.filter(
        (r) =>
          r.shiftId === shift.id ||
          assignedInShift.some((st) => st.id === r.studentDocId)
      );
      return {
        shiftId: shift.id,
        shiftName: shift.name,
        timing: `${shift.startTime} – ${shift.endTime}`,
        totalStudents: assignedInShift.length,
        present: recsInShift.filter((r) => (r.status || 'PRESENT') === 'PRESENT').length,
        leave: recsInShift.filter((r) => r.status === 'LEAVE').length,
        absent: recsInShift.filter((r) => r.status === 'ABSENT').length,
      };
    });

    let filtered = [...this.store.attendance];
    if (params?.date) {
      filtered = filtered.filter((r) => r.date === params.date);
    }
    if (params?.shiftId && params.shiftId !== 'ALL') {
      filtered = filtered.filter((r) => r.shiftId === params.shiftId);
    }
    if (params?.status && params.status !== 'ALL') {
      filtered = filtered.filter((r) => (r.status || 'PRESENT') === params.status);
    }

    filtered.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return String(b.checkInTime || '').localeCompare(String(a.checkInTime || ''));
    });

    return {
      serverIst: ist,
      targetDate,
      kpis: {
        totalRegistered: students.length,
        presentToday: presentCount,
        onLeaveToday: leaveCount,
        absentToday: absentCount,
        unmarkedToday: Math.max(0, students.length - dateRecords.length),
      },
      shiftSummary,
      shifts: this.store.shifts,
      students,
      customStatuses: this.store.customAttendanceStatuses,
      records: filtered,
      allDateRecords: dateRecords,
      auditLogs: this.store.attendanceAuditLogs.slice(0, 120),
    };
  }

  public markPresentOneClick(input: {
    studentDocId: string;
    studentUid?: string;
    studentCode: string;
    studentName: string;
    shiftId?: string;
    shiftName?: string;
    actorId: string;
    actorLabel: string;
  }) {
    // Strictly capture server IST clock — client cannot supply or override timestamp
    const ist = getIstNow();
    const recordId = `${input.studentDocId}_${ist.date}`;
    const existingIdx = this.store.attendance.findIndex(
      (r) => r.id === recordId || (r.studentDocId === input.studentDocId && r.date === ist.date)
    );
    if (existingIdx >= 0) {
      const existing = this.store.attendance[existingIdx];
      throw Object.assign(
        new Error(
          `Attendance already recorded today (${ist.date}) for ${input.studentName} as ${
            existing.status || 'PRESENT'
          } at ${existing.recordedAtIst || existing.checkInTime}. Use Correction if an authorized edit is needed.`
        ),
        { statusCode: 409 }
      );
    }

    const assign = this.store.studentShiftAssignments[input.studentDocId];
    const resolvedShiftId = input.shiftId || assign?.shiftId || 'shift_fullday';
    const resolvedShift = this.store.shifts.find((s) => s.id === resolvedShiftId);
    const resolvedShiftName = input.shiftName || assign?.shiftName || resolvedShift?.name || 'Full Day';

    let isLate = false;
    if (resolvedShift && /^\d{2}:\d{2}$/.test(resolvedShift.startTime)) {
      const [sh, sm] = resolvedShift.startTime.split(':').map(Number);
      const [nh, nm] = ist.timeShort.split(':').map(Number);
      const diffMins = nh * 60 + nm - (sh * 60 + sm);
      if (diffMins > 20 && diffMins < 360) isLate = true;
    }

    const record: AttendanceRecord = {
      id: recordId,
      studentDocId: input.studentDocId,
      studentUid: input.studentUid || input.studentDocId,
      studentCode: input.studentCode,
      studentName: input.studentName,
      date: ist.date,
      checkInTime: ist.timeShort,
      recordedAtIst: ist.time12,
      recordedByLabel: input.actorLabel,
      durationMinutes: 0,
      method: 'manual',
      isLate,
      markedBy: input.actorId,
      status: 'PRESENT',
      shiftId: resolvedShiftId,
      shiftName: resolvedShiftName,
      isDemo: false,
      createdAt: ist.iso,
      updatedAt: ist.iso,
    };

    this.store.attendance.unshift(record);
    this.store.attendanceAuditLogs.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      attendanceId: record.id,
      studentDocId: record.studentDocId,
      studentCode: record.studentCode,
      studentName: record.studentName,
      date: ist.date,
      previousStatus: 'UNMARKED',
      newStatus: 'PRESENT',
      newTimeIst: ist.time12,
      reason: 'One-click Present button (server Asia/Kolkata clock)',
      editedBy: input.actorLabel,
      editedAtIst: `${ist.date} ${ist.time12} IST`,
    });
    this.persist();
    return record;
  }

  public markAttendanceStatus(input: {
    studentDocId: string;
    studentUid?: string;
    studentCode: string;
    studentName: string;
    date?: string;
    status: AttendanceStatusCode;
    customStatusLabel?: string;
    leaveType?: string;
    leaveReason?: string;
    remarks?: string;
    entryDate?: string;
    shiftId?: string;
    actorId: string;
    actorLabel: string;
  }) {
    const ist = getIstNow();
    const targetDate =
      input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : ist.date;
    const recordId = `${input.studentDocId}_${targetDate}`;
    const existingIdx = this.store.attendance.findIndex(
      (r) => r.id === recordId || (r.studentDocId === input.studentDocId && r.date === targetDate)
    );
    if (existingIdx >= 0) {
      throw Object.assign(
        new Error(
          `Only 1 attendance record per student per day is allowed (${targetDate}). Use the authorized Edit/Correction control to modify existing status.`
        ),
        { statusCode: 409 }
      );
    }

    const assign = this.store.studentShiftAssignments[input.studentDocId];
    const resolvedShiftId = input.shiftId || assign?.shiftId || 'shift_fullday';
    const resolvedShift = this.store.shifts.find((s) => s.id === resolvedShiftId);

    const record: AttendanceRecord = {
      id: recordId,
      studentDocId: input.studentDocId,
      studentUid: input.studentUid || input.studentDocId,
      studentCode: input.studentCode,
      studentName: input.studentName,
      date: targetDate,
      checkInTime: input.status === 'PRESENT' || input.status === 'HALF_DAY' ? ist.timeShort : '00:00',
      recordedAtIst: ist.time12,
      recordedByLabel: input.actorLabel,
      durationMinutes: 0,
      method: 'manual',
      isLate: false,
      markedBy: input.actorId,
      status: input.status,
      customStatusLabel: input.customStatusLabel?.trim().slice(0, 60),
      leaveType: input.leaveType?.trim().slice(0, 80),
      leaveReason: input.leaveReason?.trim().slice(0, 300),
      remarks: input.remarks?.trim().slice(0, 300),
      entryDate: input.entryDate?.trim().slice(0, 20) || targetDate,
      shiftId: resolvedShiftId,
      shiftName: assign?.shiftName || resolvedShift?.name || 'Full Day',
      isDemo: false,
      createdAt: ist.iso,
      updatedAt: ist.iso,
    };

    this.store.attendance.unshift(record);
    this.store.attendanceAuditLogs.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      attendanceId: record.id,
      studentDocId: record.studentDocId,
      studentCode: record.studentCode,
      studentName: record.studentName,
      date: targetDate,
      previousStatus: 'UNMARKED',
      newStatus: input.customStatusLabel ? `${input.status} (${input.customStatusLabel})` : input.status,
      newTimeIst: ist.time12,
      reason: input.leaveReason || input.remarks || `Marked ${input.status}`,
      editedBy: input.actorLabel,
      editedAtIst: `${ist.date} ${ist.time12} IST`,
    });
    this.persist();
    return record;
  }

  public correctAttendanceRecord(input: {
    attendanceId: string;
    status: AttendanceStatusCode;
    customStatusLabel?: string;
    leaveType?: string;
    leaveReason?: string;
    remarks?: string;
    correctionReason: string;
    actorId: string;
    actorLabel: string;
  }) {
    const rec = this.store.attendance.find((r) => r.id === input.attendanceId);
    if (!rec) {
      throw Object.assign(new Error('Attendance record not found.'), { statusCode: 404 });
    }
    const reason = String(input.correctionReason || '').trim();
    if (!reason) {
      throw Object.assign(new Error('An audit reason is required to modify an existing attendance record.'), {
        statusCode: 400,
      });
    }
    const ist = getIstNow();
    const prevStatus = rec.status || 'PRESENT';
    const prevTime = rec.recordedAtIst || rec.checkInTime;

    rec.status = input.status;
    rec.customStatusLabel = input.customStatusLabel?.trim().slice(0, 60);
    rec.leaveType = input.leaveType?.trim().slice(0, 80);
    rec.leaveReason = input.leaveReason?.trim().slice(0, 300);
    rec.remarks = input.remarks?.trim().slice(0, 300);
    rec.updatedAt = ist.iso;
    if (input.status === 'PRESENT' && (!rec.recordedAtIst || rec.checkInTime === '00:00')) {
      rec.checkInTime = ist.timeShort;
      rec.recordedAtIst = ist.time12;
    }

    this.store.attendanceAuditLogs.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      attendanceId: rec.id,
      studentDocId: rec.studentDocId,
      studentCode: rec.studentCode,
      studentName: rec.studentName,
      date: rec.date,
      previousStatus: prevStatus,
      newStatus: input.customStatusLabel ? `${input.status} (${input.customStatusLabel})` : input.status,
      previousTimeIst: prevTime,
      newTimeIst: rec.recordedAtIst || ist.time12,
      reason: reason.slice(0, 300),
      editedBy: input.actorLabel,
      editedAtIst: `${ist.date} ${ist.time12} IST`,
    });
    if (this.store.attendanceAuditLogs.length > 500) {
      this.store.attendanceAuditLogs = this.store.attendanceAuditLogs.slice(0, 500);
    }
    this.persist();
    return rec;
  }

  public createCustomAttendanceStatus(input: { label: string; color?: string }) {
    const label = String(input.label || '').trim().slice(0, 50);
    if (!label) {
      throw Object.assign(new Error('Status label is required.'), { statusCode: 400 });
    }
    const status: CustomAttendanceStatus = {
      id: `cstat_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      label,
      color: input.color || 'slate',
      createdAt: new Date().toISOString(),
    };
    this.store.customAttendanceStatuses.push(status);
    this.persist();
    return status;
  }
}
