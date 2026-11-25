import {
  doc,
  writeBatch,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  DEFAULT_FACILITIES,
  DEFAULT_GYAN_ADDA_SETTINGS,
} from '../types/library';

export const DEMO_IMAGES = {
  hero: '/assets/aistudio/image_06146a49.png',
  silentZone: '/assets/aistudio/image_0b08f282.png',
  bookArchive: '/assets/aistudio/image_06146a49.png',
  discussionLounge: '/assets/aistudio/image_0b08f282.png',
};

const STUDENT_NAMES = [
  'Aarav Sharma', 'Ananya Verma', 'Rohan Kulkarni', 'Priya Nair', 'Siddharth Joshi',
  'Kavya Iyer', 'Aditya Mishra', 'Neha Deshmukh', 'Vikram Rathore', 'Ishita Chatterjee',
  'Arjun Malhotra', 'Meera Krishnan', 'Karan Singhania', 'Divya Bansal', 'Nikhil Tiwari',
  'Shruti Saxena', 'Pranav Gokhale', 'Riya Agarwal', 'Harshvardhan Patel', 'Sneha Reddy',
  'Yashwant Chauhan', 'Tanvi Menon', 'Devansh Kapoor', 'Aditi Kulkarni', 'Manish Yadav',
  'Pooja Bhatnagar', 'Rahul Sengupta', 'Nandini Rao', 'Abhishek Dubey', 'Sakshi Tripathi',
];

const FATHER_NAMES = [
  'Rajesh Sharma', 'Suresh Verma', 'Prakash Kulkarni', 'Venkatesh Nair', 'Mahesh Joshi',
  'Subramanian Iyer', 'Ramesh Mishra', 'Anil Deshmukh', 'Bhanwar Rathore', 'Debashish Chatterjee',
  'Deepak Malhotra', 'Gopal Krishnan', 'Alok Singhania', 'Vinod Bansal', 'Ashok Tiwari',
  'Sanjay Saxena', 'Nitin Gokhale', 'Pawan Agarwal', 'Kishore Patel', 'Raghav Reddy',
  'Devendra Chauhan', 'Narayan Menon', 'Vivek Kapoor', 'Madhav Kulkarni', 'Ramprasad Yadav',
  'Harish Bhatnagar', 'Subrata Sengupta', 'Srinivas Rao', 'Santosh Dubey', 'Gaurav Tripathi',
];

const BOOK_CATALOG: Array<[string, string, string, string, string, number]> = [
  ['Indian Polity (7th Edition)', 'M. Laxmikanth', 'McGraw Hill', 'UPSC & Civil Services', '9789355325365', 2024],
  ['Spectrum: A Brief History of Modern India', 'Rajiv Ahir', 'Spectrum Books', 'UPSC & Civil Services', '9788179307212', 2023],
  ['Indian Economy', 'Ramesh Singh', 'McGraw Hill', 'UPSC & Civil Services', '9789355325105', 2024],
  ['Certificate Physical and Human Geography', 'Goh Cheng Leong', 'Oxford University Press', 'UPSC & Civil Services', '9780195628166', 2021],
  ['Indian Art and Culture', 'Nitin Singhania', 'McGraw Hill', 'UPSC & Civil Services', '9789354601804', 2023],
  ['Environment and Ecology', 'Shankar IAS Academy', 'Shankar IAS', 'UPSC & Civil Services', '9789389821048', 2024],
  ['Ethics, Integrity and Aptitude', 'G. Subba Rao & P.N. Roy', 'Access Publishing', 'UPSC & Civil Services', '9789388406116', 2023],
  ['India Since Independence', 'Bipan Chandra', 'Penguin India', 'UPSC & Civil Services', '9780143104094', 2020],
  ['Oxford School Atlas', 'Oxford Cartographers', 'Oxford University Press', 'UPSC & Civil Services', '9780199499564', 2024],
  ['Economic Survey Compendium', 'Ministry of Finance', 'Government Press', 'UPSC & Civil Services', '9789350001001', 2025],
  ['Introduction to Algorithms (CLRS)', 'Thomas H. Cormen', 'MIT Press', 'Engineering & Tech', '9780262046305', 2022],
  ['Operating System Concepts', 'Abraham Silberschatz', 'Wiley', 'Engineering & Tech', '9781119800361', 2021],
  ['Computer Networking: Top-Down Approach', 'James F. Kurose', 'Pearson', 'Engineering & Tech', '9780136681557', 2022],
  ['Database System Concepts', 'Henry F. Korth', 'McGraw Hill', 'Engineering & Tech', '9780078022159', 2020],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann', 'O Reilly Media', 'Engineering & Tech', '9781449373320', 2019],
  ['Clean Code', 'Robert C. Martin', 'Prentice Hall', 'Engineering & Tech', '9780132350884', 2018],
  ['Higher Engineering Mathematics', 'B.S. Grewal', 'Khanna Publishers', 'Engineering & Tech', '9788193328491', 2023],
  ['Digital Design', 'M. Morris Mano', 'Pearson', 'Engineering & Tech', '9780134549897', 2021],
  ['Engineering Mechanics: Statics', 'J.L. Meriam', 'Wiley', 'Engineering & Tech', '9781119392620', 2020],
  ['Signals and Systems', 'Alan V. Oppenheim', 'Pearson', 'Engineering & Tech', '9780138147570', 2019],
  ['Concepts of Physics Vol. 1', 'H.C. Verma', 'Bharati Bhawan', 'Medical & Sciences', '9788177091878', 2023],
  ['Concepts of Physics Vol. 2', 'H.C. Verma', 'Bharati Bhawan', 'Medical & Sciences', '9788177092325', 2023],
  ['Organic Chemistry', 'Morrison & Boyd', 'Pearson', 'Medical & Sciences', '9788131704813', 2021],
  ['Trueman Elementary Biology Vol. 1', 'K.N. Bhatia', 'Trueman Book Co', 'Medical & Sciences', '9789389822106', 2024],
  ['Trueman Elementary Biology Vol. 2', 'K.N. Bhatia', 'Trueman Book Co', 'Medical & Sciences', '9789389822113', 2024],
  ['Guyton & Hall Medical Physiology', 'John E. Hall', 'Elsevier', 'Medical & Sciences', '9780323597128', 2021],
  ['Harper Illustrated Biochemistry', 'Victor W. Rodwell', 'McGraw Hill', 'Medical & Sciences', '9781260469943', 2022],
  ['Gray Anatomy for Students', 'Richard L. Drake', 'Elsevier', 'Medical & Sciences', '9780323393041', 2020],
  ['Concise Inorganic Chemistry', 'J.D. Lee', 'Wiley', 'Medical & Sciences', '9788126515547', 2021],
  ['Problems in General Physics', 'I.E. Irodov', 'Arihant', 'Medical & Sciences', '9789313191094', 2022],
  ['Financial Accounting for CA', 'P.C. Tulsian', 'S. Chand', 'Commerce & CA', '9789352834563', 2024],
  ['Corporate and Other Laws', 'Munish Bhandari', 'Bestword Publications', 'Commerce & CA', '9789389510010', 2024],
  ['Direct Tax Laws & Practice', 'Vinod K. Singhania', 'Taxmann', 'Commerce & CA', '9789357781237', 2025],
  ['Cost and Management Accounting', 'M.N. Arora', 'Vikas Publishing', 'Commerce & CA', '9789353388126', 2023],
  ['Auditing and Assurance Standards', 'Pankaj Garg', 'Taxmann', 'Commerce & CA', '9789357782005', 2024],
  ['Principles of Economics', 'N. Gregory Mankiw', 'Cengage', 'Commerce & CA', '9780357038314', 2022],
  ['The Intelligent Investor', 'Benjamin Graham', 'Harper Business', 'Commerce & CA', '9780060555665', 2019],
  ['Corporate Finance', 'Aswath Damodaran', 'Wiley', 'Commerce & CA', '9781118808931', 2021],
  ['Quantitative Aptitude for Competitive Exams', 'R.S. Aggarwal', 'S. Chand', 'Competitive Aptitude', '9789352832163', 2024],
  ['A Modern Approach to Verbal Reasoning', 'R.S. Aggarwal', 'S. Chand', 'Competitive Aptitude', '9789352832170', 2024],
  ['How to Prepare for Quantitative Aptitude (CAT)', 'Arun Sharma', 'McGraw Hill', 'Competitive Aptitude', '9789355323217', 2024],
  ['Word Power Made Easy', 'Norman Lewis', 'Penguin', 'Competitive Aptitude', '9780143424680', 2021],
  ['Objective General English', 'S.P. Bakshi', 'Arihant', 'Competitive Aptitude', '9789325792340', 2023],
  ['Fast Track Objective Arithmetic', 'Rajesh Verma', 'Arihant', 'Competitive Aptitude', '9789313166757', 2023],
  ['Data Interpretation & Logical Reasoning', 'Gautam Puri', 'GK Publications', 'Competitive Aptitude', '9789356810419', 2024],
  ['The Discovery of India', 'Jawaharlal Nehru', 'Penguin', 'Literature & Philosophy', '9780143031031', 2018],
  ['Wings of Fire: An Autobiography', 'A.P.J. Abdul Kalam', 'Universities Press', 'Literature & Philosophy', '9788173711466', 2019],
  ['Meditations', 'Marcus Aurelius', 'Penguin Classics', 'Literature & Philosophy', '9780140449334', 2017],
  ['Deep Work', 'Cal Newport', 'Grand Central', 'Literature & Philosophy', '9781455586691', 2020],
  ['Atomic Habits', 'James Clear', 'Penguin Random House', 'Literature & Philosophy', '9781847941831', 2021],
];

export async function ensurePublicBootstrap(): Promise<boolean> {
  const settingsRef = doc(db, 'library_settings', 'main');
  const snap = await getDoc(settingsRef);
  return snap.exists();
}

export async function seedDemoDataset(actorUid: string): Promise<{ created: number }> {
  const batch1 = writeBatch(db);
  const nowStr = new Date().toISOString().slice(0, 10);

  // 1. Library Settings (Gyan Adda Self-Study Center · Mirzapur Chowk, Darbhanga, Bihar)
  batch1.set(doc(db, 'library_settings', 'main'), {
    libraryName: DEFAULT_GYAN_ADDA_SETTINGS.libraryName,
    tagline: DEFAULT_GYAN_ADDA_SETTINGS.tagline,
    address: DEFAULT_GYAN_ADDA_SETTINGS.address,
    nearbyLandmarks: DEFAULT_GYAN_ADDA_SETTINGS.nearbyLandmarks,
    phone: DEFAULT_GYAN_ADDA_SETTINGS.phone,
    whatsapp: DEFAULT_GYAN_ADDA_SETTINGS.whatsapp,
    email: DEFAULT_GYAN_ADDA_SETTINGS.email,
    openingHours: DEFAULT_GYAN_ADDA_SETTINGS.openingHours,
    is24HourAccess: true,
    mapLat: DEFAULT_GYAN_ADDA_SETTINGS.mapLat,
    mapLng: DEFAULT_GYAN_ADDA_SETTINGS.mapLng,
    mapUrl: DEFAULT_GYAN_ADDA_SETTINGS.mapUrl,
    ratingText: DEFAULT_GYAN_ADDA_SETTINGS.ratingText,
    facilities: DEFAULT_FACILITIES,
    termsText: DEFAULT_GYAN_ADDA_SETTINGS.termsText,
    privacyText: DEFAULT_GYAN_ADDA_SETTINGS.privacyText,
    razorpayEnabled: true,
    whatsappConfigured: false,
    emailConfigured: false,
    smsConfigured: false,
    updatedAt: serverTimestamp(),
  });

  // 2. 5 Membership Plans
  const plans = [
    {
      id: 'plan_monthly_full',
      name: 'Monthly Full-Day Plan',
      durationDays: 30,
      price: 1500,
      timings: 'Open 24 Hours · Full-Day Shift',
      seatAccess: 'Reserved Individual Desk (All Zones)',
      facilities: ['Full Centralized AC', 'High-Speed Wi-Fi', 'Charging Point', 'RO Drinking Water'],
      terms: 'Includes 1 reserved desk, AI Exam Portal access, and reading room books.',
      active: true,
    },
    {
      id: 'plan_quarterly',
      name: 'Three-Month Scholar Plan',
      durationDays: 90,
      price: 4100,
      timings: 'Open 24 Hours · Unlimited Study',
      seatAccess: 'Reserved Desk + Book Lending + AI PYQ Tests',
      facilities: ['Centralized AC', 'High-Speed Wi-Fi', 'Book Borrowing', 'RO Water'],
      terms: '9% discount over monthly billing with reference book borrowing privileges.',
      active: true,
    },
    {
      id: 'plan_half_yearly',
      name: 'Six-Month Achiever Plan',
      durationDays: 180,
      price: 7800,
      timings: '24-Hour Keycard Access',
      seatAccess: 'Dedicated Carrel + Personal Locker',
      facilities: ['24-Hour Access', 'Dedicated Locker', 'Book Borrowing (4 Books)', 'Priority Seat Choice'],
      terms: 'Includes 24/7 access card, AI Mock Generator, and priority seat transfer.',
      active: true,
    },
    {
      id: 'plan_annual',
      name: 'Annual Fellow Membership',
      durationDays: 365,
      price: 14400,
      timings: '24-Hour Keycard Access',
      seatAccess: 'Executive Silent Zone Carrel',
      facilities: ['24-Hour Access', 'Executive Carrel', 'Dedicated Locker', 'Unlimited Digital GK Books'],
      terms: 'Full-year continuous study allocation with zero renewal fees.',
      active: true,
    },
    {
      id: 'plan_shift_morning',
      name: 'Morning / Evening Shift Plan',
      durationDays: 30,
      price: 950,
      timings: '06:00 AM – 02:00 PM or 02:00 PM – 10:00 PM',
      seatAccess: 'Shift-Allocated Study Desk',
      facilities: ['Centralized AC', 'High-Speed Wi-Fi', 'Charging Point'],
      terms: 'Ideal for college students and working professionals preparing for competitive exams.',
      active: true,
    },
  ];

  plans.forEach((p) => {
    batch1.set(doc(db, 'membership_plans', p.id), {
      name: p.name,
      durationDays: p.durationDays,
      price: p.price,
      timings: p.timings,
      seatAccess: p.seatAccess,
      facilities: p.facilities,
      terms: p.terms,
      active: p.active,
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 3. 5 Staff Members
  const staffMembers = [
    { id: 'staff_demo_1', code: 'STF001', name: 'Rajendra Prasad', email: 'rajendra.manager@gyanaddalibrary.in', mobile: '8797640034', role: 'manager', shift: 'Morning (06:00–14:00)', salary: 28000, perms: ['view_students', 'manage_seats', 'mark_attendance', 'record_offline_payments', 'manage_books', 'view_enquiries'] },
    { id: 'staff_demo_2', code: 'STF002', name: 'Sunita Choudhary', email: 'sunita.manager@gyanaddalibrary.in', mobile: '8789702011', role: 'manager', shift: 'Evening (14:00–22:00)', salary: 26500, perms: ['view_students', 'manage_seats', 'mark_attendance', 'manage_books'] },
    { id: 'staff_demo_3', code: 'STF003', name: 'Mahesh Kumar', email: 'mahesh.desk@gyanaddalibrary.in', mobile: '9829011223', role: 'staff', shift: 'Morning (06:00–14:00)', salary: 16500, perms: ['view_students', 'mark_attendance', 'manage_books'] },
    { id: 'staff_demo_4', code: 'STF004', name: 'Deepika Jha', email: 'deepika.desk@gyanaddalibrary.in', mobile: '9829011224', role: 'staff', shift: 'Afternoon (12:00–20:00)', salary: 16000, perms: ['view_students', 'manage_seats', 'record_offline_payments'] },
    { id: 'staff_demo_5', code: 'STF005', name: 'Vinod Thakur', email: 'vinod.night@gyanaddalibrary.in', mobile: '9829011225', role: 'staff', shift: 'Night (20:00–06:00)', salary: 18000, perms: ['view_students', 'mark_attendance'] },
  ];

  staffMembers.forEach((s) => {
    batch1.set(doc(db, 'staff', s.id), {
      staffCode: s.code,
      fullName: s.name,
      email: s.email,
      mobile: s.mobile,
      role: s.role,
      permissions: s.perms,
      shift: s.shift,
      monthlySalary: s.salary,
      status: 'active',
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 4. Book Categories + Gallery + Announcements
  const categories = [
    { id: 'cat_upsc', name: 'UPSC & Civil Services', description: 'Polity, History, Economy, Geography and GS volumes', shelfRange: 'S-01 to S-04' },
    { id: 'cat_eng', name: 'Engineering & Tech', description: 'Computer Science, GATE, Algorithms, and Core Engineering', shelfRange: 'S-05 to S-08' },
    { id: 'cat_med', name: 'Medical & Sciences', description: 'NEET, Physics, Chemistry, Biology and Medical Physiology', shelfRange: 'S-09 to S-12' },
    { id: 'cat_ca', name: 'Commerce & CA', description: 'Chartered Accountancy, Taxation, Economics and Finance', shelfRange: 'S-13 to S-15' },
    { id: 'cat_apt', name: 'Competitive Aptitude', description: 'CAT, SSC, Banking, Quantitative and Verbal Reasoning', shelfRange: 'S-16 to S-18' },
    { id: 'cat_lit', name: 'Literature & Philosophy', description: 'Biographies, Productivity, History and Classic Philosophy', shelfRange: 'S-19 to S-20' },
  ];
  categories.forEach((c) => {
    batch1.set(doc(db, 'book_categories', c.id), {
      name: c.name,
      description: c.description,
      shelfRange: c.shelfRange,
      createdAt: serverTimestamp(),
    });
  });

  const gallery = [
    {
      id: 'gal_1',
      title: 'Gyan Adda Main Reading Hall · Darbhanga',
      category: 'Reading Hall',
      imageUrl: DEMO_IMAGES.hero,
      caption: 'Spacious partitioned desks with comfortable rolling chairs, bright LED lighting, and overhead cooling.',
      sortOrder: 1,
    },
    {
      id: 'gal_2',
      title: 'Silent AC Study Cubicles · Mirzapur Chowk',
      category: 'Silent Zone',
      imageUrl: DEMO_IMAGES.silentZone,
      caption: 'Quiet individual study cubicles with power sockets, full air conditioning, and 24-hour discipline.',
      sortOrder: 2,
    },
  ];
  gallery.forEach((g) => {
    batch1.set(doc(db, 'gallery', g.id), {
      title: g.title,
      category: g.category,
      imageUrl: g.imageUrl,
      caption: g.caption,
      sortOrder: g.sortOrder,
      approved: true,
      createdAt: serverTimestamp(),
    });
  });

  const announcements = [
    {
      id: 'ann_1',
      title: '24-Hour Exam Season Access Active',
      body: 'Zone A and Zone B silent halls remain open 24 hours for Six-Month and Annual scholars throughout November and December.',
      priority: 'important',
      published: true,
    },
    {
      id: 'ann_2',
      title: 'New UPSC 2026 Reference Edition Arrivals',
      body: '24 new copies of Indian Polity, Economic Survey Compendium, and Environment guides are now available at Shelf S-01.',
      priority: 'normal',
      published: true,
    },
  ];
  announcements.forEach((a) => {
    batch1.set(doc(db, 'announcements', a.id), {
      title: a.title,
      body: a.body,
      priority: a.priority,
      published: a.published,
      createdAt: serverTimestamp(),
    });
  });

  await batch1.commit();

  // Batch 2: 30 Students + 40 Seats + Memberships + Payments
  const batch2 = writeBatch(db);
  const zones = ['Zone A · Silent AC', 'Zone B · Executive Carrels', 'Zone C · Research Wing', 'Zone D · Extended Focus'];
  const rowLabels = ['A', 'B', 'C', 'D'];

  for (let i = 0; i < 30; i++) {
    const idx = i + 1;
    const studentDocId = `student_demo_${idx}`;
    const studentCode = `VL2026${String(idx).padStart(3, '0')}`;
    const assignedPlan = plans[i % plans.length];
    const isExpired = i >= 25 && i < 28;
    const membershipStatus = isExpired ? 'expired' : 'active';
    const hasSeat = i < 24;
    const rowIdx = Math.floor(i / 10);
    const colIdx = (i % 10) + 1;
    const seatCode = hasSeat ? `${rowLabels[rowIdx]}${String(colIdx).padStart(2, '0')}` : '';
    const seatId = hasSeat ? `seat_${seatCode}` : '';

    const startDateObj = new Date(Date.now() - (isExpired ? 45 : 12) * 86400000);
    const expiryDateObj = new Date(startDateObj.getTime() + assignedPlan.durationDays * 86400000);
    const startDate = startDateObj.toISOString().slice(0, 10);
    const expiryDate = expiryDateObj.toISOString().slice(0, 10);

    batch2.set(doc(db, 'students', studentDocId), {
      uid: `demo_uid_${idx}`,
      studentCode,
      fullName: STUDENT_NAMES[i],
      mobile: `98291${String(10000 + idx * 173).slice(0, 5)}`,
      email: `${STUDENT_NAMES[i].toLowerCase().replace(/[^a-z]/g, '.')}@example.edu`,
      fatherName: FATHER_NAMES[i],
      address: `Ward ${1 + (idx % 20)}, Mirzapur Chowk, Darbhanga, Bihar 846004`,
      emergencyContact: `98292${String(20000 + idx * 131).slice(0, 5)}`,
      seatId,
      seatCode,
      shiftId: ['shift_morning', 'shift_afternoon', 'shift_evening', 'shift_fullday'][i % 4],
      shiftName: ['Morning Shift', 'Afternoon Shift', 'Evening Shift', 'Full Day'][i % 4],
      shiftTiming: ['06:00 – 12:00', '12:00 – 18:00', '16:00 – 22:00', '06:00 – 22:00'][i % 4],
      membershipId: `mem_demo_${idx}`,
      membershipPlanName: assignedPlan.name,
      membershipStatus,
      membershipExpiry: expiryDate,
      status: i === 29 ? 'inactive' : 'active',
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, 'memberships', `mem_demo_${idx}`), {
      studentDocId,
      studentUid: `demo_uid_${idx}`,
      studentCode,
      studentName: STUDENT_NAMES[i],
      planId: assignedPlan.id,
      planName: assignedPlan.name,
      amount: assignedPlan.price,
      startDate,
      expiryDate,
      status: membershipStatus,
      paymentId: `pay_demo_${idx}`,
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch2.set(doc(db, 'payments', `pay_demo_${idx}`), {
      receiptNumber: `VL-RCP-2026-${String(idx).padStart(4, '0')}`,
      studentDocId,
      studentUid: `demo_uid_${idx}`,
      studentCode,
      studentName: STUDENT_NAMES[i],
      planId: assignedPlan.id,
      planName: assignedPlan.name,
      amount: assignedPlan.price,
      method: i % 3 === 0 ? 'razorpay_upi' : i % 3 === 1 ? 'cash' : 'razorpay_card',
      status: i === 28 ? 'pending' : 'verified',
      notes: 'Demonstration sample payment entry',
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 40 Seats (A01-A10, B01-B10, C01-C10, D01-D10)
  for (let r = 0; r < 4; r++) {
    for (let c = 1; c <= 10; c++) {
      const seatCode = `${rowLabels[r]}${String(c).padStart(2, '0')}`;
      const seatId = `seat_${seatCode}`;
      const globalIdx = r * 10 + (c - 1);
      let status: 'available' | 'occupied' | 'reserved' | 'maintenance' = 'available';
      let assignedStudentDocId = '';
      let assignedStudentUid = '';
      let assignedStudentCode = '';

      if (globalIdx < 24) {
        status = 'occupied';
        assignedStudentDocId = `student_demo_${globalIdx + 1}`;
        assignedStudentUid = `demo_uid_${globalIdx + 1}`;
        assignedStudentCode = `VL2026${String(globalIdx + 1).padStart(3, '0')}`;
      } else if (globalIdx === 24 || globalIdx === 25) {
        status = 'reserved';
      } else if (globalIdx === 38 || globalIdx === 39) {
        status = 'maintenance';
      }

      batch2.set(doc(db, 'seats', seatId), {
        seatCode,
        zone: zones[r],
        rowLabel: rowLabels[r],
        colIndex: c,
        status,
        assignedStudentDocId,
        assignedStudentUid,
        assignedStudentCode,
        shift: 'Full Day',
        isDemo: true,
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch2.commit();

  // Batch 3: 50 Books + Attendance + Book Issues + Expenses
  const batch3 = writeBatch(db);
  BOOK_CATALOG.forEach(([title, author, publisher, categoryName, isbn, year], idx) => {
    const bookId = `book_demo_${idx + 1}`;
    const totalCopies = 3 + (idx % 4);
    const issuedOut = idx < 8 ? 1 : 0;
    batch3.set(doc(db, 'books', bookId), {
      title,
      author,
      publisher,
      isbn,
      categoryName,
      totalCopies,
      availableCopies: totalCopies - issuedOut,
      shelfNumber: `S-${String(Math.floor(idx / 3) + 1).padStart(2, '0')}`,
      publicationYear: year,
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 18 Sample Attendance Records across today & recent days
  for (let i = 0; i < 18; i++) {
    const idx = i + 1;
    const isToday = i < 12;
    const date = isToday
      ? nowStr
      : new Date(Date.now() - ((i % 5) + 1) * 86400000).toISOString().slice(0, 10);
    const checkedOut = i >= 6;
    batch3.set(doc(db, 'attendance', `att_demo_${idx}`), {
      studentDocId: `student_demo_${idx}`,
      studentUid: `demo_uid_${idx}`,
      studentCode: `VL2026${String(idx).padStart(3, '0')}`,
      studentName: STUDENT_NAMES[i],
      date,
      checkInTime: `${String(7 + (i % 4)).padStart(2, '0')}:${i % 2 === 0 ? '15' : '45'}`,
      ...(checkedOut ? { checkOutTime: `${String(15 + (i % 5)).padStart(2, '0')}:30` } : {}),
      durationMinutes: checkedOut ? 360 + (i % 4) * 45 : 0,
      method: i % 3 === 0 ? 'qr' : 'id',
      isLate: i % 5 === 4,
      markedBy: actorUid,
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 8 Sample Book Issues
  for (let i = 0; i < 8; i++) {
    const idx = i + 1;
    const [title] = BOOK_CATALOG[i];
    const issueDate = new Date(Date.now() - (5 + i * 2) * 86400000).toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + (i < 2 ? -2 : 9 - i) * 86400000).toISOString().slice(0, 10);
    batch3.set(doc(db, 'book_issues', `issue_demo_${idx}`), {
      bookId: `book_demo_${idx}`,
      bookTitle: title,
      studentDocId: `student_demo_${idx}`,
      studentUid: `demo_uid_${idx}`,
      studentCode: `VL2026${String(idx).padStart(3, '0')}`,
      studentName: STUDENT_NAMES[i],
      issueDate,
      dueDate,
      fineAmount: i < 2 ? 40 : 0,
      status: i < 2 ? 'overdue' : 'issued',
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Sample Expenses
  const expenses = [
    { id: 'exp_demo_1', title: 'Monthly Hall Lease & Maintenance', category: 'rent', amount: 35000, offsetDays: 20 },
    { id: 'exp_demo_2', title: 'Commercial AC & Lighting Electricity Bill', category: 'electricity', amount: 11400, offsetDays: 14 },
    { id: 'exp_demo_3', title: 'Dual-ISP Fiber Broadband (300 Mbps)', category: 'internet', amount: 2800, offsetDays: 10 },
    { id: 'exp_demo_4', title: 'Staff & Desk Attendant Payroll', category: 'salary', amount: 95000, offsetDays: 5 },
    { id: 'exp_demo_5', title: 'RO Water Purifier & Housekeeping Supplies', category: 'maintenance', amount: 3200, offsetDays: 3 },
  ];
  expenses.forEach((e) => {
    batch3.set(doc(db, 'expenses', e.id), {
      title: e.title,
      category: e.category,
      amount: e.amount,
      expenseDate: new Date(Date.now() - e.offsetDays * 86400000).toISOString().slice(0, 10),
      notes: 'Demonstration operational expense',
      recordedBy: actorUid,
      isDemo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch3.commit();

  return { created: 175 };
}
