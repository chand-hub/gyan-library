import { PaymentRecord } from '../types/library';

export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function downloadReceiptHtml(payment: PaymentRecord, libraryName = 'GYAN ADDA LIBRARY', address = '') {
  const safeHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(payment.receiptNumber)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 40px; background: #fff; }
  .box { max-width: 680px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 10px; padding: 32px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #002046; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 22px; font-weight: 700; color: #002046; }
  .tag { font-size: 12px; color: #475569; margin-top: 4px; }
  .meta { text-align: right; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
  .amt { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 28px; font-size: 12px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="box">
    <div class="head">
      <div>
        <div class="brand">${escapeHtml(libraryName)}</div>
        <div class="tag">Your Knowledge, Your Future.${address ? ' · ' + escapeHtml(address) : ''}</div>
      </div>
      <div class="meta">
        <div><strong>Receipt:</strong> ${escapeHtml(payment.receiptNumber)}</div>
        <div><strong>Status:</strong> ${escapeHtml(payment.status.toUpperCase())}</div>
        ${payment.isDemo ? '<div><strong>Dataset:</strong> DEMONSTRATION</div>' : ''}
      </div>
    </div>
    <table>
      <tr><th>Student Name</th><td>${escapeHtml(payment.studentName)}</td></tr>
      <tr><th>Student ID</th><td>${escapeHtml(payment.studentCode)}</td></tr>
      <tr><th>Membership Plan</th><td>${escapeHtml(payment.planName)}</td></tr>
      <tr><th>Payment Method</th><td>${escapeHtml(payment.method.replace(/_/g, ' ').toUpperCase())}</td></tr>
      ${payment.razorpayPaymentId ? `<tr><th>Gateway Ref</th><td>${escapeHtml(payment.razorpayPaymentId)}</td></tr>` : ''}
      <tr><th>Amount Paid</th><td class="amt">INR ${Number(payment.amount).toLocaleString('en-IN')}</td></tr>
    </table>
    <div class="footer">
      <span>Computer-generated receipt · Valid without signature</span>
      <span>Powered by DIGI TECH SOLUTION</span>
    </div>
  </div>
</body>
</html>`;

  const blob = new Blob([safeHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${payment.receiptNumber}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | boolean>>) {
  const escapeCsv = (val: string | number | boolean) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
