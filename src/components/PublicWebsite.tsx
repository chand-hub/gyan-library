import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BatteryCharging,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Droplets,
  HelpCircle,
  LampDesk,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  Navigation,
  Phone,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  UserCheck,
  Wifi,
  Wind,
  X,
} from 'lucide-react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { DEMO_IMAGES } from '../lib/demoSeed';
import {
  DEFAULT_GYAN_ADDA_SETTINGS,
  FacilityItem,
  FaqItem,
  GalleryItem,
  LibrarySettings,
} from '../types/library';
import { BrandLogo } from './BrandLogo';
import { LibraryMap } from './LibraryMap';

interface PublicWebsiteProps {
  settings: LibrarySettings | null;
  faqs: FaqItem[];
  importantQuestions: FaqItem[];
  gallery: GalleryItem[];
  isSignedIn: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdminLogin: () => void;
  onOpenStudentAuth: (tab: 'login' | 'register') => void;
  onOpenPortal: () => void;
  quotaExceeded: boolean;
}

const DEFAULT_PUBLIC_FACILITIES: FacilityItem[] = [
  {
    id: 'fac_24h',
    name: 'Open 24 Hours Self-Study Access',
    description: 'Quiet study hall open round-the-clock Monday through Sunday.',
    icon: 'Clock',
    available: true,
  },
  {
    id: 'fac_ac',
    name: 'Full Centralized Air Conditioning',
    description: 'Comfortable temperature-regulated reading hall throughout the year.',
    icon: 'Wind',
    available: true,
  },
  {
    id: 'fac_wifi',
    name: 'High-Speed Dual-Band Fiber Wi-Fi',
    description: 'Reliable fiber internet for online classes, lectures, and mock exams.',
    icon: 'Wifi',
    available: true,
  },
  {
    id: 'fac_desk',
    name: 'Individual Partitioned Study Desks',
    description: 'Ergonomic seating, personal LED desk lamp, and dedicated charging socket.',
    icon: 'LampDesk',
    available: true,
  },
  {
    id: 'fac_water',
    name: 'RO Chilled Drinking Water',
    description: 'Clean chilled and normal purified drinking water available on the floor.',
    icon: 'Droplets',
    available: true,
  },
  {
    id: 'fac_cctv',
    name: '24/7 HD CCTV Surveillance & Discipline',
    description: 'Monitored campus safety, sanitized washrooms, and helpful desk support.',
    icon: 'ShieldCheck',
    available: true,
  },
];

const DEFAULT_PUBLIC_FAQS: FaqItem[] = [
  {
    id: 'faq_1',
    section: 'faq',
    category: 'Timings',
    question: 'What are the opening and closing times of GYAN ADDA LIBRARY?',
    answer:
      'GYAN ADDA LIBRARY is open 24 hours a day, Monday through Sunday. Students may enroll in Morning, Afternoon, Evening, Full-Day, or Night shifts.',
    sortOrder: 1,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'faq_2',
    section: 'faq',
    category: 'Fees',
    question: 'How can I enquire about monthly fees and shift availability?',
    answer:
      'Monthly charges depend on your selected shift timing and desk reservation. Call our help line at +91 87976 40034 or send an admission enquiry below for the current fee card.',
    sortOrder: 2,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'faq_3',
    section: 'faq',
    category: 'Admission',
    question: 'What is the admission procedure?',
    answer:
      'Visit GYAN ADDA LIBRARY at 2nd Floor, Station Rd, Mirzapur Chowk, Darbhanga or submit the online enquiry form below. Pick your preferred study shift, verify your ID at the desk, and start studying immediately.',
    sortOrder: 3,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'faq_4',
    section: 'faq',
    category: 'Documents',
    question: 'Which documents are required for admission?',
    answer:
      'Carry one valid Government Photo ID (Aadhaar Card / Voter ID / Driving License), two passport-size photographs, and an active mobile & parent/guardian emergency number.',
    sortOrder: 4,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'faq_5',
    section: 'faq',
    category: 'Wi-Fi & Power',
    question: 'Are Wi-Fi and desk power sockets provided for laptops and tablets?',
    answer:
      'Yes. High-speed dual-band fiber Wi-Fi and dedicated desk charging sockets are available at study desks for online classes and competitive exam practice.',
    sortOrder: 5,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'faq_6',
    section: 'faq',
    category: 'Attendance',
    question: 'How are shift check-ins and attendance tracked?',
    answer:
      'Members check in at the library desk according to their registered shift, with accurate timestamps and leave records maintained by the desk staff.',
    sortOrder: 6,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
];

const DEFAULT_IMPORTANT_QUESTIONS: FaqItem[] = [
  {
    id: 'imp_1',
    section: 'important',
    category: 'Membership',
    question: 'Is library membership transferable between students?',
    answer:
      'No. Every GYAN ADDA LIBRARY membership and allocated desk is strictly personal and non-transferable.',
    sortOrder: 1,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'imp_2',
    section: 'important',
    category: 'Seat & Shifts',
    question: 'How do seat reservation and shift rules work?',
    answer:
      'Seats are assigned against your selected shift window. Shift-based members must vacate cleanly at the close of their shift unless enrolled in Full-Day / 24-hour reserved access.',
    sortOrder: 2,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'imp_3',
    section: 'important',
    category: 'Discipline',
    question: 'What are the core study hall discipline rules?',
    answer:
      'Maintain strict silence inside the reading hall, keep mobile phones on silent mode, take phone calls outside, avoid bringing food items onto study desks, and keep earphones at low volume.',
    sortOrder: 3,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
  {
    id: 'imp_4',
    section: 'important',
    category: 'Renewal',
    question: 'What is the monthly renewal policy?',
    answer:
      'Monthly membership should be renewed on or before the due date to retain the same reserved desk number without interruption.',
    sortOrder: 4,
    published: true,
    createdAt: null,
    updatedAt: null,
  },
];

function renderFacilityIcon(iconName: string) {
  const cls = 'w-5 h-5 text-secondary dark:text-blue-400';
  switch (iconName) {
    case 'Clock':
      return <Clock className={cls} />;
    case 'Wind':
      return <Wind className={cls} />;
    case 'Wifi':
      return <Wifi className={cls} />;
    case 'LampDesk':
      return <LampDesk className={cls} />;
    case 'Droplets':
      return <Droplets className={cls} />;
    case 'ShieldCheck':
      return <ShieldCheck className={cls} />;
    case 'BookOpen':
      return <BookOpen className={cls} />;
    case 'BatteryCharging':
      return <BatteryCharging className={cls} />;
    default:
      return <Sparkles className={cls} />;
  }
}

export const PublicWebsite: React.FC<PublicWebsiteProps> = ({
  settings,
  faqs,
  importantQuestions,
  gallery,
  isSignedIn,
  darkMode,
  onToggleDarkMode,
  onOpenAdminLogin,
  onOpenStudentAuth,
  onOpenPortal,
  quotaExceeded,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqId, setOpenFaqId] = useState<string | null>('faq_1');
  const [openImpId, setOpenImpId] = useState<string | null>('imp_1');
  const [galleryCategory, setGalleryCategory] = useState<string>('ALL');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Help Line Enquiry Form
  const [enqName, setEnqName] = useState('');
  const [enqPhone, setEnqPhone] = useState('');
  const [enqEmail, setEnqEmail] = useState('');
  const [enqSubject, setEnqSubject] = useState('New Admission & Shift Enquiry');
  const [enqMessage, setEnqMessage] = useState('');
  const [enqSubmitting, setEnqSubmitting] = useState(false);
  const [enqFeedback, setEnqFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const effectiveSettings: LibrarySettings = {
    ...DEFAULT_GYAN_ADDA_SETTINGS,
    ...(settings || {}),
    libraryName: settings?.libraryName || 'GYAN ADDA LIBRARY',
  };

  const phoneNumbers = useMemo(() => {
    return (effectiveSettings.phone || '+91 87976 40034')
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean);
  }, [effectiveSettings.phone]);

  const primaryTelHref = `tel:${(phoneNumbers[0] || '+918797640034').replace(/[^+\d]/g, '')}`;
  const whatsappDigits = (effectiveSettings.whatsapp || '+91 87976 40034').replace(/\D/g, '');
  const whatsappUrl = `https://wa.me/${whatsappDigits.length === 10 ? `91${whatsappDigits}` : whatsappDigits}?text=${encodeURIComponent(
    'Hello GYAN ADDA LIBRARY, I would like information about study hall admission and shift availability.'
  )}`;

  const directionsUrl =
    effectiveSettings.mapUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${effectiveSettings.mapLat},${effectiveSettings.mapLng}`
    )}`;

  // 4. Facilities (strictly available items only)
  const displayFacilities: FacilityItem[] = useMemo(() => {
    if (Array.isArray(settings?.facilityItems) && settings.facilityItems.length > 0) {
      return settings.facilityItems.filter((f) => f.available !== false);
    }
    if (Array.isArray(settings?.facilities) && settings.facilities.length > 0) {
      return settings.facilities.map((name, idx) => ({
        id: `fac_str_${idx}`,
        name,
        description: 'Available inside GYAN ADDA LIBRARY study halls.',
        icon: idx === 0 ? 'Clock' : idx === 1 ? 'Wind' : idx === 2 ? 'Droplets' : 'Sparkles',
        available: true,
      }));
    }
    return DEFAULT_PUBLIC_FACILITIES;
  }, [settings]);

  // 5. Published FAQs
  const displayFaqs = useMemo(() => {
    const src = faqs.filter((f) => f.published !== false && f.section === 'faq');
    return (src.length > 0 ? src : DEFAULT_PUBLIC_FAQS).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [faqs]);

  // 6. Published Important Questions
  const displayImportant = useMemo(() => {
    const src = importantQuestions.filter((f) => f.published !== false && f.section === 'important');
    return (src.length > 0 ? src : DEFAULT_IMPORTANT_QUESTIONS).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [importantQuestions]);

  // 7. Approved Photo Gallery only
  const approvedGallery = useMemo(() => {
    const src = gallery.filter((g) => g.approved !== false);
    const list: GalleryItem[] =
      src.length > 0
        ? src
        : [
            {
              id: 'gal_default_1',
              title: 'GYAN ADDA LIBRARY · Main Reading Hall',
              category: 'Reading Hall',
              imageUrl: DEMO_IMAGES.hero,
              caption: 'Partitioned study desks with ergonomic seating, LED desk lighting, and centralized AC.',
              sortOrder: 1,
              approved: true,
              createdAt: null,
            },
            {
              id: 'gal_default_2',
              title: 'Silent AC Study Cubicles · Mirzapur Chowk',
              category: 'Silent Zone',
              imageUrl: DEMO_IMAGES.silentZone,
              caption: 'Quiet individual study cubicles built for focused UPSC, BPSC, NEET, JEE, and SSC preparation.',
              sortOrder: 2,
              approved: true,
              createdAt: null,
            },
          ];
    if (galleryCategory === 'ALL') return list;
    return list.filter((g) => g.category === galleryCategory);
  }, [gallery, galleryCategory]);

  const galleryCategories = useMemo(() => {
    const src = gallery.filter((g) => g.approved !== false);
    const cats = Array.from(
      new Set(src.length > 0 ? src.map((g) => g.category) : ['Reading Hall', 'Silent Zone'])
    );
    return ['ALL', ...cats];
  }, [gallery]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') {
        setLightboxIndex((i) => (i === null ? null : (i + 1) % approvedGallery.length));
      }
      if (e.key === 'ArrowLeft') {
        setLightboxIndex((i) =>
          i === null ? null : (i - 1 + approvedGallery.length) % approvedGallery.length
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIndex, approvedGallery.length]);

  const handleEnquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnqSubmitting(true);
    setEnqFeedback(null);
    try {
      const payload = {
        name: enqName.trim(),
        phone: enqPhone.trim(),
        email: enqEmail.trim() || 'visitor@gyanaddalibrary.in',
        subject: enqSubject.trim() || 'Admission Enquiry',
        message: enqMessage.trim(),
      };

      let savedOk = false;
      const apiRes = await fetch('/api/public/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => null);
      if (apiRes && apiRes.ok) savedOk = true;

      try {
        await addDoc(collection(db, 'enquiries'), {
          ...payload,
          status: 'new',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        savedOk = true;
      } catch {
        // Resilient if public server endpoint already persisted it
      }

      if (!savedOk) throw new Error('Unable to submit your enquiry right now.');

      setEnqFeedback({
        type: 'ok',
        text: 'Thank you! Your enquiry has been received by the GYAN ADDA LIBRARY desk. We will contact you shortly.',
      });
      setEnqName('');
      setEnqPhone('');
      setEnqEmail('');
      setEnqMessage('');
    } catch (err: any) {
      setEnqFeedback({
        type: 'err',
        text: err?.message || 'Unable to submit enquiry. Please call our help line directly.',
      });
    } finally {
      setEnqSubmitting(false);
    }
  };

  const navLinks = [
    { href: '#home', label: 'Home' },
    { href: '#location', label: 'Location' },
    { href: '#helpline', label: 'Help Line' },
    { href: '#facilities', label: 'Facilities' },
    { href: '#faqs', label: 'FAQs' },
    { href: '#important', label: 'Important' },
    { href: '#gallery', label: 'Gallery' },
  ];

  const inputCls =
    'w-full px-3.5 py-2.5 text-sm rounded-lg border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white focus:border-secondary focus:outline-none';

  return (
    <div className="min-h-screen bg-surface dark:bg-slate-950 text-on-surface dark:text-slate-100 font-body">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-surface-container-lowest/95 dark:bg-slate-950/95 backdrop-blur-md border-b border-outline-variant dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <a href="#home" className="shrink-0">
            <BrandLogo variant={darkMode ? 'light' : 'dark'} subtitle="Self-Study Campus" />
          </a>

          {/* Public Navigation Links */}
          <nav aria-label="Public navigation" className="hidden lg:flex items-center gap-5 text-xs font-semibold text-on-surface-variant dark:text-slate-300">
            {navLinks.map((lnk) => (
              <a
                key={lnk.href}
                href={lnk.href}
                className="hover:text-secondary dark:hover:text-blue-400 transition-colors whitespace-nowrap"
              >
                {lnk.label}
              </a>
            ))}
          </nav>

          {/* Right Controls: Admission CTA + Visually Separated Admin Login Button */}
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="#helpline"
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary transition-colors"
            >
              Admission Enquiry
            </a>

            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg border border-outline-variant dark:border-slate-700 text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low dark:hover:bg-slate-800 cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="h-5 w-px bg-outline-variant dark:bg-slate-800 hidden sm:block mx-0.5" />

            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/25 dark:border-blue-400/30 bg-primary/5 dark:bg-slate-900 text-primary dark:text-blue-300 text-xs font-bold hover:bg-primary hover:text-on-primary transition-colors cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Admin Login</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              className="lg:hidden p-2 rounded-lg border border-outline-variant dark:border-slate-700 text-on-surface dark:text-white cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-outline-variant dark:border-slate-800 bg-surface-container-lowest dark:bg-slate-950 px-4 py-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {navLinks.map((lnk) => (
                <a
                  key={lnk.href}
                  href={lnk.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold text-on-surface dark:text-slate-200 hover:bg-surface-container-low dark:hover:bg-slate-900"
                >
                  {lnk.label}
                </a>
              ))}
            </div>
            <div className="pt-2 border-t border-outline-variant dark:border-slate-800 flex flex-wrap gap-2">
              <a
                href="#helpline"
                onClick={() => setMobileMenuOpen(false)}
                className="flex-1 text-center py-2 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold"
              >
                Admission Enquiry
              </a>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAdminLogin();
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-primary/30 text-primary dark:text-blue-300 text-xs font-bold"
              >
                <Lock className="w-3.5 h-3.5" /> Admin Login
              </button>
            </div>
          </div>
        )}
      </header>

      <main>
        {/* 1. HOME / HERO SECTION */}
        <section id="home" className="relative bg-gradient-to-br from-[#001633] via-[#002046] to-[#0b336b] text-white overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-xs font-semibold text-blue-100">
                <Star className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>{effectiveSettings.ratingText || '4.9/5 Student Rating · Open 24 Hours'}</span>
              </div>

              <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight leading-tight">
                {effectiveSettings.libraryName}
              </h1>

              <p className="text-base sm:text-lg text-blue-100 leading-relaxed max-w-2xl">
                {effectiveSettings.tagline || 'Your Knowledge, Your Future.'} Welcome to Darbhanga&apos;s calm, air-conditioned 24-hour self-study campus crafted for disciplined UPSC, BPSC, NEET, JEE, SSC, and Banking preparation.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="#helpline"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-secondary hover:bg-blue-500 text-white text-sm font-bold shadow-lg transition-colors"
                >
                  <span>Admission Enquiry</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href="#location"
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-semibold transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  <span>View Location</span>
                </a>
                {isSignedIn && (
                  <button
                    type="button"
                    onClick={onOpenPortal}
                    className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-300/40 text-emerald-100 text-sm font-semibold cursor-pointer"
                  >
                    <UserCheck className="w-4 h-4" /> Open Portal
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-white/15 text-xs text-blue-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-300 shrink-0" />
                  <span>{effectiveSettings.openingHours}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-blue-300 shrink-0" />
                  <span>High-Speed Fiber Wi-Fi</span>
                </div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-300 shrink-0" />
                  <span>24/7 CCTV &amp; AC Study Hall</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="relative rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-slate-900">
                <img
                  src={DEMO_IMAGES.hero}
                  alt="GYAN ADDA LIBRARY air-conditioned self-study reading hall"
                  className="w-full aspect-4/3 object-cover"
                />
                <div className="p-4 bg-slate-950/85 border-t border-white/10 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white truncate">
                      {effectiveSettings.libraryName} · Darbhanga
                    </p>
                    <p className="text-[11px] text-blue-200 truncate">
                      Mirzapur Chowk · Station Road · Quiet Study Desks
                    </p>
                  </div>
                  <a
                    href={primaryTelHref}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-secondary text-white text-xs font-bold shrink-0"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call Desk
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2. LIBRARY LOCATION SECTION */}
        <section id="location" className="py-14 sm:py-16 bg-surface-container-lowest dark:bg-slate-900 border-b border-outline-variant dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                Campus Location
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white mt-1">
                Visit {effectiveSettings.libraryName}
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-slate-400 mt-1">
                Conveniently situated near Darbhanga Junction with easy access for morning, afternoon, evening, and 24-hour students.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5 p-6 rounded-xl bg-surface dark:bg-slate-950 border border-outline-variant dark:border-slate-800 space-y-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm text-primary dark:text-white">Complete Address</h3>
                    <p className="text-sm text-on-surface-variant dark:text-slate-300 mt-1 break-words leading-relaxed">
                      {effectiveSettings.address}
                    </p>
                  </div>
                </div>

                {effectiveSettings.nearbyLandmarks && (
                  <div className="p-3.5 rounded-lg bg-surface-container-low dark:bg-slate-900 border border-outline-variant/60 dark:border-slate-800">
                    <p className="text-[11px] font-bold uppercase text-secondary dark:text-blue-400">
                      Nearby Landmarks
                    </p>
                    <p className="text-xs text-on-surface dark:text-slate-200 mt-1 break-words">
                      {effectiveSettings.nearbyLandmarks}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2.5 text-xs text-on-surface-variant dark:text-slate-300">
                  <Clock className="w-4 h-4 text-secondary shrink-0" />
                  <span>{effectiveSettings.openingHours}</span>
                </div>

                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  Get Google Maps Directions
                </a>
              </div>

              <div className="lg:col-span-7">
                <LibraryMap
                  lat={effectiveSettings.mapLat}
                  lng={effectiveSettings.mapLng}
                  libraryName={effectiveSettings.libraryName}
                  address={effectiveSettings.address}
                  nearbyLandmarks={effectiveSettings.nearbyLandmarks}
                  openingHours={effectiveSettings.openingHours}
                  mapUrl={effectiveSettings.mapUrl}
                  ratingText={effectiveSettings.ratingText}
                  quotaExceeded={quotaExceeded}
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. HELP LINE & ADMISSION ENQUIRY SECTION */}
        <section id="helpline" className="py-14 sm:py-16 bg-surface dark:bg-slate-950 border-b border-outline-variant dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-5 space-y-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                  24-Hour Help Line &amp; Admissions
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white mt-1">
                  Speak With Our Study Desk
                </h2>
                <p className="text-sm text-on-surface-variant dark:text-slate-400 mt-1">
                  Call or message on WhatsApp to check shift timings, visit the reading hall, or enquire about new admission.
                </p>
              </div>

              <div className="space-y-3">
                {phoneNumbers.map((num, idx) => {
                  const href = `tel:${num.replace(/[^+\d]/g, '')}`;
                  return (
                    <a
                      key={`${num}-${idx}`}
                      href={href}
                      className="flex items-center justify-between gap-3 p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 hover:border-secondary transition-colors shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
                          <Phone className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase text-on-surface-variant dark:text-slate-400">
                            Help Line {idx + 1}
                          </p>
                          <p className="font-mono text-sm font-bold text-primary dark:text-white truncate">
                            {num}
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded bg-secondary text-on-secondary text-xs font-semibold shrink-0">
                        Call Now
                      </span>
                    </a>
                  );
                })}

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 p-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase text-emerald-100">
                        WhatsApp Desk Support
                      </p>
                      <p className="font-mono text-sm font-bold truncate">
                        {effectiveSettings.whatsapp}
                      </p>
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded bg-white text-emerald-700 text-xs font-bold shrink-0">
                    Chat on WhatsApp
                  </span>
                </a>

                <a
                  href={`mailto:${effectiveSettings.email}`}
                  className="flex items-center gap-3 p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 hover:border-secondary transition-colors"
                >
                  <Mail className="w-5 h-5 text-secondary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase text-on-surface-variant dark:text-slate-400">
                      Email Support
                    </p>
                    <p className="text-sm font-semibold text-primary dark:text-white truncate">
                      {effectiveSettings.email}
                    </p>
                  </div>
                </a>
              </div>
            </div>

            <form
              onSubmit={handleEnquirySubmit}
              className="lg:col-span-7 p-6 sm:p-8 rounded-2xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm space-y-4"
            >
              <h3 className="font-display text-xl font-bold text-primary dark:text-white">
                Send Admission / Shift Enquiry
              </h3>
              <p className="text-xs text-on-surface-variant dark:text-slate-400">
                Leave your details below and our campus coordinator will call you back.
              </p>

              {enqFeedback && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium border ${
                    enqFeedback.type === 'ok'
                      ? 'bg-success-container text-on-success-container border-success/30'
                      : 'bg-error-container text-on-error-container border-error/30'
                  }`}
                >
                  {enqFeedback.text}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={enqName}
                    onChange={(e) => setEnqName(e.target.value)}
                    placeholder="Enter student name"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Mobile / WhatsApp Number</label>
                  <input
                    type="tel"
                    required
                    value={enqPhone}
                    onChange={(e) => setEnqPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">Email (Optional)</label>
                  <input
                    type="email"
                    value={enqEmail}
                    onChange={(e) => setEnqEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Preferred Shift / Topic</label>
                  <input
                    type="text"
                    required
                    value={enqSubject}
                    onChange={(e) => setEnqSubject(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Message</label>
                <textarea
                  rows={3}
                  required
                  value={enqMessage}
                  onChange={(e) => setEnqMessage(e.target.value)}
                  placeholder="Preferred timing (Morning / Afternoon / Evening / Full Day) or questions..."
                  className={inputCls}
                />
              </div>

              <button
                type="submit"
                disabled={enqSubmitting}
                className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-secondary text-on-secondary text-sm font-bold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                {enqSubmitting ? 'Submitting Enquiry...' : 'Submit Admission Enquiry'}
              </button>
            </form>
          </div>
        </section>

        {/* 4. LIBRARY FACILITIES SECTION */}
        <section id="facilities" className="py-14 sm:py-16 bg-surface-container-lowest dark:bg-slate-900 border-b border-outline-variant dark:border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                Study Environment
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white mt-1">
                Library Facilities
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-slate-400 mt-1">
                Verified campus amenities designed for uninterrupted, distraction-free daily preparation.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {displayFacilities.map((fac) => (
                <div
                  key={fac.id}
                  className="p-5 rounded-xl bg-surface dark:bg-slate-950 border border-outline-variant dark:border-slate-800 shadow-sm flex items-start gap-4"
                >
                  <div className="w-11 h-11 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
                    {renderFacilityIcon(fac.icon)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-base text-primary dark:text-white break-words">
                      {fac.name}
                    </h3>
                    <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1 leading-relaxed break-words">
                      {fac.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 5. FREQUENTLY ASKED QUESTIONS (FAQs) */}
        <section id="faqs" className="py-14 sm:py-16 bg-surface dark:bg-slate-950 border-b border-outline-variant dark:border-slate-800">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <div className="text-center space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                Student Information
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white">
                Frequently Asked Questions
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-slate-400">
                Answers about library timings, admission steps, required ID documents, Wi-Fi, and attendance.
              </p>
            </div>

            <div className="space-y-3">
              {displayFaqs.map((item) => {
                const open = openFaqId === item.id;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 overflow-hidden shadow-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqId(open ? null : item.id)}
                      className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <HelpCircle className="w-4 h-4 text-secondary shrink-0" />
                        <span className="font-semibold text-sm text-primary dark:text-white break-words">
                          {item.question}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-outline shrink-0 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {open && (
                      <div className="px-5 pb-4 pt-1 text-xs sm:text-sm text-on-surface-variant dark:text-slate-300 leading-relaxed border-t border-outline-variant/40 dark:border-slate-800">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 6. IMPORTANT QUESTIONS SECTION */}
        <section id="important" className="py-14 sm:py-16 bg-surface-container-lowest dark:bg-slate-900 border-b border-outline-variant dark:border-slate-800">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <div className="text-center space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                Campus Rules &amp; Policies
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white">
                Important Questions
              </h2>
              <p className="text-sm text-on-surface-variant dark:text-slate-400">
                Essential guidelines on membership rules, seat allocation, silence discipline, and monthly renewals.
              </p>
            </div>

            <div className="space-y-3">
              {displayImportant.map((item) => {
                const open = openImpId === item.id;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl bg-surface dark:bg-slate-950 border border-outline-variant dark:border-slate-800 overflow-hidden shadow-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenImpId(open ? null : item.id)}
                      className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex items-center gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-secondary shrink-0" />
                        <span className="font-semibold text-sm text-primary dark:text-white break-words">
                          {item.question}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-outline shrink-0 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {open && (
                      <div className="px-5 pb-4 pt-1 text-xs sm:text-sm text-on-surface-variant dark:text-slate-300 leading-relaxed border-t border-outline-variant/40 dark:border-slate-800">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 7. PHOTO GALLERY SECTION (ADMIN-APPROVED PHOTOS ONLY + LIGHTBOX) */}
        <section id="gallery" className="py-14 sm:py-16 bg-surface dark:bg-slate-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
                  Inside GYAN ADDA LIBRARY
                </p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-primary dark:text-white mt-1">
                  Photo Gallery
                </h2>
                <p className="text-sm text-on-surface-variant dark:text-slate-400 mt-1">
                  Click any photograph to view full size.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {galleryCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setGalleryCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      galleryCategory === cat
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 text-on-surface-variant dark:text-slate-300'
                    }`}
                  >
                    {cat === 'ALL' ? 'All Photos' : cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {approvedGallery.map((g, idx) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setLightboxIndex(idx)}
                  className="text-left group rounded-xl overflow-hidden bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm hover:shadow-md transition-all cursor-pointer"
                >
                  <div className="overflow-hidden">
                    <img
                      src={g.imageUrl}
                      alt={g.title}
                      className="w-full aspect-4/3 object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                  <div className="p-4">
                    <p className="text-[11px] font-bold uppercase text-secondary dark:text-blue-400">
                      {g.category}
                    </p>
                    <h3 className="font-semibold text-sm text-primary dark:text-white mt-0.5 break-words">
                      {g.title}
                    </h3>
                    <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1 break-words">
                      {g.caption}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Lightbox Modal */}
      {lightboxIndex !== null && approvedGallery[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-slate-900 rounded-2xl overflow-hidden border border-white/15 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxIndex(null)}
              aria-label="Close lightbox"
              className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/60 text-white hover:bg-black cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={approvedGallery[lightboxIndex].imageUrl}
              alt={approvedGallery[lightboxIndex].title}
              className="w-full max-h-[72dvh] object-contain bg-black"
            />
            <div className="p-4 flex items-center justify-between gap-4 text-white border-t border-white/10">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{approvedGallery[lightboxIndex].title}</p>
                <p className="text-xs text-slate-300 truncate">{approvedGallery[lightboxIndex].caption}</p>
              </div>
              {approvedGallery.length > 1 && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxIndex(
                        (lightboxIndex - 1 + approvedGallery.length) % approvedGallery.length
                      )
                    }
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightboxIndex((lightboxIndex + 1) % approvedGallery.length)}
                    className="p-2 rounded-lg bg-white/10 hover:bg-white/20 cursor-pointer"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-[#001633] text-blue-100 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
            <BrandLogo variant="light" />
            <span className="text-blue-200/80">
              {effectiveSettings.address} · {effectiveSettings.openingHours}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => (isSignedIn ? onOpenPortal() : onOpenStudentAuth('login'))}
              className="text-blue-200 hover:text-white underline cursor-pointer"
            >
              Student Member Login
            </button>
            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="text-blue-200 hover:text-white underline cursor-pointer"
            >
              Admin Login
            </button>
            <span className="text-blue-200/70">
              © {new Date().getFullYear()} {effectiveSettings.libraryName}. All rights reserved.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
