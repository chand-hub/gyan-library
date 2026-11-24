export type UserRole = 'student' | 'staff' | 'manager' | 'admin';

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  studentDocId?: string;
  staffDocId?: string;
  status: 'active' | 'inactive' | 'blocked';
  createdAt: any;
  updatedAt: any;
}

export interface StudentRecord {
  id: string;
  uid: string;
  studentCode: string; // e.g., VL2026001
  fullName: string;
  mobile: string;
  email: string;
  fatherName: string;
  address: string;
  emergencyContact: string;
  profilePhotoUrl?: string;
  idDocumentUrl?: string;
  seatId?: string;
  seatCode?: string;
  membershipId?: string;
  membershipPlanName?: string;
  membershipStatus: 'active' | 'expired' | 'pending' | 'none';
  membershipExpiry?: string;
  status: 'active' | 'inactive' | 'blocked';
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface StaffRecord {
  id: string;
  uid?: string;
  staffCode: string;
  fullName: string;
  email: string;
  mobile: string;
  role: 'staff' | 'manager';
  permissions: string[];
  shift: string;
  monthlySalary: number;
  status: 'active' | 'inactive';
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface MembershipPlan {
  id: string;
  name: string;
  durationDays: number;
  price: number;
  timings: string;
  seatAccess: string;
  facilities: string[];
  terms: string;
  active: boolean;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface MembershipRecord {
  id: string;
  studentDocId: string;
  studentUid: string;
  studentCode: string;
  studentName: string;
  planId: string;
  planName: string;
  amount: number;
  startDate: string;
  expiryDate: string;
  status: 'active' | 'expired' | 'pending' | 'cancelled';
  paymentId?: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export type SeatStatus = 'available' | 'occupied' | 'reserved' | 'maintenance';

export interface SeatRecord {
  id: string;
  seatCode: string;
  zone: string;
  rowLabel: string;
  colIndex: number;
  status: SeatStatus;
  assignedStudentDocId?: string;
  assignedStudentUid?: string;
  assignedStudentCode?: string;
  shift?: string;
  isDemo: boolean;
  updatedAt: any;
}

export interface SeatBookingRecord {
  id: string;
  seatId: string;
  seatCode: string;
  studentDocId: string;
  studentUid: string;
  studentCode: string;
  studentName: string;
  bookingType: 'new' | 'change';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'released';
  notes?: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface AttendanceRecord {
  id: string;
  studentDocId: string;
  studentUid: string;
  studentCode: string;
  studentName: string;
  date: string; // YYYY-MM-DD
  checkInTime: string;
  checkOutTime?: string;
  durationMinutes: number;
  method: 'qr' | 'manual' | 'id';
  isLate: boolean;
  markedBy?: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface BookCategory {
  id: string;
  name: string;
  description?: string;
  shelfRange: string;
  createdAt: any;
}

export interface BookRecord {
  id: string;
  title: string;
  author: string;
  publisher?: string;
  isbn: string;
  categoryId?: string;
  categoryName: string;
  totalCopies: number;
  availableCopies: number;
  shelfNumber: string;
  publicationYear: number;
  coverUrl?: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface BookIssueRecord {
  id: string;
  bookId: string;
  bookTitle: string;
  studentDocId: string;
  studentUid: string;
  studentCode: string;
  studentName: string;
  issueDate?: string;
  dueDate?: string;
  returnDate?: string;
  fineAmount: number;
  status: 'requested' | 'issued' | 'returned' | 'overdue' | 'rejected';
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface PaymentRecord {
  id: string;
  receiptNumber: string;
  studentDocId: string;
  studentUid: string;
  studentCode: string;
  studentName: string;
  planId?: string;
  planName: string;
  amount: number;
  method: 'razorpay_upi' | 'razorpay_card' | 'razorpay_netbanking' | 'cash' | 'upi_offline';
  status: 'verified' | 'pending' | 'failed' | 'refunded';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  notes?: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface ExpenseRecord {
  id: string;
  title: string;
  category: 'electricity' | 'rent' | 'internet' | 'salary' | 'maintenance' | 'furniture' | 'other';
  amount: number;
  expenseDate: string;
  notes?: string;
  recordedBy: string;
  isDemo: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface NotificationRecord {
  id: string;
  recipientUid: string;
  type:
    | 'membership_expiry'
    | 'payment_confirmation'
    | 'payment_pending'
    | 'seat_allocation'
    | 'seat_change'
    | 'attendance_confirmation'
    | 'book_return'
    | 'announcement';
  title: string;
  message: string;
  read: boolean;
  channel: 'in_app' | 'whatsapp' | 'email' | 'sms';
  createdAt: any;
}

export interface EnquiryRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  status: 'new' | 'contacted' | 'resolved';
  createdAt: any;
  updatedAt: any;
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important';
  published: boolean;
  createdAt: any;
}

export interface GalleryItem {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
  caption: string;
  sortOrder: number;
  createdAt: any;
}

export interface LibrarySettings {
  id?: string;
  libraryName: string;
  tagline: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  openingHours: string;
  is24HourAccess: boolean;
  mapLat: number;
  mapLng: number;
  mapUrl?: string;
  ratingText?: string;
  facilities: string[];
  termsText?: string;
  privacyText?: string;
  razorpayEnabled?: boolean;
  whatsappConfigured?: boolean;
  emailConfigured?: boolean;
  smsConfigured?: boolean;
  updatedAt: any;
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  createdAt: any;
}

// =========================================================================
// AI-POWERED COMPETITIVE EXAMINATION & LEARNING MANAGEMENT TYPES
// =========================================================================

export interface ExamCategory {
  id: string;
  name: string;
  categoryGroup: string; // Medical, Engineering, Civil Services, SSC, Railway, State Police, Banking, Other
  code: string;
  defaultDurationMinutes: number;
  marksPerCorrect: number;
  negativeMarks: number;
  description: string;
  active: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface ExamSubject {
  id: string;
  examName: string;
  name: string;
  active: boolean;
  createdAt: any;
}

export interface ExamChapter {
  id: string;
  examName: string;
  subjectName: string;
  name: string;
  topics: string[];
  active: boolean;
  createdAt: any;
}

export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuestionSourceType = 'pyq' | 'ai_generated' | 'manual' | 'current_affairs' | 'gk_book';
export type QuestionVerificationStatus = 'verified' | 'ai_derived' | 'needs_review';

export interface ExamQuestion {
  id: string;
  questionCode: string; // e.g., Q-UPSC-2024-001
  examName: string;
  examCategory: string;
  subject: string;
  chapter: string;
  topic: string;
  questionText: string;
  options: [string, string, string, string];
  difficulty: QuestionDifficulty;
  examYear: number;
  examShift?: string;
  source: QuestionSourceType;
  sourceDocumentId?: string;
  language: 'en' | 'hi' | 'bilingual';
  verificationStatus: QuestionVerificationStatus;
  published?: boolean;
  usageCount?: number;
  hasDiagramOrTable?: boolean;
  diagramDescription?: string;
  fingerprint: string;
  normalizedText: string;
  answerSeal: string; // AES-256-GCM encrypted { correctIndex, explanation } sealed server-side
  createdAt: any;
  updatedAt: any;
}

export interface QuestionKeyRecord {
  id: string;
  questionId: string;
  correctIndex: number;
  explanation: string;
  derivedBy: 'official_key' | 'ai_derived' | 'admin_manual';
  updatedAt: any;
}

export interface UploadedDocumentRecord {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  totalPages: number;
  storageUrl?: string;
  examName: string;
  examYear: number;
  subject: string;
  shift?: string;
  uploadedByUid: string;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  createdAt: any;
}

export interface ImportJobRecord {
  id: string;
  documentId: string;
  fileName: string;
  examName: string;
  examYear: number;
  subject: string;
  shift?: string;
  totalPages: number;
  pagesProcessed: number;
  failedPageRanges: string[];
  extractedCount: number;
  importedCount: number;
  duplicateCount: number;
  reviewCount: number;
  errorMessages: string[];
  status: 'uploading' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
  createdByUid: string;
  createdAt: any;
  updatedAt: any;
}

export type TestType =
  | 'pyq'
  | 'ai_mock'
  | 'subject'
  | 'chapter'
  | 'topic'
  | 'current_affairs'
  | 'full_length';

export interface MockTestRecord {
  id: string;
  title: string;
  examName: string;
  testType: TestType;
  subject?: string;
  chapter?: string;
  topic?: string;
  difficulty: QuestionDifficulty | 'mixed';
  questionIds: string[];
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarks: number;
  isTimed: boolean;
  active: boolean;
  createdByUid: string;
  createdAt: any;
}

export interface BreakdownMetric {
  name: string;
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
  avgTimeSeconds: number;
}

export interface RevealedAnswerKey {
  correctIndex: number;
  explanation: string;
}

export interface TestAttemptRecord {
  id: string;
  studentUid: string;
  studentDocId?: string;
  studentCode: string;
  studentName: string;
  examName: string;
  testType: TestType;
  mode: 'exam' | 'practice';
  subject?: string;
  chapter?: string;
  topic?: string;
  questionIds: string[];
  responses: Record<string, number>;
  markedForReview: string[];
  timeSpentByQuestion: Record<string, number>;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  totalMarks: number;
  maxMarks: number;
  percentage: number;
  accuracy: number;
  timeTakenSeconds: number;
  subjectBreakdown: BreakdownMetric[];
  chapterBreakdown: BreakdownMetric[];
  topicBreakdown: BreakdownMetric[];
  difficultyBreakdown?: BreakdownMetric[];
  weakSubjects: string[];
  weakChapters: string[];
  weakTopics: string[];
  slowQuestionIds: string[];
  aiRecommendations?: string;
  scoreReceipt?: string;
  revealedKeys?: Record<string, RevealedAnswerKey>;
  status: 'in_progress' | 'submitted';
  startedAt: string;
  submittedAt?: string;
  createdAt: any;
  updatedAt: any;
}

export type CurrentAffairsCategory =
  | 'National'
  | 'International'
  | 'Bihar Current Affairs'
  | 'Economy'
  | 'Science and Technology'
  | 'Sports'
  | 'Awards and Honours'
  | 'Government Schemes'
  | 'Important Appointments'
  | 'Environment';

export interface CurrentAffairsItem {
  id: string;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  year: number;
  category: CurrentAffairsCategory;
  titleEn: string;
  titleHi: string;
  summaryEn: string;
  summaryHi: string;
  sourceTitle: string;
  sourceUrl: string;
  publishedDate: string;
  linkedQuestionIds: string[];
  status: 'pending_review' | 'published' | 'archived';
  autoCollected: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface CurrentAffairsSettings {
  id?: string;
  autoPublishEnabled: boolean;
  paused: boolean;
  lastRunAt?: string;
  lastRunCount?: number;
  updatedAt: any;
}

export interface DigitalBookChapter {
  id: string;
  title: string;
  summary: string;
  contentText: string;
  keyFacts: string[];
  linkedTopic: string;
}

export interface DigitalGKBook {
  id: string;
  subject: string;
  title: string;
  description: string;
  chapters: DigitalBookChapter[];
  pdfDownloadAllowed: boolean;
  updatedAt: any;
}

export interface StudyBookmark {
  id: string;
  userUid: string;
  bookId: string;
  subject: string;
  chapterId: string;
  chapterTitle: string;
  note?: string;
  createdAt: any;
}

export const FIELD_LIMITS = {
  STUDENT_CODE_PATTERN: /^VL[0-9]{4,12}$/,
  FULL_NAME_MAX: 120,
  MOBILE_MAX: 20,
  EMAIL_MAX: 200,
  ADDRESS_MAX: 400,
  NOTES_MAX: 400,
  ENQUIRY_MSG_MAX: 1000,
};

export const DEFAULT_FACILITIES: string[] = [
  'Open 24 Hours Self-Study Access (Monday–Sunday)',
  'Full Centralized Air Conditioning',
  'RO Chilled Drinking Water',
  'Quiet Self-Study Seating with Comfortable Chairs',
  'Spacious Individual Study Tables & LED Lighting',
  'High-Speed Dual-Band Fiber Wi-Fi',
  'Dedicated Desk Charging Points',
  '24/7 HD CCTV Surveillance',
  'Sanitized Clean Washrooms',
  'AI Competitive Examination & PYQ Portal',
  'Digital GK Books & Daily Current Affairs',
];

export const ALL_STAFF_PERMISSIONS = [
  'view_students',
  'manage_seats',
  'mark_attendance',
  'record_offline_payments',
  'manage_books',
  'view_enquiries',
  'manage_questions',
  'import_pyq_pdfs',
];

export const CURRENT_AFFAIRS_CATEGORIES: CurrentAffairsCategory[] = [
  'National',
  'International',
  'Bihar Current Affairs',
  'Economy',
  'Science and Technology',
  'Sports',
  'Awards and Honours',
  'Government Schemes',
  'Important Appointments',
  'Environment',
];

export const GK_BOOK_SUBJECTS: string[] = [
  'Indian History',
  'Indian Geography',
  'Indian Polity',
  'Indian Economy',
  'General Science',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Awareness',
  'Bihar GK',
  'General Knowledge',
];

export const DEFAULT_GYAN_ADDA_SETTINGS: LibrarySettings = {
  libraryName: 'VIDHYA LIBRARY · Gyan Adda Self-Study Center',
  tagline: 'Your Knowledge, Your Future.',
  address: '2nd Floor, Station Rd, in front of Poor Home Road, Mirzapur Chowk, Darbhanga, Bihar 846004',
  phone: '+91 87976 40034 / +91 87897 02011',
  whatsapp: '+91 87976 40034',
  email: 'desk@vidhyalibrary.in',
  openingHours: 'Open 24 hours (Monday–Sunday)',
  is24HourAccess: true,
  mapLat: 26.1542,
  mapLng: 85.8918,
  mapUrl: 'https://maps.app.goo.gl/7vA6BPUQgZ5xJz6R9',
  ratingText: '4.9/5 (116 Google Reviews)',
  facilities: DEFAULT_FACILITIES,
  termsText:
    'Members must maintain pin-drop silence inside study halls. Desk assignments are personal and non-transferable. Student ID / QR pass is required for 24-hour entry and examination hall access.',
  privacyText:
    'Student records, attendance logs, and test performance data are stored securely for academic mentoring, library billing, and emergency contact compliance.',
  razorpayEnabled: true,
  whatsappConfigured: false,
  emailConfigured: false,
  smsConfigured: false,
  updatedAt: null,
};
