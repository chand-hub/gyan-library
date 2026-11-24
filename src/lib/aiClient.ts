const AI_COOLDOWN_STORAGE_KEY = 'vl_ai_shared_cooldown_v1';

export interface SharedAiCooldownState {
  active: boolean;
  cooldownUntil: string | null;
  remainingSeconds: number;
  reason: string | null;
  category?: string | null;
}

export function generateAiRequestId(prefix = 'ai'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function formatCooldownRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const remSec = s % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m ${remSec}s`;
  }
  if (mins > 0) {
    return `${mins}m ${String(remSec).padStart(2, '0')}s`;
  }
  return `${remSec}s`;
}

export function readStoredAiCooldown(): SharedAiCooldownState {
  try {
    if (typeof sessionStorage === 'undefined') {
      return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
    }
    const raw = sessionStorage.getItem(AI_COOLDOWN_STORAGE_KEY);
    if (!raw) return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
    const parsed = JSON.parse(raw) as {
      cooldownUntil?: string;
      reason?: string;
      category?: string;
    };
    if (!parsed.cooldownUntil) {
      return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
    }
    const msLeft = new Date(parsed.cooldownUntil).getTime() - Date.now();
    if (!Number.isFinite(msLeft) || msLeft <= 0) {
      sessionStorage.removeItem(AI_COOLDOWN_STORAGE_KEY);
      return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
    }
    return {
      active: true,
      cooldownUntil: parsed.cooldownUntil,
      remainingSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
      reason: parsed.reason || null,
      category: parsed.category || null,
    };
  } catch {
    return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
  }
}

export function saveStoredAiCooldown(params: {
  cooldownUntil?: string | null;
  cooldownRemainingSeconds?: number;
  reason?: string | null;
  category?: string | null;
}): SharedAiCooldownState {
  let untilIso = params.cooldownUntil || null;
  if (!untilIso && params.cooldownRemainingSeconds && params.cooldownRemainingSeconds > 0) {
    untilIso = new Date(Date.now() + params.cooldownRemainingSeconds * 1000).toISOString();
  }
  if (!untilIso) {
    clearStoredAiCooldown();
    return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
  }
  const msLeft = new Date(untilIso).getTime() - Date.now();
  if (!Number.isFinite(msLeft) || msLeft <= 0) {
    clearStoredAiCooldown();
    return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(
        AI_COOLDOWN_STORAGE_KEY,
        JSON.stringify({
          cooldownUntil: untilIso,
          reason: params.reason || null,
          category: params.category || null,
        })
      );
    }
  } catch {
    // ignore storage errors
  }
  return {
    active: true,
    cooldownUntil: untilIso,
    remainingSeconds: Math.max(1, Math.ceil(msLeft / 1000)),
    reason: params.reason || null,
    category: params.category || null,
  };
}

export function clearStoredAiCooldown(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(AI_COOLDOWN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export async function fetchServerAiStatus(token: string): Promise<SharedAiCooldownState | null> {
  try {
    const res = await fetch('/api/ai/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.cooldownActive && (data.cooldownUntil || data.cooldownRemainingSeconds > 0)) {
      return saveStoredAiCooldown({
        cooldownUntil: data.cooldownUntil,
        cooldownRemainingSeconds: data.cooldownRemainingSeconds,
        reason: data.cooldownReason,
        category: data.circuitState,
      });
    }
    clearStoredAiCooldown();
    return { active: false, cooldownUntil: null, remainingSeconds: 0, reason: null };
  } catch {
    return null;
  }
}
