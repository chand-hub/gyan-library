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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  BellRing,
  Download,
  Plus,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import { db, logAuditEvent } from '../../lib/firebase';
import { downloadCsv, downloadReceiptHtml } from '../../lib/receiptPdf';
import {
  ExpenseRecord,
  LibrarySettings,
  MembershipPlan,
  MembershipRecord,
  PaymentRecord,
  StudentRecord,
} from '../../types/library';

interface FinancePanelProps {
  plans: MembershipPlan[];
  memberships: MembershipRecord[];
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  students: StudentRecord[];
  settings: LibrarySettings | null;
  actorUid: string;
  actorRole: string;
  isAdmin: boolean;
  isManagerOrAdmin: boolean;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

type FinanceSubTab = 'payments' | 'plans' | 'subscriptions' | 'expenses';
type DatasetScope = 'live' | 'all' | 'demo';
type DateRange = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';

export const FinancePanel: React.FC<FinancePanelProps> = ({
  plans,
  memberships,
  payments,
  expenses,
  students,
  settings,
  actorUid,
  actorRole,
  isAdmin,
  isManagerOrAdmin,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<FinanceSubTab>('payments');
  const [datasetScope, setDatasetScope] = useState<DatasetScope>('all');
  const [dateRange, setDateRange] = useState<DateRange>('monthly');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('ALL');
  const [receiptPreview, setReceiptPreview] = useState<PaymentRecord | null>(null);

  // Offline Payment Modal
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [offStudentId, setOffStudentId] = useState('');
  const [offPlanId, setOffPlanId] = useState('');
  const [offAmount, setOffAmount] = useState<number>(1500);
  const [offMethod, setOffMethod] = useState<'cash' | 'upi_offline'>('cash');
  const [offNotes, setOffNotes] = useState('');
  const [submittingOffline, setSubmittingOffline] = useState(false);

  // Plan Modal
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [planName, setPlanName] = useState('');
  const [planDays, setPlanDays] = useState(30);
  const [planPrice, setPlanPrice] = useState(1500);
  const [planTimings, setPlanTimings] = useState('06:00 AM – 11:00 PM');
  const [planSeatAccess, setPlanSeatAccess] = useState('Reserved Individual Desk');
  const [planFacilities, setPlanFacilities] = useState('Centralized AC, High-Speed Wi-Fi, Charging Point');
  const [planTerms, setPlanTerms] = useState('');

  // Expense Form
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expTitle, setExpTitle] = useState('');
  const [expCategory, setExpCategory] = useState<ExpenseRecord['category']>('electricity');
  const [expAmount, setExpAmount] = useState<number>(0);
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expNotes, setExpNotes] = useState('');

  const scopeMatches = (isDemo: boolean) => {
    if (datasetScope === 'live') return !isDemo;
    if (datasetScope === 'demo') return isDemo;
    return true;
  };

  const toDateStr = (val: any): string => {
    if (!val) return new Date().toISOString().slice(0, 10);
    if (typeof val?.toDate === 'function') return val.toDate().toISOString().slice(0, 10);
    if (typeof val === 'string') return val.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  };

  const inDateRange = (dateStr: string): boolean => {
    if (dateRange === 'all') return true;
    const now = new Date();
    const target = new Date(dateStr);
    if (Number.isNaN(target.getTime())) return true;
    const diffDays = (now.getTime() - target.getTime()) / 86400000;
    if (dateRange === 'daily') return diffDays <= 1;
    if (dateRange === 'weekly') return diffDays <= 7;
    if (dateRange === 'monthly') return diffDays <= 31;
    if (dateRange === 'yearly') return diffDays <= 366;
    return true;
  };

  const scopedPayments = useMemo(() => {
    return payments.filter((p) => {
      if (!scopeMatches(Boolean(p.isDemo))) return false;
      const d = toDateStr(p.createdAt);
      if (!inDateRange(d)) return false;
      if (paymentStatusFilter !== 'ALL' && p.status !== paymentStatusFilter) return false;
      return true;
    });
  }, [payments, datasetScope, dateRange, paymentStatusFilter]);

  const scopedExpenses = useMemo(() => {
    return expenses.filter((e) => scopeMatches(Boolean(e.isDemo)) && inDateRange(e.expenseDate));
  }, [expenses, datasetScope, dateRange]);

  const financialSummary = useMemo(() => {
    const scopeOnlyPayments = payments.filter(
      (p) => scopeMatches(Boolean(p.isDemo)) && inDateRange(toDateStr(p.createdAt))
    );
    const verifiedRevenue = scopeOnlyPayments
      .filter((p) => p.status === 'verified')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const pendingRevenue = scopeOnlyPayments
      .filter((p) => p.status === 'pending')
      .reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const totalExpenses = scopedExpenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
    const netProfit = verifiedRevenue - totalExpenses;
    return { verifiedRevenue, pendingRevenue, totalExpenses, netProfit };
  }, [payments, scopedExpenses, datasetScope, dateRange]);

  const incomeVsExpenseChartData = useMemo(() => {
    const byCat: Record<string, { name: string; VerifiedIncome: number; Expense: number }> = {
      Membership: { name: 'Verified Fees', VerifiedIncome: financialSummary.verifiedRevenue, Expense: 0 },
    };
    scopedExpenses.forEach((e) => {
      const label = e.category.charAt(0).toUpperCase() + e.category.slice(1);
      if (!byCat[label]) byCat[label] = { name: label, VerifiedIncome: 0, Expense: 0 };
      byCat[label].Expense += Number(e.amount || 0);
    });
    return Object.values(byCat);
  }, [financialSummary.verifiedRevenue, scopedExpenses]);

  const handleRecordOfflinePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const stu = students.find((s) => s.id === offStudentId);
    if (!stu) {
      onNotify('err', 'Please select a valid student.');
      return;
    }
    const plan = plans.find((p) => p.id === offPlanId);
    const amountNum = Number(offAmount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      onNotify('err', 'Enter a valid positive amount.');
      return;
    }

    setSubmittingOffline(true);
    try {
      const receiptNumber = `VL-OFF-${Date.now().toString().slice(-6)}`;
      const payRef = await addDoc(collection(db, 'payments'), {
        receiptNumber,
        studentDocId: stu.id,
        studentUid: stu.uid,
        studentCode: stu.studentCode,
        studentName: stu.fullName,
        ...(plan ? { planId: plan.id } : {}),
        planName: plan ? plan.name : 'Custom Desk / Fee Payment',
        amount: amountNum,
        method: offMethod,
        status: 'verified',
        notes: offNotes.trim() || 'Counter payment collected by desk',
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (plan && isManagerOrAdmin) {
        const startDate = new Date().toISOString().slice(0, 10);
        const expiryDate = new Date(Date.now() + plan.durationDays * 86400000)
          .toISOString()
          .slice(0, 10);
        const memRef = await addDoc(collection(db, 'memberships'), {
          studentDocId: stu.id,
          studentUid: stu.uid,
          studentCode: stu.studentCode,
          studentName: stu.fullName,
          planId: plan.id,
          planName: plan.name,
          amount: amountNum,
          startDate,
          expiryDate,
          status: 'active',
          paymentId: payRef.id,
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'students', stu.id), {
          membershipId: memRef.id,
          membershipPlanName: plan.name,
          membershipStatus: 'active',
          membershipExpiry: expiryDate,
          updatedAt: serverTimestamp(),
        });
      }

      await addDoc(collection(db, 'notifications'), {
        recipientUid: stu.uid,
        type: 'payment_confirmation',
        title: `Payment Verified (${receiptNumber})`,
        message: `Received INR ${amountNum.toLocaleString('en-IN')} via ${offMethod.replace('_', ' ').toUpperCase()}.`,
        read: false,
        channel: 'in_app',
        createdAt: serverTimestamp(),
      });

      await logAuditEvent(
        'OFFLINE_PAYMENT_RECORDED',
        'payments',
        payRef.id,
        `Collected INR ${amountNum} from ${stu.studentCode} (${offMethod})`,
        actorRole
      );

      setShowOfflineModal(false);
      setOffNotes('');
      onNotify('ok', `Offline payment ${receiptNumber} verified for ${stu.fullName}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to record offline payment.');
    } finally {
      setSubmittingOffline(false);
    }
  };

  const handlePaymentStatusUpdate = async (
    payment: PaymentRecord,
    newStatus: 'verified' | 'refunded' | 'failed'
  ) => {
    try {
      await updateDoc(doc(db, 'payments', payment.id), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });

      if (newStatus === 'verified' && payment.planId && isManagerOrAdmin) {
        const plan = plans.find((p) => p.id === payment.planId);
        const stu = students.find((s) => s.id === payment.studentDocId);
        if (plan && stu) {
          const startDate = new Date().toISOString().slice(0, 10);
          const expiryDate = new Date(Date.now() + plan.durationDays * 86400000)
            .toISOString()
            .slice(0, 10);
          const memRef = await addDoc(collection(db, 'memberships'), {
            studentDocId: stu.id,
            studentUid: stu.uid,
            studentCode: stu.studentCode,
            studentName: stu.fullName,
            planId: plan.id,
            planName: plan.name,
            amount: payment.amount,
            startDate,
            expiryDate,
            status: 'active',
            paymentId: payment.id,
            isDemo: Boolean(payment.isDemo),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await updateDoc(doc(db, 'students', stu.id), {
            membershipId: memRef.id,
            membershipPlanName: plan.name,
            membershipStatus: 'active',
            membershipExpiry: expiryDate,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await logAuditEvent(
        'PAYMENT_STATUS_UPDATED',
        'payments',
        payment.id,
        `Marked ${payment.receiptNumber} as ${newStatus}`,
        actorRole
      );
      onNotify('ok', `Receipt ${payment.receiptNumber} marked ${newStatus}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to update payment status.');
    }
  };

  const openNewPlanModal = () => {
    setEditingPlan(null);
    setPlanName('');
    setPlanDays(30);
    setPlanPrice(1500);
    setPlanTimings('06:00 AM – 11:00 PM');
    setPlanSeatAccess('Reserved Individual Desk');
    setPlanFacilities('Centralized AC, High-Speed Wi-Fi, Charging Point');
    setPlanTerms('Non-transferable desk allocation.');
    setShowPlanModal(true);
  };

  const openEditPlanModal = (p: MembershipPlan) => {
    setEditingPlan(p);
    setPlanName(p.name);
    setPlanDays(p.durationDays);
    setPlanPrice(p.price);
    setPlanTimings(p.timings);
    setPlanSeatAccess(p.seatAccess);
    setPlanFacilities((p.facilities || []).join(', '));
    setPlanTerms(p.terms || '');
    setShowPlanModal(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const facs = planFacilities
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 15);
    try {
      if (editingPlan) {
        await updateDoc(doc(db, 'membership_plans', editingPlan.id), {
          name: planName.trim(),
          durationDays: Math.max(1, Math.round(Number(planDays))),
          price: Math.max(0, Number(planPrice)),
          timings: planTimings.trim(),
          seatAccess: planSeatAccess.trim(),
          facilities: facs,
          terms: planTerms.trim(),
          updatedAt: serverTimestamp(),
        });
        onNotify('ok', `Plan "${planName}" updated.`);
      } else {
        await addDoc(collection(db, 'membership_plans'), {
          name: planName.trim(),
          durationDays: Math.max(1, Math.round(Number(planDays))),
          price: Math.max(0, Number(planPrice)),
          timings: planTimings.trim(),
          seatAccess: planSeatAccess.trim(),
          facilities: facs,
          terms: planTerms.trim(),
          active: true,
          isDemo: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        onNotify('ok', `Membership plan "${planName}" created.`);
      }
      setShowPlanModal(false);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to save membership plan.');
    }
  };

  const handleTogglePlanActive = async (plan: MembershipPlan) => {
    await updateDoc(doc(db, 'membership_plans', plan.id), {
      active: !plan.active,
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', `${plan.name} is now ${!plan.active ? 'Active' : 'Inactive'}.`);
  };

  const handleDeletePlan = async (plan: MembershipPlan) => {
    await deleteDoc(doc(db, 'membership_plans', plan.id));
    onNotify('ok', `Deleted plan "${plan.name}".`);
  };

  const handleRunExpiryCheckAndReminders = async () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    let remindersSent = 0;
    let expiredUpdated = 0;

    const batch = writeBatch(db);
    for (const mem of memberships) {
      if (mem.status !== 'active' || !mem.expiryDate) continue;
      const exp = new Date(mem.expiryDate);
      const daysLeft = Math.ceil((exp.getTime() - today.getTime()) / 86400000);

      if (mem.expiryDate < todayStr) {
        batch.update(doc(db, 'memberships', mem.id), {
          status: 'expired',
          updatedAt: serverTimestamp(),
        });
        const stu = students.find((s) => s.id === mem.studentDocId);
        if (stu) {
          batch.update(doc(db, 'students', stu.id), {
            membershipStatus: 'expired',
            updatedAt: serverTimestamp(),
          });
        }
        expiredUpdated += 1;
      } else if (daysLeft === 7 || daysLeft === 3 || daysLeft <= 1) {
        await addDoc(collection(db, 'notifications'), {
          recipientUid: mem.studentUid,
          type: 'membership_expiry',
          title: `Membership Expiring in ${Math.max(0, daysLeft)} Day(s)`,
          message: `Your ${mem.planName} expires on ${mem.expiryDate}. Renew early in your portal to keep your reserved seat.`,
          read: false,
          channel: 'in_app',
          createdAt: serverTimestamp(),
        });
        remindersSent += 1;
      }
    }

    if (expiredUpdated > 0) {
      await batch.commit();
    }
    onNotify(
      'ok',
      `Expiry scan finished: ${expiredUpdated} memberships marked expired, ${remindersSent} renewal reminders queued.`
    );
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ref = await addDoc(collection(db, 'expenses'), {
        title: expTitle.trim(),
        category: expCategory,
        amount: Math.max(0, Number(expAmount)),
        expenseDate: expDate,
        notes: expNotes.trim(),
        recordedBy: actorUid,
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logAuditEvent('EXPENSE_RECORDED', 'expenses', ref.id, `${expTitle} (INR ${expAmount})`, actorRole);
      setExpTitle('');
      setExpAmount(0);
      setExpNotes('');
      setShowExpenseForm(false);
      onNotify('ok', 'Operational expense recorded.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to record expense.');
    }
  };

  const handleDeleteExpense = async (id: string) => {
    await deleteDoc(doc(db, 'expenses', id));
    onNotify('ok', 'Expense removed.');
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Payments, Plans &amp; Financial Analytics
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Verified revenue excludes pending dues. Demo entries are tagged separately from live operations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={datasetScope}
            onChange={(e) => setDatasetScope(e.target.value as DatasetScope)}
            aria-label="Dataset Scope"
            className="px-3 py-1.5 text-xs font-semibold rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
          >
            <option value="live">Live Production Only</option>
            <option value="all">Combined (Live + Demo)</option>
            <option value="demo">Demo Dataset Only</option>
          </select>

          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
            aria-label="Date Range"
            className="px-3 py-1.5 text-xs font-semibold rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white"
          >
            <option value="daily">Today</option>
            <option value="weekly">Last 7 Days</option>
            <option value="monthly">Last 30 Days</option>
            <option value="yearly">Last 12 Months</option>
            <option value="all">All Time</option>
          </select>

          <button
            type="button"
            onClick={() => setShowOfflineModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Record Offline Fee
          </button>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 border-b border-outline-variant dark:border-slate-800 pb-3">
        {(
          [
            ['payments', 'Payments & Receipts'],
            ...(isAdmin ? [['plans', 'Membership Plans']] : []),
            ...(isManagerOrAdmin ? [['subscriptions', 'Subscriptions & Expiry']] : []),
            ...(isManagerOrAdmin ? [['expenses', 'Expenses & Net Profit']] : []),
          ] as Array<[FinanceSubTab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSubTab(key)}
            className={`px-3.5 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer ${
              subTab === key
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-low dark:bg-slate-900 text-on-surface-variant dark:text-slate-300 hover:bg-surface-container'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary Strip */}
      {isManagerOrAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="min-w-0 p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
            <p className="text-xs text-on-surface-variant dark:text-slate-400 font-semibold">Verified Fee Revenue</p>
            <p className="font-display text-2xl font-bold text-success tabular-nums mt-1">
              ₹{financialSummary.verifiedRevenue.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="min-w-0 p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
            <p className="text-xs text-on-surface-variant dark:text-slate-400 font-semibold">Pending Dues (Excluded)</p>
            <p className="font-display text-2xl font-bold text-warning tabular-nums mt-1">
              ₹{financialSummary.pendingRevenue.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="min-w-0 p-4 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
            <p className="text-xs text-on-surface-variant dark:text-slate-400 font-semibold">Operational Expenses</p>
            <p className="font-display text-2xl font-bold text-error tabular-nums mt-1">
              ₹{financialSummary.totalExpenses.toLocaleString('en-IN')}
            </p>
          </div>
          <div className="min-w-0 p-4 rounded-lg bg-primary text-on-primary border border-primary-container shadow-sm">
            <p className="text-xs text-on-primary-container font-semibold">Net Operating Profit</p>
            <p className="font-display text-2xl font-bold text-on-primary tabular-nums mt-1">
              ₹{financialSummary.netProfit.toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      )}

      {/* TAB: PAYMENTS */}
      {subTab === 'payments' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 p-1 rounded bg-surface-container-low dark:bg-slate-900 border border-outline-variant dark:border-slate-800">
              {['ALL', 'verified', 'pending', 'refunded', 'failed'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setPaymentStatusFilter(st)}
                  className={`px-3 py-1 rounded text-xs font-semibold capitalize cursor-pointer ${
                    paymentStatusFilter === st
                      ? 'bg-primary text-on-primary'
                      : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container'
                  }`}
                >
                  {st === 'ALL' ? 'All Receipts' : st}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                downloadCsv(
                  `vidhya-payments-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['Receipt', 'Student ID', 'Student Name', 'Plan', 'Amount (INR)', 'Method', 'Status', 'Dataset'],
                  scopedPayments.map((p) => [
                    p.receiptNumber,
                    p.studentCode,
                    p.studentName,
                    p.planName,
                    p.amount,
                    p.method,
                    p.status,
                    p.isDemo ? 'DEMO' : 'LIVE',
                  ])
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white hover:bg-surface-container-low cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Export Payments CSV
            </button>
          </div>

          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Plan / Description</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                {scopedPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-container-low/50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary dark:text-white">
                      {p.receiptNumber}
                      {p.isDemo && <span className="ml-1.5 text-[10px] text-outline">· DEMO</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-xs text-on-surface dark:text-white">{p.studentName}</div>
                      <div className="font-mono text-[11px] text-on-surface-variant dark:text-slate-400">{p.studentCode}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant dark:text-slate-300">{p.planName}</td>
                    <td className="px-4 py-3 text-xs uppercase text-on-surface-variant dark:text-slate-300">
                      {p.method.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-on-surface dark:text-white">
                      ₹{Number(p.amount).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold capitalize">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${
                          p.status === 'verified'
                            ? 'bg-success-container text-on-success-container'
                            : p.status === 'pending'
                            ? 'bg-warning-container text-on-warning-container'
                            : 'bg-error-container text-on-error-container'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2.5 whitespace-nowrap">
                      {p.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handlePaymentStatusUpdate(p, 'verified')}
                          className="text-xs font-semibold text-success hover:underline cursor-pointer"
                        >
                          Verify
                        </button>
                      )}
                      {isAdmin && p.status === 'verified' && (
                        <button
                          type="button"
                          onClick={() => handlePaymentStatusUpdate(p, 'refunded')}
                          className="text-xs font-semibold text-error hover:underline cursor-pointer"
                        >
                          Refund
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setReceiptPreview(p)}
                        className="text-xs font-semibold text-secondary hover:text-primary hover:underline cursor-pointer"
                      >
                        Receipt
                      </button>
                    </td>
                  </tr>
                ))}
                {scopedPayments.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-xs text-on-surface-variant dark:text-slate-400">
                      No payment transactions match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: PLANS */}
      {subTab === 'plans' && isAdmin && (
        <div className="space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <h3 className="text-sm font-semibold text-primary dark:text-white">
              Active &amp; Archived Membership Tiers ({plans.length})
            </h3>
            <button
              type="button"
              onClick={openNewPlanModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Create Plan
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {plans.map((p) => (
              <div
                key={p.id}
                className="min-w-0 p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm flex flex-col justify-between gap-4"
              >
                <div className="space-y-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-display text-lg font-bold text-on-surface dark:text-white break-words min-w-0">{p.name}</h4>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
                        p.active
                          ? 'bg-success-container text-on-success-container'
                          : 'bg-surface-variant text-on-surface-variant'
                      }`}
                    >
                      {p.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <div className="font-display text-2xl font-bold text-primary dark:text-white tabular-nums">
                    ₹{Number(p.price).toLocaleString('en-IN')}{' '}
                    <span className="text-xs font-sans font-normal text-on-surface-variant dark:text-slate-400">
                      / {p.durationDays} days
                    </span>
                  </div>
                  <p className="text-xs text-on-surface-variant dark:text-slate-300">
                    {p.timings} · {p.seatAccess}
                  </p>
                  <p className="text-xs text-on-surface-variant dark:text-slate-400">{p.terms}</p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-outline-variant dark:border-slate-800">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => openEditPlanModal(p)}
                      className="text-xs font-semibold text-secondary hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePlanActive(p)}
                      className="text-xs font-semibold text-on-surface-variant hover:text-primary hover:underline cursor-pointer"
                    >
                      {p.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeletePlan(p)}
                    className="text-xs text-error hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB: SUBSCRIPTIONS & EXPIRY */}
      {subTab === 'subscriptions' && isManagerOrAdmin && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-surface-container-low dark:bg-slate-900 border border-outline-variant dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-primary dark:text-white">
                Automated Expiry Sync &amp; 7 / 3 / 1-Day Renewal Reminders
              </h3>
              <p className="text-xs text-on-surface-variant dark:text-slate-400 mt-0.5">
                Scans active subscriptions, expires overdue plans, and dispatches renewal alerts to student dashboards.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunExpiryCheckAndReminders}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold shrink-0 hover:bg-primary cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5" /> Run Expiry &amp; Reminder Scan
            </button>
          </div>

          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Student</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Start</th>
                  <th className="px-4 py-3 font-semibold">Expiry</th>
                  <th className="px-4 py-3 text-right font-semibold">Fee</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                {memberships
                  .filter((m) => scopeMatches(Boolean(m.isDemo)))
                  .map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 text-xs">
                        <span className="font-semibold text-on-surface dark:text-white">{m.studentName}</span>{' '}
                        <span className="font-mono text-on-surface-variant dark:text-slate-400">· {m.studentCode}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant dark:text-slate-300">{m.planName}</td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-on-surface-variant dark:text-slate-300">{m.startDate}</td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-on-surface-variant dark:text-slate-300">{m.expiryDate}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums font-semibold text-on-surface dark:text-white">
                        ₹{Number(m.amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-xs font-semibold capitalize">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${
                            m.status === 'active'
                              ? 'bg-success-container text-on-success-container'
                              : m.status === 'expired'
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-warning-container text-on-warning-container'
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: EXPENSES & PROFIT */}
      {subTab === 'expenses' && isManagerOrAdmin && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-primary dark:text-white">Income vs Operational Expenses</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `vidhya-expenses-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['Date', 'Title', 'Category', 'Amount (INR)', 'Notes', 'Dataset'],
                    scopedExpenses.map((e) => [
                      e.expenseDate,
                      e.title,
                      e.category,
                      e.amount,
                      e.notes || '',
                      e.isDemo ? 'DEMO' : 'LIVE',
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Export P&amp;L CSV
              </button>
              <button
                type="button"
                onClick={() => setShowExpenseForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Expense
              </button>
            </div>
          </div>

          {showExpenseForm && (
            <form
              onSubmit={handleAddExpense}
              className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 items-end"
            >
              <div className="sm:col-span-2 xl:col-span-2">
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Expense Title</label>
                <input
                  type="text"
                  required
                  value={expTitle}
                  onChange={(e) => setExpTitle(e.target.value)}
                  placeholder="Monthly Electricity Bill"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Category</label>
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value as ExpenseRecord['category'])}
                  className={inputCls}
                >
                  <option value="electricity">Electricity</option>
                  <option value="rent">Rent</option>
                  <option value="internet">Internet</option>
                  <option value="salary">Staff Salary</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="furniture">Furniture</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Amount (INR)</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={expAmount}
                  onChange={(e) => setExpAmount(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="sm:col-span-2 xl:col-span-4">
                <input
                  type="text"
                  value={expNotes}
                  onChange={(e) => setExpNotes(e.target.value)}
                  placeholder="Optional invoice / voucher note"
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                className="sm:col-span-2 xl:col-span-1 py-2 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
              >
                Save Expense
              </button>
            </form>
          )}

          {/* Income vs Expense Recharts BarChart */}
          <div className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm min-w-0 overflow-hidden">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant dark:text-slate-400 mb-4">
              Verified Income vs Expense Breakdown (INR)
            </h4>
            <div className="h-64 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={incomeVsExpenseChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" strokeOpacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#44474E' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#44474E' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderColor: '#C4C6CF',
                      color: '#0B1C30',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ color: '#44474E', fontSize: '12px' }} />
                  <Bar dataKey="VerifiedIncome" name="Verified Income" fill="#0051D5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expense" name="Expense" fill="#BF0715" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  {isAdmin && <th className="px-4 py-3 text-right font-semibold">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                {scopedExpenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-on-surface-variant dark:text-slate-300">{e.expenseDate}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-on-surface dark:text-white">
                      {e.title}
                      {e.isDemo && <span className="ml-1.5 text-[10px] text-outline">· DEMO</span>}
                    </td>
                    <td className="px-4 py-3 text-xs capitalize text-on-surface-variant dark:text-slate-300">{e.category}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-on-surface dark:text-white">
                      ₹{Number(e.amount).toLocaleString('en-IN')}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(e.id)}
                          className="text-xs font-semibold text-error hover:underline cursor-pointer"
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Offline Payment Modal */}
      {showOfflineModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto text-on-surface dark:text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                Record Offline Counter Payment
              </h3>
              <button type="button" onClick={() => setShowOfflineModal(false)} className="text-on-surface-variant hover:text-primary shrink-0 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordOfflinePayment} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Student</label>
                <select
                  required
                  value={offStudentId}
                  onChange={(e) => setOffStudentId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Select student...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.studentCode} — {s.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Membership Plan (Optional)</label>
                <select
                  value={offPlanId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    setOffPlanId(pid);
                    const found = plans.find((p) => p.id === pid);
                    if (found) setOffAmount(found.price);
                  }}
                  className={inputCls}
                >
                  <option value="">Custom / Fee Adjustment</option>
                  {plans.filter((p) => p.active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (₹{p.price})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Amount (INR)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={offAmount}
                    onChange={(e) => setOffAmount(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Payment Mode</label>
                  <select
                    value={offMethod}
                    onChange={(e) => setOffMethod(e.target.value as 'cash' | 'upi_offline')}
                    className={inputCls}
                  >
                    <option value="cash">Cash at Desk</option>
                    <option value="upi_offline">UPI QR Scan</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Notes</label>
                <input
                  type="text"
                  value={offNotes}
                  onChange={(e) => setOffNotes(e.target.value)}
                  placeholder="Optional counter reference"
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                disabled={submittingOffline}
                className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold disabled:opacity-60 hover:bg-primary cursor-pointer"
              >
                {submittingOffline ? 'Recording...' : 'Verify & Generate Receipt'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Plan Create/Edit Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto text-on-surface dark:text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                {editingPlan ? 'Edit Membership Plan' : 'Create Membership Plan'}
              </h3>
              <button type="button" onClick={() => setShowPlanModal(false)} className="text-on-surface-variant hover:text-primary shrink-0 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePlan} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Plan Name</label>
                <input
                  type="text"
                  required
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Duration (Days)</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={3650}
                    value={planDays}
                    onChange={(e) => setPlanDays(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Price (INR)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={planPrice}
                    onChange={(e) => setPlanPrice(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Study Timings</label>
                  <input
                    type="text"
                    required
                    value={planTimings}
                    onChange={(e) => setPlanTimings(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Seat Access</label>
                  <input
                    type="text"
                    required
                    value={planSeatAccess}
                    onChange={(e) => setPlanSeatAccess(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Facilities (Comma-Separated)</label>
                <input
                  type="text"
                  value={planFacilities}
                  onChange={(e) => setPlanFacilities(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Terms &amp; Conditions</label>
                <textarea
                  rows={2}
                  value={planTerms}
                  onChange={(e) => setPlanTerms(e.target.value)}
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
              >
                {editingPlan ? 'Save Plan Changes' : 'Create Membership Plan'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Receipt Preview & Print Modal */}
      {receiptPreview && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-md bg-surface-container-lowest text-on-surface rounded-xl border border-outline-variant p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-outline-variant pb-3">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-primary">
                  Fee Receipt
                </h3>
                <p className="font-mono text-xs text-on-surface-variant break-all">{receiptPreview.receiptNumber}</p>
              </div>
              <button type="button" onClick={() => setReceiptPreview(null)} className="text-on-surface-variant hover:text-primary shrink-0 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-on-surface-variant">Student</span>
                <span className="font-semibold break-words text-right">
                  {receiptPreview.studentName} ({receiptPreview.studentCode})
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-on-surface-variant">Plan</span>
                <span className="font-semibold break-words text-right">{receiptPreview.planName}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-on-surface-variant">Method</span>
                <span className="uppercase">{receiptPreview.method.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-on-surface-variant">Status</span>
                <span className="font-semibold capitalize">{receiptPreview.status}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-outline-variant text-sm font-bold text-primary">
                <span>Total Amount</span>
                <span className="font-mono tabular-nums">
                  ₹{Number(receiptPreview.amount).toLocaleString('en-IN')}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-1.5 py-2 rounded border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" /> Print
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadReceiptHtml(
                    receiptPreview,
                    settings?.libraryName || 'VIDHYA LIBRARY',
                    settings?.address || ''
                  )
                }
                className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 py-2 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
