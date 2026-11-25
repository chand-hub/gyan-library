import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, logAuditEvent } from '../../lib/firebase';
import { SeatBookingRecord, SeatRecord, SeatStatus, StudentRecord } from '../../types/library';
import { Check, Plus, Trash2, Wrench, UserCheck, X } from 'lucide-react';

interface SeatManagementPanelProps {
  seats: SeatRecord[];
  bookings: SeatBookingRecord[];
  students: StudentRecord[];
  canDelete: boolean;
  actorRole: string;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

export const SeatManagementPanel: React.FC<SeatManagementPanelProps> = ({
  seats,
  bookings,
  students,
  canDelete,
  actorRole,
  onNotify,
}) => {
  const [zoneFilter, setZoneFilter] = useState('ALL');
  const [selectedSeat, setSelectedSeat] = useState<SeatRecord | null>(null);
  const [assignStudentId, setAssignStudentId] = useState('');

  // Grid generator form
  const [showGenerator, setShowGenerator] = useState(false);
  const [genZone, setGenZone] = useState('Zone E · New Wing');
  const [genRow, setGenRow] = useState('E');
  const [genCount, setGenCount] = useState(5);

  const zones = useMemo(() => ['ALL', ...Array.from(new Set(seats.map((s) => s.zone)))], [seats]);

  const filteredSeats = useMemo(() => {
    const list = zoneFilter === 'ALL' ? seats : seats.filter((s) => s.zone === zoneFilter);
    return [...list].sort((a, b) => a.seatCode.localeCompare(b.seatCode));
  }, [seats, zoneFilter]);

  const studentById = useMemo(() => {
    const map: Record<string, StudentRecord> = {};
    students.forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [students]);

  const pendingBookings = bookings.filter((b) => b.status === 'pending');

  const handleAssignSeat = async () => {
    if (!selectedSeat || !assignStudentId) return;
    const student = studentById[assignStudentId];
    if (!student) return;

    if (selectedSeat.status === 'occupied' && selectedSeat.assignedStudentDocId !== student.id) {
      onNotify('err', `Seat ${selectedSeat.seatCode} is already occupied. Release it first.`);
      return;
    }

    if (student.seatId && student.seatId !== selectedSeat.id) {
      await updateDoc(doc(db, 'seats', student.seatId), {
        status: 'available',
        assignedStudentDocId: '',
        assignedStudentUid: '',
        assignedStudentCode: '',
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, 'seats', selectedSeat.id), {
      status: 'occupied',
      assignedStudentDocId: student.id,
      assignedStudentUid: student.uid,
      assignedStudentCode: student.studentCode,
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'students', student.id), {
      seatId: selectedSeat.id,
      seatCode: selectedSeat.seatCode,
      updatedAt: serverTimestamp(),
    });

    await logAuditEvent(
      'SEAT_ASSIGNED',
      'seats',
      selectedSeat.id,
      `Assigned ${selectedSeat.seatCode} to ${student.studentCode}`,
      actorRole
    );
    setSelectedSeat(null);
    setAssignStudentId('');
    onNotify('ok', `Seat ${selectedSeat.seatCode} assigned to ${student.fullName}.`);
  };

  const handleReleaseSeat = async (seat: SeatRecord) => {
    if (seat.assignedStudentDocId) {
      const stu = studentById[seat.assignedStudentDocId];
      if (stu) {
        await updateDoc(doc(db, 'students', stu.id), {
          seatId: '',
          seatCode: '',
          updatedAt: serverTimestamp(),
        });
      }
    }
    await updateDoc(doc(db, 'seats', seat.id), {
      status: 'available',
      assignedStudentDocId: '',
      assignedStudentUid: '',
      assignedStudentCode: '',
      updatedAt: serverTimestamp(),
    });
    await logAuditEvent('SEAT_RELEASED', 'seats', seat.id, `Released ${seat.seatCode}`, actorRole);
    setSelectedSeat(null);
    onNotify('ok', `Seat ${seat.seatCode} released and marked Available.`);
  };

  const handleSetStatus = async (seat: SeatRecord, status: SeatStatus) => {
    if (status === 'maintenance' && seat.assignedStudentDocId) {
      onNotify('err', 'Release the occupied student before marking Maintenance.');
      return;
    }
    await updateDoc(doc(db, 'seats', seat.id), {
      status,
      updatedAt: serverTimestamp(),
    });
    setSelectedSeat(null);
    onNotify('ok', `Seat ${seat.seatCode} marked ${status}.`);
  };

  const handleDeleteSeat = async (seat: SeatRecord) => {
    if (seat.status === 'occupied') {
      onNotify('err', 'Release occupied seat before deleting.');
      return;
    }
    await deleteDoc(doc(db, 'seats', seat.id));
    setSelectedSeat(null);
    onNotify('ok', `Seat ${seat.seatCode} deleted.`);
  };

  const handleGenerateRow = async (e: React.FormEvent) => {
    e.preventDefault();
    const row = genRow.trim().toUpperCase().slice(0, 4);
    const count = Math.min(30, Math.max(1, Number(genCount)));
    const batch = writeBatch(db);
    for (let i = 1; i <= count; i++) {
      const seatCode = `${row}${String(i).padStart(2, '0')}`;
      batch.set(doc(db, 'seats', `seat_${seatCode}`), {
        seatCode,
        zone: genZone.trim(),
        rowLabel: row,
        colIndex: i,
        status: 'available',
        assignedStudentDocId: '',
        assignedStudentUid: '',
        assignedStudentCode: '',
        shift: 'Full Day',
        isDemo: false,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
    setShowGenerator(false);
    onNotify('ok', `Generated ${count} seats in row ${row} (${genZone}).`);
  };

  const handleBookingDecision = async (booking: SeatBookingRecord, decision: 'approved' | 'rejected') => {
    const stu = studentById[booking.studentDocId];
    if (decision === 'approved') {
      if (stu?.seatId && stu.seatId !== booking.seatId) {
        await updateDoc(doc(db, 'seats', stu.seatId), {
          status: 'available',
          assignedStudentDocId: '',
          assignedStudentUid: '',
          assignedStudentCode: '',
          updatedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'seats', booking.seatId), {
        status: 'occupied',
        assignedStudentDocId: booking.studentDocId,
        assignedStudentUid: booking.studentUid,
        assignedStudentCode: booking.studentCode,
        updatedAt: serverTimestamp(),
      });
      if (stu) {
        await updateDoc(doc(db, 'students', stu.id), {
          seatId: booking.seatId,
          seatCode: booking.seatCode,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      await updateDoc(doc(db, 'seats', booking.seatId), {
        status: 'available',
        assignedStudentDocId: '',
        assignedStudentUid: '',
        assignedStudentCode: '',
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, 'seat_bookings', booking.id), {
      status: decision,
      updatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, 'notifications'), {
      recipientUid: booking.studentUid,
      type: 'seat_allocation',
      title: `Seat ${booking.seatCode} ${decision === 'approved' ? 'Confirmed' : 'Declined'}`,
      message:
        decision === 'approved'
          ? `Your desk ${booking.seatCode} is now confirmed and active.`
          : `Your request for desk ${booking.seatCode} was declined. Please choose another seat.`,
      read: false,
      channel: 'in_app',
      createdAt: serverTimestamp(),
    });

    onNotify('ok', `Booking for ${booking.seatCode} ${decision}.`);
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Visual Seat Management
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Click any desk to assign a student, release occupancy, or toggle maintenance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex flex-wrap gap-1 p-1 bg-surface-container-low dark:bg-slate-900 rounded border border-outline-variant dark:border-slate-800 max-w-full min-w-0">
            {zones.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoneFilter(z)}
                className={`px-3 py-1.5 text-xs font-semibold rounded text-left sm:whitespace-nowrap cursor-pointer transition-colors ${
                  zoneFilter === z
                    ? 'bg-primary text-on-primary'
                    : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container'
                }`}
              >
                {z === 'ALL' ? 'All Zones' : z}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowGenerator((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Configure Seats
          </button>
        </div>
      </div>

      {showGenerator && (
        <form
          onSubmit={handleGenerateRow}
          className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Zone Name</label>
            <input
              type="text"
              required
              value={genZone}
              onChange={(e) => setGenZone(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Row Prefix (e.g. E)</label>
            <input
              type="text"
              required
              maxLength={4}
              value={genRow}
              onChange={(e) => setGenRow(e.target.value)}
              className={`${inputCls} font-mono uppercase`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Seats Count (1–30)</label>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            className="py-2 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
          >
            Add Seat Row
          </button>
        </form>
      )}

      {/* Interactive Seat Grid */}
      <div className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
        <div className="grid grid-cols-3 min-[400px]:grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 sm:gap-2.5">
          {filteredSeats.map((seat) => {
            const occupant = seat.assignedStudentDocId ? studentById[seat.assignedStudentDocId] : null;
            const colors: Record<SeatStatus, string> = {
              available: 'bg-success-container border-success text-on-success-container',
              occupied: 'bg-error-container border-error/40 text-on-error-container',
              reserved: 'bg-warning-container border-warning/40 text-on-warning-container',
              maintenance: 'bg-surface-variant border-outline-variant text-on-surface-variant',
            };
            return (
              <button
                key={seat.id}
                type="button"
                onClick={() => {
                  setSelectedSeat(seat);
                  setAssignStudentId(seat.assignedStudentDocId || '');
                }}
                className={`min-w-0 overflow-hidden p-2 sm:p-2.5 rounded border text-left transition-opacity hover:opacity-85 cursor-pointer ${colors[seat.status]}`}
              >
                <div className="font-mono text-xs font-bold tabular-nums">{seat.seatCode}</div>
                <div className="text-[10px] truncate mt-0.5 font-medium">
                  {occupant ? occupant.fullName.split(' ')[0] : seat.assignedStudentCode || seat.status}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pending Seat Booking Requests */}
      {pendingBookings.length > 0 && (
        <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 bg-surface-container-low dark:bg-slate-800/80 border-b border-outline-variant dark:border-slate-700">
            <h3 className="text-sm font-semibold text-primary dark:text-white">
              Pending Student Seat Requests ({pendingBookings.length})
            </h3>
          </div>
          <div className="divide-y divide-outline-variant/60 dark:divide-slate-800">
            {pendingBookings.map((b) => (
              <div key={b.id} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                <div className="min-w-0 break-words">
                  <span className="font-mono font-bold text-secondary dark:text-blue-400">{b.seatCode}</span>
                  <span className="mx-2 text-outline">·</span>
                  <span className="font-semibold text-on-surface dark:text-white">{b.studentName}</span>
                  <span className="mx-2 text-outline">·</span>
                  <span className="font-mono text-xs text-on-surface-variant dark:text-slate-400">{b.studentCode}</span>
                  {b.notes && <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-0.5">{b.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleBookingDecision(b, 'approved')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-success text-on-success text-xs font-semibold cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBookingDecision(b, 'rejected')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-error text-error text-xs font-semibold cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" /> Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Seat Action Modal */}
      {selectedSeat && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-700 rounded-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto text-on-surface dark:text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-outline-variant dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                  Desk {selectedSeat.seatCode}
                </h3>
                <p className="text-xs text-on-surface-variant dark:text-slate-400">
                  {selectedSeat.zone} · Status: <span className="capitalize font-semibold">{selectedSeat.status}</span>
                </p>
              </div>
              <button type="button" onClick={() => setSelectedSeat(null)} className="p-1 text-on-surface-variant hover:text-primary cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedSeat.assignedStudentDocId && studentById[selectedSeat.assignedStudentDocId] && (
              <div className="p-3 rounded bg-surface-container-low dark:bg-slate-800 border border-outline-variant dark:border-slate-700 text-xs space-y-1">
                <p className="font-semibold text-sm text-primary dark:text-white">
                  {studentById[selectedSeat.assignedStudentDocId].fullName}
                </p>
                <p className="font-mono text-on-surface-variant dark:text-slate-400">
                  {studentById[selectedSeat.assignedStudentDocId].studentCode} ·{' '}
                  {studentById[selectedSeat.assignedStudentDocId].mobile}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-on-surface dark:text-slate-300">Assign to Student</label>
              <select
                value={assignStudentId}
                onChange={(e) => setAssignStudentId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select student...</option>
                {students
                  .filter((s) => s.status === 'active')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.studentCode} — {s.fullName} {s.seatCode ? `(Current: ${s.seatCode})` : ''}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!assignStudentId}
                onClick={handleAssignSeat}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                <UserCheck className="w-3.5 h-3.5" /> Assign Seat
              </button>
            </div>

            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2 pt-2 border-t border-outline-variant dark:border-slate-800">
              <button
                type="button"
                onClick={() => handleReleaseSeat(selectedSeat)}
                className="py-2 px-3 rounded border border-success text-success text-xs font-semibold hover:bg-success-container cursor-pointer"
              >
                Release Seat
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSetStatus(
                    selectedSeat,
                    selectedSeat.status === 'maintenance' ? 'available' : 'maintenance'
                  )
                }
                className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded border border-outline-variant dark:border-slate-700 text-on-surface dark:text-slate-200 text-xs font-semibold hover:bg-surface-container-low cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                {selectedSeat.status === 'maintenance' ? 'Mark Available' : 'Maintenance'}
              </button>
            </div>

            {canDelete && (
              <button
                type="button"
                onClick={() => handleDeleteSeat(selectedSeat)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-semibold text-error hover:bg-error-container cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Seat Permanently
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
