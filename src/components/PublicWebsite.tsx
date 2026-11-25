import React, { useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Check,
  ChevronDown,
  Clock,
  Globe,
  Mail,
  MapPin,
  Menu,
  Moon,
  Newspaper,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  AnnouncementRecord,
  CurrentAffairsItem,
  DEFAULT_FACILITIES,
  DEFAULT_GYAN_ADDA_SETTINGS,
  DigitalGKBook,
  ExamCategory,
  GalleryItem,
  LibrarySettings,
  MembershipPlan,
  SeatRecord,
} from '../types/library';
import { DEMO_IMAGES } from '../lib/demoSeed';
import { BrandLogo } from './BrandLogo';
import { LibraryMap } from './LibraryMap';
import { CurrentAffairsModule } from './exam/CurrentAffairsModule';
import { DigitalGKBookModule } from './exam/DigitalGKBookModule';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface PublicWebsiteProps {
  settings: LibrarySettings | null;
  plans: MembershipPlan[];
  seats: SeatRecord[];
  gallery: GalleryItem[];
  announcements: AnnouncementRecord[];
  exams: ExamCategory[];
  currentAffairs: CurrentAffairsItem[];
  gkBooks: DigitalGKBook[];
  totalBooksCount: number;
  totalQuestionsCount: number;
  isSignedIn: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAuth: (tab: 'login' | 'register') => void;
  onOpenPortal: (initialTab?: string) => void;
  quotaExceeded: boolean;
}

const TESTIMONIALS = [
  {
    name: 'Raghavendra Singh',
    role: 'UPSC & BPSC Aspirant',
    org: 'Mirzapur Study Hall',
    quote:
      'Moving to Gyan Adda Self-Study Center in Mirzapur Chowk transformed my preparation. Full air conditioning, bright LED desk lamps, and 24-hour quiet seating boosted my focused daily study to 10+ hours.',
  },
  {
    name: 'Dr. Anjali Kumari',
    role: 'NEET PG Candidate',
    org: '24-Hour Member',
    quote:
      'Between chilled RO water, comfortable chairs, and instant AI PYQ mock tests in the student portal, everything I need for medical revision is in one place.',
  },
  {
    name: 'Prashant Jha',
    role: 'SSC CGL & Banking Scholar',
    org: 'Darbhanga Campus',
    quote:
      'The Digital GK Books including Bihar Special and negative-marking mock analytics helped pinpoint my weak math chapters within weeks.',
  },
];

const FAQS = [
  {
    q: 'Where is VIDHYA LIBRARY (Gyan Adda Self-Study Center) located in Darbhanga?',
    a: 'We are located on the 2nd Floor, Station Rd, in front of Poor Home Road, Mirzapur Chowk, Darbhanga, Bihar 846004 — open 24 hours from Monday through Sunday.',
  },
  {
    q: 'How do I reserve a study desk and access the AI Competitive Exam Portal?',
    a: 'Click Register now to create your free student profile (VL2026XXX). Once inside your Student Portal, select any available desk and launch PYQ tests, AI Mocks, Current Affairs, and Digital GK Books.',
  },
  {
    q: 'Which competitive exams are supported on the AI Examination Platform?',
    a: 'We support NEET UG, JEE Main, JEE Advanced, NDA, UPSC, BPSC, SSC CGL, SSC CHSL, SSC MTS, Railway NTPC, Railway Group D, Bihar Police, Bihar SSC, Banking, and custom exams added by our academic desk.',
  },
  {
    q: 'Which online payment methods are accepted for membership fees?',
    a: 'Online payments work seamlessly via Razorpay supporting UPI, Debit/Credit Cards, and Net Banking with instant downloadable payment receipts, alongside cash/UPI payments verified at the campus desk.',
  },
];

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({
  settings,
  plans,
  seats,
  gallery,
  announcements,
  exams,
  currentAffairs,
  gkBooks,
  totalBooksCount,
  totalQuestionsCount,
  isSignedIn,
  darkMode,
  onToggleDarkMode,
  onOpenAuth,
  onOpenPortal,
  quotaExceeded,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string>('ALL');
  const [galleryCategory, setGalleryCategory] = useState<string>('ALL');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [quickSearch, setQuickSearch] = useState('');
  const [publicHubTab, setPublicHubTab] = useState<'none' | 'news' | 'books'>('none');

  // Contact form
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactFeedback, setContactFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const effectiveSettings: LibrarySettings = settings || {
    ...DEFAULT_GYAN_ADDA_SETTINGS,
    facilities: DEFAULT_FACILITIES,
  };

  const seatCounts = useMemo(() => {
    const total = seats.length;
    const available = seats.filter((s) => s.status === 'available').length;
    const occupied = seats.filter((s) => s.status === 'occupied').length;
    const reserved = seats.filter((s) => s.status === 'reserved').length;
    return { total, available, occupied, reserved };
  }, [seats]);

  const zones = useMemo(() => {
    const unique = Array.from(new Set(seats.map((s) => s.zone)));
    return ['ALL', ...unique];
  }, [seats]);

  const filteredSeats = useMemo(() => {
    if (selectedZone === 'ALL') return seats;
    return seats.filter((s) => s.zone === selectedZone);
  }, [seats, selectedZone]);

  const displayGallery = useMemo(() => {
    const source: GalleryItem[] =
      gallery.length > 0
        ? gallery
        : [
            {
              id: 'fallback-1',
              title: 'Gyan Adda Main Reading Hall · Darbhanga',
              category: 'Reading Hall',
              imageUrl: DEMO_IMAGES.hero,
              caption: 'Spacious individual study desks with comfortable chairs, LED lighting, and full AC.',
              sortOrder: 1,
              createdAt: null,
            },
            {
              id: 'fallback-2',
              title: 'Silent AC Study Cubicles · Mirzapur Chowk',
              category: 'Silent Zone',
              imageUrl: DEMO_IMAGES.silentZone,
              caption: 'Quiet partitioned desks designed for deep UPSC, BPSC, NEET & JEE concentration.',
              sortOrder: 2,
              createdAt: null,
            },
          ];
    if (galleryCategory === 'ALL') return source;
    return source.filter((g) => g.category === galleryCategory);
  }, [gallery, galleryCategory]);

  const galleryCategories = useMemo(() => {
    const cats = Array.from(
      new Set(
        gallery.length > 0
          ? gallery.map((g) => g.category)
          : ['Reading Hall', 'Silent Zone']
      )
    );
    return ['ALL', ...cats];
  }, [gallery]);

  const displayExams = useMemo(() => {
    const base =
      exams.length > 0
        ? exams.filter((e) => e.active)
        : [
            { id: '1', name: 'UPSC', categoryGroup: 'Civil Services', description: 'IAS / IPS Prelims PYQs & Mocks' },
            { id: '2', name: 'BPSC', categoryGroup: 'State PSC', description: 'Bihar PCS Prelims & Bihar Special' },
            { id: '3', name: 'NEET UG', categoryGroup: 'Medical', description: 'NCERT Biology, Physics & Chemistry' },
            { id: '4', name: 'JEE Main', categoryGroup: 'Engineering', description: 'NTA Pattern Physics, Chem & Maths' },
            { id: '5', name: 'SSC CGL', categoryGroup: 'SSC', description: 'Quantitative, English & Reasoning CBT' },
            { id: '6', name: 'Bihar Police', categoryGroup: 'State Police', description: 'Constable & SI Practice Tests' },
          ];
    const q = quickSearch.trim().toLowerCase();
    if (!q) return base.slice(0, 6);
    return base.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.categoryGroup || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
    );
  }, [exams, quickSearch]);

  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactSubmitting(true);
    setContactFeedback(null);
    try {
      const ref = await addDoc(collection(db, 'enquiries'), {
        name: contactName.trim(),
        email: contactEmail.trim(),
        phone: contactPhone.trim(),
        subject: contactSubject.trim() || 'Membership & Seat Enquiry',
        message: contactMessage.trim(),
        status: 'new',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setContactFeedback({
        type: 'ok',
        text: `Enquiry received (Ref: ${ref.id.slice(0, 8)}). Our Darbhanga desk will contact you shortly.`,
      });
      setContactName('');
      setContactEmail('');
      setContactPhone('');
      setContactSubject('');
      setContactMessage('');
    } catch (err: any) {
      setContactFeedback({
        type: 'err',
        text: err?.message || 'Unable to submit enquiry. Please verify all fields.',
      });
    } finally {
      setContactSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface dark:bg-slate-950 dark:text-slate-100">
      {/* Top Public Navigation */}
      <header className="sticky top-0 z-40 bg-surface-container-lowest/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-outline-variant dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <a href="#top" className="whitespace-nowrap shrink-0">
            <BrandLogo variant={darkMode ? 'light' : 'dark'} />
          </a>

          <nav aria-label="Public navigation" className="hidden lg:flex items-center gap-6">
            <a href="#about" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Study Halls
            </a>
            <a href="#exams" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Exams &amp; AI Hub
            </a>
            <a href="#facilities" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Facilities
            </a>
            <a href="#plans" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Membership Plans
            </a>
            <a href="#seats" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Live Seats
            </a>
            <a href="#contact" className="text-sm font-semibold text-on-surface-variant hover:text-primary dark:text-slate-300 dark:hover:text-white transition-colors whitespace-nowrap">
              Contact
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle color theme"
              className="w-9 h-9 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low flex items-center justify-center transition-colors"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {!isSignedIn && (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded bg-surface-container-lowest dark:bg-slate-800 text-primary dark:text-white border border-outline-variant dark:border-slate-700 hover:bg-surface-container-low text-sm font-semibold transition-colors whitespace-nowrap"
              >
                Student Login
              </button>
            )}
            <button
              type="button"
              onClick={isSignedIn ? () => onOpenPortal() : () => onOpenAuth('register')}
              className="inline-flex items-center justify-center px-4 py-2 rounded bg-primary text-on-primary hover:bg-primary-container text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {isSignedIn ? 'Open Portal' : 'Join Now'}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded border border-outline-variant dark:border-slate-700 text-on-surface dark:text-slate-200 hover:bg-surface-container-low"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-900 px-4 py-4 space-y-2">
            {[
              ['Study Halls & About', '#about'],
              ['Exams & AI Hub', '#exams'],
              ['Facilities', '#facilities'],
              ['Membership Plans', '#plans'],
              ['Live Seats', '#seats'],
              ['Gallery', '#gallery'],
              ['Contact', '#contact'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-semibold text-on-surface dark:text-slate-200 hover:text-secondary"
              >
                {label}
              </a>
            ))}
            <div className="pt-2 flex gap-2 border-t border-outline-variant dark:border-slate-800">
              {!isSignedIn && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenAuth('login');
                  }}
                  className="flex-1 py-2 rounded border border-outline-variant dark:border-slate-700 text-sm font-semibold text-primary dark:text-white"
                >
                  Student Login
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (isSignedIn) onOpenPortal();
                  else onOpenAuth('register');
                }}
                className="flex-1 py-2 rounded bg-primary text-on-primary text-sm font-semibold"
              >
                {isSignedIn ? 'Open Portal' : 'Register'}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section
          id="top"
          className="bg-surface-container-low dark:bg-slate-900/60 border-b border-outline-variant dark:border-slate-800"
        >
          <div className="max-w-7xl mx-auto px-4 lg:px-8 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <div className="lg:col-span-6 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                  {effectiveSettings.libraryName} · {effectiveSettings.ratingText || '4.9/5 (116 Google Reviews)'}
                </p>
                <h1 className="font-display text-3xl sm:text-4xl lg:text-[40px] lg:leading-[48px] font-extrabold tracking-tight text-primary dark:text-white [text-wrap:balance]">
                  A quiet, structured space built for focused study
                </h1>
                <p className="text-[15px] leading-relaxed text-on-surface-variant dark:text-slate-300 max-w-prose">
                  {effectiveSettings.tagline} Reserve a 24-hour quiet AC reading desk at{' '}
                  <span className="font-semibold text-on-surface dark:text-white">Mirzapur Chowk, Darbhanga</span> — powered by{' '}
                  <span className="font-semibold text-on-surface dark:text-white">AI Mock Tests, Bilingual PYQs, Current Affairs &amp; Digital GK Books</span>.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('register')}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded bg-secondary text-on-secondary hover:bg-primary text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isSignedIn ? 'Launch AI Exam Hub' : 'Apply for Membership'}</span>
                </button>
                <a
                  href="#plans"
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded bg-surface-container-lowest dark:bg-slate-800 text-primary dark:text-white border border-outline-variant dark:border-slate-700 hover:bg-surface-container text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  Explore Membership Plans
                </a>
              </div>

              {announcements.filter((a) => a.published).length > 0 && (
                <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-800 border border-outline-variant dark:border-slate-700 shadow-sm">
                  <p className="text-xs font-semibold text-secondary dark:text-blue-400 mb-1">
                    Notice Board · {announcements.filter((a) => a.published)[0].title}
                  </p>
                  <p className="text-xs text-on-surface-variant dark:text-slate-300 leading-relaxed">
                    {announcements.filter((a) => a.published)[0].body}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-outline-variant dark:border-slate-800">
                <div className="flex flex-col">
                  <span className="font-display text-xl font-bold text-primary dark:text-white tabular-nums">
                    {seatCounts.total > 0 ? `${seatCounts.available}/${seatCounts.total}` : '40 Desks'}
                  </span>
                  <span className="text-xs text-on-surface-variant dark:text-slate-400">Available desks</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-display text-xl font-bold text-primary dark:text-white tabular-nums">
                    {totalBooksCount + (gkBooks.length || 11)}+
                  </span>
                  <span className="text-xs text-on-surface-variant dark:text-slate-400">Library &amp; GK books</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-display text-xl font-bold text-primary dark:text-white tabular-nums">
                    {totalQuestionsCount > 0 ? `${totalQuestionsCount}+` : '15 Tracks'}
                  </span>
                  <span className="text-xs text-on-surface-variant dark:text-slate-400">AI Exam MCQs</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-display text-xl font-bold text-primary dark:text-white tabular-nums">
                    24 Hours
                  </span>
                  <span className="text-xs text-on-surface-variant dark:text-slate-400">Open all 7 days</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6 flex flex-col gap-4">
              <div className="relative rounded-xl overflow-hidden border border-outline-variant dark:border-slate-700 shadow-sm bg-surface-container-lowest">
                <img
                  src={DEMO_IMAGES.hero}
                  alt="Gyan Adda Self-Study Center Darbhanga quiet reading hall with partitioned desks"
                  className="w-full h-72 sm:h-96 object-cover"
                />
              </div>
              <div className="bg-surface-container-lowest dark:bg-slate-800 rounded-lg border border-outline-variant dark:border-slate-700 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <span
                    role="status"
                    aria-label="Open now"
                    className="inline-block w-2.5 h-2.5 rounded-full bg-success shrink-0"
                  />
                  <span className="text-sm font-semibold text-on-surface dark:text-white">
                    {seatCounts.available > 0
                      ? `${seatCounts.available} seats available right now`
                      : 'Open 24 Hours · 7 Days a Week'}
                  </span>
                </div>
                <span className="font-mono text-xs text-on-surface-variant dark:text-slate-400 tabular-nums">
                  {effectiveSettings.openingHours} · Mirzapur Chowk, Darbhanga
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Competitive Exams Quick Search, AI Hub Actions & Track Cards */}
        <section id="exams" className="max-w-7xl mx-auto px-4 lg:px-8 py-10 space-y-6">
          <div className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg border border-outline-variant dark:border-slate-800 p-6 shadow-sm space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-[22px] font-bold text-on-surface dark:text-white">
                  Search Competitive Exams &amp; Learning Modules
                </h2>
                <p className="text-sm text-on-surface-variant dark:text-slate-400">
                  Explore UPSC, BPSC, NEET, JEE, SSC, Bihar Police tests, Daily Current Affairs, and Digital GK Books.
                </p>
              </div>
              <div className="relative w-full md:w-96">
                <Search className="w-4 h-4 text-outline absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={quickSearch}
                  onChange={(e) => setQuickSearch(e.target.value)}
                  placeholder="Search exams (UPSC, BPSC, NEET, JEE, SSC)..."
                  className="w-full pl-10 pr-3 py-2.5 rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-5">
                <div className="aspect-[16/10] rounded-lg overflow-hidden border border-outline-variant dark:border-slate-700 bg-surface-container-low">
                  <img
                    src={DEMO_IMAGES.silentZone}
                    alt="Quiet self-study cubicles at Gyan Adda Self-Study Center Darbhanga"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                  className="p-4 rounded-lg bg-secondary text-on-secondary hover:bg-primary transition-colors flex items-center justify-between gap-3 text-left font-semibold text-sm shadow-sm cursor-pointer"
                >
                  <span>Explore Competitive Exams &amp; PYQ Tests</span>
                  <Sparkles className="w-4 h-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setPublicHubTab(publicHubTab === 'news' ? 'none' : 'news')}
                  className={`p-4 rounded-lg border transition-colors flex items-center justify-between gap-3 text-left font-semibold text-sm cursor-pointer ${
                    publicHubTab === 'news'
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-surface-container-low dark:bg-slate-800 text-primary dark:text-white border-outline-variant dark:border-slate-700 hover:bg-surface-container'
                  }`}
                >
                  <span>Daily Current Affairs &amp; Bihar Updates</span>
                  <Newspaper className="w-4 h-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setPublicHubTab(publicHubTab === 'books' ? 'none' : 'books')}
                  className={`p-4 rounded-lg border transition-colors flex items-center justify-between gap-3 text-left font-semibold text-sm cursor-pointer ${
                    publicHubTab === 'books'
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-surface-container-low dark:bg-slate-800 text-primary dark:text-white border-outline-variant dark:border-slate-700 hover:bg-surface-container'
                  }`}
                >
                  <span>Open {gkBooks.length || 11} Digital GK Books &amp; PDFs</span>
                  <BookOpen className="w-4 h-4 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('seats') : () => onOpenAuth('register')}
                  className="p-4 rounded-lg bg-surface-container-low dark:bg-slate-800 text-primary dark:text-white border border-outline-variant dark:border-slate-700 hover:bg-surface-container transition-colors flex items-center justify-between gap-3 text-left font-semibold text-sm cursor-pointer"
                >
                  <span>Reserve Your 24-Hour AC Study Desk</span>
                  <Award className="w-4 h-4 shrink-0 text-secondary" />
                </button>
              </div>
            </div>

            {publicHubTab === 'news' && (
              <div className="pt-6 border-t border-outline-variant dark:border-slate-800">
                <CurrentAffairsModule items={currentAffairs} questions={[]} />
              </div>
            )}

            {publicHubTab === 'books' && (
              <div className="pt-6 border-t border-outline-variant dark:border-slate-800">
                <DigitalGKBookModule
                  books={gkBooks}
                  questions={[]}
                  bookmarks={[]}
                  userUid={null}
                />
              </div>
            )}

            <div className="pt-2 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-display text-xl font-bold text-on-surface dark:text-white">
                  Popular Competitive Tracks
                </h3>
                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                  className="text-xs sm:text-sm font-semibold text-secondary hover:text-primary dark:text-blue-400"
                >
                  Explore All 15+ Exams →
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayExams.map((ex: any) => (
                  <div
                    key={ex.id || ex.name}
                    className="p-5 rounded-lg bg-surface-container-low dark:bg-slate-800/80 border border-outline-variant dark:border-slate-700 flex flex-col justify-between gap-4 hover:border-secondary transition-colors"
                  >
                    <div>
                      <p className="text-xs font-semibold text-secondary dark:text-blue-400">{ex.categoryGroup}</p>
                      <h4 className="font-display text-lg font-bold text-on-surface dark:text-white mt-1">{ex.name}</h4>
                      <p className="text-xs text-on-surface-variant dark:text-slate-300 mt-1 leading-relaxed">{ex.description}</p>
                    </div>
                    <button
                      type="button"
                      onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                      className="self-start px-3.5 py-1.5 rounded bg-primary text-on-primary hover:bg-primary-container text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Start Practice →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Study Halls & About Section */}
        <section id="about" className="max-w-7xl mx-auto px-4 lg:px-8 py-8 space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                About Gyan Adda Self-Study Center · Vidhya Library
              </p>
              <h2 className="font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white [text-wrap:balance]">
                Designed for uninterrupted preparation in Darbhanga
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-slate-300 leading-relaxed">
                Rated <span className="font-semibold text-on-surface dark:text-white">{effectiveSettings.ratingText || '4.9/5'}</span>, our self-study campus near Mirzapur Chowk combines quiet ergonomic cubicles, chilled RO water, LED study lighting, and AI-assisted competitive test readiness.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
                  <h3 className="text-sm font-bold text-primary dark:text-white">Our Mission</h3>
                  <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-400 leading-relaxed">
                    Deliver quiet, 24-hour climate-controlled study spaces paired with instant AI analytics.
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
                  <h3 className="text-sm font-bold text-primary dark:text-white">Our Vision</h3>
                  <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-400 leading-relaxed">
                    Empower Bihar civil service, medical, SSC, and engineering aspirants under one disciplined roof.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  num: '01',
                  title: 'Guaranteed Desk Exclusivity',
                  desc: 'Real-time live seating map prevents double booking. Reserve your preferred desk directly online.',
                  icon: Users,
                },
                {
                  num: '02',
                  title: 'QR Attendance & Study Analytics',
                  desc: 'Each scholar receives a unique VL2026XXX Student ID and QR pass for instant daily logs.',
                  icon: Clock,
                },
                {
                  num: '03',
                  title: '24/7 CCTV, AC & RO Water',
                  desc: 'Continuous HD CCTV surveillance, full air conditioning, and clean chilled RO drinking water.',
                  icon: ShieldCheck,
                },
                {
                  num: '04',
                  title: 'AI PYQs, Mocks & GK Books',
                  desc: 'Solve unseen AI mocks, Bihar Current Affairs quizzes, and read 11 downloadable GK books.',
                  icon: Globe,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.num}
                    className="bg-surface-container-lowest dark:bg-slate-900 rounded-lg border border-outline-variant dark:border-slate-800 p-5 flex items-start gap-4 shadow-sm"
                  >
                    <div className="w-11 h-11 rounded-md bg-surface-container-low dark:bg-slate-800 text-secondary flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="space-y-1">
                      <span className="font-mono text-[11px] font-medium text-outline">{item.num}</span>
                      <h3 className="text-base font-semibold text-on-surface dark:text-white">{item.title}</h3>
                      <p className="text-sm text-on-surface-variant dark:text-slate-400 leading-relaxed">{item.desc}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* Facilities Section */}
        <section id="facilities" className="bg-surface-container-low dark:bg-slate-900/50 border-y border-outline-variant dark:border-slate-800 py-12">
          <div className="max-w-7xl mx-auto px-4 lg:px-8">
            <div className="max-w-2xl mb-8">
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                Campus Amenities
              </p>
              <h2 className="mt-1 font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white">
                Library Facilities &amp; Study Environment
              </h2>
              <p className="mt-2 text-sm text-on-surface-variant dark:text-slate-400">
                Comfortable cushioned chairs, spacious individual tables, LED study lamps, and silent 24-hour discipline.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {effectiveSettings.facilities.map((facility, idx) => (
                <div
                  key={`${facility}-${idx}`}
                  className="flex items-center gap-3.5 p-4 rounded-lg border border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-900 shadow-sm"
                >
                  <div className="w-9 h-9 rounded-md bg-surface-container-low dark:bg-slate-800 text-secondary flex items-center justify-center shrink-0">
                    {facility.toLowerCase().includes('wi-fi') ? (
                      <Wifi className="w-4 h-4" />
                    ) : facility.toLowerCase().includes('charg') ? (
                      <Zap className="w-4 h-4" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-on-surface dark:text-slate-200">{facility}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Membership Plans */}
        <section id="plans" className="max-w-7xl mx-auto px-4 lg:px-8 py-12">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                Flexible Memberships
              </p>
              <h2 className="mt-1 font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white">
                Membership Plans &amp; Timings
              </h2>
            </div>
            <p className="text-sm text-on-surface-variant dark:text-slate-400 max-w-md">
              Includes reserved study desk plus full Student Portal access to AI Exams, Current Affairs, and Digital GK Books.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            {plans
              .filter((p) => p.active)
              .map((plan, index) => {
                const highlighted = index === 1 || plan.name.toLowerCase().includes('24') || plan.name.toLowerCase().includes('full');
                return (
                  <article
                    key={plan.id}
                    className={`h-full bg-surface-container-lowest dark:bg-slate-900 rounded-lg p-6 flex flex-col justify-between gap-6 shadow-sm ${
                      highlighted
                        ? 'border-2 border-secondary'
                        : 'border border-outline-variant dark:border-slate-800'
                    }`}
                  >
                    <div className="space-y-4">
                      <header className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-bold text-on-surface dark:text-white">
                            {plan.name}
                          </h3>
                          <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-0.5">
                            {plan.durationDays} Days · {plan.timings}
                          </p>
                        </div>
                        {highlighted && (
                          <span className="px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[11px] font-semibold whitespace-nowrap shrink-0">
                            Popular
                          </span>
                        )}
                      </header>

                      <div className="flex items-baseline gap-1">
                        <span className="font-display text-3xl font-bold text-primary dark:text-white tabular-nums">
                          ₹{Number(plan.price).toLocaleString('en-IN')}
                        </span>
                        <span className="text-xs text-on-surface-variant dark:text-slate-400">
                          / {plan.durationDays} days
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-secondary dark:text-blue-400">
                        {plan.seatAccess}
                      </p>

                      <ul className="space-y-2 border-t border-outline-variant dark:border-slate-800 pt-4">
                        {plan.facilities.map((f, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-xs text-on-surface-variant dark:text-slate-300">
                            <Check className="w-3.5 h-3.5 text-success shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <footer className="pt-4 border-t border-outline-variant dark:border-slate-800">
                      <button
                        type="button"
                        onClick={isSignedIn ? () => onOpenPortal('membership') : () => onOpenAuth('register')}
                        className={`w-full py-2.5 px-4 rounded text-sm font-semibold transition-colors cursor-pointer ${
                          highlighted
                            ? 'bg-secondary text-on-secondary hover:bg-primary'
                            : 'bg-surface-container-low dark:bg-slate-800 text-primary dark:text-white hover:bg-surface-container'
                        }`}
                      >
                        {isSignedIn ? 'Select in Portal' : 'Join With This Plan'}
                      </button>
                    </footer>
                  </article>
                );
              })}
          </div>
        </section>

        {/* Available Study Seats Live Grid */}
        <section id="seats" className="bg-surface-container-low dark:bg-slate-900/50 border-y border-outline-variant dark:border-slate-800 py-12">
          <div className="max-w-7xl mx-auto px-4 lg:px-8">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                  Live Seating Layout
                </p>
                <h2 className="mt-1 font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white">
                  Available Study Seats
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-on-surface-variant dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-success inline-block" /> Available ({seatCounts.available})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-error inline-block" /> Occupied ({seatCounts.occupied})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-warning inline-block" /> Reserved ({seatCounts.reserved})
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 p-1 bg-surface-container-lowest dark:bg-slate-900 rounded border border-outline-variant dark:border-slate-800">
                {zones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setSelectedZone(z)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                      selectedZone === z
                        ? 'bg-primary text-on-primary'
                        : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low'
                    }`}
                  >
                    {z === 'ALL' ? 'All Zones' : z}
                  </button>
                ))}
              </div>
            </div>

            {filteredSeats.length === 0 ? (
              <div className="p-8 rounded-lg border border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-900 text-center text-sm text-on-surface-variant dark:text-slate-400">
                Live seat layout initializes upon admin setup.
              </div>
            ) : (
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
                {filteredSeats.map((seat) => {
                  const styleMap: Record<string, string> = {
                    available: 'bg-success-container border-success text-on-success-container hover:opacity-90 cursor-pointer',
                    occupied: 'bg-error-container border-error/40 text-on-error-container cursor-not-allowed opacity-90',
                    reserved: 'bg-warning-container border-warning/40 text-on-warning-container cursor-not-allowed',
                    maintenance: 'bg-surface-variant border-outline-variant text-on-surface-variant cursor-not-allowed',
                  };
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      onClick={() => {
                        if (seat.status === 'available') {
                          if (isSignedIn) onOpenPortal('seats');
                          else onOpenAuth('register');
                        }
                      }}
                      title={`${seat.seatCode} · ${seat.zone} · ${seat.status.toUpperCase()}`}
                      className={`p-2.5 rounded border text-center transition-all ${styleMap[seat.status]}`}
                    >
                      <div className="font-mono text-xs font-bold tabular-nums">{seat.seatCode}</div>
                      <div className="text-[10px] mt-0.5 capitalize font-medium">{seat.status}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Gallery Section */}
        <section id="gallery" className="max-w-7xl mx-auto px-4 lg:px-8 py-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-blue-400">
                Inside Our Darbhanga Campus
              </p>
              <h2 className="mt-1 font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white">
                Library Gallery
              </h2>
            </div>

            <div className="flex flex-wrap gap-1 p-1 bg-surface-container-lowest dark:bg-slate-900 rounded border border-outline-variant dark:border-slate-800">
              {galleryCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setGalleryCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap cursor-pointer ${
                    galleryCategory === cat
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low'
                  }`}
                >
                  {cat === 'ALL' ? 'All Photos' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {displayGallery.map((item) => (
              <div
                key={item.id}
                className="rounded-lg overflow-hidden bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm"
              >
                <div className="aspect-[16/10] bg-surface-container-low overflow-hidden">
                  <img
                    src={item.imageUrl}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-5">
                  <p className="text-xs font-semibold text-secondary dark:text-blue-400">{item.category}</p>
                  <h3 className="mt-1 text-base font-bold text-on-surface dark:text-white">{item.title}</h3>
                  <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-400">{item.caption}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Testimonials & FAQ */}
        <section className="bg-surface-container-low dark:bg-slate-900/50 border-y border-outline-variant dark:border-slate-800 py-12">
          <div className="max-w-7xl mx-auto px-4 lg:px-8 space-y-10">
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-xs font-semibold text-secondary dark:text-blue-400 inline-flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                  {effectiveSettings.ratingText || '4.9/5 Rating · 116 Google Reviews'}
                </p>
                <h2 className="mt-1 font-display text-[28px] leading-[34px] font-bold text-on-surface dark:text-white">
                  What Our Scholars Say
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {TESTIMONIALS.map((t) => (
                  <div
                    key={t.name}
                    className="p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm flex flex-col justify-between space-y-4"
                  >
                    <p className="text-sm text-on-surface dark:text-slate-200 leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                    <div className="text-xs text-on-surface-variant dark:text-slate-400 pt-3 border-t border-outline-variant dark:border-slate-800">
                      <p className="font-bold text-primary dark:text-white">{t.name}</p>
                      <p>{t.role} · {t.org}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="max-w-4xl mx-auto space-y-4">
              <h2 className="font-display text-2xl font-bold text-on-surface dark:text-white text-center">
                Frequently Asked Questions
              </h2>
              <div className="space-y-3">
                {FAQS.map((faq, idx) => {
                  const open = openFaq === idx;
                  return (
                    <div
                      key={faq.q}
                      className="rounded-lg border border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-900 overflow-hidden shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : idx)}
                        className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 text-sm font-semibold text-on-surface dark:text-white cursor-pointer"
                      >
                        <span>{faq.q}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-on-surface-variant shrink-0 transition-transform ${
                            open ? 'rotate-180' : ''
                          }`}
                        />
                      </button>
                      {open && (
                        <div className="px-5 pb-4 text-sm text-on-surface-variant dark:text-slate-300 leading-relaxed">
                          {faq.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Contact Banner + Map & Enquiry Form */}
        <section id="contact" className="max-w-7xl mx-auto px-4 lg:px-8 py-12 space-y-8">
          <div className="p-6 sm:p-8 rounded-lg bg-primary text-on-primary flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-on-primary">
                Want To Know More? Contact Us
              </h2>
              <p className="text-sm text-on-primary-container mt-1">
                Speak directly with our Darbhanga reading hall admissions desk on WhatsApp or visit us 24/7.
              </p>
            </div>
            <a
              href={`https://wa.me/${effectiveSettings.whatsapp.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-surface-container-lowest hover:text-primary transition-colors whitespace-nowrap shrink-0"
            >
              WhatsApp Desk
            </a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold text-secondary dark:text-blue-400">
                    <Phone className="w-3.5 h-3.5" /> Phone &amp; WhatsApp
                  </div>
                  <p className="mt-1 font-semibold text-on-surface dark:text-white tabular-nums">
                    {effectiveSettings.phone}
                  </p>
                  <a
                    href={`https://wa.me/${effectiveSettings.whatsapp.replace(/[^0-9]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs font-semibold text-secondary hover:underline"
                  >
                    Chat on WhatsApp →
                  </a>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold text-secondary dark:text-blue-400">
                    <Mail className="w-3.5 h-3.5" /> Desk Email &amp; Hours
                  </div>
                  <p className="mt-1 font-semibold text-on-surface dark:text-white break-all">
                    {effectiveSettings.email}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-400">
                    {effectiveSettings.openingHours}
                  </p>
                </div>
                <div className="sm:col-span-2 p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-semibold text-secondary dark:text-blue-400">
                    <MapPin className="w-3.5 h-3.5" /> Campus Address
                  </div>
                  <p className="mt-1 text-sm text-on-surface dark:text-slate-200">{effectiveSettings.address}</p>
                </div>
              </div>

              <LibraryMap
                lat={effectiveSettings.mapLat}
                lng={effectiveSettings.mapLng}
                libraryName={effectiveSettings.libraryName}
                address={effectiveSettings.address}
                openingHours={effectiveSettings.openingHours}
                mapUrl={effectiveSettings.mapUrl}
                ratingText={effectiveSettings.ratingText}
                quotaExceeded={quotaExceeded}
              />
            </div>

            <div className="lg:col-span-6">
              <form
                onSubmit={handleEnquirySubmit}
                className="p-6 sm:p-8 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm space-y-4"
              >
                <div>
                  <h3 className="font-display text-xl font-bold text-on-surface dark:text-white">
                    Send an Enquiry
                  </h3>
                  <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-0.5">
                    All enquiries are logged directly for our Darbhanga study center administrators.
                  </p>
                </div>

                {contactFeedback && (
                  <div
                    className={`p-3 rounded text-xs border ${
                      contactFeedback.type === 'ok'
                        ? 'bg-success-container border-success text-on-success-container'
                        : 'bg-error-container border-error text-on-error-container'
                    }`}
                  >
                    {contactFeedback.text}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">
                      Your Name
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Full Name"
                      className="w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      required
                      minLength={7}
                      maxLength={20}
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+91 87976 40034"
                      className="w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={150}
                    value={contactSubject}
                    onChange={(e) => setContactSubject(e.target.value)}
                    placeholder="24-hr Seat booking / BPSC Test Series query"
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">
                    Message
                  </label>
                  <textarea
                    rows={4}
                    required
                    minLength={5}
                    maxLength={1000}
                    value={contactMessage}
                    onChange={(e) => setContactMessage(e.target.value)}
                    placeholder="Tell us your preferred study shift or competitive exam goal..."
                    className="w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={contactSubmitting}
                  className="w-full py-2.5 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {contactSubmitting ? 'Submitting...' : 'Submit Enquiry'}
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>

      {/* Navy Institutional Footer */}
      <footer className="bg-primary text-on-primary border-t border-primary-container py-10">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-2">
              <BrandLogo variant="light" />
              <p className="text-xs text-on-primary-container leading-relaxed">
                {effectiveSettings.address}
              </p>
              <p className="text-xs font-mono text-on-primary-container tabular-nums">
                {effectiveSettings.phone}
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-on-primary uppercase tracking-wider">Campus</p>
              <a href="#about" className="block text-on-primary-container hover:text-on-primary">About Campus</a>
              <a href="#facilities" className="block text-on-primary-container hover:text-on-primary">Facilities</a>
              <a href="#gallery" className="block text-on-primary-container hover:text-on-primary">Study Hall Gallery</a>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-on-primary uppercase tracking-wider">Learning</p>
              <a href="#exams" className="block text-on-primary-container hover:text-on-primary">Competitive Exams Hub</a>
              <button type="button" onClick={() => setPublicHubTab('news')} className="block text-on-primary-container hover:text-on-primary cursor-pointer">
                Daily Current Affairs
              </button>
              <button type="button" onClick={() => setPublicHubTab('books')} className="block text-on-primary-container hover:text-on-primary cursor-pointer">
                Digital GK Books
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-on-primary uppercase tracking-wider">Support</p>
              <a href="#plans" className="block text-on-primary-container hover:text-on-primary">Membership Plans</a>
              <a href="#contact" className="block text-on-primary-container hover:text-on-primary">Contact Desk</a>
              <a href="/sitemap.xml" className="block text-on-primary-container hover:text-on-primary">Sitemap</a>
            </div>
          </div>

          <div className="pt-6 border-t border-primary-container flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-on-primary-container">
            <span>{effectiveSettings.openingHours}</span>
            <span>© {new Date().getFullYear()} {effectiveSettings.libraryName} · Darbhanga, Bihar</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
