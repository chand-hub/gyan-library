import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Mandatory Google Maps Case A Quota Defense: intercept gm_authFailure and quota errors before rendering
let gmpQuotaTriggered = false;
function notifyGmpQuotaExceeded() {
  if (gmpQuotaTriggered) return;
  gmpQuotaTriggered = true;
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
}

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => String(a ?? '')).join(' ');
  if (
    joined.includes('QuotaExceededError') ||
    joined.includes('OverQuotaMapError') ||
    joined.includes('ApiProjectMapError')
  ) {
    notifyGmpQuotaExceeded();
  }
  origConsoleError.apply(console, args);
};

(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  notifyGmpQuotaExceeded();
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
