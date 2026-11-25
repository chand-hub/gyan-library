import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Clock, Edit2, Plus, RefreshCw, Search, Trash2, Users, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { LibraryShift, StudentRecord } from '../../types/library';

interface ShiftManagementPanelProps {
  students: StudentRecord[];
  hasFirebaseSession: boolean;
  isManagerOrAdmin: boolean;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface ShiftAssignmentMap {
  [studentDocId: string]: {
    studentDocId: string;
    studentCode: string;
    studentName: string;
    mobile?: string;
    seatCode?: string;
    shiftId: string;
    shiftName: string;
    shiftTiming: string;
    updatedAt: string;
  };
}

export const ShiftManagementPanel: React.FC<ShiftManagementPanelProps> = ({
  students,
  hasFirebaseSession,
  isManagerOrAdmin,
  getIdToken,
  onNotify,
}) => {
  const [shifts, setShifts] = useState<LibraryShift[]>([]);
  const [assignments, setAssignments] = useState<ShiftAssignmentMap>({});
  const [directoryStudents, setDirectoryStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkShiftId, setBulkShiftId] = useState('');

  // Create / Edit Shift modal
  const [showModal, setShowModal] = useState(false);
  const [editingShift, setEditingShift] = useState<LibraryShift | null>(null);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('06:00');
  const [endTime, setEndTime] = useState('12:00');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      if (students.length > 0) {
        await fetch('/api/admin/attendance/sync-students', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            students: students.map((s) => ({
              id: s.id,
              uid: s.uid,
              studentCode: s.studentCode,
              fullName: s.fullName,
              mobile: s.mobile,
              email: s.email,
              seatCode: s.seatCode,
              shiftId: s.shiftId,
              shiftName: s.shiftName,
              shiftTiming: s.shiftTiming,
              membershipPlanName: s.membershipPlanName,
              membershipStatus: s.membershipStatus,
              status: s.status,
            })),
          }),
        }).catch(() => {});
      }

      const [shiftRes, attRes] = await Promise.all([
        fetch('/api/admin/shifts', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/attendance', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (shiftRes.ok) {
        const data = await shiftRes.json();
        setShifts(data.shifts || []);
        setAssignments(data.assignments || {});
        if (!bulkShiftId && data.shifts?.[0]?.id) {
          setBulkShiftId(data.shifts[0].id);
        }
      }
      if (attRes.ok) {
        const attData = await attRes.json();
        if (Array.isArray(attData.students)) {
          setDirectoryStudents(attData.students);
        }
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to load library shifts.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, students, bulkShiftId, onNotify]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const mergedStudents = useMemo(() => {
    const base = students.length > 0 ? students : directoryStudents;
    return base.map((st) => {
      const assign = assignments[st.id];
      return {
        ...st,
        shiftId: assign?.shiftId || st.shiftId || 'shift_fullday',
        shiftName: assign?.shiftName || st.shiftName || 'Full Day',
        shiftTiming: assign?.shiftTiming || st.shiftTiming || '06:00 – 22:00',
      };
    });
  }, [students, directoryStudents, assignments]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mergedStudents.filter((s) => {
      if (shiftFilter !== 'ALL' && s.shiftId !== shiftFilter) return false;
      if (!q) return true;
      return (
        s.fullName.toLowerCase().includes(q) ||
        s.studentCode.toLowerCase().includes(q) ||
        (s.mobile || '').toLowerCase().includes(q)
      );
    });
  }, [mergedStudents, search, shiftFilter]);

  const openCreate = () => {
    setEditingShift(null);
    setName('');
    setStartTime('06:00');
    setEndTime('12:00');
    setDescription('');
    setActive(true);
    setShowModal(true);
  };

  const openEdit = (sh: LibraryShift) => {
    setEditingShift(sh);
    setName(sh.name);
    setStartTime(sh.startTime);
    setEndTime(sh.endTime);
    setDescription(sh.description || '');
    setActive(sh.active !== false);
    setShowModal(true);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication session required.');
      const res = await fetch('/api/admin/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editingShift?.id,
          name: name.trim(),
          startTime,
          endTime,
          description: description.trim(),
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save shift.');

      if (hasFirebaseSession && data.shift?.id) {
        setDoc(doc(db, 'shifts', data.shift.id), {
          ...data.shift,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      onNotify('ok', `Shift "${data.shift.name}" saved.`);
      setShowModal(false);
      await loadShifts();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save shift.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteShift = async (sh: LibraryShift) => {
    if (!window.confirm(`Remove shift "${sh.name}"? Existing student records will keep history.`)) return;
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/admin/shifts/${encodeURIComponent(sh.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete shift.');
      onNotify('ok', `Shift "${sh.name}" removed.`);
      await loadShifts();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to remove shift.');
    }
  };

  const assignSingleStudentShift = async (student: StudentRecord, shiftId: string) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/shifts/assign-student', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentDocId: student.id,
          studentCode: student.studentCode,
          studentName: student.fullName,
          mobile: student.mobile,
          seatCode: student.seatCode,
          shiftId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Shift assignment failed.');

      if (hasFirebaseSession && student.id) {
        updateDoc(doc(db, 'students', student.id), {
          shiftId: data.assignment.shiftId,
          shiftName: data.assignment.shiftName,
          shiftTiming: data.assignment.shiftTiming,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      setAssignments((prev) => ({
        ...prev,
        [student.id]: data.assignment,
      }));
      onNotify('ok', `${student.fullName} assigned to ${data.assignment.shiftName}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to assign shift.');
    }
  };

  const handleBulkAssign = async () => {
    if (selectedIds.length === 0 || !bulkShiftId) return;
    setSaving(true);
    try {
      for (const id of selectedIds) {
        const st = mergedStudents.find((s) => s.id === id);
        if (st) {
          await assignSingleStudentShift(st, bulkShiftId);
        }
      }
      setSelectedIds([]);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white focus:border-secondary focus:outline-none';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Study Shift &amp; Batch Management
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Configure study shifts (Morning, Afternoon, Evening, Full Day, Night, or Custom) and assign students individually or in bulk.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadShifts}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Create Shift
            </button>
          )}
        </div>
      </div>

      {/* Shift Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shifts.map((sh) => {
          const count = mergedStudents.filter((s) => s.shiftId === sh.id).length;
          return (
            <div
              key={sh.id}
              className="min-w-0 p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-headline text-base font-bold text-primary dark:text-white break-words">
                      {sh.name}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        sh.active !== false
                          ? 'bg-success-container text-on-success-container'
                          : 'bg-surface-variant text-on-surface-variant'
                      }`}
                    >
                      {sh.active !== false ? 'Active' : 'Archived'}
                    </span>
                  </div>
                  <p className="font-mono text-xs font-semibold text-secondary dark:text-blue-400 mt-1 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    {sh.startTime} – {sh.endTime}
                  </p>
                  {sh.description && (
                    <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-1.5 break-words">
                      {sh.description}
                    </p>
                  )}
                </div>
                {isManagerOrAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(sh)}
                      className="p-1.5 rounded text-on-surface-variant hover:text-secondary hover:bg-surface-container-low cursor-pointer"
                      aria-label={`Edit ${sh.name}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteShift(sh)}
                      className="p-1.5 rounded text-error hover:bg-error-container cursor-pointer"
                      aria-label={`Delete ${sh.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className="pt-2.5 border-t border-outline-variant/60 dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-on-surface-variant dark:text-slate-400">
                  <Users className="w-3.5 h-3.5" /> Assigned Students
                </span>
                <span className="font-mono font-bold text-primary dark:text-white tabular-nums">{count}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Student Shift Assignment Table */}
      <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 bg-surface-container-low dark:bg-slate-800/80 border-b border-outline-variant dark:border-slate-700 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-outline absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search student name, ID, mobile..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
              />
            </div>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
            >
              <option value="ALL">All Shifts</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {isManagerOrAdmin && selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-secondary">{selectedIds.length} selected</span>
              <select
                value={bulkShiftId}
                onChange={(e) => setBulkShiftId(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
              >
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.startTime}–{s.endTime})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving}
                onClick={handleBulkAssign}
                className="px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                Apply Bulk Shift
              </button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low/60 dark:bg-slate-800/60 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all filtered students"
                    checked={
                      filteredStudents.length > 0 &&
                      filteredStudents.every((s) => selectedIds.includes(s.id))
                    }
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? filteredStudents.map((s) => s.id) : [])
                    }
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Student ID</th>
                <th className="px-4 py-3 font-semibold">Student Name</th>
                <th className="px-4 py-3 font-semibold">Seat</th>
                <th className="px-4 py-3 font-semibold">Current Shift</th>
                <th className="px-4 py-3 text-right font-semibold">Assign Shift</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {filteredStudents.map((s) => (
                <tr key={s.id} className="hover:bg-surface-container-low/40 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.fullName}`}
                      checked={selectedIds.includes(s.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs font-bold text-secondary dark:text-blue-400">
                    {s.studentCode}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-xs text-on-surface dark:text-white">{s.fullName}</div>
                    <div className="text-[11px] text-on-surface-variant dark:text-slate-400">{s.mobile}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{s.seatCode || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-semibold text-primary dark:text-white">{s.shiftName}</span>
                    <span className="block text-[11px] font-mono text-on-surface-variant dark:text-slate-400">
                      {s.shiftTiming}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <select
                      aria-label={`Shift for ${s.fullName}`}
                      value={s.shiftId}
                      onChange={(e) => assignSingleStudentShift(s, e.target.value)}
                      className="px-2.5 py-1.5 text-xs rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white"
                    >
                      {shifts.map((sh) => (
                        <option key={sh.id} value={sh.id}>
                          {sh.name} ({sh.startTime}–{sh.endTime})
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-on-surface-variant dark:text-slate-400">
                    No students match your current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Shift Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-5 space-y-4 shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-outline-variant dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                {editingShift ? `Edit ${editingShift.name}` : 'Create Study Shift'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-on-surface-variant hover:text-primary cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveShift} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Shift Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Early Bird UPSC Batch"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Start Time</label>
                  <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">End Time</label>
                  <input type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional hall or timing notes"
                  className={inputCls}
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                <span>Shift active for daily attendance &amp; admission assignment</span>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Shift'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
