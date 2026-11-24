import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { Download, Plus, Search, Upload, UserCheck, X } from 'lucide-react';
import { db, logAuditEvent } from '../../lib/firebase';
import { downloadCsv } from '../../lib/receiptPdf';
import {
  AttendanceRecord,
  MembershipPlan,
  PaymentRecord,
  SeatRecord,
  StudentRecord,
} from '../../types/library';

interface StudentsPanelProps {
  students: StudentRecord[];
  plans: MembershipPlan[];
  seats: SeatRecord[];
  attendance: AttendanceRecord[];
  payments: PaymentRecord[];
  isManagerOrAdmin: boolean;
  actorRole: string;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

export const StudentsPanel: React.FC<StudentsPanelProps> = ({
  students,
  plans,
  seats,
  attendance,
  payments,
  isManagerOrAdmin,
  actorRole,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive' | 'blocked'>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [viewingStudent, setViewingStudent] = useState<StudentRecord | null>(null);

  // Add / Edit Form
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [assignSeatId, setAssignSeatId] = useState('');
  const [assignPlanId, setAssignPlanId] = useState('');

  // Bulk CSV Import
  const [csvText, setCsvText] = useState(
    'fullName,mobile,email,fatherName,address,emergencyContact\nKunal Jha,9829055111,kunal.jha@example.edu,Rakesh Jha,Mirzapur Chowk Darbhanga Bihar,9829055112'
  );
  const [importingCsv, setImportingCsv] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.studentCode.toLowerCase().includes(q) ||
        s.fullName.toLowerCase().includes(q) ||
        s.mobile.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
      );
    });
  }, [students, search, statusFilter]);

  const openAddModal = () => {
    setEditingStudent(null);
    setFullName('');
    setMobile('');
    setEmail('');
    setFatherName('');
    setAddress('');
    setEmergencyContact('');
    setAssignSeatId('');
    setAssignPlanId('');
    setShowAddModal(true);
  };

  const openEditModal = (s: StudentRecord) => {
    setEditingStudent(s);
    setFullName(s.fullName);
    setMobile(s.mobile);
    setEmail(s.email);
    setFatherName(s.fatherName);
    setAddress(s.address);
    setEmergencyContact(s.emergencyContact);
    setAssignSeatId(s.seatId || '');
    setAssignPlanId('');
    setShowAddModal(true);
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManagerOrAdmin) {
      onNotify('err', 'Only Manager or Admin can create or edit student records.');
      return;
    }
    try {
      const selectedSeat = seats.find((st) => st.id === assignSeatId);
      const selectedPlan = plans.find((p) => p.id === assignPlanId);

      if (editingStudent) {
        if (selectedSeat && selectedSeat.id !== editingStudent.seatId) {
          if (selectedSeat.status === 'occupied') {
            onNotify('err', `Seat ${selectedSeat.seatCode} is already occupied.`);
            return;
          }
          if (editingStudent.seatId) {
            await updateDoc(doc(db, 'seats', editingStudent.seatId), {
              status: 'available',
              assignedStudentDocId: '',
              assignedStudentUid: '',
              assignedStudentCode: '',
              updatedAt: serverTimestamp(),
            });
          }
          await updateDoc(doc(db, 'seats', selectedSeat.id), {
            status: 'occupied',
            assignedStudentDocId: editingStudent.id,
            assignedStudentUid: editingStudent.uid,
            assignedStudentCode: editingStudent.studentCode,
            updatedAt: serverTimestamp(),
          });
        }

        const updates: Record<string, any> = {
          fullName: fullName.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          fatherName: fatherName.trim(),
          address: address.trim(),
          emergencyContact: emergencyContact.trim(),
          ...(selectedSeat ? { seatId: selectedSeat.id, seatCode: selectedSeat.seatCode } : {}),
          updatedAt: serverTimestamp(),
        };

        if (selectedPlan) {
          const startDate = new Date().toISOString().slice(0, 10);
          const expiryDate = new Date(Date.now() + selectedPlan.durationDays * 86400000)
            .toISOString()
            .slice(0, 10);
          const memRef = await addDoc(collection(db, 'memberships'), {
            studentDocId: editingStudent.id,
            studentUid: editingStudent.uid,
            studentCode: editingStudent.studentCode,
            studentName: fullName.trim(),
            planId: selectedPlan.id,
            planName: selectedPlan.name,
            amount: selectedPlan.price,
            startDate,
            expiryDate,
            status: 'active',
            isDemo: Boolean(editingStudent.isDemo),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          updates.membershipId = memRef.id;
          updates.membershipPlanName = selectedPlan.name;
          updates.membershipStatus = 'active';
          updates.membershipExpiry = expiryDate;
        }

        await updateDoc(doc(db, 'students', editingStudent.id), updates);
        await logAuditEvent(
          'STUDENT_UPDATED',
          'students',
          editingStudent.id,
          `Updated ${editingStudent.studentCode}`,
          actorRole
        );
        onNotify('ok', `Updated student ${editingStudent.studentCode}.`);
      } else {
        const studentCode = `VL2026${String(Math.floor(100 + Math.random() * 8999)).slice(0, 4)}`;
        const uid = `manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const startDate = new Date().toISOString().slice(0, 10);
        const expiryDate = selectedPlan
          ? new Date(Date.now() + selectedPlan.durationDays * 86400000).toISOString().slice(0, 10)
          : '';

        const ref = await addDoc(collection(db, 'students'), {
          uid,
          studentCode,
          fullName: fullName.trim(),
          mobile: mobile.trim(),
          email: email.trim(),
          fatherName: fatherName.trim(),
          address: address.trim(),
          emergencyContact: emergencyContact.trim(),
          ...(selectedSeat ? { seatId: selectedSeat.id, seatCode: selectedSeat.seatCode } : {}),
          ...(selectedPlan
            ? {
                membershipPlanName: selectedPlan.name,
                membershipStatus: 'active',
                membershipExpiry: expiryDate,
              }
            : { membershipStatus: 'none' }),
          status: 'active',
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (selectedSeat && selectedSeat.status !== 'occupied') {
          await updateDoc(doc(db, 'seats', selectedSeat.id), {
            status: 'occupied',
            assignedStudentDocId: ref.id,
            assignedStudentUid: uid,
            assignedStudentCode: studentCode,
            updatedAt: serverTimestamp(),
          });
        }

        if (selectedPlan) {
          const memRef = await addDoc(collection(db, 'memberships'), {
            studentDocId: ref.id,
            studentUid: uid,
            studentCode,
            studentName: fullName.trim(),
            planId: selectedPlan.id,
            planName: selectedPlan.name,
            amount: selectedPlan.price,
            startDate,
            expiryDate,
            status: 'active',
            isDemo: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'students', ref.id), {
            membershipId: memRef.id,
            updatedAt: serverTimestamp(),
          });
        }

        await logAuditEvent('STUDENT_CREATED', 'students', ref.id, `Added ${studentCode}`, actorRole);
        onNotify('ok', `Student ${fullName} registered (${studentCode}).`);
      }
      setShowAddModal(false);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to save student record.');
    }
  };

  const handleToggleBlock = async (s: StudentRecord, targetStatus: 'active' | 'inactive' | 'blocked') => {
    await updateDoc(doc(db, 'students', s.id), {
      status: targetStatus,
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', `${s.studentCode} marked ${targetStatus}.`);
  };

  const handleBulkCsvImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      onNotify('err', 'Include a CSV header and at least one student row.');
      return;
    }

    setImportingCsv(true);
    try {
      const batch = writeBatch(db);
      let imported = 0;
      for (let i = 1; i < Math.min(lines.length, 51); i++) {
        const cols = lines[i].split(',').map((c) => c.trim());
        if (cols.length < 6) continue;
        const [fName, mob, em, father, addr, emerg] = cols;
        if (!fName || !mob || !em || !father || !addr || !emerg) continue;
        const studentCode = `VL2026${String(Math.floor(1000 + Math.random() * 8999))}`;
        const newRef = doc(collection(db, 'students'));
        batch.set(newRef, {
          uid: `csv_${Date.now()}_${i}`,
          studentCode,
          fullName: fName.slice(0, 120),
          mobile: mob.slice(0, 20),
          email: em.slice(0, 200),
          fatherName: father.slice(0, 120),
          address: addr.slice(0, 400),
          emergencyContact: emerg.slice(0, 30),
          membershipStatus: 'none',
          status: 'active',
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        imported += 1;
      }
      if (imported === 0) {
        onNotify('err', 'No valid 6-column rows parsed.');
        setImportingCsv(false);
        return;
      }
      await batch.commit();
      setShowCsvModal(false);
      onNotify('ok', `Imported ${imported} students cleanly.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'CSV import failed.');
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Student Directory ({filtered.length})
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Search by VL ID, name, mobile, or email; inspect attendance, dues, and seat allocation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                `vidhya-students-${new Date().toISOString().slice(0, 10)}.csv`,
                ['Student ID', 'Full Name', 'Mobile', 'Email', 'Seat', 'Plan', 'Membership Status', 'Account Status'],
                filtered.map((s) => [
                  s.studentCode,
                  s.fullName,
                  s.mobile,
                  s.email,
                  s.seatCode || '',
                  s.membershipPlanName || '',
                  s.membershipStatus,
                  s.status,
                ])
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#7C7397]/60 bg-[#3D2C56] text-xs font-semibold text-white hover:bg-[#514871]"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          {isManagerOrAdmin && (
            <>
              <button
                type="button"
                onClick={() => setShowCsvModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#7C7397]/60 bg-[#3D2C56] text-xs font-semibold text-white hover:bg-[#514871]"
              >
                <Upload className="w-3.5 h-3.5" /> Bulk CSV Import
              </button>
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
              >
                <Plus className="w-4 h-4" /> Add Student
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#9993AC] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search VL2026001, student name, mobile..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white placeholder-[#9993AC]"
          />
        </div>
        <div className="flex gap-1.5">
          {(['ALL', 'active', 'inactive', 'blocked'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize ${
                statusFilter === st
                  ? 'bg-[#B5ADC6] text-[#0E0713]'
                  : 'bg-[#3D2C56] text-[#CFCEDD] hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'All' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0E0713]/60 text-xs uppercase text-[#CFCEDD]">
            <tr>
              <th className="px-4 py-3">Student ID</th>
              <th className="px-4 py-3">Name & Contact</th>
              <th className="px-4 py-3">Seat</th>
              <th className="px-4 py-3">Membership</th>
              <th className="px-4 py-3">Account</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#7C7397]/25">
            {filtered.map((s) => (
              <tr key={s.id} className="hover:bg-[#514871]/40">
                <td className="px-4 py-3 font-mono text-xs font-bold text-[#B5ADC6]">
                  {s.studentCode}
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-xs text-white">{s.fullName}</div>
                  <div className="text-[11px] text-[#CFCEDD]">
                    {s.mobile} · {s.email}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-white">
                  {s.seatCode || '—'}
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="text-white">{s.membershipPlanName || 'No Active Plan'}</div>
                  <div className="text-[11px] text-[#CFCEDD] capitalize">
                    {s.membershipStatus}
                    {s.membershipExpiry ? ` · Exp ${s.membershipExpiry}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs font-semibold capitalize">
                  <span
                    className={
                      s.status === 'active' ? 'text-emerald-300' : 'text-red-300'
                    }
                  >
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setViewingStudent(s)}
                    className="text-xs font-semibold text-[#B5ADC6] hover:text-white hover:underline"
                  >
                    Profile
                  </button>
                  {isManagerOrAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(s)}
                        className="text-xs font-semibold text-[#CFCEDD] hover:text-white hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleToggleBlock(s, s.status === 'active' ? 'blocked' : 'active')
                        }
                        className="text-xs font-semibold text-red-300 hover:underline"
                      >
                        {s.status === 'active' ? 'Block' : 'Reactivate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* View Full Student Profile Modal */}
      {viewingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-2xl bg-[#3D2C56] rounded-xl border border-[#7C7397] p-6 space-y-5 max-h-[90vh] overflow-y-auto text-white">
            <div className="flex items-start justify-between border-b border-[#7C7397]/40 pb-3">
              <div>
                <h3 className="font-display text-xl font-bold text-white">
                  {viewingStudent.fullName}
                </h3>
                <p className="font-mono text-xs text-[#CFCEDD]">
                  {viewingStudent.studentCode} · Seat {viewingStudent.seatCode || 'Unassigned'} ·{' '}
                  {viewingStudent.membershipPlanName || 'No Plan'}
                </p>
              </div>
              <button type="button" onClick={() => setViewingStudent(null)}>
                <X className="w-5 h-5 text-[#CFCEDD] hover:text-white" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs text-[#CFCEDD]">
              <div>
                <span className="text-[#9993AC]">Mobile:</span> {viewingStudent.mobile}
              </div>
              <div>
                <span className="text-[#9993AC]">Email:</span> {viewingStudent.email}
              </div>
              <div>
                <span className="text-[#9993AC]">Father&apos;s Name:</span> {viewingStudent.fatherName}
              </div>
              <div>
                <span className="text-[#9993AC]">Emergency Contact:</span>{' '}
                {viewingStudent.emergencyContact}
              </div>
              <div className="col-span-2">
                <span className="text-[#9993AC]">Address:</span> {viewingStudent.address}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase text-[#B5ADC6] mb-2">
                Recent Attendance ({attendance.filter((a) => a.studentDocId === viewingStudent.id).length})
              </h4>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {attendance
                  .filter((a) => a.studentDocId === viewingStudent.id)
                  .slice(0, 6)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="flex justify-between py-1 border-b border-[#7C7397]/30"
                    >
                      <span className="font-mono">{a.date}</span>
                      <span>
                        In {a.checkInTime} · Out {a.checkOutTime || 'Active'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase text-[#B5ADC6] mb-2">
                Payments & Dues ({payments.filter((p) => p.studentDocId === viewingStudent.id).length})
              </h4>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {payments
                  .filter((p) => p.studentDocId === viewingStudent.id)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between py-1 border-b border-[#7C7397]/30"
                    >
                      <span className="font-mono">
                        {p.receiptNumber} · {p.planName}
                      </span>
                      <span className="font-mono font-semibold">
                        ₹{Number(p.amount).toLocaleString('en-IN')} ({p.status})
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg bg-[#3D2C56] rounded-xl border border-[#7C7397] p-6 space-y-4 max-h-[90vh] overflow-y-auto text-white">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">
                {editingStudent ? `Edit ${editingStudent.studentCode}` : 'Register New Student'}
              </h3>
              <button type="button" onClick={() => setShowAddModal(false)}>
                <X className="w-5 h-5 text-[#CFCEDD]" />
              </button>
            </div>
            <form onSubmit={handleSaveStudent} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Mobile</label>
                  <input
                    type="tel"
                    required
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
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
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Father&apos;s Name</label>
                  <input
                    type="text"
                    required
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Address</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Emergency Contact</label>
                <input
                  type="tel"
                  required
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Assign Study Seat</label>
                  <select
                    value={assignSeatId}
                    onChange={(e) => setAssignSeatId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  >
                    <option value="">Leave Unassigned</option>
                    {seats
                      .filter((st) => st.status === 'available' || st.id === editingStudent?.seatId)
                      .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.seatCode} ({st.zone})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Assign / Renew Plan</label>
                  <select
                    value={assignPlanId}
                    onChange={(e) => setAssignPlanId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
                  >
                    <option value="">No Membership Change</option>
                    {plans.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (₹{p.price})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
              >
                {editingStudent ? 'Save Student Changes' : 'Register Student'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV Import Modal */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg bg-[#3D2C56] rounded-xl border border-[#7C7397] p-6 space-y-4 text-white">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">
                Bulk Student CSV Import
              </h3>
              <button type="button" onClick={() => setShowCsvModal(false)}>
                <X className="w-5 h-5 text-[#CFCEDD]" />
              </button>
            </div>
            <p className="text-xs text-[#CFCEDD]">
              Paste up to 50 comma-separated student records per batch. Student IDs (VL2026XXXX) are auto-generated.
            </p>
            <form onSubmit={handleBulkCsvImport} className="space-y-3">
              <textarea
                rows={7}
                required
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                className="w-full p-3 font-mono text-xs rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
              />
              <button
                type="submit"
                disabled={importingCsv}
                className="w-full py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold disabled:opacity-50"
              >
                {importingCsv ? 'Importing Batch...' : 'Import Student CSV'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
