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
  Bell,
  Database,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Plus,
  Settings,
  Shield,
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
  GalleryItem,
  LibrarySettings,
  StaffRecord,
  StudentRecord,
} from '../../types/library';

interface SettingsAndOpsPanelProps {
  activeSection: 'staff' | 'enquiries' | 'gallery' | 'announcements' | 'notifications' | 'audit' | 'settings';
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
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface ProviderInfo {
  whatsapp: { configured: boolean; label: string };
  email: { configured: boolean; label: string };
  sms: { configured: boolean; label: string };
}

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

  // Gallery Form State
  const [galTitle, setGalTitle] = useState('');
  const [galCat, setGalCat] = useState('Reading Hall');
  const [galUrl, setGalUrl] = useState('');
  const [galCaption, setGalCaption] = useState('');

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
  const [phone, setPhone] = useState(settings?.phone || DEFAULT_GYAN_ADDA_SETTINGS.phone);
  const [whatsapp, setWhatsapp] = useState(settings?.whatsapp || DEFAULT_GYAN_ADDA_SETTINGS.whatsapp);
  const [email, setEmail] = useState(settings?.email || DEFAULT_GYAN_ADDA_SETTINGS.email);
  const [openingHours, setOpeningHours] = useState(settings?.openingHours || DEFAULT_GYAN_ADDA_SETTINGS.openingHours);
  const [is24Hour, setIs24Hour] = useState(settings?.is24HourAccess ?? true);
  const [mapLat, setMapLat] = useState(settings?.mapLat ?? DEFAULT_GYAN_ADDA_SETTINGS.mapLat);
  const [mapLng, setMapLng] = useState(settings?.mapLng ?? DEFAULT_GYAN_ADDA_SETTINGS.mapLng);
  const [facilities, setFacilities] = useState<string[]>(settings?.facilities || DEFAULT_FACILITIES);
  const [newFacility, setNewFacility] = useState('');
  const [termsText, setTermsText] = useState<string>(
    settings?.termsText || DEFAULT_GYAN_ADDA_SETTINGS.termsText || ''
  );
  const [privacyText, setPrivacyText] = useState<string>(
    settings?.privacyText || DEFAULT_GYAN_ADDA_SETTINGS.privacyText || ''
  );
  const [seedingDemo, setSeedingDemo] = useState(false);

  useEffect(() => {
    if (settings) {
      setLibName(settings.libraryName);
      setTagline(settings.tagline);
      setAddress(settings.address);
      setPhone(settings.phone);
      setWhatsapp(settings.whatsapp);
      setEmail(settings.email);
      setOpeningHours(settings.openingHours);
      setIs24Hour(Boolean(settings.is24HourAccess));
      setMapLat(settings.mapLat);
      setMapLng(settings.mapLng);
      setFacilities(settings.facilities || DEFAULT_FACILITIES);
      setTermsText(settings.termsText || '');
      setPrivacyText(settings.privacyText || '');
    }
  }, [settings]);

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

  // Staff CRUD + RBAC sync
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

  // Enquiries
  const handleEnquiryStatus = async (enq: EnquiryRecord, status: EnquiryRecord['status']) => {
    await updateDoc(doc(db, 'enquiries', enq.id), {
      status,
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', `Enquiry from ${enq.name} marked ${status}.`);
  };

  // Gallery
  const handleAddGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    await addDoc(collection(db, 'gallery'), {
      title: galTitle.trim(),
      category: galCat.trim(),
      imageUrl: galUrl.trim(),
      caption: galCaption.trim(),
      sortOrder: gallery.length + 1,
      createdAt: serverTimestamp(),
    });
    setGalTitle('');
    setGalUrl('');
    setGalCaption('');
    onNotify('ok', 'Gallery image published.');
  };

  // Announcements
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

  // Notifications Broadcast
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

  // Settings Save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await setDoc(doc(db, 'library_settings', 'main'), {
      libraryName: libName.trim(),
      tagline: tagline.trim(),
      address: address.trim(),
      phone: phone.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim(),
      openingHours: openingHours.trim(),
      is24HourAccess: is24Hour,
      mapLat: Number(mapLat),
      mapLng: Number(mapLng),
      facilities: facilities.slice(0, 20),
      termsText: termsText.trim(),
      privacyText: privacyText.trim(),
      razorpayEnabled: settings?.razorpayEnabled ?? true,
      whatsappConfigured: Boolean(providers?.whatsapp.configured),
      emailConfigured: Boolean(providers?.email.configured),
      smsConfigured: Boolean(providers?.sms.configured),
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent('SETTINGS_UPDATED', 'library_settings', 'main', 'Updated library profile & facilities', actorRole);
    onNotify('ok', 'Library settings and facilities saved.');
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

  if (activeSection === 'staff') {
    return (
      <div className="space-y-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Staff &amp; Manager Access Control
            </h2>
            <p className="text-xs text-[#CFCEDD]">
              Assign granular desk permissions and link Firebase UIDs to enforce backend role checks.
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={openAddStaff}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
            >
              <UserPlus className="w-4 h-4" /> Add Staff / Manager
            </button>
          )}
        </div>

        <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0E0713]/60 text-xs uppercase text-[#CFCEDD]">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Role &amp; Shift</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="px-4 py-3 text-right">Salary</th>
                <th className="px-4 py-3">Status</th>
                {isAdmin && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#7C7397]/25">
              {staffList.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-xs text-white">{s.fullName}</div>
                    <div className="font-mono text-[11px] text-[#CFCEDD]">
                      {s.staffCode} · {s.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-semibold capitalize text-white">{s.role}</div>
                    <div className="text-[#CFCEDD]">{s.shift}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#CFCEDD] max-w-xs">
                    {(s.permissions || []).map((p) => p.replace(/_/g, ' ')).join(' · ')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-white">
                    ₹{Number(s.monthlySalary).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize">
                    <span className={s.status === 'active' ? 'text-emerald-300' : 'text-[#9993AC]'}>
                      {s.status}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditStaff(s)}
                        className="text-xs font-semibold text-[#B5ADC6] hover:text-white hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleStaffStatus(s)}
                        className="text-xs font-semibold text-[#CFCEDD] hover:text-white hover:underline"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-lg bg-[#3D2C56] rounded-xl border border-[#7C7397] p-6 space-y-4 max-h-[90vh] overflow-y-auto text-white">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-bold text-white">
                  {editingStaff ? 'Update Staff Permissions' : 'Add Staff or Manager'}
                </h3>
                <button type="button" onClick={() => setShowStaffModal(false)}>
                  <X className="w-5 h-5 text-[#CFCEDD]" />
                </button>
              </div>
              <form onSubmit={handleSaveStaff} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Full Name</label>
                    <input
                      type="text"
                      required
                      value={stfName}
                      onChange={(e) => setStfName(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Mobile</label>
                    <input
                      type="tel"
                      required
                      value={stfMobile}
                      onChange={(e) => setStfMobile(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={stfEmail}
                      onChange={(e) => setStfEmail(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Firebase Auth UID (Optional)</label>
                    <input
                      type="text"
                      value={stfUid}
                      onChange={(e) => setStfUid(e.target.value)}
                      placeholder="Links live RBAC login"
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Role</label>
                    <select
                      value={stfRole}
                      onChange={(e) => setStfRole(e.target.value as 'staff' | 'manager')}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    >
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Shift</label>
                    <input
                      type="text"
                      required
                      value={stfShift}
                      onChange={(e) => setStfShift(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Monthly Salary</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={stfSalary}
                      onChange={(e) => setStfSalary(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1.5">Granular Permissions</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_STAFF_PERMISSIONS.map((perm) => {
                      const checked = stfPerms.includes(perm);
                      return (
                        <label
                          key={perm}
                          className="flex items-center gap-2 text-xs p-2 rounded-lg border border-[#7C7397]/50 bg-[#1C0E29]/60 cursor-pointer"
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
                  className="w-full py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
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
    return (
      <div className="space-y-6 text-white">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Public Website Enquiries ({enquiries.length})
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Inquiries submitted via the Contact Us page are stored here for follow-up.
          </p>
        </div>
        <div className="space-y-3">
          {enquiries.map((e) => (
            <div
              key={e.id}
              className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-sm text-white">{e.subject}</span>
                  <span className="text-[#9993AC]">·</span>
                  <span className="capitalize font-semibold text-[#B5ADC6]">{e.status}</span>
                </div>
                <p className="text-xs text-[#CFCEDD]">
                  {e.name} · {e.phone} · {e.email}
                </p>
                <p className="text-sm text-[#CFCEDD] mt-1">{e.message}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {e.status !== 'contacted' && (
                  <button
                    type="button"
                    onClick={() => handleEnquiryStatus(e, 'contacted')}
                    className="px-3 py-1.5 rounded-lg border border-[#7C7397]/60 text-xs font-semibold text-white"
                  >
                    Mark Contacted
                  </button>
                )}
                {e.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={() => handleEnquiryStatus(e, 'resolved')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                  >
                    Resolve
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'enquiries', e.id))}
                    className="p-1.5 text-red-300"
                    aria-label="Delete enquiry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {enquiries.length === 0 && (
            <div className="p-8 text-center rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 text-xs text-[#CFCEDD]">
              No public contact enquiries received yet.
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'gallery') {
    return (
      <div className="space-y-6 text-white">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">Gallery Management</h2>
          <p className="text-xs text-[#CFCEDD]">
            Add or remove library interior photographs displayed on the public homepage.
          </p>
        </div>

        {isManagerOrAdmin && (
          <form
            onSubmit={handleAddGallery}
            className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Photo Title</label>
              <input
                type="text"
                required
                value={galTitle}
                onChange={(e) => setGalTitle(e.target.value)}
                placeholder="Silent Hall Wing B"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Category</label>
              <input
                type="text"
                required
                value={galCat}
                onChange={(e) => setGalCat(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Image URL</label>
              <input
                type="text"
                required
                value={galUrl}
                onChange={(e) => setGalUrl(e.target.value)}
                placeholder="https://... or /assets/..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
            </div>
            <button
              type="submit"
              className="py-2 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
            >
              Add Photo
            </button>
            <div className="sm:col-span-4">
              <input
                type="text"
                value={galCaption}
                onChange={(e) => setGalCaption(e.target.value)}
                placeholder="Short architectural / desk caption"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
            </div>
          </form>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {gallery.map((g) => (
            <div
              key={g.id}
              className="rounded-xl overflow-hidden bg-[#514871] border border-[#7C7397]/40"
            >
              <img src={g.imageUrl} alt={g.title} className="w-full aspect-4/3 object-cover" />
              <div className="p-4 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase text-[#B5ADC6]">{g.category}</p>
                  <p className="font-semibold text-sm text-white">{g.title}</p>
                  <p className="text-xs text-[#CFCEDD] mt-0.5">{g.caption}</p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'gallery', g.id))}
                    className="p-1.5 text-red-300"
                    aria-label="Delete photo"
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

  if (activeSection === 'announcements') {
    return (
      <div className="space-y-6 text-white">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Announcements &amp; Notice Board
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Published announcements appear on the public homepage and inside every Student Portal.
          </p>
        </div>

        {isManagerOrAdmin && (
          <form
            onSubmit={handleAddAnnouncement}
            className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement headline"
                className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
              <select
                value={annPriority}
                onChange={(e) => setAnnPriority(e.target.value as 'normal' | 'important')}
                className="px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
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
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
            >
              Publish Announcement
            </button>
          </form>
        )}

        <div className="space-y-3">
          {announcements.map((a) => (
            <div
              key={a.id}
              className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex items-start justify-between gap-4"
            >
              <div>
                <p className="text-xs font-semibold uppercase text-[#B5ADC6]">
                  {a.priority} · {a.published ? 'Published' : 'Hidden'}
                </p>
                <h4 className="font-semibold text-sm mt-0.5 text-white">{a.title}</h4>
                <p className="text-xs text-[#CFCEDD] mt-1">{a.body}</p>
              </div>
              <div className="flex items-center gap-2">
                {isManagerOrAdmin && (
                  <button
                    type="button"
                    onClick={() =>
                      updateDoc(doc(db, 'announcements', a.id), { published: !a.published })
                    }
                    className="text-xs font-semibold text-[#B5ADC6] hover:text-white hover:underline"
                  >
                    {a.published ? 'Unpublish' : 'Publish'}
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'announcements', a.id))}
                    className="text-red-300"
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
      <div className="space-y-6 text-white">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Notifications &amp; Integration Status
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            In-app notifications are always active. External gateways remain disabled unless configured in server environment secrets.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: 'WhatsApp Business Cloud API', ready: providers?.whatsapp.configured },
            { name: 'SMTP Email Relay', ready: providers?.email.configured },
            { name: 'Transactional SMS Gateway', ready: providers?.sms.configured },
          ].map((item) => (
            <div
              key={item.name}
              className="p-4 rounded-xl bg-[#514871] border border-[#7C7397]/40"
            >
              <p className="text-xs text-[#CFCEDD] font-medium">{item.name}</p>
              <p
                className={`text-sm font-bold mt-1 ${
                  item.ready ? 'text-emerald-300' : 'text-[#B5ADC6]'
                }`}
              >
                {item.ready ? 'Active & Configured' : 'Not Configured'}
              </p>
            </div>
          ))}
        </div>

        <form
          onSubmit={handleSendInAppBroadcast}
          className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 space-y-3"
        >
          <h3 className="text-sm font-semibold text-white">Dispatch In-App Student Notification</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={notifRecipient}
              onChange={(e) => setNotifRecipient(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            >
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
              className="px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <textarea
            rows={2}
            required
            value={notifMessage}
            onChange={(e) => setNotifMessage(e.target.value)}
            placeholder="Message content..."
            className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
          >
            Send Notification
          </button>
        </form>
      </div>
    );
  }

  if (activeSection === 'audit') {
    return (
      <div className="space-y-4 text-white">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Immutable Security Audit Logs ({auditLogs.length})
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Append-only operational trail across authentication, payments, seat updates, exam publishing, and role changes.
          </p>
        </div>
        <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0E0713]/60 uppercase text-[#CFCEDD]">
              <tr>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#7C7397]/25">
              {auditLogs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-[#B5ADC6]">{l.action}</td>
                  <td className="px-4 py-3 text-white">
                    {l.actorEmail} · <span className="capitalize text-[#CFCEDD]">{l.actorRole}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[#CFCEDD]">
                    {l.targetType}/{l.targetId}
                  </td>
                  <td className="px-4 py-3 text-[#CFCEDD]">{l.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Library Settings & Demo Seed
  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Library Profile, Facilities &amp; Demo Seed
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Changes sync immediately to the public homepage, Google Maps pin, and receipts.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            disabled={seedingDemo}
            onClick={handleSeedDemo}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#B5ADC6] text-[#B5ADC6] text-xs font-semibold hover:bg-[#514871] hover:text-white disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {seedingDemo ? 'Populating Demo Data...' : 'Seed 175-Record Demonstration Dataset'}
          </button>
        )}
      </div>

      <form
        onSubmit={handleSaveSettings}
        className="p-6 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Library Name</label>
            <input
              type="text"
              required
              value={libName}
              onChange={(e) => setLibName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Tagline</label>
            <input
              type="text"
              required
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Phone</label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">WhatsApp</label>
            <input
              type="text"
              required
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Official Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Opening Hours</label>
            <input
              type="text"
              required
              value={openingHours}
              onChange={(e) => setOpeningHours(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Full Street Address</label>
            <input
              type="text"
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Google Maps Latitude</label>
            <input
              type="number"
              step="0.0001"
              required
              value={mapLat}
              onChange={(e) => setMapLat(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Google Maps Longitude</label>
            <input
              type="number"
              step="0.0001"
              required
              value={mapLng}
              onChange={(e) => setMapLng(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer text-white">
          <input
            type="checkbox"
            checked={is24Hour}
            onChange={(e) => setIs24Hour(e.target.checked)}
          />
          Enable 24-Hour Study Hall Access Badge &amp; Policy on Public Website
        </label>

        {/* Editable Facilities */}
        <div className="space-y-3 pt-4 border-t border-[#7C7397]/40">
          <h4 className="text-sm font-semibold text-white">
            Editable Public Facilities ({facilities.length}/20)
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {facilities.map((fac, idx) => (
              <div
                key={`${fac}-${idx}`}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397]/50 text-xs text-[#CFCEDD]"
              >
                <span>{fac}</span>
                <button
                  type="button"
                  onClick={() => setFacilities((prev) => prev.filter((_, i) => i !== idx))}
                  className="text-red-300 ml-2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newFacility}
              onChange={(e) => setNewFacility(e.target.value)}
              placeholder="Add new facility (e.g. Personal Storage Lockers)"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
            <button
              type="button"
              onClick={() => {
                if (!newFacility.trim() || facilities.length >= 20) return;
                setFacilities((prev) => [...prev, newFacility.trim()]);
                setNewFacility('');
              }}
              className="px-4 py-2 rounded-lg border border-[#7C7397]/60 bg-[#514871] text-white text-xs font-semibold"
            >
              Add Facility
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#7C7397]/40">
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Terms &amp; Library Rules</label>
            <textarea
              rows={3}
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Privacy Policy Text</label>
            <textarea
              rows={3}
              value={privacyText}
              onChange={(e) => setPrivacyText(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-6 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
        >
          Save Library Configuration
        </button>
      </form>
    </div>
  );
};
