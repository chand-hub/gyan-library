import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  CheckCircle2,
  Database,
  Edit2,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { db, logAuditEvent } from '../../lib/firebase';
import { seedDemoDataset } from '../../lib/demoSeed';
import {
  ALL_STAFF_PERMISSIONS,
  AnnouncementRecord,
  AuditLogRecord,
  DEFAULT_FACILITIES,
  DEFAULT_GYAN_ADDA_SETTINGS,
  EnquiryRecord,
  FacilityItem,
  GalleryItem,
  LibrarySettings,
  StaffRecord,
  StudentRecord,
} from '../../types/library';

interface SettingsAndOpsPanelProps {
  activeSection:
    | 'staff'
    | 'enquiries'
    | 'gallery'
    | 'facilities'
    | 'announcements'
    | 'notifications'
    | 'audit'
    | 'settings';
  staffList: StaffRecord[];
  enquiries: EnquiryRecord[];
  gallery: GalleryItem[];
  announcements: AnnouncementRecord[];
  auditLogs: AuditLogRecord[];
  students: StudentRecord[];
  settings: LibrarySettings | null;
  actorUid: string;
  actorRole: string;
  isAdmin: boolean;
  isManagerOrAdmin: boolean;
  hasFirebaseSession?: boolean;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface ProviderInfo {
  whatsapp: { configured: boolean; label: string };
  email: { configured: boolean; label: string };
  sms: { configured: boolean; label: string };
}

const FACILITY_ICONS = [
  'Clock',
  'Wind',
  'Wifi',
  'LampDesk',
  'Droplets',
  'ShieldCheck',
  'BookOpen',
  'BatteryCharging',
  'Sparkles',
];

export const SettingsAndOpsPanel: React.FC<SettingsAndOpsPanelProps> = ({
  activeSection,
  staffList,
  enquiries,
  gallery,
  announcements,
  auditLogs,
  students,
  settings,
  actorUid,
  actorRole,
  isAdmin,
  isManagerOrAdmin,
  hasFirebaseSession = true,
  getIdToken,
  onNotify,
}) => {
  // Staff Form State
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffRecord | null>(null);
  const [stfUid, setStfUid] = useState('');
  const [stfName, setStfName] = useState('');
  const [stfEmail, setStfEmail] = useState('');
  const [stfMobile, setStfMobile] = useState('');
  const [stfRole, setStfRole] = useState<'staff' | 'manager'>('staff');
  const [stfShift, setStfShift] = useState('Morning (06:00–14:00)');
  const [stfSalary, setStfSalary] = useState(18000);
  const [stfPerms, setStfPerms] = useState<string[]>(['view_students', 'mark_attendance']);

  // Gallery Form & Edit State
  const [galTitle, setGalTitle] = useState('');
  const [galCat, setGalCat] = useState('Reading Hall');
  const [galUrl, setGalUrl] = useState('');
  const [galCaption, setGalCaption] = useState('');
  const [galApproved, setGalApproved] = useState(true);
  const [editingGallery, setEditingGallery] = useState<GalleryItem | null>(null);

  // Server Public Content mirror (for Mobile+Password admins and persistent CMS)
  const [serverGallery, setServerGallery] = useState<GalleryItem[]>([]);
  const [serverEnquiries, setServerEnquiries] = useState<EnquiryRecord[]>([]);
  const [serverSettings, setServerSettings] = useState<LibrarySettings | null>(null);

  // Facility Items State
  const [facilityItems, setFacilityItems] = useState<FacilityItem[]>([]);
  const [facName, setFacName] = useState('');
  const [facDesc, setFacDesc] = useState('');
  const [facIcon, setFacIcon] = useState('Sparkles');
  const [editingFacilityId, setEditingFacilityId] = useState<string | null>(null);

  // Announcement Form State
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPriority, setAnnPriority] = useState<'normal' | 'important'>('normal');

  // Notifications Provider Status + Broadcast
  const [providers, setProviders] = useState<ProviderInfo | null>(null);
  const [notifRecipient, setNotifRecipient] = useState('ALL_STUDENTS');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');

  // Settings State
  const [libName, setLibName] = useState(settings?.libraryName || DEFAULT_GYAN_ADDA_SETTINGS.libraryName);
  const [tagline, setTagline] = useState(settings?.tagline || DEFAULT_GYAN_ADDA_SETTINGS.tagline);
  const [address, setAddress] = useState(settings?.address || DEFAULT_GYAN_ADDA_SETTINGS.address);
  const [nearbyLandmarks, setNearbyLandmarks] = useState(
    settings?.nearbyLandmarks || DEFAULT_GYAN_ADDA_SETTINGS.nearbyLandmarks || ''
  );
  const [phone, setPhone] = useState(settings?.phone || DEFAULT_GYAN_ADDA_SETTINGS.phone);
  const [whatsapp, setWhatsapp] = useState(settings?.whatsapp || DEFAULT_GYAN_ADDA_SETTINGS.whatsapp);
  const [email, setEmail] = useState(settings?.email || DEFAULT_GYAN_ADDA_SETTINGS.email);
  const [openingHours, setOpeningHours] = useState(settings?.openingHours || DEFAULT_GYAN_ADDA_SETTINGS.openingHours);
  const [is24Hour, setIs24Hour] = useState(settings?.is24HourAccess ?? true);
  const [mapLat, setMapLat] = useState(settings?.mapLat ?? DEFAULT_GYAN_ADDA_SETTINGS.mapLat);
  const [mapLng, setMapLng] = useState(settings?.mapLng ?? DEFAULT_GYAN_ADDA_SETTINGS.mapLng);
  const [mapUrl, setMapUrl] = useState(settings?.mapUrl || DEFAULT_GYAN_ADDA_SETTINGS.mapUrl || '');
  const [ratingText, setRatingText] = useState(settings?.ratingText || DEFAULT_GYAN_ADDA_SETTINGS.ratingText || '');
  const [facilities, setFacilities] = useState<string[]>(settings?.facilities || DEFAULT_FACILITIES);
  const [newFacility, setNewFacility] = useState('');
  const [termsText, setTermsText] = useState<string>(
    settings?.termsText || DEFAULT_GYAN_ADDA_SETTINGS.termsText || ''
  );
  const [privacyText, setPrivacyText] = useState<string>(
    settings?.privacyText || DEFAULT_GYAN_ADDA_SETTINGS.privacyText || ''
  );
  const [seedingDemo, setSeedingDemo] = useState(false);

  const loadServerPublicContent = async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/public-content', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        if (d.settings) {
          setServerSettings(d.settings);
          if (Array.isArray(d.settings.facilityItems)) {
            setFacilityItems(d.settings.facilityItems);
          }
        }
        if (Array.isArray(d.gallery)) setServerGallery(d.gallery);
        if (Array.isArray(d.enquiries)) setServerEnquiries(d.enquiries);
      }
    } catch {
      // Ignore network errors
    }
  };

  useEffect(() => {
    if (
      activeSection === 'settings' ||
      activeSection === 'facilities' ||
      activeSection === 'gallery' ||
      activeSection === 'enquiries'
    ) {
      loadServerPublicContent();
    }
  }, [activeSection]);

  useEffect(() => {
    const src = settings || serverSettings;
    if (src) {
      setLibName(src.libraryName);
      setTagline(src.tagline);
      setAddress(src.address);
      setNearbyLandmarks(src.nearbyLandmarks || DEFAULT_GYAN_ADDA_SETTINGS.nearbyLandmarks || '');
      setPhone(src.phone);
      setWhatsapp(src.whatsapp);
      setEmail(src.email);
      setOpeningHours(src.openingHours);
      setIs24Hour(Boolean(src.is24HourAccess));
      setMapLat(src.mapLat);
      setMapLng(src.mapLng);
      setMapUrl(src.mapUrl || '');
      setRatingText(src.ratingText || '');
      setFacilities(src.facilities || DEFAULT_FACILITIES);
      if (Array.isArray(src.facilityItems) && src.facilityItems.length > 0) {
        setFacilityItems(src.facilityItems);
      }
      setTermsText(src.termsText || '');
      setPrivacyText(src.privacyText || '');
    }
  }, [settings, serverSettings]);

  useEffect(() => {
    if (activeSection !== 'notifications') return;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch('/api/notifications/providers', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setProviders(await res.json());
        }
      } catch {
        // Ignore network failure
      }
    })();
  }, [activeSection, getIdToken]);

  const openAddStaff = () => {
    setEditingStaff(null);
    setStfUid('');
    setStfName('');
    setStfEmail('');
    setStfMobile('');
    setStfRole('staff');
    setStfShift('Morning (06:00–14:00)');
    setStfSalary(18000);
    setStfPerms(['view_students', 'mark_attendance']);
    setShowStaffModal(true);
  };

  const openEditStaff = (s: StaffRecord) => {
    setEditingStaff(s);
    setStfUid(s.uid || '');
    setStfName(s.fullName);
    setStfEmail(s.email);
    setStfMobile(s.mobile);
    setStfRole(s.role);
    setStfShift(s.shift);
    setStfSalary(s.monthlySalary);
    setStfPerms(s.permissions || []);
    setShowStaffModal(true);
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const cleanUid = stfUid.trim();
      if (editingStaff) {
        await updateDoc(doc(db, 'staff', editingStaff.id), {
          ...(cleanUid ? { uid: cleanUid } : {}),
          fullName: stfName.trim(),
          email: stfEmail.trim(),
          mobile: stfMobile.trim(),
          role: stfRole,
          permissions: stfPerms,
          shift: stfShift.trim(),
          monthlySalary: Math.max(0, Number(stfSalary)),
          updatedAt: serverTimestamp(),
        });
        if (cleanUid) {
          await setDoc(doc(db, 'user_roles', cleanUid), {
            uid: cleanUid,
            email: stfEmail.trim(),
            role: stfRole,
            permissions: stfPerms,
            active: editingStaff.status === 'active',
            updatedAt: serverTimestamp(),
          });
        }
        onNotify('ok', `Updated staff profile for ${stfName}.`);
      } else {
        const staffCode = `STF${String(Math.floor(100 + Math.random() * 899))}`;
        const ref = await addDoc(collection(db, 'staff'), {
          ...(cleanUid ? { uid: cleanUid } : {}),
          staffCode,
          fullName: stfName.trim(),
          email: stfEmail.trim(),
          mobile: stfMobile.trim(),
          role: stfRole,
          permissions: stfPerms,
          shift: stfShift.trim(),
          monthlySalary: Math.max(0, Number(stfSalary)),
          status: 'active',
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (cleanUid) {
          await setDoc(doc(db, 'user_roles', cleanUid), {
            uid: cleanUid,
            email: stfEmail.trim(),
            role: stfRole,
            permissions: stfPerms,
            active: true,
            updatedAt: serverTimestamp(),
          });
        }
        await logAuditEvent('STAFF_ADDED', 'staff', ref.id, `${stfName} (${stfRole})`, actorRole);
        onNotify('ok', `Staff member ${stfName} added (${staffCode}).`);
      }
      setShowStaffModal(false);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to save staff record.');
    }
  };

  const handleToggleStaffStatus = async (s: StaffRecord) => {
    const nextStatus = s.status === 'active' ? 'inactive' : 'active';
    await updateDoc(doc(db, 'staff', s.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    if (s.uid) {
      await setDoc(doc(db, 'user_roles', s.uid), {
        uid: s.uid,
        email: s.email,
        role: s.role,
        permissions: s.permissions || [],
        active: nextStatus === 'active',
        updatedAt: serverTimestamp(),
      });
    }
    onNotify('ok', `${s.fullName} marked ${nextStatus}.`);
  };

  const handleEnquiryStatus = async (enq: EnquiryRecord, status: EnquiryRecord['status']) => {
    try {
      const token = await getIdToken();
      if (token) {
        await fetch(`/api/admin/enquiries/${encodeURIComponent(enq.id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status }),
        }).catch(() => {});
      }
      if (hasFirebaseSession && !enq.id.startsWith('enq_')) {
        await updateDoc(doc(db, 'enquiries', enq.id), {
          status,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      await loadServerPublicContent();
      onNotify('ok', `Enquiry from ${enq.name} marked ${status}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to update enquiry.');
    }
  };

  const handleSaveGalleryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await getIdToken();
      const payload = {
        id: editingGallery?.id,
        title: galTitle.trim(),
        category: galCat.trim(),
        imageUrl: galUrl.trim(),
        caption: galCaption.trim(),
        sortOrder: editingGallery?.sortOrder || serverGallery.length + gallery.length + 1,
        approved: galApproved,
      };
      let savedId = editingGallery?.id || '';
      if (token) {
        const res = await fetch('/api/admin/gallery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed saving gallery item.');
        savedId = d.item?.id || savedId;
      }
      if (hasFirebaseSession) {
        if (editingGallery && !editingGallery.id.startsWith('gal_')) {
          await updateDoc(doc(db, 'gallery', editingGallery.id), {
            title: payload.title,
            category: payload.category,
            imageUrl: payload.imageUrl,
            caption: payload.caption,
            approved: payload.approved,
          }).catch(() => {});
        } else {
          await addDoc(collection(db, 'gallery'), {
            title: payload.title,
            category: payload.category,
            imageUrl: payload.imageUrl,
            caption: payload.caption,
            sortOrder: payload.sortOrder,
            approved: payload.approved,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
      setEditingGallery(null);
      setGalTitle('');
      setGalUrl('');
      setGalCaption('');
      setGalApproved(true);
      await loadServerPublicContent();
      onNotify('ok', editingGallery ? 'Gallery photo updated.' : `Gallery photo saved (${savedId || 'published'}).`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save gallery photo.');
    }
  };

  const handleToggleGalleryApproval = async (item: GalleryItem) => {
    const nextApproved = item.approved === false;
    try {
      const token = await getIdToken();
      if (token) {
        await fetch('/api/admin/gallery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...item, approved: nextApproved }),
        });
      }
      if (hasFirebaseSession && !item.id.startsWith('gal_')) {
        await updateDoc(doc(db, 'gallery', item.id), { approved: nextApproved }).catch(() => {});
      }
      await loadServerPublicContent();
      onNotify('ok', `${item.title} ${nextApproved ? 'approved for public website' : 'hidden from public gallery'}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to toggle approval.');
    }
  };

  const handleDeleteGalleryItem = async (item: GalleryItem) => {
    try {
      const token = await getIdToken();
      if (token) {
        await fetch(`/api/admin/gallery/${encodeURIComponent(item.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (hasFirebaseSession && !item.id.startsWith('gal_')) {
        await deleteDoc(doc(db, 'gallery', item.id)).catch(() => {});
      }
      await loadServerPublicContent();
      onNotify('ok', 'Gallery photo deleted.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to delete photo.');
    }
  };

  const persistFacilitiesList = async (nextItems: FacilityItem[]) => {
    const token = await getIdToken();
    const availableNames = nextItems.filter((f) => f.available).map((f) => f.name);
    if (token) {
      const res = await fetch('/api/admin/public-settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          facilityItems: nextItems,
          facilities: availableNames,
        }),
      });
      if (!res.ok) throw new Error('Unable to update facilities.');
    }
    if (hasFirebaseSession) {
      await setDoc(
        doc(db, 'library_settings', 'main'),
        {
          facilities: availableNames.slice(0, 20),
          facilityItems: nextItems,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }
    setFacilityItems(nextItems);
    setFacilities(availableNames);
  };

  const handleAddOrUpdateFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facName.trim()) return;
    try {
      const nextItems = editingFacilityId
        ? facilityItems.map((f) =>
            f.id === editingFacilityId
              ? { ...f, name: facName.trim(), description: facDesc.trim(), icon: facIcon }
              : f
          )
        : [
            ...facilityItems,
            {
              id: `fac_${Date.now()}`,
              name: facName.trim(),
              description: facDesc.trim(),
              icon: facIcon,
              available: true,
            },
          ];
      await persistFacilitiesList(nextItems);
      setFacName('');
      setFacDesc('');
      setFacIcon('Sparkles');
      setEditingFacilityId(null);
      onNotify('ok', editingFacilityId ? 'Facility updated.' : 'Facility added to public website.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save facility.');
    }
  };

  const handleAddAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'announcements'), {
      title: annTitle.trim(),
      body: annBody.trim(),
      priority: annPriority,
      published: true,
      createdAt: serverTimestamp(),
    });
    setAnnTitle('');
    setAnnBody('');
    onNotify('ok', 'Library announcement published.');
  };

  const handleSendInAppBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'notifications'), {
      recipientUid: notifRecipient,
      type: 'announcement',
      title: notifTitle.trim(),
      message: notifMessage.trim(),
      read: false,
      channel: 'in_app',
      createdAt: serverTimestamp(),
    });
    setNotifTitle('');
    setNotifMessage('');
    onNotify('ok', 'In-app notification dispatched.');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        libraryName: libName.trim(),
        tagline: tagline.trim(),
        address: address.trim(),
        nearbyLandmarks: nearbyLandmarks.trim(),
        phone: phone.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        openingHours: openingHours.trim(),
        is24HourAccess: is24Hour,
        mapLat: Number(mapLat),
        mapLng: Number(mapLng),
        mapUrl: mapUrl.trim(),
        ratingText: ratingText.trim(),
        facilities: facilities.slice(0, 20),
        facilityItems,
        termsText: termsText.trim(),
        privacyText: privacyText.trim(),
      };
      const token = await getIdToken();
      if (token) {
        const res = await fetch('/api/admin/public-settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Unable to save public website settings.');
      }
      if (hasFirebaseSession) {
        await setDoc(doc(db, 'library_settings', 'main'), {
          ...payload,
          razorpayEnabled: settings?.razorpayEnabled ?? true,
          whatsappConfigured: Boolean(providers?.whatsapp.configured),
          emailConfigured: Boolean(providers?.email.configured),
          smsConfigured: Boolean(providers?.sms.configured),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        await logAuditEvent(
          'SETTINGS_UPDATED',
          'library_settings',
          'main',
          'Updated library profile & facilities',
          actorRole
        ).catch(() => {});
      }
      onNotify('ok', 'GYAN ADDA LIBRARY public website settings saved.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed saving settings.');
    }
  };

  const handleSeedDemo = async () => {
    setSeedingDemo(true);
    try {
      const res = await seedDemoDataset(actorUid);
      await logAuditEvent('DEMO_DATASET_SEEDED', 'system', 'demoSeed', `Seeded ${res.created} demo records`, actorRole);
      onNotify('ok', `Demo dataset (${res.created} sample records) populated cleanly.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to populate demo dataset.');
    } finally {
      setSeedingDemo(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white focus:border-secondary focus:outline-none';
  const cardCls =
    'rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm';

  if (activeSection === 'staff') {
    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
              Staff &amp; Manager Access Control
            </h2>
            <p className="text-xs text-on-surface-variant dark:text-slate-400">
              Assign granular desk permissions and link Firebase UIDs to enforce backend role checks.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openAddStaff}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
            >
              <UserPlus className="w-4 h-4" /> Add Staff / Manager
            </button>
          )}
        </div>

        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Staff</th>
                <th className="px-4 py-3 font-semibold">Role &amp; Shift</th>
                <th className="px-4 py-3 font-semibold">Permissions</th>
                <th className="px-4 py-3 text-right font-semibold">Salary</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                {isAdmin && <th className="px-4 py-3 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {staffList.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-xs text-on-surface dark:text-white">{s.fullName}</div>
                    <div className="font-mono text-[11px] text-on-surface-variant dark:text-slate-400">
                      {s.staffCode} · {s.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-semibold capitalize text-on-surface dark:text-white">{s.role}</div>
                    <div className="text-on-surface-variant dark:text-slate-400">{s.shift}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant dark:text-slate-300 max-w-xs">
                    {(s.permissions || []).map((p) => p.replace(/_/g, ' ')).join(' · ')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-on-surface dark:text-white">
                    ₹{Number(s.monthlySalary).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] ${s.status === 'active' ? 'bg-success-container text-on-success-container' : 'bg-surface-variant text-on-surface-variant'}`}>
                      {s.status}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right space-x-2.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditStaff(s)}
                        className="text-xs font-semibold text-secondary hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStaffStatus(s)}
                        className="text-xs font-semibold text-on-surface-variant hover:text-primary hover:underline cursor-pointer"
                      >
                        {s.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showStaffModal && (
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
            <div className="w-full max-w-lg bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto text-on-surface dark:text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between gap-2 border-b border-outline-variant dark:border-slate-800 pb-3">
                <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                  {editingStaff ? 'Update Staff Permissions' : 'Add Staff or Manager'}
                </h3>
                <button type="button" onClick={() => setShowStaffModal(false)} className="text-on-surface-variant hover:text-primary shrink-0 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleSaveStaff} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Full Name</label>
                    <input type="text" required value={stfName} onChange={(e) => setStfName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Mobile</label>
                    <input type="tel" required value={stfMobile} onChange={(e) => setStfMobile(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Email</label>
                    <input type="email" required value={stfEmail} onChange={(e) => setStfEmail(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Firebase Auth UID (Optional)</label>
                    <input type="text" value={stfUid} onChange={(e) => setStfUid(e.target.value)} placeholder="Links live RBAC login" className={`${inputCls} font-mono`} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">Role</label>
                    <select value={stfRole} onChange={(e) => setStfRole(e.target.value as 'staff' | 'manager')} className={inputCls}>
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Shift</label>
                    <input type="text" required value={stfShift} onChange={(e) => setStfShift(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">Monthly Salary</label>
                    <input type="number" min={0} required value={stfSalary} onChange={(e) => setStfSalary(Number(e.target.value))} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Granular Permissions</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ALL_STAFF_PERMISSIONS.map((perm) => {
                      const checked = stfPerms.includes(perm);
                      return (
                        <label
                          key={perm}
                          className="flex items-center gap-2 text-xs p-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-low dark:bg-slate-800 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setStfPerms((prev) =>
                                prev.includes(perm) ? prev.filter((x) => x !== perm) : [...prev, perm]
                              )
                            }
                          />
                          <span className="capitalize">{perm.replace(/_/g, ' ')}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
                >
                  Save Staff Account
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (activeSection === 'enquiries') {
    const mergedEnquiries = [...enquiries];
    serverEnquiries.forEach((se) => {
      if (!mergedEnquiries.some((e) => e.id === se.id)) {
        mergedEnquiries.push(se);
      }
    });

    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Public Website Enquiries ({mergedEnquiries.length})
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Admission and helpline enquiries submitted on GYAN ADDA LIBRARY are stored here for follow-up.
          </p>
        </div>
        <div className="space-y-3">
          {mergedEnquiries.map((e) => (
            <div
              key={e.id}
              className={`${cardCls} p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4`}
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-sm text-primary dark:text-white break-words">{e.subject}</span>
                  <span className="text-outline">·</span>
                  <span className="capitalize font-semibold text-secondary dark:text-blue-400">{e.status}</span>
                </div>
                <p className="text-xs text-on-surface-variant dark:text-slate-400 break-all">
                  {e.name} · {e.phone} · {e.email}
                </p>
                <p className="text-sm text-on-surface dark:text-slate-200 mt-1 break-words">{e.message}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {e.status !== 'contacted' && (
                  <button
                    type="button"
                    onClick={() => handleEnquiryStatus(e, 'contacted')}
                    className="px-3 py-1.5 rounded border border-outline-variant dark:border-slate-700 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
                  >
                    Mark Contacted
                  </button>
                )}
                {e.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={() => handleEnquiryStatus(e, 'resolved')}
                    className="px-3 py-1.5 rounded bg-success text-on-success text-xs font-semibold cursor-pointer"
                  >
                    Resolve
                  </button>
                )}
                {isAdmin && hasFirebaseSession && !e.id.startsWith('enq_') && (
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'enquiries', e.id))}
                    className="p-1.5 text-error hover:bg-error-container rounded cursor-pointer"
                    aria-label="Delete enquiry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {mergedEnquiries.length === 0 && (
            <div className={`${cardCls} p-8 text-center text-xs text-on-surface-variant dark:text-slate-400`}>
              No public contact enquiries received yet.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'facilities') {
    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Library Facilities Manager ({facilityItems.length})
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Configure only genuinely available facilities. Disabled facilities are hidden automatically from the public website.
          </p>
        </div>

        <form onSubmit={handleAddOrUpdateFacility} className={`${cardCls} p-4 sm:p-5 space-y-3`}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Facility Name</label>
              <input
                type="text"
                required
                value={facName}
                onChange={(e) => setFacName(e.target.value)}
                placeholder="e.g. Personal Storage Lockers"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Icon</label>
              <select value={facIcon} onChange={(e) => setFacIcon(e.target.value)} className={inputCls}>
                {FACILITY_ICONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {editingFacilityId ? 'Update Facility' : 'Add Facility'}
              </button>
              {editingFacilityId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingFacilityId(null);
                    setFacName('');
                    setFacDesc('');
                  }}
                  className="py-2 px-3 rounded border border-outline-variant text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Description</label>
            <input
              type="text"
              required
              value={facDesc}
              onChange={(e) => setFacDesc(e.target.value)}
              placeholder="Short description shown on the public facility card"
              className={inputCls}
            />
          </div>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {facilityItems.map((fac) => (
            <div key={fac.id} className={`${cardCls} p-4 flex flex-col justify-between gap-3`}>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary dark:text-blue-400 font-mono text-[11px] font-semibold">
                    {fac.icon}
                  </span>
                  <span className={`text-[11px] font-bold uppercase ${fac.available ? 'text-success' : 'text-error'}`}>
                    {fac.available ? 'Available (Visible)' : 'Unavailable (Hidden)'}
                  </span>
                </div>
                <h4 className="font-semibold text-sm text-primary dark:text-white mt-2 break-words">{fac.name}</h4>
                <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1 break-words">{fac.description}</p>
              </div>
              <div className="pt-2.5 border-t border-outline-variant/60 dark:border-slate-800 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    persistFacilitiesList(
                      facilityItems.map((f) => (f.id === fac.id ? { ...f, available: !f.available } : f))
                    )
                  }
                  className="text-xs font-semibold text-secondary hover:underline cursor-pointer"
                >
                  {fac.available ? 'Mark Unavailable' : 'Mark Available'}
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingFacilityId(fac.id);
                      setFacName(fac.name);
                      setFacDesc(fac.description);
                      setFacIcon(fac.icon || 'Sparkles');
                    }}
                    className="p-1.5 rounded text-on-surface-variant hover:text-primary cursor-pointer"
                    aria-label={`Edit ${fac.name}`}
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => persistFacilitiesList(facilityItems.filter((f) => f.id !== fac.id))}
                    className="p-1.5 rounded text-error hover:bg-error-container cursor-pointer"
                    aria-label={`Delete ${fac.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeSection === 'gallery') {
    const mergedGallery = [...gallery];
    serverGallery.forEach((sg) => {
      if (!mergedGallery.some((g) => g.id === sg.id)) {
        mergedGallery.push(sg);
      }
    });

    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Photo Gallery Management ({mergedGallery.length})
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Upload, edit, delete, and approve campus photographs. Only admin-approved photos appear on the public website.
          </p>
        </div>

        {isManagerOrAdmin && (
          <form
            onSubmit={handleSaveGalleryItem}
            className={`${cardCls} p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end`}
          >
            <div>
              <label className="block text-xs font-semibold mb-1">Photo Title</label>
              <input
                type="text"
                required
                value={galTitle}
                onChange={(e) => setGalTitle(e.target.value)}
                placeholder="Silent Hall Wing B"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Category</label>
              <input type="text" required value={galCat} onChange={(e) => setGalCat(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Image URL</label>
              <input
                type="text"
                required
                value={galUrl}
                onChange={(e) => setGalUrl(e.target.value)}
                placeholder="https://... or /assets/..."
                className={inputCls}
              />
            </div>
            <button type="submit" className="py-2 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer">
              {editingGallery ? 'Update Photo' : 'Add Photo'}
            </button>
            <div className="sm:col-span-2 xl:col-span-3">
              <input
                type="text"
                value={galCaption}
                onChange={(e) => setGalCaption(e.target.value)}
                placeholder="Short architectural / study hall caption"
                className={inputCls}
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer py-2">
              <input type="checkbox" checked={galApproved} onChange={(e) => setGalApproved(e.target.checked)} />
              <span>Approved for Public Gallery</span>
            </label>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {mergedGallery.map((g) => {
            const isApproved = g.approved !== false;
            return (
              <div key={g.id} className={`${cardCls} overflow-hidden min-w-0 flex flex-col justify-between`}>
                <div>
                  <div className="relative">
                    <img src={g.imageUrl} alt={g.title} className="w-full aspect-4/3 object-cover" />
                    <span
                      className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        isApproved
                          ? 'bg-success text-on-success'
                          : 'bg-warning-container text-on-warning-container'
                      }`}
                    >
                      <CheckCircle2 className="w-3 h-3" /> {isApproved ? 'Approved' : 'Hidden'}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="text-[11px] font-semibold uppercase text-secondary dark:text-blue-400">{g.category}</p>
                    <p className="font-semibold text-sm text-on-surface dark:text-white break-words">{g.title}</p>
                    <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-0.5 break-words">{g.caption}</p>
                  </div>
                </div>
                {isManagerOrAdmin && (
                  <div className="px-4 py-2.5 border-t border-outline-variant/60 dark:border-slate-800 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleGalleryApproval(g)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline cursor-pointer"
                    >
                      {isApproved ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      {isApproved ? 'Hide Publicly' : 'Approve Publicly'}
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGallery(g);
                          setGalTitle(g.title);
                          setGalCat(g.category);
                          setGalUrl(g.imageUrl);
                          setGalCaption(g.caption);
                          setGalApproved(isApproved);
                        }}
                        className="p-1.5 rounded text-on-surface-variant hover:text-primary cursor-pointer"
                        aria-label={`Edit ${g.title}`}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteGalleryItem(g)}
                          className="p-1.5 text-error hover:bg-error-container rounded cursor-pointer"
                          aria-label="Delete photo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (activeSection === 'announcements') {
    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Announcements &amp; Notice Board
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Published announcements appear on the public homepage and inside every Student Portal.
          </p>
        </div>

        {isManagerOrAdmin && (
          <form onSubmit={handleAddAnnouncement} className={`${cardCls} p-5 space-y-3`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement headline"
                className={`sm:col-span-2 ${inputCls}`}
              />
              <select
                value={annPriority}
                onChange={(e) => setAnnPriority(e.target.value as 'normal' | 'important')}
                className={inputCls}
              >
                <option value="normal">Normal Notice</option>
                <option value="important">Important Priority</option>
              </select>
            </div>
            <textarea
              rows={2}
              required
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              placeholder="Write full announcement text..."
              className={inputCls}
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
            >
              Publish Announcement
            </button>
          </form>
        )}

        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className={`${cardCls} p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4`}>
              <div className="min-w-0 break-words">
                <p className="text-xs font-semibold uppercase text-secondary dark:text-blue-400">
                  {a.priority} · {a.published ? 'Published' : 'Hidden'}
                </p>
                <h4 className="font-semibold text-sm mt-0.5 text-on-surface dark:text-white">{a.title}</h4>
                <p className="text-xs text-on-surface-variant dark:text-slate-300 mt-1">{a.body}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {isManagerOrAdmin && (
                  <button
                    type="button"
                    onClick={() => updateDoc(doc(db, 'announcements', a.id), { published: !a.published })}
                    className="text-xs font-semibold text-secondary hover:underline cursor-pointer"
                  >
                    {a.published ? 'Unpublish' : 'Publish'}
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'announcements', a.id))}
                    className="text-error hover:bg-error-container p-1 rounded cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeSection === 'notifications') {
    return (
      <div className="space-y-6 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Notifications &amp; Integration Status
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            In-app notifications are always active. External gateways remain disabled unless configured in server environment secrets.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: 'WhatsApp Business Cloud API', ready: providers?.whatsapp.configured },
            { name: 'SMTP Email Relay', ready: providers?.email.configured },
            { name: 'Transactional SMS Gateway', ready: providers?.sms.configured },
          ].map((item) => (
            <div key={item.name} className={`${cardCls} p-4`}>
              <p className="text-xs text-on-surface-variant dark:text-slate-400 font-semibold">{item.name}</p>
              <p className={`text-sm font-bold mt-1 ${item.ready ? 'text-success' : 'text-outline'}`}>
                {item.ready ? 'Active & Configured' : 'Not Configured'}
              </p>
            </div>
          ))}
        </div>

        <form onSubmit={handleSendInAppBroadcast} className={`${cardCls} p-5 space-y-3`}>
          <h3 className="text-sm font-semibold text-primary dark:text-white">Dispatch In-App Student Notification</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select value={notifRecipient} onChange={(e) => setNotifRecipient(e.target.value)} className={inputCls}>
              <option value="ALL_STUDENTS">Broadcast to All Students</option>
              {students.map((s) => (
                <option key={s.id} value={s.uid}>
                  {s.studentCode} — {s.fullName}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              value={notifTitle}
              onChange={(e) => setNotifTitle(e.target.value)}
              placeholder="Notification title"
              className={inputCls}
            />
          </div>
          <textarea
            rows={2}
            required
            value={notifMessage}
            onChange={(e) => setNotifMessage(e.target.value)}
            placeholder="Message content..."
            className={inputCls}
          />
          <button
            type="submit"
            className="px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            Send Notification
          </button>
        </form>
      </div>
    );
  }

  if (activeSection === 'audit') {
    return (
      <div className="space-y-4 text-on-surface dark:text-slate-100">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Immutable Security Audit Logs ({auditLogs.length})
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Append-only operational trail across authentication, payments, seat updates, exam publishing, and role changes.
          </p>
        </div>
        <div className={`${cardCls} overflow-x-auto`}>
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container-low dark:bg-slate-800/80 uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 font-semibold">Action</th>
                <th className="px-4 py-3 font-semibold">Actor</th>
                <th className="px-4 py-3 font-semibold">Target</th>
                <th className="px-4 py-3 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {auditLogs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-secondary dark:text-blue-400">{l.action}</td>
                  <td className="px-4 py-3 text-on-surface dark:text-white">
                    {l.actorEmail} · <span className="capitalize text-on-surface-variant dark:text-slate-400">{l.actorRole}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-on-surface-variant dark:text-slate-300">
                    {l.targetType}/{l.targetId}
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant dark:text-slate-300">{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Public Website Settings &amp; Location
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Changes sync immediately to GYAN ADDA LIBRARY public sections, Google Maps directions, and helpline links.
          </p>
        </div>
        {isAdmin && hasFirebaseSession && (
          <button
            type="button"
            disabled={seedingDemo}
            onClick={handleSeedDemo}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded border border-secondary text-secondary text-xs font-semibold hover:bg-secondary hover:text-on-secondary disabled:opacity-50 cursor-pointer"
          >
            <Database className="w-4 h-4" />
            {seedingDemo ? 'Populating Demo Data...' : 'Seed Demonstration Dataset'}
          </button>
        )}
      </div>

      <form onSubmit={handleSaveSettings} className={`${cardCls} p-4 sm:p-6 space-y-5`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1">Library Name</label>
            <input type="text" required value={libName} onChange={(e) => setLibName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Tagline</label>
            <input type="text" required value={tagline} onChange={(e) => setTagline(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Help Line Phone(s)</label>
            <input type="text" required value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">WhatsApp Help Line</label>
            <input type="text" required value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Official Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Opening Hours</label>
            <input type="text" required value={openingHours} onChange={(e) => setOpeningHours(e.target.value)} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold mb-1">Full Street Address</label>
            <input type="text" required value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold mb-1">Nearby Landmarks</label>
            <input
              type="text"
              value={nearbyLandmarks}
              onChange={(e) => setNearbyLandmarks(e.target.value)}
              placeholder="e.g. In front of Poor Home Road · 350m from Darbhanga Junction"
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Google Maps Share / Directions URL</label>
            <input type="url" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Google Reviews / Rating Badge</label>
            <input type="text" value={ratingText} onChange={(e) => setRatingText(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Google Maps Latitude</label>
            <input type="number" step="0.0001" required value={mapLat} onChange={(e) => setMapLat(Number(e.target.value))} className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Google Maps Longitude</label>
            <input type="number" step="0.0001" required value={mapLng} onChange={(e) => setMapLng(Number(e.target.value))} className={`${inputCls} font-mono`} />
          </div>
        </div>

        <label className="flex items-start sm:items-center gap-2.5 text-sm font-medium cursor-pointer">
          <input type="checkbox" className="mt-1 sm:mt-0 shrink-0" checked={is24Hour} onChange={(e) => setIs24Hour(e.target.checked)} />
          <span>Enable 24-Hour Study Hall Access Badge &amp; Policy on Public Website</span>
        </label>

        {/* Editable Facilities */}
        <div className="space-y-3 pt-4 border-t border-outline-variant dark:border-slate-800">
          <h4 className="text-sm font-semibold text-primary dark:text-white">
            Editable Public Facilities ({facilities.length}/20)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {facilities.map((fac, idx) => (
              <div
                key={`${fac}-${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-surface-container-low dark:bg-slate-800 border border-outline-variant dark:border-slate-700 text-xs min-w-0"
              >
                <span className="min-w-0 break-words">{fac}</span>
                <button
                  type="button"
                  onClick={() => setFacilities((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-error shrink-0 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newFacility}
              onChange={(e) => setNewFacility(e.target.value)}
              placeholder="Add new facility (e.g. Personal Storage Lockers)"
              className={`flex-1 min-w-0 ${inputCls}`}
            />
            <button
              type="button"
              onClick={() => {
                if (!newFacility.trim() || facilities.length >= 20) return;
                setFacilities((prev) => [...prev, newFacility.trim()]);
                setNewFacility('');
              }}
              className="w-full sm:w-auto px-4 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-low dark:bg-slate-800 text-primary dark:text-white text-xs font-semibold hover:bg-surface-container cursor-pointer shrink-0"
            >
              Add Facility
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-outline-variant dark:border-slate-800">
          <div>
            <label className="block text-xs font-semibold mb-1">Terms &amp; Library Rules</label>
            <textarea rows={3} value={termsText} onChange={(e) => setTermsText(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Privacy Policy Text</label>
            <textarea rows={3} value={privacyText} onChange={(e) => setPrivacyText(e.target.value)} className={inputCls} />
          </div>
        </div>

        <button
          type="submit"
          className="w-full sm:w-auto px-6 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
        >
          Save Library Configuration
        </button>
      </form>
    </div>
  );
};
