import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import {
  CurrentAffairsCategory,
  ExamCategory,
  QuestionDifficulty,
} from '../types/library';

export const DEFAULT_EXAM_CATEGORIES: Array<Omit<ExamCategory, 'createdAt' | 'updatedAt'>> = [
  { id: 'exam_neet_ug', name: 'NEET UG', categoryGroup: 'Medical', code: 'NEET', defaultDurationMinutes: 180, marksPerCorrect: 4, negativeMarks: 1, description: 'National Eligibility cum Entrance Test (Biology, Physics, Chemistry)', active: true },
  { id: 'exam_jee_main', name: 'JEE Main', categoryGroup: 'Engineering', code: 'JEEM', defaultDurationMinutes: 180, marksPerCorrect: 4, negativeMarks: 1, description: 'Joint Entrance Examination Main (Physics, Chemistry, Mathematics)', active: true },
  { id: 'exam_jee_adv', name: 'JEE Advanced', categoryGroup: 'Engineering', code: 'JEEA', defaultDurationMinutes: 180, marksPerCorrect: 4, negativeMarks: 1, description: 'IIT Entrance Examination (Advanced Problem Solving)', active: true },
  { id: 'exam_nda', name: 'NDA', categoryGroup: 'Defence', code: 'NDA', defaultDurationMinutes: 150, marksPerCorrect: 2.5, negativeMarks: 0.83, description: 'UPSC National Defence Academy & Naval Academy Examination', active: true },
  { id: 'exam_upsc', name: 'UPSC', categoryGroup: 'Civil Services', code: 'UPSC', defaultDurationMinutes: 120, marksPerCorrect: 2, negativeMarks: 0.66, description: 'UPSC Civil Services Preliminary Examination (GS Paper I & CSAT)', active: true },
  { id: 'exam_bpsc', name: 'BPSC', categoryGroup: 'State PSC', code: 'BPSC', defaultDurationMinutes: 120, marksPerCorrect: 1, negativeMarks: 0.33, description: 'Bihar Public Service Commission Integrated CCE Preliminary Exam', active: true },
  { id: 'exam_ssc_cgl', name: 'SSC CGL', categoryGroup: 'SSC', code: 'CGL', defaultDurationMinutes: 60, marksPerCorrect: 2, negativeMarks: 0.5, description: 'Staff Selection Commission Combined Graduate Level Tier I & II', active: true },
  { id: 'exam_ssc_chsl', name: 'SSC CHSL', categoryGroup: 'SSC', code: 'CHSL', defaultDurationMinutes: 60, marksPerCorrect: 2, negativeMarks: 0.5, description: 'Combined Higher Secondary Level Examination', active: true },
  { id: 'exam_ssc_mts', name: 'SSC MTS', categoryGroup: 'SSC', code: 'MTS', defaultDurationMinutes: 90, marksPerCorrect: 3, negativeMarks: 1, description: 'Multi-Tasking Staff & Havaldar Examination', active: true },
  { id: 'exam_rrb_ntpc', name: 'Railway NTPC', categoryGroup: 'Railway', code: 'NTPC', defaultDurationMinutes: 90, marksPerCorrect: 1, negativeMarks: 0.33, description: 'RRB Non-Technical Popular Categories CBT', active: true },
  { id: 'exam_rrb_grpd', name: 'Railway Group D', categoryGroup: 'Railway', code: 'RRBD', defaultDurationMinutes: 90, marksPerCorrect: 1, negativeMarks: 0.33, description: 'RRB Level-1 Track Maintainer & Technical Posts CBT', active: true },
  { id: 'exam_bihar_police', name: 'Bihar Police', categoryGroup: 'State Police', code: 'BHPOL', defaultDurationMinutes: 120, marksPerCorrect: 1, negativeMarks: 0, description: 'CSBC Bihar Police Constable & Sub-Inspector Recruitment', active: true },
  { id: 'exam_bihar_ssc', name: 'Bihar SSC', categoryGroup: 'State SSC', code: 'BSSC', defaultDurationMinutes: 135, marksPerCorrect: 4, negativeMarks: 1, description: 'BSSC Inter-Level & Graduate Level Combined Competitive Exam', active: true },
  { id: 'exam_banking', name: 'Banking examinations', categoryGroup: 'Banking', code: 'IBPS', defaultDurationMinutes: 60, marksPerCorrect: 1, negativeMarks: 0.25, description: 'IBPS PO/Clerk, SBI PO/Clerk & RBI Assistant Examinations', active: true },
  { id: 'exam_other_govt', name: 'Other government examinations', categoryGroup: 'General Govt', code: 'GOVT', defaultDurationMinutes: 90, marksPerCorrect: 1, negativeMarks: 0.25, description: 'State TET, CUET, Defence Agniveer & Central PSU Exams', active: true },
];

interface RawStarterQuestion {
  id: string;
  examName: string;
  examCategory: string;
  subject: string;
  chapter: string;
  topic: string;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  difficulty: QuestionDifficulty;
  examYear: number;
  examShift?: string;
  language: 'en' | 'hi' | 'bilingual';
  source: 'pyq' | 'manual' | 'current_affairs' | 'gk_book';
}

const STARTER_QUESTIONS: RawStarterQuestion[] = [
  // UPSC
  {
    id: 'q_seed_upsc_1',
    examName: 'UPSC',
    examCategory: 'Civil Services',
    subject: 'Indian Polity',
    chapter: 'Fundamental Rights',
    topic: 'Article 21 & Privacy',
    questionText: 'Under the Constitution of India, the Right to Privacy is protected as an intrinsic part of which Article as affirmed by the nine-judge bench in Justice K.S. Puttaswamy (Retd.) vs Union of India?',
    options: ['Article 14', 'Article 19(1)(a)', 'Article 21', 'Article 32'],
    correctIndex: 2,
    explanation: 'In 2017, a 9-judge Supreme Court bench unanimously held that the Right to Privacy is protected as an intrinsic part of the Right to Life and Personal Liberty under Article 21.',
    difficulty: 'medium',
    examYear: 2021,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_upsc_2',
    examName: 'UPSC',
    examCategory: 'Civil Services',
    subject: 'Indian Economy',
    chapter: 'Monetary Policy',
    topic: 'RBI Tools & SLR',
    questionText: 'If the Reserve Bank of India reduces the Cash Reserve Ratio (CRR), what is the immediate expected impact on the commercial banking system?',
    options: [
      'Commercial banks have more lendable liquidity to create credit',
      'Commercial banks must lock more gold reserves with RBI',
      'Government fiscal deficit immediately increases',
      'Repo rate automatically drops to zero',
    ],
    correctIndex: 0,
    explanation: 'Reducing CRR lowers the mandatory cash percentage banks must keep idle with RBI, increasing excess reserves available for lending and expanding money supply.',
    difficulty: 'easy',
    examYear: 2022,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_upsc_3',
    examName: 'UPSC',
    examCategory: 'Civil Services',
    subject: 'Indian History',
    chapter: 'Freedom Struggle',
    topic: 'Gandhian Movements',
    questionText: 'Who among the following led the Salt Satyagraha march from Sabarmati Ashram to Dandi in 1930 alongside 78 chosen followers?',
    options: ['Sardar Vallabhbhai Patel', 'Mahatma Gandhi', 'Subhas Chandra Bose', 'C. Rajagopalachari'],
    correctIndex: 1,
    explanation: 'Mahatma Gandhi launched the Civil Disobedience Movement with the historic Dandi March from March 12 to April 6, 1930, breaking the British salt monopoly.',
    difficulty: 'easy',
    examYear: 2020,
    language: 'en',
    source: 'pyq',
  },
  // BPSC & Bihar exams
  {
    id: 'q_seed_bpsc_1',
    examName: 'BPSC',
    examCategory: 'State PSC',
    subject: 'Bihar GK',
    chapter: 'Bihar History & Freedom Movement',
    topic: 'Champaran Satyagraha',
    questionText: 'Who persistently invited Mahatma Gandhi to Champaran in 1916–1917 to investigate the plight of indigo cultivators under the Tinkathia system? (1917 में चंपारण के नील किसानों की समस्या देखने के लिए गांधीजी को किसने आमंत्रित किया था?)',
    options: ['Dr. Rajendra Prasad', 'Raj Kumar Shukla', 'Anugrah Narayan Sinha', 'Jayaprakash Narayan'],
    correctIndex: 1,
    explanation: 'Raj Kumar Shukla met Mahatma Gandhi at the Lucknow Congress Session (1916) and persuaded him to visit Champaran in April 1917.',
    difficulty: 'easy',
    examYear: 2023,
    language: 'bilingual',
    source: 'pyq',
  },
  {
    id: 'q_seed_bpsc_2',
    examName: 'BPSC',
    examCategory: 'State PSC',
    subject: 'Bihar GK',
    chapter: 'Geography of Bihar',
    topic: 'River Systems of Bihar',
    questionText: 'Which river, known historically for shifting its course across North Bihar plains and joining the Ganga near Kursela, is called the "Sorrow of Bihar"?',
    options: ['Son River', 'Gandak River', 'Kosi River', 'Punpun River'],
    correctIndex: 2,
    explanation: 'The Kosi River brings heavy silt from Nepal Himalayas into North Bihar (including Darbhanga-Kosi basin districts) and frequently shifts channels during monsoon.',
    difficulty: 'easy',
    examYear: 2022,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_bpsc_3',
    examName: 'BPSC',
    examCategory: 'State PSC',
    subject: 'Indian Polity',
    chapter: 'Constitutional Bodies',
    topic: '73rd Amendment & Panchayati Raj',
    questionText: 'Which state became the first in India to implement 50% reservation for women in Panchayati Raj Institutions?',
    options: ['Rajasthan', 'Bihar', 'Madhya Pradesh', 'Maharashtra'],
    correctIndex: 1,
    explanation: 'Bihar implemented 50% reservation for women in Panchayati Raj Institutions through the Bihar Panchayat Raj Act, 2006.',
    difficulty: 'medium',
    examYear: 2024,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_biharpol_1',
    examName: 'Bihar Police',
    examCategory: 'State Police',
    subject: 'Bihar GK',
    chapter: 'Art & Culture of Mithila',
    topic: 'Madhubani & Mithila Heritage',
    questionText: 'Darbhanga and Madhubani districts in Bihar are world-renowned for which traditional GI-tagged folk painting style?',
    options: ['Warli Painting', 'Mithila (Madhubani) Painting', 'Pattachitra Painting', 'Kalamkari Painting'],
    correctIndex: 1,
    explanation: 'Mithila (Madhubani) painting originated in the Mithila region of Bihar (centered around Madhubani and Darbhanga) and holds Geographical Indication (GI) status.',
    difficulty: 'easy',
    examYear: 2024,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_bssc_1',
    examName: 'Bihar SSC',
    examCategory: 'State SSC',
    subject: 'General Knowledge',
    chapter: 'Indian Parliament',
    topic: 'Money Bills',
    questionText: 'Under Article 110 of the Indian Constitution, who certifies whether a bill is a Money Bill?',
    options: ['President of India', 'Prime Minister', 'Speaker of the Lok Sabha', 'Union Finance Minister'],
    correctIndex: 2,
    explanation: 'The decision of the Speaker of the Lok Sabha on whether a bill is a Money Bill is final under Article 110(3).',
    difficulty: 'easy',
    examYear: 2023,
    language: 'en',
    source: 'pyq',
  },
  // NEET UG
  {
    id: 'q_seed_neet_1',
    examName: 'NEET UG',
    examCategory: 'Medical',
    subject: 'Biology',
    chapter: 'Cell Cycle and Cell Division',
    topic: 'Meiosis I - Prophase I',
    questionText: 'During Meiosis I, crossing over (recombination) between non-sister chromatids of homologous chromosomes occurs in which substage of Prophase I?',
    options: ['Leptotene', 'Zygotene', 'Pachytene', 'Diplotene'],
    correctIndex: 2,
    explanation: 'Crossing over catalyzed by the enzyme recombinase occurs during the Pachytene stage of Prophase I after synaptonemal complex formation in Zygotene.',
    difficulty: 'medium',
    examYear: 2023,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_neet_2',
    examName: 'NEET UG',
    examCategory: 'Medical',
    subject: 'Chemistry',
    chapter: 'Chemical Bonding',
    topic: 'Hybridisation & VSEPR',
    questionText: 'What is the hybridisation of the central Boron atom in BF₃ and its molecular geometry?',
    options: ['sp² · Trigonal planar', 'sp³ · Tetrahedral', 'sp · Linear', 'sp³d · T-shaped'],
    correctIndex: 0,
    explanation: 'Boron in BF₃ forms 3 sigma bonds with zero lone pairs (steric number = 3), giving sp² hybridisation and trigonal planar geometry (120° bond angle).',
    difficulty: 'easy',
    examYear: 2022,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_neet_3',
    examName: 'NEET UG',
    examCategory: 'Medical',
    subject: 'Physics',
    chapter: 'Current Electricity',
    topic: 'Ohm Law & Power Dissipation',
    questionText: 'Two resistors of 4 Ω and 12 Ω are connected in parallel across a 12 V DC battery. What is the total equivalent resistance of the combination?',
    options: ['16 Ω', '8 Ω', '3 Ω', '4.5 Ω'],
    correctIndex: 2,
    explanation: 'For parallel resistors: 1/Req = 1/4 + 1/12 = (3 + 1)/12 = 4/12 = 1/3, therefore Req = 3 Ω.',
    difficulty: 'easy',
    examYear: 2024,
    language: 'en',
    source: 'pyq',
  },
  // JEE Main & Advanced
  {
    id: 'q_seed_jeem_1',
    examName: 'JEE Main',
    examCategory: 'Engineering',
    subject: 'Physics',
    chapter: 'Electrostatics',
    topic: 'Gauss Law',
    questionText: 'A point charge +q is placed at the centre of a cube of side L. What is the total electric flux passing through one single face of the cube?',
    options: ['q / ε₀', 'q / (6ε₀)', 'q / (4ε₀)', 'Zero'],
    correctIndex: 1,
    explanation: 'By Gauss Law, total flux through all 6 faces = q/ε₀. By symmetry, flux through each identical face is q/(6ε₀).',
    difficulty: 'easy',
    examYear: 2023,
    examShift: 'Shift 1 (Jan)',
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_jeem_2',
    examName: 'JEE Main',
    examCategory: 'Engineering',
    subject: 'Mathematics',
    chapter: 'Definite Integration',
    topic: 'King Property',
    questionText: 'Evaluate the definite integral I = ∫₀^(π/2) [sin²x / (sin²x + cos²x)] dx.',
    options: ['π / 2', 'π / 4', '1', '0'],
    correctIndex: 0,
    explanation: 'Since sin²x + cos²x = 1 for all x, the integrand simplifies identically to 1, giving ∫₀^(π/2) 1 dx = π/2.',
    difficulty: 'easy',
    examYear: 2022,
    examShift: 'Shift 2 (June)',
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_jeea_1',
    examName: 'JEE Advanced',
    examCategory: 'Engineering',
    subject: 'Chemistry',
    chapter: 'Thermodynamics',
    topic: 'Gibbs Free Energy',
    questionText: 'For a chemical reaction at constant temperature T and pressure P, a process is spontaneous in the forward direction if ΔG satisfies which condition?',
    options: ['ΔG > 0', 'ΔG = 0', 'ΔG < 0', 'ΔG = ΔH'],
    correctIndex: 2,
    explanation: 'At constant T and P, ΔG = ΔH − TΔS < 0 defines thermodynamic spontaneity.',
    difficulty: 'easy',
    examYear: 2021,
    language: 'en',
    source: 'pyq',
  },
  // SSC CGL / CHSL / MTS
  {
    id: 'q_seed_ssc_1',
    examName: 'SSC CGL',
    examCategory: 'SSC',
    subject: 'Quantitative Aptitude',
    chapter: 'Algebra & Identities',
    topic: 'Reciprocal Identities',
    questionText: 'If x + (1/x) = 5, then what is the value of x² + (1/x²)?',
    options: ['25', '23', '27', '21'],
    correctIndex: 1,
    explanation: 'Squaring both sides: (x + 1/x)² = x² + 1/x² + 2 = 25 ⇒ x² + 1/x² = 25 − 2 = 23.',
    difficulty: 'easy',
    examYear: 2024,
    examShift: 'Tier I · Shift 1',
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_ssc_2',
    examName: 'SSC CHSL',
    examCategory: 'SSC',
    subject: 'General Science',
    chapter: 'Vitamins & Nutrition',
    topic: 'Deficiency Diseases',
    questionText: 'Deficiency of Vitamin C (Ascorbic Acid) primarily leads to which disease?',
    options: ['Rickets', 'Scurvy', 'Beriberi', 'Night Blindness'],
    correctIndex: 1,
    explanation: 'Vitamin C deficiency causes Scurvy (bleeding gums and impaired collagen synthesis). Vitamin D causes Rickets, B1 causes Beriberi, and A causes Night Blindness.',
    difficulty: 'easy',
    examYear: 2023,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_ssc_3',
    examName: 'SSC MTS',
    examCategory: 'SSC',
    subject: 'Indian Geography',
    chapter: 'National Parks & Biosphere',
    topic: 'Protected Areas',
    questionText: 'Valmiki National Park and Tiger Reserve is located in which district of Bihar?',
    options: ['West Champaran', 'Gaya', 'Bhagalpur', 'Darbhanga'],
    correctIndex: 0,
    explanation: 'Valmiki Tiger Reserve, Bihar’s premier tiger reserve bordering Nepal, is located in West Champaran district.',
    difficulty: 'medium',
    examYear: 2024,
    language: 'en',
    source: 'pyq',
  },
  // NDA
  {
    id: 'q_seed_nda_1',
    examName: 'NDA',
    examCategory: 'Defence',
    subject: 'Mathematics',
    chapter: 'Trigonometry',
    topic: 'Identities',
    questionText: 'What is the value of sin(15°) × cos(15°)?',
    options: ['1 / 2', '1 / 4', '√3 / 4', '√3 / 2'],
    correctIndex: 1,
    explanation: 'Using sin(2θ) = 2 sinθ cosθ ⇒ sin(15°)cos(15°) = ½ sin(30°) = ½ × ½ = 1/4.',
    difficulty: 'medium',
    examYear: 2023,
    language: 'en',
    source: 'pyq',
  },
  // Railway NTPC & Group D
  {
    id: 'q_seed_rrb_1',
    examName: 'Railway NTPC',
    examCategory: 'Railway',
    subject: 'Computer Awareness',
    chapter: 'Operating Systems & Shortcuts',
    topic: 'Memory Hierarchy',
    questionText: 'Which type of computer memory is volatile and loses its stored instructions immediately when power is turned off?',
    options: ['ROM', 'SSD', 'RAM', 'EEPROM'],
    correctIndex: 2,
    explanation: 'RAM (Random Access Memory) is volatile primary memory; ROM, EEPROM, and SSD retain data without power.',
    difficulty: 'easy',
    examYear: 2022,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_rrbd_1',
    examName: 'Railway Group D',
    examCategory: 'Railway',
    subject: 'General Science',
    chapter: 'Acids, Bases and Salts',
    topic: 'pH Scale',
    questionText: 'Pure distilled water at 25 °C has a pH value equal to:',
    options: ['0', '5.5', '7', '14'],
    correctIndex: 2,
    explanation: 'Neutral solutions at 25 °C have [H⁺] = 10⁻⁷ M, giving pH = 7.',
    difficulty: 'easy',
    examYear: 2022,
    language: 'en',
    source: 'pyq',
  },
  // Banking & Other Govt
  {
    id: 'q_seed_bank_1',
    examName: 'Banking examinations',
    examCategory: 'Banking',
    subject: 'Indian Economy',
    chapter: 'Banking Regulation',
    topic: 'Basel & Payment Systems',
    questionText: 'Which institution operates the Unified Payments Interface (UPI) and RuPay card network in India?',
    options: ['SEBI', 'NPCI (National Payments Corporation of India)', 'NABARD', 'SIDBI'],
    correctIndex: 1,
    explanation: 'NPCI (an umbrella organization under RBI & IBA) developed and operates UPI, IMPS, RuPay, and BHIM.',
    difficulty: 'easy',
    examYear: 2024,
    language: 'en',
    source: 'pyq',
  },
  {
    id: 'q_seed_other_1',
    examName: 'Other government examinations',
    examCategory: 'General Govt',
    subject: 'General Knowledge',
    chapter: 'Indian Constitution & Symbols',
    topic: 'Constitutional Dates',
    questionText: 'On which date was the Constitution of India adopted by the Constituent Assembly?',
    options: ['15 August 1947', '26 November 1949', '26 January 1950', '2 October 1948'],
    correctIndex: 1,
    explanation: 'The Constituent Assembly adopted the Constitution on 26 November 1949 (Constitution Day), and it came into full effect on 26 January 1950.',
    difficulty: 'easy',
    examYear: 2023,
    language: 'en',
    source: 'gk_book',
  },
];

export const STARTER_GK_BOOKS = [
  {
    id: 'gk_indian_history',
    subject: 'Indian History',
    title: 'Comprehensive Indian History Compendium',
    description: 'Ancient, Medieval & Modern Indian History curated for UPSC, BPSC, SSC & State PSC.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_hist_1',
        title: 'Indus Valley & Vedic Civilization',
        summary: 'Urban town planning, trade networks, Harappan sites, and early Vedic assemblies.',
        contentText:
          'The Indus Valley Civilization (c. 2600–1900 BCE) represents South Asia’s first urban culture. Major centres included Harappa (Ravi river), Mohenjo-daro (Indus), Lothal (dockyard in Gujarat), Dholavira (water conservation), and Kalibangan (ploughed fields). Rigvedic polity centered on Sabha and Samiti assemblies.',
        keyFacts: [
          'Great Bath and bronze Dancing Girl discovered at Mohenjo-daro.',
          'Lothal featured a tidal dockyard and bead-making workshops.',
          'Dholavira is a UNESCO World Heritage Site featuring 3-tier town division.',
        ],
        linkedTopic: 'Ancient Civilizations',
      },
      {
        id: 'ch_hist_2',
        title: 'Indian National Movement (1885–1947)',
        summary: 'INC sessions, Partition of Bengal, Non-Cooperation, Dandi March, and Quit India.',
        contentText:
          'From the foundation of the Indian National Congress in 1885 to Purna Swaraj (Lahore 1929), key turning points included the Swadeshi Movement (1905), Champaran Satyagraha (1917), Non-Cooperation (1920–22), Civil Disobedience (1930), and Quit India Movement (1942).',
        keyFacts: [
          'Champaran (1917) was Gandhi’s first Civil Disobedience in India.',
          '1929 Lahore Session under Jawaharlal Nehru declared Purna Swaraj.',
          'Quit India Resolution was passed on 8 August 1942 at Gowalia Tank, Bombay.',
        ],
        linkedTopic: 'Gandhian Movements',
      },
    ],
  },
  {
    id: 'gk_indian_geography',
    subject: 'Indian Geography',
    title: 'Physical & Human Geography of India',
    description: 'Physiographic divisions, Himalayan & Peninsular rivers, monsoons, soils, and biosphere reserves.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_geo_1',
        title: 'Himalayan & Peninsular Drainage Systems',
        summary: 'Ganga, Brahmaputra, Indus basins compared with Godavari, Krishna, and Narmada.',
        contentText:
          'Himalayan rivers are perennial (snow-fed + rain-fed) and form meanders and deltas, whereas Peninsular rivers are mostly seasonal. Key Ganga tributaries in Bihar include Gandak, Kosi, Son, and Bagmati.',
        keyFacts: [
          'Kosi joins the Ganga near Kursela in Katihar, Bihar.',
          'Godavari is the largest Peninsular river (Dakshin Ganga).',
          'Narmada and Tapi flow westward through rift valleys into the Arabian Sea.',
        ],
        linkedTopic: 'River Systems of Bihar',
      },
    ],
  },
  {
    id: 'gk_indian_polity',
    subject: 'Indian Polity',
    title: 'Constitution of India & Governance Handbook',
    description: 'Preamble, Fundamental Rights, DPSP, Parliament, Judiciary, and Panchayati Raj.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_pol_1',
        title: 'Fundamental Rights (Articles 12–35)',
        summary: 'Six fundamental rights, writ jurisdiction under Article 32 & 226, and Basic Structure.',
        contentText:
          'Part III of the Constitution guarantees Fundamental Rights including Right to Equality (Art 14–18), Freedom (Art 19–22), Right against Exploitation (Art 23–24), Freedom of Religion (Art 25–28), Cultural & Educational Rights (Art 29–30), and Constitutional Remedies (Art 32).',
        keyFacts: [
          'Article 32 was called the "Heart and Soul of the Constitution" by Dr. B.R. Ambedkar.',
          'Right to Education (Article 21A) was added by the 86th Amendment Act, 2002.',
          'Kesavananda Bharati (1973) established the Basic Structure Doctrine.',
        ],
        linkedTopic: 'Article 21 & Privacy',
      },
    ],
  },
  {
    id: 'gk_indian_economy',
    subject: 'Indian Economy',
    title: 'Macroeconomics, RBI & Public Finance',
    description: 'Monetary policy, GST, Union Budget, NITI Aayog, and financial inclusion.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_eco_1',
        title: 'RBI Monetary Policy Tools & Banking',
        summary: 'Repo rate, Reverse Repo, CRR, SLR, MPC framework, and NPCI digital payments.',
        contentText:
          'The Monetary Policy Committee (MPC) targets CPI inflation at 4% (±2%). Quantitative tools include Repo Rate, Standing Deposit Facility (SDF), Cash Reserve Ratio (CRR), and Statutory Liquidity Ratio (SLR).',
        keyFacts: [
          'MPC has 6 members (3 RBI + 3 Government nominees) chaired by the RBI Governor.',
          'NPCI operates UPI, IMPS, AePS, and RuPay.',
        ],
        linkedTopic: 'RBI Tools & SLR',
      },
    ],
  },
  {
    id: 'gk_general_science',
    subject: 'General Science',
    title: 'Everyday General Science for Competitive Exams',
    description: 'Units, optics, acids/bases, vitamins, diseases, and space missions.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_gs_1',
        title: 'Human Nutrition, Vitamins & Common Diseases',
        summary: 'Fat-soluble (A,D,E,K) vs water-soluble (B-complex, C) vitamins and deficiency disorders.',
        contentText:
          'Vitamins are micronutrients essential for metabolism. Water-soluble vitamins B and C require regular dietary intake, whereas A, D, E, and K are stored in adipose tissue and liver.',
        keyFacts: [
          'Vitamin C (Ascorbic Acid) deficiency causes Scurvy.',
          'Vitamin D (Calciferol) deficiency causes Rickets in children and Osteomalacia in adults.',
          'pH of pure neutral water at 25 °C is 7.0.',
        ],
        linkedTopic: 'Deficiency Diseases',
      },
    ],
  },
  {
    id: 'gk_physics',
    subject: 'Physics',
    title: 'Core Physics Formulas & Concepts (NEET / JEE / SSC)',
    description: 'Mechanics, Electrostatics, Current Electricity, Optics, and Modern Physics.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_phy_1',
        title: 'Electrostatics & Current Electricity',
        summary: 'Gauss Law, electric flux symmetry, Ohm Law, Kirchhoff laws, and equivalent circuits.',
        contentText:
          'Gauss Law relates total electric flux through a closed surface to enclosed charge: Φ = q_in / ε₀. In parallel resistor networks, voltage remains identical across branches and 1/Req = Σ(1/Ri).',
        keyFacts: [
          'Flux through one face of a cube with charge q at its center = q/(6ε₀).',
          'Drift velocity v_d = I / (n·e·A).',
        ],
        linkedTopic: 'Gauss Law',
      },
    ],
  },
  {
    id: 'gk_chemistry',
    subject: 'Chemistry',
    title: 'Inorganic, Organic & Physical Chemistry Notes',
    description: 'Atomic structure, chemical bonding, thermodynamics, and named reactions.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_chem_1',
        title: 'Chemical Bonding & Thermodynamics',
        summary: 'VSEPR geometries, hybridisation shortcuts, and Gibbs Free Energy criterion.',
        contentText:
          'Steric number determines hybridisation: 2→sp (linear), 3→sp² (trigonal planar), 4→sp³ (tetrahedral). Spontaneity at constant T, P requires ΔG = ΔH − TΔS < 0.',
        keyFacts: [
          'BF₃ is sp² hybridised, planar, and non-polar despite polar B–F bonds.',
          'At equilibrium, ΔG = 0.',
        ],
        linkedTopic: 'Hybridisation & VSEPR',
      },
    ],
  },
  {
    id: 'gk_biology',
    subject: 'Biology',
    title: 'NCERT-Aligned Botany & Zoology High-Yield Notes',
    description: 'Cell biology, genetics, human physiology, ecology, and plant kingdoms.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_bio_1',
        title: 'Cell Division: Mitosis & Meiosis',
        summary: 'Substages of Prophase I (L-Z-P-D-D) and significance of crossing over.',
        contentText:
          'Prophase I of Meiosis I comprises Leptotene (condensation), Zygotene (synapsis), Pachytene (crossing over via recombinase), Diplotene (chiasmata visible), and Diakinesis (terminalisation).',
        keyFacts: [
          'Crossing over occurs in Pachytene between non-sister chromatids of homologous chromosomes.',
          'Synaptonemal complex forms during Zygotene.',
        ],
        linkedTopic: 'Meiosis I - Prophase I',
      },
    ],
  },
  {
    id: 'gk_computer',
    subject: 'Computer Awareness',
    title: 'Computer Fundamentals, Networking & Cyber Security',
    description: 'Hardware architecture, memory hierarchy, OSI layers, DBMS, and MS Office.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_comp_1',
        title: 'Memory Hierarchy & Networking Basics',
        summary: 'Registers, Cache, RAM, ROM, SSD, TCP/IP vs OSI model.',
        contentText:
          'Memory speed increases from Secondary Storage (HDD/SSD) → RAM → L1/L2/L3 Cache → CPU Registers. RAM is volatile whereas ROM and flash storage retain state without power.',
        keyFacts: [
          '1 Kilobyte (KB) = 1024 Bytes; 1 Nibble = 4 Bits.',
          'HTTP uses port 80; HTTPS uses port 443.',
        ],
        linkedTopic: 'Memory Hierarchy',
      },
    ],
  },
  {
    id: 'gk_bihar_gk',
    subject: 'Bihar GK',
    title: 'Bihar Samanya Gyan (Darbhanga, Mithila & BPSC Special)',
    description: 'Complete Bihar history, geography, Mithila heritage, economy, rivers, and administrative profile.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_bh_1',
        title: 'Ancient Magadha, Mithila & Modern Bihar',
        summary: 'Mahajanapadas, Champaran Satyagraha, Dr. Rajendra Prasad, and Mithila cultural heritage.',
        contentText:
          'Bihar was home to ancient republics like Vajji (Vaishali) and empires of Magadha (Maurya, Gupta). Darbhanga is the cultural capital of Mithila, famous for Maithili literature (Vidyapati), Mithila painting, and Makhana cultivation.',
        keyFacts: [
          'Darbhanga and Madhubani lead India in GI-tagged Mithila Makhana & Madhubani Painting.',
          'Champaran Satyagraha (1917) was led by Mahatma Gandhi on Raj Kumar Shukla’s invitation.',
          'Valmiki National Park (West Champaran) is Bihar’s Tiger Reserve.',
        ],
        linkedTopic: 'Champaran Satyagraha',
      },
    ],
  },
  {
    id: 'gk_general_knowledge',
    subject: 'General Knowledge',
    title: 'Static GK Master Reference (Awards, Capitals & Bodies)',
    description: 'Constitutional dates, international headquarters, Nobel/Bharat Ratna, and classical arts.',
    pdfDownloadAllowed: true,
    chapters: [
      {
        id: 'ch_gk_1',
        title: 'Constitutional Milestones & National Institutions',
        summary: 'Key dates of Indian Republic, Election Commission, CAG, and Finance Commission.',
        contentText:
          'The Constituent Assembly met first on 9 December 1946, adopted the Constitution on 26 November 1949, and enforced it on 26 January 1950.',
        keyFacts: [
          '26 November is observed annually as Constitution Day (Samvidhan Diwas).',
          'Dr. Sachchidananda Sinha was the temporary President; Dr. Rajendra Prasad became permanent President on 11 Dec 1946.',
        ],
        linkedTopic: 'Constitutional Dates',
      },
    ],
  },
];

const INITIAL_CURRENT_AFFAIRS: Array<{
  id: string;
  date: string;
  category: CurrentAffairsCategory;
  titleEn: string;
  titleHi: string;
  summaryEn: string;
  summaryHi: string;
  sourceTitle: string;
  sourceUrl: string;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}> = [
  {
    id: 'ca_seed_1',
    date: new Date().toISOString().slice(0, 10),
    category: 'Bihar Current Affairs',
    titleEn: 'Darbhanga & Mithila Makhana Export Promotion Expansion',
    titleHi: 'दरभंगा और मिथिला मखाना निर्यात संवर्धन का विस्तार',
    summaryEn:
      'Mithila Makhana, awarded the Geographical Indication (GI) tag, continues to expand value-added processing clusters across Darbhanga and Madhubani districts with central food-processing support.',
    summaryHi:
      'भौगोलिक संकेतक (GI) टैग प्राप्त मिथिला मखाना ने दरभंगा और मधुबनी जिलों में प्रसंस्करण इकाइयों के माध्यम से राष्ट्रीय और अंतरराष्ट्रीय बाजारों में अपनी पहुंच बढ़ाई है।',
    sourceTitle: 'Press Information Bureau (PIB India)',
    sourceUrl: 'https://pib.gov.in',
    questionText: 'Which agricultural aquatic crop from the Darbhanga-Madhubani region holds a Geographical Indication (GI) tag as "Mithila Makhana"?',
    options: ['Fox Nut (Euryale ferox)', 'Basmati Rice', 'Katarni Paddy', 'Shahi Litchi'],
    correctIndex: 0,
    explanation: 'Mithila Makhana (Fox Nut / Gorgon Nut) received the GI tag in 2022, centered around Darbhanga and Madhubani.',
  },
  {
    id: 'ca_seed_2',
    date: new Date().toISOString().slice(0, 10),
    category: 'National',
    titleEn: 'Digital Public Infrastructure & UPI Cross-Border Interoperability',
    titleHi: 'डिजिटल पब्लिक इंफ्रास्ट्रक्चर और यूपीआई सीमा-पार विस्तार',
    summaryEn:
      'NPCI International continues expanding real-time UPI merchant QR acceptance across partner countries, strengthening India’s Digital Public Infrastructure leadership.',
    summaryHi:
      'एनपीसीआई इंटरनेशनल सहयोगी देशों में रियल-टाइम यूपीआई मर्चेंट क्यूआर भुगतान का विस्तार कर रहा है, जिससे भारत के डिजिटल पब्लिक इंफ्रास्ट्रक्चर को मजबूती मिली है।',
    sourceTitle: 'NPCI Official Releases',
    sourceUrl: 'https://www.npci.org.in',
    questionText: 'Which organization manages India’s Unified Payments Interface (UPI) and its international cross-border partnerships?',
    options: ['TRAI', 'NPCI', 'IRDAI', 'PFRDA'],
    correctIndex: 1,
    explanation: 'The National Payments Corporation of India (NPCI) and its subsidiary NPCI International oversee UPI operations.',
  },
];

export async function ensureExamBootstrap(): Promise<boolean> {
  const snap = await getDoc(doc(db, 'exams', 'exam_upsc'));
  return snap.exists();
}

export async function backfillQuestionPublishedFlags(): Promise<number> {
  const snap = await getDocs(collection(db, 'questions'));
  const toPatch = snap.docs.filter((d) => typeof d.data().published !== 'boolean');
  if (toPatch.length === 0) return 0;

  let updated = 0;
  for (let i = 0; i < toPatch.length; i += 400) {
    const chunk = toPatch.slice(i, i + 400);
    const batch = writeBatch(db);
    chunk.forEach((d) => {
      const data = d.data();
      const shouldPublish = data.verificationStatus !== 'needs_review';
      batch.update(doc(db, 'questions', d.id), {
        published: shouldPublish,
        updatedAt: serverTimestamp(),
      });
      updated += 1;
    });
    await batch.commit();
  }
  return updated;
}

export async function seedExamPlatformData(idToken: string | null): Promise<{
  exams: number;
  questions: number;
  gkBooks: number;
}> {
  const batch = writeBatch(db);

  // 1. Seed 15 Exam Categories (strip `id` to match strict firestore.rules hasOnly whitelist)
  DEFAULT_EXAM_CATEGORIES.forEach((ex) => {
    const { id, ...examPayload } = ex;
    batch.set(doc(db, 'exams', id), {
      ...examPayload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 2. Seal starter questions + CA MCQs via server vault if token available
  const allToSeal = [
    ...STARTER_QUESTIONS.map((q) => ({
      id: q.id,
      questionText: q.questionText,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    })),
    ...INITIAL_CURRENT_AFFAIRS.map((c) => ({
      id: `q_${c.id}`,
      questionText: c.questionText,
      options: c.options,
      correctIndex: c.correctIndex,
      explanation: c.explanation,
    })),
  ];

  const sealedMap = new Map<
    string,
    { fingerprint: string; normalizedText: string; answerSeal: string }
  >();

  if (idToken) {
    try {
      const res = await fetch('/api/exams/seal-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ items: allToSeal }),
      });
      if (res.ok) {
        const data = await res.json();
        (data.sealed || []).forEach((s: any) => {
          sealedMap.set(s.id, {
            fingerprint: s.fingerprint,
            normalizedText: s.normalizedText,
            answerSeal: s.answerSeal,
          });
        });
      }
    } catch (e) {
      console.warn('Seal endpoint skipped during offline seed:', e);
    }
  }

  // Fallback check: only write questions that received a valid server answerSeal
  let qCount = 0;
  const subjectsSeen = new Set<string>();
  const chaptersSeen = new Set<string>();

  STARTER_QUESTIONS.forEach((q, idx) => {
    const sealed = sealedMap.get(q.id);
    if (!sealed) return;
    qCount += 1;
    batch.set(doc(db, 'questions', q.id), {
      questionCode: `Q-${q.examName.replace(/[^A-Z]/gi, '').slice(0, 4).toUpperCase()}-${q.examYear}-${String(idx + 1).padStart(3, '0')}`,
      examName: q.examName,
      examCategory: q.examCategory,
      subject: q.subject,
      chapter: q.chapter,
      topic: q.topic,
      questionText: q.questionText,
      options: q.options,
      difficulty: q.difficulty,
      examYear: q.examYear,
      examShift: q.examShift || '',
      source: q.source,
      language: q.language,
      verificationStatus: 'verified',
      published: true,
      usageCount: 0,
      hasDiagramOrTable: false,
      fingerprint: sealed.fingerprint,
      normalizedText: sealed.normalizedText,
      answerSeal: sealed.answerSeal,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'question_keys', q.id), {
      questionId: q.id,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      derivedBy: 'official_key',
      updatedAt: serverTimestamp(),
    });

    const subKey = `${q.examName}__${q.subject}`;
    if (!subjectsSeen.has(subKey)) {
      subjectsSeen.add(subKey);
      batch.set(doc(db, 'exam_subjects', `sub_${subKey.toLowerCase().replace(/[^a-z0-9]/g, '_')}`), {
        examName: q.examName,
        name: q.subject,
        active: true,
        createdAt: serverTimestamp(),
      });
    }

    const chapKey = `${q.examName}__${q.subject}__${q.chapter}`;
    if (!chaptersSeen.has(chapKey)) {
      chaptersSeen.add(chapKey);
      batch.set(doc(db, 'exam_chapters', `chap_${chapKey.toLowerCase().replace(/[^a-z0-9]/g, '_')}`), {
        examName: q.examName,
        subjectName: q.subject,
        name: q.chapter,
        topics: [q.topic],
        active: true,
        createdAt: serverTimestamp(),
      });
    }
  });

  // 3. Seed Current Affairs + linked sealed questions
  INITIAL_CURRENT_AFFAIRS.forEach((c) => {
    const qId = `q_${c.id}`;
    const sealed = sealedMap.get(qId);
    if (sealed) {
      batch.set(doc(db, 'questions', qId), {
        questionCode: `Q-CA-${c.date.replace(/-/g, '')}`,
        examName: 'UPSC',
        examCategory: 'Current Affairs',
        subject: 'Current Affairs',
        chapter: c.category,
        topic: c.titleEn.slice(0, 60),
        questionText: c.questionText,
        options: c.options,
        difficulty: 'medium',
        examYear: Number(c.date.slice(0, 4)),
        source: 'current_affairs',
        language: 'en',
        verificationStatus: 'verified',
        published: true,
        usageCount: 0,
        fingerprint: sealed.fingerprint,
        normalizedText: sealed.normalizedText,
        answerSeal: sealed.answerSeal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'question_keys', qId), {
        questionId: qId,
        correctIndex: c.correctIndex,
        explanation: c.explanation,
        derivedBy: 'official_key',
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'current_affairs', c.id), {
      date: c.date,
      month: c.date.slice(0, 7),
      year: Number(c.date.slice(0, 4)),
      category: c.category,
      titleEn: c.titleEn,
      titleHi: c.titleHi,
      summaryEn: c.summaryEn,
      summaryHi: c.summaryHi,
      sourceTitle: c.sourceTitle,
      sourceUrl: c.sourceUrl,
      publishedDate: c.date,
      linkedQuestionIds: sealed ? [qId] : [],
      status: 'published',
      autoCollected: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  // 4. Seed all 11 Digital GK Books
  STARTER_GK_BOOKS.forEach((b) => {
    batch.set(doc(db, 'gk_books', b.id), {
      subject: b.subject,
      title: b.title,
      description: b.description,
      chapters: b.chapters,
      pdfDownloadAllowed: b.pdfDownloadAllowed,
      updatedAt: serverTimestamp(),
    });
  });

  // 5. Current Affairs Scheduler Metadata
  batch.set(doc(db, 'current_affairs_settings', 'main'), {
    autoPublishEnabled: false,
    paused: false,
    lastRunAt: new Date().toISOString(),
    lastRunCount: INITIAL_CURRENT_AFFAIRS.length,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  return {
    exams: DEFAULT_EXAM_CATEGORIES.length,
    questions: qCount,
    gkBooks: STARTER_GK_BOOKS.length,
  };
}
