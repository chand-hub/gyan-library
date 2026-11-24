import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { AttendanceRecord, StudentRecord } from '../../types/library';
import { downloadCsv } from '../../lib/receiptPdf';
import { Camera, Download, QrCode, Search, UserCheck } from 'lucide-react';

interface AttendancePanelProps {
  attendance: AttendanceRecord[];
  students: StudentRecord[];
  actorUid: string;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

export const AttendancePanel: React.FC<AttendancePanelProps> = ({
  attendance,
  students,
  actorUid,
  onNotify,
}) => {
  const [studentQuery, setStudentQuery] = useState('');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10));
  const [scannerOpen, setScannerOpen] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);

  const recordAttendanceByCode = async (rawInput: string, method: 'qr' | 'id' | 'manual') => {
    let targetCode = rawInput.trim().toUpperCase();
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed?.studentCode) targetCode = String(parsed.studentCode).toUpperCase();
    } catch {
      // Plain student code string
    }

    const student = students.find((s) => s.studentCode.toUpperCase() === targetCode);
    if (!student) {
      onNotify('err', `No student found matching ID "${targetCode}".`);
      return;
    }
    if (student.status !== 'active') {
      onNotify('err', `Account ${student.studentCode} is ${student.status} and cannot check in.`);
      return;
    }

    const existingOpen = attendance.find(
      (a) => a.studentDocId === student.id && a.date === todayStr && !a.checkOutTime
    );

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    if (existingOpen) {
      // Check-out
      const [inH, inM] = existingOpen.checkInTime.split(':').map(Number);
      const durationMinutes = Math.max(
        1,
        now.getHours() * 60 + now.getMinutes() - ((inH || 0) * 60 + (inM || 0))
      );
      await updateDoc(doc(db, 'attendance', existingOpen.id), {
        checkOutTime: hhmm,
        durationMinutes,
        updatedAt: serverTimestamp(),
      });
      onNotify('ok', `${student.fullName} (${student.studentCode}) checked OUT at ${hhmm}.`);
    } else {
      // Prevent duplicate check-in if already checked in & out? Allow re-entry or warn if open
      const isLate = now.getHours() >= 10;
      await addDoc(collection(db, 'attendance'), {
        studentDocId: student.id,
        studentUid: student.uid,
        studentCode: student.studentCode,
        studentName: student.fullName,
        date: todayStr,
        checkInTime: hhmm,
        durationMinutes: 0,
        method,
        isLate,
        markedBy: actorUid,
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onNotify('ok', `${student.fullName} (${student.studentCode}) checked IN at ${hhmm}.`);
    }
    setStudentQuery('');
  };

  useEffect(() => {
    if (!scannerOpen) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
      return;
    }
    const scanner = new Html5QrcodeScanner(
      'vl-qr-reader',
      { fps: 10, qrbox: { width: 220, height: 220 } },
      false
    );
    scanner.render(
      (decodedText) => {
        recordAttendanceByCode(decodedText, 'qr');
        setScannerOpen(false);
      },
      () => {
        // Ignore frame decode errors while scanning
      }
    );
    scannerRef.current = scanner;
    return () => {
      scanner.clear().catch(() => {});
    };
  }, [scannerOpen]);

  const filteredRecords = useMemo(() => {
    return attendance.filter((a) => (!dateFilter ? true : a.date === dateFilter));
  }, [attendance, dateFilter]);

  const handleExportCsv = () => {
    downloadCsv(
      `vidhya-attendance-${dateFilter || 'all'}.csv`,
      ['Student ID', 'Name', 'Date', 'Check In', 'Check Out', 'Minutes', 'Method', 'Late'],
      filteredRecords.map((a) => [
        a.studentCode,
        a.studentName,
        a.date,
        a.checkInTime,
        a.checkOutTime || '',
        a.durationMinutes,
        a.method,
        a.isLate ? 'Yes' : 'No',
      ])
    );
  };

  return (
    <div className="space-y-6 text-white">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">
            QR & Desk Attendance Register
          </h2>
          <p className="text-xs text-[#CFCEDD]">
            Scan student QR pass or enter Student ID (e.g. VL2026001) to toggle Check-In / Check-Out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setScannerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-semibold hover:bg-white"
          >
            <Camera className="w-3.5 h-3.5" />
            {scannerOpen ? 'Close QR Scanner' : 'Open QR Camera'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#7C7397]/60 bg-[#3D2C56] text-white text-xs font-semibold hover:bg-[#514871]"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {scannerOpen && (
        <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 max-w-md">
          <div id="vl-qr-reader" className="w-full" />
        </div>
      )}

      {/* Quick ID Check-in Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (studentQuery.trim()) recordAttendanceByCode(studentQuery, 'id');
        }}
        className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 flex flex-col sm:flex-row gap-3"
      >
        <div className="relative flex-1">
          <QrCode className="w-4 h-4 text-[#9993AC] absolute left-3 top-2.5" />
          <input
            type="text"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
            placeholder="Enter Student ID (e.g. VL2026001) or paste QR payload..."
            className="w-full pl-9 pr-3 py-2 text-sm font-mono rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white placeholder-[#9993AC]"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-semibold whitespace-nowrap hover:bg-white"
        >
          <UserCheck className="w-4 h-4" /> Mark Check-In / Out
        </button>
      </form>

      {/* Date Filter & Table */}
      <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/40 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#7C7397]/30 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold text-white">
            Register Entries ({filteredRecords.length})
          </span>
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-[#9993AC]" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="px-2.5 py-1 text-xs rounded-lg border border-[#7C7397]/60 bg-[#0E0713] text-white"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-xs text-[#B5ADC6] hover:text-white hover:underline"
              >
                Show All Dates
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0E0713]/60 text-xs text-[#CFCEDD]">
              <tr>
                <th className="text-left px-4 py-3">Student ID</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Check In</th>
                <th className="text-left px-4 py-3">Check Out</th>
                <th className="text-right px-4 py-3">Study Time</th>
                <th className="text-left px-4 py-3">Method</th>
                <th className="text-left px-4 py-3">Punctuality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#7C7397]/25">
              {filteredRecords.map((a) => (
                <tr key={a.id} className="hover:bg-[#514871]/40">
                  <td className="px-4 py-3 font-mono text-xs text-[#B5ADC6]">{a.studentCode}</td>
                  <td className="px-4 py-3 font-medium text-white">{a.studentName}</td>
                  <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{a.date}</td>
                  <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{a.checkInTime}</td>
                  <td className="px-4 py-3 tabular-nums text-[#CFCEDD]">{a.checkOutTime || 'Active'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white">
                    {a.durationMinutes ? `${a.durationMinutes} min` : '—'}
                  </td>
                  <td className="px-4 py-3 uppercase text-xs font-mono text-[#B5ADC6]">{a.method}</td>
                  <td className="px-4 py-3 text-xs text-[#CFCEDD]">{a.isLate ? 'Late Entry' : 'On Time'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
