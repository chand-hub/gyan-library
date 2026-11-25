import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AdminLoginActivity } from '../../types/library';

interface AdminProfilePanelProps {
  mode: 'profile' | 'password';
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface AdminProfileResponse {
  configured: boolean;
  admin: {
    adminId: string;
    displayName: string;
    mobile: string;
    updatedAt: string;
  } | null;
  smsGatewayConfigured: boolean;
  loginActivity: AdminLoginActivity[];
}

export const AdminProfilePanel: React.FC<AdminProfilePanelProps> = ({ mode, onNotify }) => {
  const { getIdToken, updateAdminSessionMobile, signOut } = useAuth();

  const [data, setData] = useState<AdminProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Change password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Change / Initialize mobile fields
  const [newMobile, setNewMobile] = useState('');
  const [displayName, setDisplayName] = useState('GYAN ADDA Admin');
  const [verifyPwdForMobile, setVerifyPwdForMobile] = useState('');
  const [initPassword, setInitPassword] = useState('');

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = (await res.json()) as AdminProfileResponse;
        setData(json);
        if (json.admin) {
          setNewMobile(json.admin.mobile);
          setDisplayName(json.admin.displayName);
        }
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to load admin security profile.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, onNotify]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleInitOwnerCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch('/api/admin/profile/init-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          mobile: newMobile.trim(),
          newPassword: initPassword,
          displayName: displayName.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save mobile credentials.');
      setInitPassword('');
      updateAdminSessionMobile(json.admin?.mobile || newMobile.trim());
      onNotify('ok', 'Admin mobile & password credentials initialized.');
      await loadProfile();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to initialize mobile credentials.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      onNotify('err', 'New passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to update password.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      onNotify('ok', 'Admin password updated securely.');
      await loadProfile();
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed updating password.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeMobile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch('/api/admin/change-mobile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword: verifyPwdForMobile,
          newMobile: newMobile.trim(),
          displayName: displayName.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Unable to update mobile number.');
      setVerifyPwdForMobile('');
      if (json.admin?.mobile) {
        updateAdminSessionMobile(json.admin.mobile);
      }
      onNotify('ok', 'Admin mobile number and display name updated.');
      await loadProfile();
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed updating mobile number.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white focus:border-secondary focus:outline-none';
  const cardCls =
    'rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm p-5';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            {mode === 'password' ? 'Change Admin Password' : 'Admin Profile & Security'}
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Manage registered admin mobile authentication, salted password credentials, SMS OTP gateway readiness, and login activity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadProfile}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => signOut()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-error text-on-error text-xs font-semibold hover:opacity-90 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" /> Revoke &amp; Sign Out
          </button>
        </div>
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={cardCls}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-on-surface-variant dark:text-slate-400">
            <Smartphone className="w-4 h-4 text-secondary" /> Registered Admin Mobile
          </div>
          <p className="font-mono text-lg font-bold text-primary dark:text-white mt-2">
            {data?.admin?.mobile || 'Not configured'}
          </p>
          <p className="text-[11px] text-on-surface-variant dark:text-slate-400 mt-0.5">
            {data?.admin?.displayName || 'Configure mobile + password below'}
          </p>
        </div>

        <div className={cardCls}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-on-surface-variant dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-success" /> Password Storage
          </div>
          <p className="text-sm font-bold text-on-surface dark:text-white mt-2">
            {data?.configured ? 'Salted Scrypt Hash Active' : 'Pending Setup'}
          </p>
          <p className="text-[11px] text-on-surface-variant dark:text-slate-400 mt-0.5">
            HMAC-SHA256 revocable in-memory session tokens
          </p>
        </div>

        <div className={cardCls}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-on-surface-variant dark:text-slate-400">
            {data?.smsGatewayConfigured ? (
              <CheckCircle2 className="w-4 h-4 text-success" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-warning" />
            )}
            SMS OTP Recovery Gateway
          </div>
          <p className={`text-sm font-bold mt-2 ${data?.smsGatewayConfigured ? 'text-success' : 'text-warning'}`}>
            {data?.smsGatewayConfigured ? 'Configured & Ready' : 'Not Configured'}
          </p>
          <p className="text-[11px] text-on-surface-variant dark:text-slate-400 mt-0.5">
            {data?.smsGatewayConfigured
              ? 'Forgot-password OTP dispatches live SMS'
              : 'Set SMS_API_KEY in server environment secrets'}
          </p>
        </div>
      </div>

      {/* Forms */}
      {!data?.configured ? (
        <form onSubmit={handleInitOwnerCredentials} className={`${cardCls} max-w-xl space-y-4`}>
          <h3 className="font-display text-base font-bold text-primary dark:text-white flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-secondary" /> Set Up Mobile + Password Admin Login
          </h3>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Enable signing in directly at /admin/login with your mobile number and password in addition to Google Owner Admin login.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Admin Mobile Number</label>
              <input
                type="tel"
                required
                value={newMobile}
                onChange={(e) => setNewMobile(e.target.value)}
                placeholder="10-digit mobile number"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Admin Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1">Password (min 8 chars, letters + numbers)</label>
            <input
              type="password"
              required
              minLength={8}
              value={initPassword}
              onChange={(e) => setInitPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Enable Mobile + Password Sign-In'}
          </button>
        </form>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Change Password Card */}
          <form onSubmit={handleChangePassword} className={`${cardCls} space-y-4`}>
            <h3 className="font-display text-base font-bold text-primary dark:text-white flex items-center gap-2">
              <Lock className="w-4 h-4 text-secondary" /> Change Password
            </h3>
            <div>
              <label className="block text-xs font-semibold mb-1">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">New Password (8+ chars, letters + numbers)</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </form>

          {/* Update Mobile / Profile Card */}
          {mode === 'profile' && (
            <form onSubmit={handleChangeMobile} className={`${cardCls} space-y-4`}>
              <h3 className="font-display text-base font-bold text-primary dark:text-white flex items-center gap-2">
                <Phone className="w-4 h-4 text-secondary" /> Update Admin Mobile &amp; Profile
              </h3>
              <div>
                <label className="block text-xs font-semibold mb-1">Registered Mobile Number</label>
                <input
                  type="tel"
                  required
                  value={newMobile}
                  onChange={(e) => setNewMobile(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Administrator Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Confirm Current Password</label>
                <input
                  type="password"
                  required
                  value={verifyPwdForMobile}
                  onChange={(e) => setVerifyPwdForMobile(e.target.value)}
                  className={inputCls}
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 rounded bg-primary text-on-primary text-sm font-semibold hover:bg-primary-container disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Update Mobile & Name'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Login Activity Audit Log */}
      {mode === 'profile' && (
        <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
          <div className="px-5 py-3.5 border-b border-outline-variant dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-primary dark:text-white">
              Admin Login &amp; Credential Activity Log
            </h3>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-container-low dark:bg-slate-800/80 uppercase text-on-surface-variant border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">Timestamp (IST)</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Mobile</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {(data?.loginActivity || []).map((act) => (
                <tr key={act.id}>
                  <td className="px-4 py-3 font-mono whitespace-nowrap">{act.timestampIst}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-secondary dark:text-blue-400">
                    {act.action}
                  </td>
                  <td className="px-4 py-3 font-mono">{act.mobile}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        act.status === 'success'
                          ? 'bg-success-container text-on-success-container'
                          : act.status === 'failed'
                            ? 'bg-error-container text-on-error-container'
                            : 'bg-secondary-container text-on-secondary-container'
                      }`}
                    >
                      {act.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 break-words">{act.details}</td>
                </tr>
              ))}
              {(data?.loginActivity || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-on-surface-variant">
                    No login or credential events recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
