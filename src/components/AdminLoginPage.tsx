import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Phone,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../context/AuthContext';

interface AdminLoginPageProps {
  onBackToPublic: () => void;
  onSuccess: () => void;
}

type AdminAuthStep = 'login' | 'setup' | 'forgot_mobile' | 'forgot_otp' | 'forgot_reset';

export const AdminLoginPage: React.FC<AdminLoginPageProps> = ({
  onBackToPublic,
  onSuccess,
}) => {
  const { loginAdminWithMobile, setupAdminCredentials, signInWithGoogle } = useAuth();

  const [step, setStep] = useState<AdminAuthStep>('login');
  const [statusLoading, setStatusLoading] = useState(true);
  const [hasAdminConfigured, setHasAdminConfigured] = useState(true);
  const [smsGatewayConfigured, setSmsGatewayConfigured] = useState(false);

  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('GYAN ADDA Admin');
  const [showPassword, setShowPassword] = useState(false);

  // OTP Forgot Password flow state
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/auth/status');
        if (res.ok) {
          const data = await res.json();
          if (!active) return;
          setHasAdminConfigured(Boolean(data.hasAdminConfigured));
          setSmsGatewayConfigured(Boolean(data.smsGatewayConfigured));
          if (!data.hasAdminConfigured) {
            setStep('setup');
          }
        }
      } catch {
        // default to login form
      } finally {
        if (active) setStatusLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((v) => Math.max(0, v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await loginAdminWithMobile(mobile, password);
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Invalid mobile number or password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await setupAdminCredentials({ mobile, password, displayName });
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to complete admin setup.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/auth/forgot-password/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Unable to dispatch SMS OTP.');
        return;
      }
      setInfoMsg(data.message || 'OTP sent to registered mobile.');
      setResendCooldown(60);
      setStep('forgot_otp');
    } catch {
      setErrorMsg('Network error requesting OTP.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/auth/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Invalid OTP.');
        return;
      }
      setResetToken(data.resetToken);
      setPassword('');
      setConfirmPassword('');
      setStep('forgot_reset');
    } catch {
      setErrorMsg('Failed to verify OTP.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/auth/forgot-password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mobile, resetToken, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Password reset failed.');
        return;
      }
      setInfoMsg('Admin password updated successfully. Sign in with your new password.');
      setPassword('');
      setConfirmPassword('');
      setOtp('');
      setResetToken('');
      setStep('login');
    } catch {
      setErrorMsg('Network error resetting password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleOwner = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      onSuccess();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Google sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full pl-10 pr-3 py-2.5 text-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none';

  return (
    <div className="min-h-screen bg-surface-container-low text-on-surface flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackToPublic}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-xs sm:text-sm font-semibold text-primary hover:bg-surface-container transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Public Website
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
          <ShieldCheck className="w-4 h-4" />
          Protected Administrator Access
        </span>
      </div>

      <div className="max-w-5xl w-full mx-auto my-6 bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* Left Navy Institutional Panel */}
        <aside className="lg:col-span-5 bg-primary text-on-primary p-7 sm:p-9 flex flex-col justify-between gap-8">
          <div className="space-y-6">
            <BrandLogo variant="light" subtitle="Administration Console" />
            <div className="space-y-3 pt-2">
              <p className="font-label text-[11px] uppercase tracking-widest text-on-primary-container">
                GYAN ADDA LIBRARY · Secured Portal
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                Administrator Sign In
              </h1>
              <p className="text-sm text-on-primary-container leading-relaxed">
                Manage students, daily Attendance &amp; Shift schedules, fee payments, WhatsApp reminders, FAQs, facilities, and photo gallery from one console.
              </p>
            </div>
            <ul className="space-y-3 text-xs sm:text-sm text-on-primary-container">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Salted scrypt credential verification &amp; audited login activity</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Server-locked Asia/Kolkata attendance timestamps</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Public website stays strictly isolated from private student records</span>
              </li>
            </ul>
          </div>
          <p className="text-xs text-on-primary-container border-t border-primary-container pt-4">
            GYAN ADDA LIBRARY · Mirzapur Chowk, Darbhanga
          </p>
        </aside>

        {/* Right Interactive Auth Form */}
        <main className="lg:col-span-7 p-6 sm:p-9 flex flex-col justify-center min-w-0">
          {statusLoading ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-7 h-7 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-on-surface-variant font-medium">
                Checking administrator security configuration...
              </p>
            </div>
          ) : (
            <div className="space-y-5 max-w-md w-full mx-auto">
              <div>
                <h2 className="font-display text-xl font-bold text-primary">
                  {step === 'setup'
                    ? 'First-Run Admin Setup'
                    : step === 'login'
                      ? 'Sign In with Mobile Number'
                      : step === 'forgot_mobile'
                        ? 'Forgot Admin Password'
                        : step === 'forgot_otp'
                          ? 'Verify SMS OTP'
                          : 'Set New Admin Password'}
                </h2>
                <p className="text-xs text-on-surface-variant mt-1">
                  {step === 'setup'
                    ? 'No administrator mobile credential has been configured yet. Register the primary Admin mobile number and password below.'
                    : step === 'login'
                      ? 'Enter your registered 10-digit mobile number and administrator password.'
                      : step === 'forgot_mobile'
                        ? 'Enter your registered administrator mobile number to receive a 6-digit SMS OTP.'
                        : step === 'forgot_otp'
                          ? 'Enter the 6-digit verification code sent via SMS to your registered mobile.'
                          : 'Choose a strong password (minimum 8 characters with letters and numbers).'}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg border border-error bg-error-container text-on-error-container text-xs flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="min-w-0 break-words">{errorMsg}</span>
                </div>
              )}

              {infoMsg && (
                <div className="p-3 rounded-lg border border-secondary/40 bg-secondary-container text-on-secondary-container text-xs flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="min-w-0 break-words">{infoMsg}</span>
                </div>
              )}

              {step === 'setup' && (
                <form onSubmit={handleSetup} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Administrator Name
                    </label>
                    <div className="relative">
                      <UserCheck className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type="text"
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="GYAN ADDA Admin"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Registered Mobile Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type="tel"
                        required
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="10-digit mobile number"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Create Password (8+ chars, letter + number)
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create strong password"
                        className={`${inputCls} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-2.5 text-outline hover:text-primary cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-container transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Initializing...' : 'Initialize Admin Account & Enter Console'}
                  </button>
                </form>
              )}

              {step === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Registered Mobile Number
                    </label>
                    <div className="relative">
                      <Smartphone className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type="tel"
                        required
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="e.g. 8797640034"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Admin Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter administrator password"
                        className={`${inputCls} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-2.5 text-outline hover:text-primary cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    {!hasAdminConfigured ? (
                      <button
                        type="button"
                        onClick={() => setStep('setup')}
                        className="font-semibold text-secondary hover:underline cursor-pointer"
                      >
                        First-run Admin Setup
                      </button>
                    ) : (
                      <span className="text-on-surface-variant">Mobile OTP recovery supported</span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg(null);
                        setInfoMsg(null);
                        setStep('forgot_mobile');
                      }}
                      className="font-semibold text-secondary hover:text-primary hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-lg bg-secondary text-white text-sm font-bold hover:bg-primary transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Verifying Credentials...' : 'Sign In to Admin Dashboard'}
                  </button>
                </form>
              )}

              {step === 'forgot_mobile' && (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  {!smsGatewayConfigured && (
                    <div className="p-3 rounded-lg bg-warning-container text-on-warning-container border border-warning/30 text-xs leading-relaxed">
                      <strong>SMS Gateway Not Configured:</strong> Server environment variable{' '}
                      <code className="font-mono">SMS_API_KEY</code> is not set. Real OTP SMS cannot be sent until configured—please use your Google Owner Admin sign-in below or configure SMS secrets on the server.
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Registered Admin Mobile Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type="tel"
                        required
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="10-digit registered mobile"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg(null);
                        setStep('login');
                      }}
                      className="flex-1 min-w-[120px] py-2.5 px-4 rounded-lg border border-outline-variant text-xs font-semibold text-on-surface hover:bg-surface-container-low cursor-pointer"
                    >
                      Back to Login
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 min-w-[140px] py-2.5 px-4 rounded-lg bg-secondary text-white text-xs font-bold hover:bg-primary transition-colors disabled:opacity-60 cursor-pointer"
                    >
                      {submitting ? 'Sending OTP...' : 'Send SMS OTP'}
                    </button>
                  </div>
                </form>
              )}

              {step === 'forgot_otp' && (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      6-Digit SMS OTP
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter 6-digit OTP"
                        className={`${inputCls} tracking-widest font-mono`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <button
                      type="button"
                      disabled={resendCooldown > 0 || submitting}
                      onClick={(e) => handleRequestOtp(e as any)}
                      className="font-semibold text-secondary hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep('login')}
                      className="text-on-surface-variant hover:text-primary cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || otp.length < 6}
                    className="w-full py-2.5 px-4 rounded-lg bg-secondary text-white text-sm font-bold hover:bg-primary transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </form>
              )}

              {step === 'forgot_reset' && (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      New Admin Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 8 chars (letter + number)"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-outline absolute left-3 top-3" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className={inputCls}
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded-lg bg-primary text-white text-sm font-bold hover:bg-primary-container transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Updating Password...' : 'Save New Password'}
                  </button>
                </form>
              )}

              <div className="pt-2">
                <div className="relative flex py-2 items-center">
                  <div className="grow border-t border-outline-variant" />
                  <span className="shrink mx-3 text-[11px] uppercase tracking-wider text-outline">
                    or owner Google account
                  </span>
                  <div className="grow border-t border-outline-variant" />
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGoogleOwner}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-xs font-semibold hover:bg-surface-container-low transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Sign In with Google (Owner Admin)
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-on-surface-variant">
        GYAN ADDA LIBRARY · Authorized Administrators Only
      </footer>
    </div>
  );
};
