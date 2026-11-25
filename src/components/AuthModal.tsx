import React, { useState } from 'react';
import { X, Lock, Mail, User as UserIcon, Phone, MapPin, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BrandLogo } from './BrandLogo';

interface AuthModalProps {
  isOpen: boolean;
  initialTab?: 'login' | 'register' | 'reset' | 'complete_profile';
  onClose: () => void;
  onSuccess?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialTab = 'login',
  onClose,
  onSuccess,
}) => {
  const {
    firebaseUser,
    signInWithGoogle,
    signInWithEmail,
    registerStudentWithEmail,
    completeStudentProfile,
    sendPasswordReset,
    authError,
    clearAuthError,
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register' | 'reset' | 'complete_profile'>(initialTab);
  const [submitting, setSubmitting] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Registration / Profile fields
  const [fullName, setFullName] = useState(firebaseUser?.displayName || '');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState(firebaseUser?.email || '');
  const [password, setPassword] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [idDocumentUrl, setIdDocumentUrl] = useState('');

  // Reset field
  const [resetEmail, setResetEmail] = useState('');

  if (!isOpen) return null;

  const handleGoogle = async () => {
    setSubmitting(true);
    setLocalMsg(null);
    clearAuthError();
    try {
      await signInWithGoogle();
      onSuccess?.();
      onClose();
    } catch {
      // handled in context
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg(null);
    clearAuthError();
    try {
      await signInWithEmail(loginEmail, loginPassword);
      onSuccess?.();
      onClose();
    } catch {
      // handled in context
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg(null);
    clearAuthError();
    try {
      if (tab === 'complete_profile' && firebaseUser) {
        await completeStudentProfile({
          fullName: fullName || firebaseUser.displayName || 'Student Member',
          mobile,
          email: email || firebaseUser.email || '',
          fatherName,
          address,
          emergencyContact,
          profilePhotoUrl,
          idDocumentUrl,
        });
      } else {
        await registerStudentWithEmail({
          fullName,
          mobile,
          email,
          password,
          fatherName,
          address,
          emergencyContact,
          profilePhotoUrl,
          idDocumentUrl,
        });
      }
      onSuccess?.();
      onClose();
    } catch {
      // handled in context
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setLocalMsg(null);
    clearAuthError();
    try {
      await sendPasswordReset(resetEmail);
      setLocalMsg('Password reset instructions have been sent to your email address.');
    } catch (err: any) {
      setLocalMsg(err?.message || 'Unable to send password reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none';
  const inputIconCls =
    'w-full pl-9 pr-3 py-2 text-sm rounded border border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-secondary focus:ring-1 focus:ring-secondary focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/70 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-surface-container-lowest border border-outline-variant rounded-xl shadow-2xl overflow-hidden my-2 sm:my-6 grid grid-cols-1 lg:grid-cols-12">
        {/* Left Navy Institutional Panel */}
        <aside className="hidden lg:flex lg:col-span-5 bg-primary text-on-primary p-8 flex-col justify-between gap-8">
          <div className="space-y-6">
            <BrandLogo variant="light" />
            <div className="space-y-3 pt-2">
              <h2 className="font-display text-2xl font-extrabold text-on-primary leading-tight">
                Your study desk, AI tests, and fee receipts in one place
              </h2>
              <p className="text-sm text-on-primary-container leading-relaxed">
                Sign in with your Vidhya Library ID or register as a new member to reserve your desk and start competitive exam prep.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-on-primary-container">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Instant digital library pass &amp; QR attendance</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Bilingual AI Mock Tests &amp; Digital GK Books</span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-inverse-primary shrink-0 mt-0.5" />
                <span>Live fee balance tracking &amp; printable receipts</span>
              </li>
            </ul>
          </div>
          <p className="text-xs text-on-primary-container border-t border-primary-container pt-4">
            Open 24 Hours · Mirzapur Chowk, Darbhanga
          </p>
        </aside>

        {/* Right Form Panel */}
        <div className="lg:col-span-7 bg-surface-container-lowest text-on-surface flex flex-col min-w-0">
          <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 sm:py-4 border-b border-outline-variant bg-surface-container-low">
            <div className="lg:hidden min-w-0">
              <BrandLogo variant="dark" />
            </div>
            <span className="hidden lg:inline-block font-display text-base font-bold text-primary">
              {tab === 'login'
                ? 'Member Portal Login'
                : tab === 'register'
                  ? 'New Student Registration'
                  : tab === 'complete_profile'
                    ? 'Complete Student Profile'
                    : 'Reset Account Password'}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close authentication modal"
              className="p-2 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors cursor-pointer shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 sm:p-6 max-h-[82dvh] overflow-y-auto">
            {tab !== 'complete_profile' && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-surface-container-low border border-outline-variant rounded mb-5">
                <button
                  type="button"
                  onClick={() => {
                    setTab('login');
                    clearAuthError();
                    setLocalMsg(null);
                  }}
                  className={`py-2 px-2 sm:px-3 text-xs sm:text-sm font-semibold rounded transition-colors text-center leading-tight cursor-pointer ${
                    tab === 'login'
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Member Login
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    clearAuthError();
                    setLocalMsg(null);
                  }}
                  className={`py-2 px-2 sm:px-3 text-xs sm:text-sm font-semibold rounded transition-colors text-center leading-tight cursor-pointer ${
                    tab === 'register'
                      ? 'bg-surface-container-lowest text-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-primary'
                  }`}
                >
                  Student Registration
                </button>
              </div>
            )}

            {authError && (
              <div className="mb-4 p-3 rounded border border-error bg-error-container text-on-error-container text-xs flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="min-w-0 break-words">{authError}</span>
              </div>
            )}

            {localMsg && (
              <div className="mb-4 p-3 rounded border border-secondary/40 bg-secondary-container text-on-secondary-container text-xs break-words">
                {localMsg}
              </div>
            )}

            {tab === 'login' && (
              <div className="space-y-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleGoogle}
                  className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded border border-outline-variant bg-surface-container-lowest text-on-surface text-sm font-semibold hover:bg-surface-container-low transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Continue with Google
                </button>

                <div className="relative flex py-1 items-center">
                  <div className="grow border-t border-outline-variant" />
                  <span className="shrink mx-3 text-xs text-outline">or sign in with email</span>
                  <div className="grow border-t border-outline-variant" />
                </div>

                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                      <input
                        type="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="student@vidhyalibrary.in"
                        className={inputIconCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                      <input
                        type="password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="Enter your password"
                        className={inputIconCls}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setTab('reset')}
                      className="text-xs font-semibold text-secondary hover:text-primary hover:underline cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-2.5 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary transition-colors disabled:opacity-60 cursor-pointer"
                  >
                    {submitting ? 'Signing in...' : 'Sign In to Portal'}
                  </button>
                </form>
              </div>
            )}

            {(tab === 'register' || tab === 'complete_profile') && (
              <form onSubmit={handleRegister} className="space-y-3">
                {tab === 'register' && (
                  <div className="mb-3">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={handleGoogle}
                      className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded border border-outline-variant bg-surface-container-low text-primary text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
                    >
                      Quick Register with Google Account
                    </button>
                  </div>
                )}

                {tab === 'complete_profile' && (
                  <div className="p-3 rounded bg-surface-container-low border border-outline-variant text-xs text-on-surface-variant mb-3">
                    Complete your member details to generate your unique VIDHYA LIBRARY Student ID (e.g. VL2026XXX) and QR Pass.
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Full Name
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={120}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Aarav Sharma"
                        className={inputIconCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Mobile Number
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                      <input
                        type="tel"
                        required
                        minLength={8}
                        maxLength={20}
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="+91 87976 40034"
                        className={inputIconCls}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      disabled={tab === 'complete_profile' && Boolean(firebaseUser?.email)}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="aarav@example.com"
                      className={`${inputCls} disabled:opacity-70`}
                    />
                  </div>
                  {tab === 'register' && (
                    <div>
                      <label className="block text-xs font-semibold text-on-surface mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 6 characters"
                        className={inputCls}
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Father&apos;s Name
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={fatherName}
                      onChange={(e) => setFatherName(e.target.value)}
                      placeholder="Rajesh Sharma"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Emergency Contact
                    </label>
                    <input
                      type="tel"
                      required
                      minLength={8}
                      maxLength={30}
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="+91 87897 02011"
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-on-surface mb-1">
                    Residential Address
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={400}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="House No, Street, Locality, Darbhanga"
                      className={inputIconCls}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Profile Photo URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={profilePhotoUrl}
                      onChange={(e) => setProfilePhotoUrl(e.target.value)}
                      placeholder="https://..."
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-on-surface mb-1">
                      Identity Document URL (Optional)
                    </label>
                    <input
                      type="url"
                      value={idDocumentUrl}
                      onChange={(e) => setIdDocumentUrl(e.target.value)}
                      placeholder="https://..."
                      className={inputCls}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container transition-colors disabled:opacity-60 cursor-pointer mt-2"
                >
                  {submitting
                    ? 'Creating Student Account...'
                    : tab === 'complete_profile'
                      ? 'Generate Student ID & Enter Portal'
                      : 'Create Student Account'}
                </button>
              </form>
            )}

            {tab === 'reset' && (
              <form onSubmit={handleReset} className="space-y-4">
                <p className="text-sm text-on-surface-variant">
                  Enter your registered email address to receive a password reset link.
                </p>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="student@example.com"
                  className={inputCls}
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className="flex-1 min-w-[120px] py-2 px-4 rounded border border-outline-variant text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low cursor-pointer"
                  >
                    Back to Login
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 min-w-[140px] py-2 px-4 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
                  >
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
