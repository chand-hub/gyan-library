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
  Newspaper,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
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
    a: 'Click Join Now to register your free student profile (VL2026XXX). Once inside your Student Portal, select any green available desk and launch PYQ tests, AI Mocks, Current Affairs, and Digital GK Books.',
  },
  {
    q: 'Which competitive exams are supported on the AI Examination Platform?',
    a: 'We support NEET UG, JEE Main, JEE Advanced, NDA, UPSC, BPSC, SSC CGL, SSC CHSL, SSC MTS, Railway NTPC, Railway Group D, Bihar Police, Bihar SSC, Banking, and custom exams added by our academic desk.',
  },
  {
    q: 'Which online payment methods are accepted for membership fees?',
    a: 'Online payments work seamlessly via Razorpay supporting UPI, Debit/Credit Cards, and Net Banking with instant downloadable payment receipts.',
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
    <div className="min-h-screen bg-[#1C0E29] text-white">
      {/* Dark Purple Top Navbar (#0E0713) */}
      <header className="sticky top-0 z-40 bg-[#0E0713]/95 backdrop-blur-sm border-b border-[#514871]/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <a href="#top" className="whitespace-nowrap shrink-0">
            <BrandLogo variant="light" />
          </a>

          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-[#CFCEDD]">
            <a href="#about" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              About Us
            </a>
            <a href="#exams" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Exams &amp; AI Tests
            </a>
            <a href="#facilities" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Facilities
            </a>
            <a href="#plans" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Plans
            </a>
            <a href="#gallery" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Gallery
            </a>
            <a href="#contact" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Contact
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {!isSignedIn && (
              <button
                type="button"
                onClick={() => onOpenAuth('login')}
                className="hidden sm:inline-block px-3 py-1.5 text-sm font-medium text-[#CFCEDD] hover:text-white transition-colors whitespace-nowrap"
              >
                Log In
              </button>
            )}
            <button
              type="button"
              onClick={isSignedIn ? () => onOpenPortal() : () => onOpenAuth('register')}
              className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors whitespace-nowrap shrink-0"
            >
              {isSignedIn ? 'Open Portal' : 'Join Now'}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-lg border border-[#514871] text-[#CFCEDD]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[#514871] bg-[#0E0713] px-4 py-4 space-y-2">
            {[
              ['About Us', '#about'],
              ['Exams & AI Tests', '#exams'],
              ['Facilities', '#facilities'],
              ['Membership Plans', '#plans'],
              ['Available Seats', '#seats'],
              ['Gallery', '#gallery'],
              ['Contact', '#contact'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="block py-2 text-sm font-medium text-[#CFCEDD] hover:text-white"
              >
                {label}
              </a>
            ))}
            <div className="pt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAuth('login');
                }}
                className="flex-1 py-2 rounded-lg border border-[#7C7397] text-sm font-medium text-white"
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAuth('register');
                }}
                className="flex-1 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold"
              >
                Register
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section (Inspired by dark purple split banner) */}
      <section
        id="top"
        className="bg-gradient-to-b from-[#3D2C56] via-[#2B193D] to-[#1C0E29] border-b border-[#514871]/60"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6 space-y-6">
              <div className="text-xs font-medium text-[#B5ADC6] tracking-wide">
                <span>{effectiveSettings.libraryName}</span>
                <span aria-hidden="true"> · </span>
                <span>{effectiveSettings.ratingText || '4.9/5 (116 Google Reviews)'}</span>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.1] [text-wrap:balance]">
                A Better Place to Study, Learn &amp; Crack Every Exam.
              </h1>

              <p className="text-base text-[#CFCEDD] leading-relaxed max-w-xl">
                {effectiveSettings.tagline} 24-hour quiet air-conditioned self-study center at{' '}
                <span className="text-white font-medium">Mirzapur Chowk, Darbhanga</span> — now powered by{' '}
                <span className="text-white font-medium">AI Mock Tests, Bilingual PYQs, Current Affairs &amp; Digital GK Books</span>.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="#plans"
                  className="px-5 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors whitespace-nowrap shrink-0"
                >
                  Explore Membership
                </a>
                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('register')}
                  className="px-5 py-2.5 rounded-lg bg-[#514871] border border-[#7C7397] text-white text-sm font-semibold hover:bg-[#675D85] transition-colors whitespace-nowrap shrink-0"
                >
                  {isSignedIn ? 'Launch AI Exam Hub' : 'Book Your Seat'}
                </button>
              </div>

              {announcements.filter((a) => a.published).length > 0 && (
                <div className="p-4 rounded-xl bg-[#0E0713]/60 border border-[#514871]">
                  <p className="text-xs font-semibold text-[#B5ADC6] mb-1">
                    Notice Board · {announcements.filter((a) => a.published)[0].title}
                  </p>
                  <p className="text-xs text-[#CFCEDD]">
                    {announcements.filter((a) => a.published)[0].body}
                  </p>
                </div>
              )}
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-72 sm:h-96 min-h-[340px] rounded-xl overflow-hidden border border-[#7C7397]/70 bg-[#3D2C56] shadow-2xl">
                <img
                  src={DEMO_IMAGES.hero}
                  alt="Gyan Adda Self-Study Center Darbhanga quiet reading hall with partitioned desks"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0E0713]/95 via-[#0E0713]/55 to-transparent p-6">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#CFCEDD]">
                    <span className="font-semibold text-white">{effectiveSettings.openingHours}</span>
                    <span aria-hidden="true">·</span>
                    <span>Mirzapur Chowk, Station Rd, Darbhanga</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4-Column KPI Strip */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-xl border border-[#7C7397]/50 bg-[#3D2C56]/80">
              <p className="text-xs text-[#CFCEDD]">Available Study Desks</p>
              <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                {seatCounts.total > 0 ? `${seatCounts.available} / ${seatCounts.total}` : '40 Desks'}
              </p>
            </div>
            <div className="p-5 rounded-xl border border-[#7C7397]/50 bg-[#3D2C56]/80">
              <p className="text-xs text-[#CFCEDD]">Library + Digital GK Books</p>
              <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                {totalBooksCount + (gkBooks.length || 11)} Titles
              </p>
            </div>
            <div className="p-5 rounded-xl border border-[#7C7397]/50 bg-[#3D2C56]/80">
              <p className="text-xs text-[#CFCEDD]">AI Exam Question Bank</p>
              <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                {totalQuestionsCount > 0 ? `${totalQuestionsCount}+ MCQs` : '15 Exam Tracks'}
              </p>
            </div>
            <div className="p-5 rounded-xl border border-[#7C7397]/50 bg-[#3D2C56]/80">
              <p className="text-xs text-[#CFCEDD]">Study Hall Hours</p>
              <p className="mt-1 text-2xl font-bold text-white tabular-nums">
                Open 24 Hours
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Search & 4 Soft Lavender Action Buttons (Directly inspired by reference layout) */}
      <section id="exams" className="max-w-7xl mx-auto px-4 sm:px-6 py-14 border-b border-[#514871]/50">
        <div className="p-6 sm:p-8 rounded-2xl bg-[#3D2C56] border border-[#7C7397]/60 space-y-8">
          {/* Top Search Bar */}
          <div className="relative max-w-2xl mx-auto">
            <Search className="w-4 h-4 text-[#0E0713] absolute left-4 top-3.5" />
            <input
              type="search"
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              placeholder="Search competitive exams (UPSC, BPSC, NEET, JEE, SSC, Bihar Police)..."
              className="w-full pl-11 pr-4 py-3 rounded-full bg-[#CFCEDD] text-[#0E0713] placeholder-[#514871] text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white"
            />
          </div>

          {/* Visual + 4 Soft Lavender Action Buttons Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5">
              <div className="aspect-[16/10] rounded-xl overflow-hidden border border-[#B5ADC6]/40 bg-[#514871]">
                <img
                  src={DEMO_IMAGES.silentZone}
                  alt="Quiet self-study cubicles at Gyan Adda Self-Study Center Darbhanga"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-7 space-y-3">
              <button
                type="button"
                onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                className="w-full py-3.5 px-6 rounded-xl bg-[#B5ADC6] text-[#0E0713] font-display text-base font-bold hover:bg-white transition-colors flex items-center justify-between"
              >
                <span>Explore Competitive Exams &amp; PYQ Tests</span>
                <Sparkles className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setPublicHubTab(publicHubTab === 'news' ? 'none' : 'news')}
                className="w-full py-3.5 px-6 rounded-xl bg-[#B5ADC6] text-[#0E0713] font-display text-base font-bold hover:bg-white transition-colors flex items-center justify-between"
              >
                <span>Read Daily Current Affairs &amp; Bihar Updates</span>
                <Newspaper className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setPublicHubTab(publicHubTab === 'books' ? 'none' : 'books')}
                className="w-full py-3.5 px-6 rounded-xl bg-[#B5ADC6] text-[#0E0713] font-display text-base font-bold hover:bg-white transition-colors flex items-center justify-between"
              >
                <span>Open 11 Digital GK Books &amp; PDFs</span>
                <BookOpen className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={isSignedIn ? () => onOpenPortal('seats') : () => onOpenAuth('register')}
                className="w-full py-3.5 px-6 rounded-xl bg-[#B5ADC6] text-[#0E0713] font-display text-base font-bold hover:bg-white transition-colors flex items-center justify-between"
              >
                <span>Reserve Your 24-Hour AC Study Desk</span>
                <Award className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Inline Public Preview Drawer for Current Affairs or Digital GK Books */}
          {publicHubTab === 'news' && (
            <div className="pt-6 border-t border-[#514871]">
              <CurrentAffairsModule items={currentAffairs} questions={[]} />
            </div>
          )}

          {publicHubTab === 'books' && (
            <div className="pt-6 border-t border-[#514871]">
              <DigitalGKBookModule
                books={gkBooks}
                questions={[]}
                bookmarks={[]}
                userUid={null}
              />
            </div>
          )}

          {/* Popular Exams Cards Row (Mirrors "Popular Genre" section in reference) */}
          <div className="pt-4 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                Popular Competitive Tracks
              </h2>
              <button
                type="button"
                onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                className="text-xs sm:text-sm font-semibold text-[#B5ADC6] hover:text-white"
              >
                Explore All 15+ Exams →
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayExams.map((ex: any) => (
                <div
                  key={ex.id || ex.name}
                  className="p-6 rounded-xl bg-gradient-to-br from-[#675D85] to-[#514871] border border-[#9993AC]/40 flex flex-col justify-between gap-4 hover:border-[#B5ADC6] transition-colors"
                >
                  <div>
                    <p className="text-xs font-medium text-[#CFCEDD]">{ex.categoryGroup}</p>
                    <h3 className="font-display text-xl font-bold text-white mt-1">{ex.name}</h3>
                    <p className="text-xs text-[#CFCEDD] mt-1.5 leading-relaxed">{ex.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={isSignedIn ? () => onOpenPortal('exams') : () => onOpenAuth('login')}
                    className="self-start px-3.5 py-1.5 rounded-lg bg-[#1C0E29] text-white text-xs font-semibold hover:bg-[#0E0713]"
                  >
                    Start Practice →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* About & Why Choose Us */}
      <section id="about" className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-5 space-y-4">
            <p className="text-xs font-semibold text-[#B5ADC6]">About Gyan Adda Self-Study Center · Vidhya Library</p>
            <h2 className="font-display text-3xl font-bold text-white [text-wrap:balance]">
              Built for deep concentration and measurable exam success in Darbhanga.
            </h2>
            <p className="text-sm text-[#CFCEDD] leading-relaxed">
              Rated <span className="text-white font-semibold">{effectiveSettings.ratingText || '4.9/5'}</span>, our self-study campus near Mirzapur Chowk blends quiet ergonomic cubicles, chilled RO water, LED study lighting, and AI-assisted competitive test readiness.
            </p>
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/50">
                <h3 className="text-sm font-semibold text-white">Our Mission</h3>
                <p className="mt-1 text-xs text-[#CFCEDD] leading-relaxed">
                  Deliver quiet, 24-hour climate-controlled study spaces paired with instant AI analytics.
                </p>
              </div>
              <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/50">
                <h3 className="text-sm font-semibold text-white">Our Vision</h3>
                <p className="mt-1 text-xs text-[#CFCEDD] leading-relaxed">
                  Empower Bihar civil service, medical, SSC, and engineering aspirants under one disciplined roof.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div
                  key={item.num}
                  className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs font-semibold text-[#B5ADC6]">{item.num}.</span>
                    <Icon className="w-4 h-4 text-[#B5ADC6]" />
                  </div>
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-[#CFCEDD] leading-relaxed">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Facilities Section */}
      <section id="facilities" className="bg-[#3D2C56]/40 border-y border-[#514871] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mb-10">
            <p className="text-xs font-semibold text-[#B5ADC6]">Campus Amenities</p>
            <h2 className="mt-1 font-display text-3xl font-bold text-white">
              Library Facilities &amp; Study Environment
            </h2>
            <p className="mt-2 text-sm text-[#CFCEDD]">
              Comfortable cushioned chairs, spacious individual tables, LED study lamps, and silent 24-hour discipline.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {effectiveSettings.facilities.map((facility, idx) => (
              <div
                key={`${facility}-${idx}`}
                className="flex items-center gap-3.5 p-4 rounded-xl border border-[#7C7397]/50 bg-[#3D2C56]"
              >
                <div className="w-9 h-9 rounded-lg bg-[#1C0E29] text-[#B5ADC6] flex items-center justify-center shrink-0 border border-[#7C7397]/60">
                  {facility.toLowerCase().includes('wi-fi') ? (
                    <Wifi className="w-4 h-4" />
                  ) : facility.toLowerCase().includes('charg') ? (
                    <Zap className="w-4 h-4" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </div>
                <span className="text-sm font-medium text-white">{facility}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Membership Plans */}
      <section id="plans" className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <div>
            <p className="text-xs font-semibold text-[#B5ADC6]">Flexible Memberships</p>
            <h2 className="mt-1 font-display text-3xl font-bold text-white">
              Membership Plans &amp; Timings
            </h2>
          </div>
          <p className="text-sm text-[#CFCEDD] max-w-md">
            Includes reserved study desk plus full Student Portal access to AI Exams, Current Affairs, and Digital GK Books.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plans
            .filter((p) => p.active)
            .map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col justify-between p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60"
              >
                <div>
                  <div className="text-xs text-[#CFCEDD] mb-2">
                    <span>{plan.durationDays} Days</span>
                    <span aria-hidden="true"> · </span>
                    <span>{plan.timings}</span>
                  </div>
                  <h3 className="font-display text-xl font-bold text-white">
                    {plan.name}
                  </h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-white tabular-nums">
                      ₹{Number(plan.price).toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-[#CFCEDD]">
                      / {plan.durationDays} days
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-medium text-[#B5ADC6]">
                    {plan.seatAccess}
                  </p>
                  <ul className="mt-4 space-y-2 border-t border-[#514871] pt-4">
                    {plan.facilities.map((f, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-xs text-[#CFCEDD]">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={isSignedIn ? () => onOpenPortal('membership') : () => onOpenAuth('register')}
                  className="mt-6 w-full py-2.5 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors"
                >
                  {isSignedIn ? 'Select in Portal' : 'Join With This Plan'}
                </button>
              </div>
            ))}
        </div>
      </section>

      {/* Available Study Seats Live Grid */}
      <section id="seats" className="bg-[#3D2C56]/40 border-y border-[#514871] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-semibold text-[#B5ADC6]">Live Seating Layout</p>
              <h2 className="mt-1 font-display text-3xl font-bold text-white">
                Available Study Seats
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[#CFCEDD]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-emerald-500 inline-block" /> Available ({seatCounts.available})
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-rose-500 inline-block" /> Occupied ({seatCounts.occupied})
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-amber-400 inline-block" /> Reserved ({seatCounts.reserved})
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1 p-1 bg-[#0E0713] rounded-lg border border-[#514871]">
              {zones.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setSelectedZone(z)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    selectedZone === z
                      ? 'bg-[#B5ADC6] text-[#0E0713] font-bold'
                      : 'text-[#CFCEDD]'
                  }`}
                >
                  {z === 'ALL' ? 'All Zones' : z}
                </button>
              ))}
            </div>
          </div>

          {filteredSeats.length === 0 ? (
            <div className="p-8 rounded-xl border border-[#7C7397]/50 text-center text-sm text-[#CFCEDD]">
              Live seat layout initializes upon admin setup.
            </div>
          ) : (
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
              {filteredSeats.map((seat) => {
                const styleMap: Record<string, string> = {
                  available: 'bg-emerald-950/60 border-emerald-500 text-emerald-100 hover:bg-emerald-900',
                  occupied: 'bg-rose-950/60 border-rose-500/70 text-rose-200 cursor-not-allowed opacity-80',
                  reserved: 'bg-amber-950/60 border-amber-500/70 text-amber-200 cursor-not-allowed',
                  maintenance: 'bg-[#1C0E29] border-[#514871] text-[#9993AC] cursor-not-allowed',
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
                    className={`p-2.5 rounded-lg border text-center transition-colors ${styleMap[seat.status]}`}
                  >
                    <div className="font-mono text-xs font-bold tabular-nums">{seat.seatCode}</div>
                    <div className="text-[10px] mt-0.5 capitalize">{seat.status}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Gallery Section (Showcasing real Darbhanga campus study hall photos) */}
      <section id="gallery" className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-semibold text-[#B5ADC6]">Inside Our Darbhanga Campus</p>
            <h2 className="mt-1 font-display text-3xl font-bold text-white">
              Library Gallery
            </h2>
          </div>

          <div className="flex flex-wrap gap-1 p-1 bg-[#0E0713] rounded-lg border border-[#514871]">
            {galleryCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setGalleryCategory(cat)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  galleryCategory === cat ? 'bg-[#B5ADC6] text-[#0E0713] font-bold' : 'text-[#CFCEDD]'
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
              className="rounded-xl overflow-hidden bg-[#3D2C56] border border-[#7C7397]/60"
            >
              <div className="aspect-[16/10] bg-[#1C0E29] overflow-hidden">
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-5">
                <p className="text-xs text-[#B5ADC6]">{item.category}</p>
                <h3 className="mt-1 text-base font-bold text-white">{item.title}</h3>
                <p className="mt-1 text-xs text-[#CFCEDD]">{item.caption}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials Strip & FAQ */}
      <section className="bg-[#3D2C56]/40 border-y border-[#514871] py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-12">
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-xs font-semibold text-[#B5ADC6] inline-flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                {effectiveSettings.ratingText || '4.9/5 Rating · 116 Google Reviews'}
              </p>
              <h2 className="mt-1 font-display text-3xl font-bold text-white">
                What Our Scholars Say!
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {TESTIMONIALS.map((t) => (
                <div
                  key={t.name}
                  className="p-5 rounded-xl bg-gradient-to-br from-[#675D85] to-[#514871] border border-[#9993AC]/40 flex flex-col justify-between space-y-4"
                >
                  <p className="text-sm text-white leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                  <div className="text-xs text-[#CFCEDD]">
                    <p className="font-bold text-white">{t.name}</p>
                    <p>{t.role} · {t.org}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="max-w-4xl mx-auto space-y-4">
            <h2 className="font-display text-2xl font-bold text-white text-center">
              Frequently Asked Questions
            </h2>
            <div className="space-y-3">
              {FAQS.map((faq, idx) => {
                const open = openFaq === idx;
                return (
                  <div
                    key={faq.q}
                    className="rounded-xl border border-[#7C7397]/60 bg-[#3D2C56] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : idx)}
                      className="w-full px-5 py-4 text-left flex items-center justify-between gap-4 text-sm font-semibold text-white"
                    >
                      <span>{faq.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 shrink-0 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {open && (
                      <div className="px-5 pb-4 text-sm text-[#CFCEDD] leading-relaxed">
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

      {/* "Want To Know More? Contact Us" Banner + Map & Enquiry Form */}
      <section id="contact" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 space-y-10">
        <div className="p-6 sm:p-8 rounded-2xl bg-gradient-to-r from-[#514871] to-[#675D85] border border-[#9993AC]/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Want To Know More? Contact Us
          </h2>
          <a
            href={`https://wa.me/${effectiveSettings.whatsapp.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors"
          >
            WhatsApp Desk
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B5ADC6]">
                  <Phone className="w-3.5 h-3.5" /> Phone &amp; WhatsApp
                </div>
                <p className="mt-1 font-semibold text-white tabular-nums">
                  {effectiveSettings.phone}
                </p>
                <a
                  href={`https://wa.me/${effectiveSettings.whatsapp.replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-[#B5ADC6] hover:text-white hover:underline"
                >
                  Chat on WhatsApp →
                </a>
              </div>
              <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B5ADC6]">
                  <Mail className="w-3.5 h-3.5" /> Desk Email &amp; Hours
                </div>
                <p className="mt-1 font-semibold text-white break-all">
                  {effectiveSettings.email}
                </p>
                <p className="mt-1 text-xs text-[#CFCEDD]">
                  {effectiveSettings.openingHours}
                </p>
              </div>
              <div className="sm:col-span-2 p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#B5ADC6]">
                  <MapPin className="w-3.5 h-3.5" /> Campus Address
                </div>
                <p className="mt-1 text-sm text-white">{effectiveSettings.address}</p>
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
              className="p-6 sm:p-8 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 space-y-4"
            >
              <h3 className="font-display text-xl font-bold text-white">
                Send an Enquiry
              </h3>
              <p className="text-xs text-[#CFCEDD]">
                All enquiries are logged directly for our Darbhanga study center administrators.
              </p>

              {contactFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs border ${
                    contactFeedback.type === 'ok'
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-100'
                      : 'bg-rose-950/60 border-rose-500 text-rose-100'
                  }`}
                >
                  {contactFeedback.text}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                />
              </div>

              <button
                type="submit"
                disabled={contactSubmitting}
                className="w-full py-2.5 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors disabled:opacity-60"
              >
                {contactSubmitting ? 'Submitting...' : 'Submit Enquiry'}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Multi-Column Deep Purple Footer (#0E0713) */}
      <footer className="bg-[#0E0713] text-[#CFCEDD] py-12 border-t border-[#514871]/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="space-y-2">
              <BrandLogo variant="light" />
              <p className="text-xs text-[#9993AC] leading-relaxed">
                {effectiveSettings.address}
              </p>
              <p className="text-xs text-[#B5ADC6] tabular-nums">{effectiveSettings.phone}</p>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-white uppercase tracking-wider">Links</p>
              <a href="#about" className="block hover:text-white">About Campus</a>
              <a href="#facilities" className="block hover:text-white">Facilities</a>
              <a href="#gallery" className="block hover:text-white">Study Hall Gallery</a>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-white uppercase tracking-wider">Learning</p>
              <a href="#exams" className="block hover:text-white">Competitive Exams Hub</a>
              <button type="button" onClick={() => setPublicHubTab('news')} className="block hover:text-white">
                Daily Current Affairs
              </button>
              <button type="button" onClick={() => setPublicHubTab('books')} className="block hover:text-white">
                Digital GK Books
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-bold text-white uppercase tracking-wider">Support</p>
              <a href="#plans" className="block hover:text-white">Membership Plans</a>
              <a href="#contact" className="block hover:text-white">Contact Desk</a>
              <a href="/sitemap.xml" className="block hover:text-white">Sitemap</a>
            </div>
          </div>

          <div className="pt-6 border-t border-[#514871]/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#9993AC]">
            <span>{effectiveSettings.openingHours}</span>
            <span>© {new Date().getFullYear()} {effectiveSettings.libraryName} · Darbhanga, Bihar</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
