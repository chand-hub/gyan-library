import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
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

    // Prevent two students on the same seat
    if (selectedSeat.status === 'occupied' && selectedSeat.assignedStudentDocId !== student.id) {
      onNotify('err', `Seat ${selectedSeat.seatCode} is already occupied. Release it first.`);
      return;
    }

    // Release student's previous seat if any
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

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            Visual Seat Management
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Click any desk to assign a student, release occupancy, or toggle maintenance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 p-1 bg-[#0E0713] rounded-lg border border-[#7C7397]/40">
            {zones.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoneFilter(z)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                  zoneFilter === z
                    ? 'bg-[#B5ADC6] text-[#0E0713] font-semibold'
                    : 'text-[#CFCEDD] hover:text-white'
                }`}
              >
                {z === 'ALL' ? 'All Zones' : z}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowGenerator((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
          >
            <Plus className="w-3.5 h-3.5" /> Configure Seats
          </button>
        </div>
      </div>

      {showGenerator && (
        <form
          onSubmit={handleGenerateRow}
          className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        >
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Zone Name</label>
            <input
              type="text"
              required
              value={genZone}
              onChange={(e) => setGenZone(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Row Prefix (e.g. E)</label>
            <input
              type="text"
              required
              maxLength={4}
              value={genRow}
              onChange={(e) => setGenRow(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#CFCEDD] mb-1">Seats Count (1–30)</label>
            <input
              type="number"
              min={1}
              max={30}
              required
              value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
          </div>
          <button
            type="submit"
            className="py-2 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold hover:bg-white"
          >
            Add Seat Row
          </button>
        </form>
      )}

      {/* Interactive Seat Grid */}
      <div className="grid grid-cols-4 sm:grid-cols-8 lg:grid-cols-10 gap-2.5">
        {filteredSeats.map((seat) => {
          const occupant = seat.assignedStudentDocId ? studentById[seat.assignedStudentDocId] : null;
          const colors: Record<SeatStatus, string> = {
            available: 'bg-emerald-950/60 border-emerald-500/70 text-emerald-200',
            occupied: 'bg-red-950/60 border-red-500/60 text-red-200',
            reserved: 'bg-amber-950/60 border-amber-500/60 text-amber-200',
            maintenance: 'bg-[#0E0713]/70 border-[#7C7397]/40 text-[#9993AC]',
          };
          return (
            <button
              key={seat.id}
              type="button"
              onClick={() => {
                setSelectedSeat(seat);
                setAssignStudentId(seat.assignedStudentDocId || '');
              }}
              className={`p-2.5 rounded-lg border text-left transition-colors hover:opacity-90 ${colors[seat.status]}`}
            >
              <div className="font-mono text-xs font-bold tabular-nums">{seat.seatCode}</div>
              <div className="text-[10px] truncate mt-0.5">
                {occupant ? occupant.fullName.split(' ')[0] : seat.assignedStudentCode || seat.status}
              </div>
            </button>
          );
        })}
      </div>

      {/* Pending Seat Booking Requests */}
      {pendingBookings.length > 0 && (
        <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#7C7397]/30">
            <h3 className="text-sm font-semibold text-white">
              Pending Student Seat Requests ({pendingBookings.length})
            </h3>
          </div>
          <div className="divide-y divide-[#7C7397]/25">
            {pendingBookings.map((b) => (
              <div key={b.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm">
                <div>
                  <span className="font-mono font-bold text-[#B5ADC6]">{b.seatCode}</span>
                  <span className="mx-2 text-[#9993AC]">·</span>
                  <span className="font-medium text-white">{b.studentName}</span>
                  <span className="mx-2 text-[#9993AC]">·</span>
                  <span className="font-mono text-xs text-[#CFCEDD]">{b.studentCode}</span>
                  {b.notes && <p className="text-xs text-[#CFCEDD] mt-0.5">{b.notes}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleBookingDecision(b, 'approved')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBookingDecision(b, 'rejected')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-400/60 text-red-200 text-xs font-semibold"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md bg-[#3D2C56] border border-[#7C7397] rounded-xl p-6 space-y-4 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-bold text-white">
                  Desk {selectedSeat.seatCode}
                </h3>
                <p className="text-xs text-[#CFCEDD]">
                  {selectedSeat.zone} · Status: <span className="capitalize font-semibold">{selectedSeat.status}</span>
                </p>
              </div>
              <button type="button" onClick={() => setSelectedSeat(null)} className="p-1 text-[#CFCEDD]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {selectedSeat.assignedStudentDocId && studentById[selectedSeat.assignedStudentDocId] && (
              <div className="p-3 rounded-lg bg-[#1C0E29] border border-[#7C7397]/50 text-xs space-y-1">
                <p className="font-semibold text-sm text-white">
                  {studentById[selectedSeat.assignedStudentDocId].fullName}
                </p>
                <p className="font-mono text-[#CFCEDD]">
                  {studentById[selectedSeat.assignedStudentDocId].studentCode} ·{' '}
                  {studentById[selectedSeat.assignedStudentDocId].mobile}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-medium text-[#CFCEDD]">Assign to Student</label>
              <select
                value={assignStudentId}
                onChange={(e) => setAssignStudentId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397]/60 bg-[#1C0E29] text-white"
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
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold disabled:opacity-50"
              >
                <UserCheck className="w-3.5 h-3.5" /> Assign Seat
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#7C7397]/40">
              <button
                type="button"
                onClick={() => handleReleaseSeat(selectedSeat)}
                className="py-2 px-3 rounded-lg border border-emerald-500/60 text-emerald-200 text-xs font-semibold"
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
                className="inline-flex items-center justify-center gap-1 py-2 px-3 rounded-lg border border-[#7C7397]/60 text-white text-xs font-semibold"
              >
                <Wrench className="w-3.5 h-3.5" />
                {selectedSeat.status === 'maintenance' ? 'Mark Available' : 'Maintenance'}
              </button>
            </div>

            {canDelete && (
              <button
                type="button"
                onClick={() => handleDeleteSeat(selectedSeat)}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold text-red-300 hover:bg-red-950/50"
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
