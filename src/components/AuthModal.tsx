import React, { useState } from 'react';
import { X, Lock, Mail, User as UserIcon, Phone, MapPin, ShieldAlert } from 'lucide-react';
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0E0713]/80 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-[#3D2C56] border border-[#7C7397] rounded-xl shadow-2xl overflow-hidden my-8 text-white">
        <div className="flex items-center justify-between px-6 py-4 bg-[#0E0713] border-b border-[#514871]">
          <BrandLogo variant="light" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="p-2 rounded-lg text-[#CFCEDD] hover:text-white hover:bg-[#3D2C56] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {tab !== 'complete_profile' && (
            <div className="flex gap-1 p-1 bg-[#1C0E29] border border-[#514871] rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  clearAuthError();
                  setLocalMsg(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                  tab === 'login'
                    ? 'bg-[#B5ADC6] text-[#0E0713]'
                    : 'text-[#CFCEDD] hover:text-white'
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
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-md transition-colors whitespace-nowrap ${
                  tab === 'register'
                    ? 'bg-[#B5ADC6] text-[#0E0713]'
                    : 'text-[#CFCEDD] hover:text-white'
                }`}
              >
                Student Registration
              </button>
            </div>
          )}

          {authError && (
            <div className="mb-4 p-3 rounded-lg border border-rose-500/60 bg-rose-950/60 text-rose-100 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {localMsg && (
            <div className="mb-4 p-3 rounded-lg border border-[#B5ADC6]/50 bg-[#1C0E29] text-[#CFCEDD] text-xs">
              {localMsg}
            </div>
          )}

          {tab === 'login' && (
            <div className="space-y-4">
              <button
                type="button"
                disabled={submitting}
                onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white text-sm font-semibold hover:bg-[#514871] transition-colors"
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
                <div className="grow border-t border-[#514871]" />
                <span className="shrink mx-3 text-xs text-[#9993AC]">or sign in with email</span>
                <div className="grow border-t border-[#514871]" />
              </div>

              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="student@vidhyalibrary.in"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC] focus:outline-none focus:ring-2 focus:ring-[#B5ADC6]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC] focus:outline-none focus:ring-2 focus:ring-[#B5ADC6]"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setTab('reset')}
                    className="text-xs font-medium text-[#B5ADC6] hover:text-white hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors disabled:opacity-60"
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
                    className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white text-xs font-semibold hover:bg-[#514871] transition-colors"
                  >
                    Quick Register with Google Account
                  </button>
                </div>
              )}

              {tab === 'complete_profile' && (
                <div className="p-3 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-[#CFCEDD] mb-3">
                  Complete your member details to generate your unique VIDHYA LIBRARY Student ID (e.g. VL2026XXX) and QR Pass.
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Aarav Sharma"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Mobile Number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
                    <input
                      type="tel"
                      required
                      minLength={8}
                      maxLength={20}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="+91 87976 40034"
                      className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    disabled={tab === 'complete_profile' && Boolean(firebaseUser?.email)}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="aarav@example.com"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC] disabled:opacity-70"
                  />
                </div>
                {tab === 'register' && (
                  <div>
                    <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
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
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                  Residential Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={400}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="House No, Street, Locality, Darbhanga"
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Profile Photo URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={profilePhotoUrl}
                    onChange={(e) => setProfilePhotoUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#CFCEDD] mb-1">
                    Identity Document URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={idDocumentUrl}
                    onChange={(e) => setIdDocumentUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white transition-colors disabled:opacity-60"
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
              <p className="text-sm text-[#CFCEDD]">
                Enter your registered email address to receive a password reset link.
              </p>
              <input
                type="email"
                required
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="student@example.com"
                className="w-full px-3 py-2 text-sm rounded-lg border border-[#7C7397] bg-[#1C0E29] text-white placeholder-[#9993AC]"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="flex-1 py-2 px-4 rounded-lg border border-[#7C7397] text-sm font-medium text-[#CFCEDD] hover:bg-[#514871]"
                >
                  Back to Login
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2 px-4 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-sm font-bold hover:bg-white"
                >
                  Send Reset Link
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
