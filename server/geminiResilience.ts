import { GoogleGenAI } from '@google/genai';

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

const DEPRECATED_MODEL_PREFIXES = [
  'gemini-1.0',
  'gemini-1.5',
  'gemini-2.0',
  'gemini-pro',
  'text-bison',
];

export function isDeprecatedGeminiModel(modelName: string): boolean {
  const lower = String(modelName || '').trim().toLowerCase();
  if (!lower) return true;
  return DEPRECATED_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function getActiveGeminiModel(): string {
  const configured = (process.env.GEMINI_MODEL || '').trim();
  if (configured && !isDeprecatedGeminiModel(configured)) {
    return configured;
  }
  if (configured && isDeprecatedGeminiModel(configured)) {
    console.warn(
      `[GeminiConfig] Ignoring deprecated GEMINI_MODEL="${configured}". Falling back to "${DEFAULT_GEMINI_MODEL}".`
    );
  }
  return DEFAULT_GEMINI_MODEL;
}

export function getConfiguredFallbackModel(): string | null {
  const fallback = (process.env.GEMINI_FALLBACK_MODEL || '').trim();
  const primary = getActiveGeminiModel();
  if (!fallback || fallback === primary || isDeprecatedGeminiModel(fallback)) {
    return null;
  }
  return fallback;
}

export const GEMINI_MODEL = getActiveGeminiModel();

export type GeminiErrorCategory =
  | 'daily_quota_exhausted'
  | 'rate_limit_429'
  | 'model_unavailable_503'
  | 'transient_server_error'
  | 'billing_restricted'
  | 'payload_too_large'
  | 'model_not_found'
  | 'auth_config_error'
  | 'unknown';

export type GeminiCircuitState =
  | 'closed'
  | 'open_daily_quota'
  | 'open_rate_limit'
  | 'open_billing'
  | 'open_auth';

export interface ParsedGeminiError {
  category: GeminiErrorCategory;
  httpStatus: number;
  rawMessage: string;
  userMessage: string;
  retryable: boolean;
  retryAfterMs: number | null;
  quotaMetric?: string;
}

export interface RetryAttemptLog {
  attempt: number;
  maxRetries: number;
  delayMs: number;
  category: GeminiErrorCategory;
  reason: string;
}

export interface SanitizedErrorRecord {
  timestamp: string;
  operation: string;
  category: GeminiErrorCategory;
  httpStatus: number;
  message: string;
  retryAfterSeconds: number | null;
}

export interface GeminiCooldownInfo {
  active: boolean;
  state: GeminiCircuitState;
  category: GeminiErrorCategory | null;
  reason: string | null;
  cooldownUntil: string | null;
  remainingSeconds: number;
}

export interface GeminiTelemetrySnapshot {
  model: string;
  fallbackModelConfigured: string | null;
  circuitState: GeminiCircuitState;
  quotaExhausted: boolean;
  cooldownActive: boolean;
  cooldownUntil: string | null;
  cooldownRemainingSeconds: number;
  cooldownReason: string | null;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  dedupedCount: number;
  rateLimit429Count: number;
  dailyQuota429Count: number;
  unavailable503Count: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCategory: GeminiErrorCategory | null;
  lastErrorMessage: string | null;
  recentErrors: SanitizedErrorRecord[];
}

export function sanitizeTelemetryMessage(input: unknown): string {
  const raw = String(input || '')
    // Redact Google API keys (AIza...)
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    // Redact Bearer tokens / JWTs
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\b/g, '[REDACTED_JWT]')
    // Redact key query params
    .replace(/([?&](?:key|api_key|token|access_token|secret)=)[^&\s]+/gi, '$1[REDACTED]')
    // Redact email addresses (PII)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]');
  return raw.slice(0, 260);
}

function parseDurationToMs(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.round(val * 1000);
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const sec = Number(obj.seconds || 0);
    const nanos = Number(obj.nanos || 0);
    if (sec > 0 || nanos > 0) {
      return Math.round(sec * 1000 + nanos / 1_000_000);
    }
  }
  const str = String(val).trim();
  const secMatch = str.match(/(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?/i);
  if (secMatch) {
    return Math.round(parseFloat(secMatch[1]) * 1000);
  }
  const msMatch = str.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (msMatch) {
    return Math.round(parseFloat(msMatch[1]));
  }
  return null;
}

function collectErrorDetails(err: unknown): {
  status: number;
  rawMessage: string;
  retryAfterMs: number | null;
  quotaIds: string[];
  reasons: string[];
} {
  const anyErr = err as Record<string, any>;
  let status = Number(anyErr?.status || anyErr?.statusCode || anyErr?.code || 0);
  let rawMessage = String(anyErr?.message || err || 'Unknown Gemini API error');
  let retryAfterMs: number | null = null;
  const quotaIds: string[] = [];
  const reasons: string[] = [];

  // Try parsing JSON embedded inside message (GoogleGenAI SDK often serializes API JSON in err.message)
  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart));
      const inner = parsed?.error || parsed;
      if (inner?.code && !status) status = Number(inner.code) || 0;
      if (inner?.status) reasons.push(String(inner.status));
      if (inner?.message) rawMessage = String(inner.message);
      const details = Array.isArray(inner?.details) ? inner.details : [];
      for (const d of details) {
        if (d?.retryDelay) {
          const parsedDelay = parseDurationToMs(d.retryDelay);
          if (parsedDelay) retryAfterMs = Math.max(retryAfterMs || 0, parsedDelay);
        }
        if (d?.reason) reasons.push(String(d.reason));
        if (Array.isArray(d?.violations)) {
          for (const v of d.violations) {
            if (v?.quotaId) quotaIds.push(String(v.quotaId));
            if (v?.quotaMetric) quotaIds.push(String(v.quotaMetric));
          }
        }
      }
    } catch {
      // ignore non-JSON tail
    }
  }

  // Also inspect structured details on error object directly
  if (Array.isArray(anyErr?.details)) {
    for (const d of anyErr.details) {
      if (d?.retryDelay) {
        const parsedDelay = parseDurationToMs(d.retryDelay);
        if (parsedDelay) retryAfterMs = Math.max(retryAfterMs || 0, parsedDelay);
      }
      if (d?.reason) reasons.push(String(d.reason));
      if (Array.isArray(d?.violations)) {
        for (const v of d.violations) {
          if (v?.quotaId) quotaIds.push(String(v.quotaId));
          if (v?.quotaMetric) quotaIds.push(String(v.quotaMetric));
        }
      }
    }
  }

  // Regex fallbacks on raw message text
  if (!status) {
    const codeMatch = rawMessage.match(/\b(400|401|403|404|413|429|500|502|503|504)\b/);
    if (codeMatch) status = Number(codeMatch[1]);
  }
  if (!retryAfterMs) {
    const retryInMatch = rawMessage.match(
      /(?:retry\s+(?:in|after)|retryDelay["']?\s*:\s*["']?)(\d+(?:\.\d+)?)\s*s/i
    );
    if (retryInMatch) {
      retryAfterMs = Math.round(parseFloat(retryInMatch[1]) * 1000);
    }
  }

  return { status, rawMessage, retryAfterMs, quotaIds, reasons };
}

export function parseGeminiApiError(err: unknown, modelName?: string): ParsedGeminiError {
  const activeModel = modelName || getActiveGeminiModel();
  const { status, rawMessage, retryAfterMs, quotaIds, reasons } = collectErrorDetails(err);
  const combined = `${rawMessage} ${quotaIds.join(' ')} ${reasons.join(' ')}`.toLowerCase();

  // Check API key / server config errors first
  if (
    combined.includes('gemini_api_key is not configured') ||
    combined.includes('api key not valid') ||
    combined.includes('api_key_invalid') ||
    status === 401
  ) {
    return {
      category: 'auth_config_error',
      httpStatus: status || 401,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage:
        'Gemini API key is missing or invalid on the server. Verify GEMINI_API_KEY in server Secrets.',
      retryable: false,
      retryAfterMs: null,
    };
  }

  // Check 429 RESOURCE_EXHAUSTED before generic billing text because Google's standard
  // 429 quota message includes "...please check your plan and billing details."
  if (status === 429 || combined.includes('resource_exhausted') || combined.includes('quota exceeded')) {
    const isDailyExhausted =
      combined.includes('perday') ||
      combined.includes('per_day') ||
      combined.includes('requestsperday') ||
      combined.includes('daily') ||
      (combined.includes('free_tier') &&
        (combined.includes('rpd') || combined.includes('day') || !retryAfterMs));

    const quotaMetric = quotaIds[0];

    if (isDailyExhausted) {
      return {
        category: 'daily_quota_exhausted',
        httpStatus: 429,
        rawMessage: sanitizeTelemetryMessage(rawMessage),
        userMessage:
          `Daily Gemini API request quota exhausted (429 RESOURCE_EXHAUSTED for ${activeModel}). ` +
          'Shared AI cooldown is active to prevent wasted requests. Completed work is preserved — resume after cooldown/quota reset or enable billing.',
        retryable: false,
        retryAfterMs,
        quotaMetric,
      };
    }

    const waitHint = retryAfterMs ? ` API requested a ${Math.ceil(retryAfterMs / 1000)}s cooldown.` : '';
    return {
      category: 'rate_limit_429',
      httpStatus: 429,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage:
        `Gemini API rate limit reached (429 RESOURCE_EXHAUSTED).${waitHint} Completed work is preserved; retry shortly.`,
      retryable: true,
      retryAfterMs,
      quotaMetric,
    };
  }

  // Check billing / permission restrictions (HTTP 403 or explicit billing/project blocks, no retry)
  if (
    status === 403 ||
    combined.includes('billing account') ||
    combined.includes('enable billing') ||
    combined.includes('spend_cap') ||
    combined.includes('permission_denied') ||
    combined.includes('has not been used in project') ||
    combined.includes('account has been suspended')
  ) {
    return {
      category: 'billing_restricted',
      httpStatus: status || 403,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage:
        'Gemini API billing or project permissions restricted this request. Check Google Cloud / AI Studio billing and API enablement; already completed data remains saved.',
      retryable: false,
      retryAfterMs: null,
    };
  }

  // Check 503 UNAVAILABLE / Model high demand
  if (
    status === 503 ||
    combined.includes('unavailable') ||
    combined.includes('high demand') ||
    combined.includes('overloaded')
  ) {
    return {
      category: 'model_unavailable_503',
      httpStatus: 503,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage: `Model ${activeModel} is temporarily experiencing high demand (503 UNAVAILABLE). Completed data is saved; retry in a moment.`,
      retryable: true,
      retryAfterMs,
    };
  }

  // Transient 500, 502, 504 server errors
  if (
    status === 500 ||
    status === 502 ||
    status === 504 ||
    combined.includes('timeout') ||
    combined.includes('econnreset')
  ) {
    return {
      category: 'transient_server_error',
      httpStatus: status || 502,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage: `Temporary Gemini gateway interruption (HTTP ${status || 502}). Completed data is saved; you can safely retry.`,
      retryable: true,
      retryAfterMs,
    };
  }

  // Payload / token size error (400 / 413) — can split batch into fewer pages
  if (
    status === 413 ||
    combined.includes('too large') ||
    combined.includes('payload size') ||
    combined.includes('token limit') ||
    combined.includes('exceeds the maximum')
  ) {
    return {
      category: 'payload_too_large',
      httpStatus: status || 413,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage: 'Batch PDF payload exceeded request size limits; splitting into smaller page batches.',
      retryable: false,
      retryAfterMs: null,
    };
  }

  if (status === 404 || combined.includes('not found')) {
    return {
      category: 'model_not_found',
      httpStatus: 404,
      rawMessage: sanitizeTelemetryMessage(rawMessage),
      userMessage: `Configured model "${activeModel}" returned 404 Not Found. Verify model availability for your API key.`,
      retryable: false,
      retryAfterMs: null,
    };
  }

  return {
    category: 'unknown',
    httpStatus: status || 500,
    rawMessage: sanitizeTelemetryMessage(rawMessage),
    userMessage: sanitizeTelemetryMessage(rawMessage).slice(0, 320),
    retryable: false,
    retryAfterMs,
  };
}

export function computeBackoffDelayMs(params: {
  attempt: number;
  retryAfterMs?: number | null;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}): number {
  const {
    attempt,
    retryAfterMs = null,
    baseDelayMs = 2500,
    maxDelayMs = 60_000,
    jitterMs = 1200,
  } = params;
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * Math.max(1, jitterMs));
  const backoffWithJitter = exp + jitter;
  if (retryAfterMs && retryAfterMs > 0) {
    // Strictly respect API-provided retryDelay plus a small jitter margin
    return Math.min(95_000, Math.max(retryAfterMs + Math.floor(jitter * 0.4), backoffWithJitter));
  }
  return backoffWithJitter;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiCoordinatorError extends Error {
  parsedGeminiError: ParsedGeminiError;
  cooldownUntil: string | null;
  cooldownRemainingSeconds: number;

  constructor(
    message: string,
    parsed: ParsedGeminiError,
    cooldownUntil: string | null = null,
    cooldownRemainingSeconds = 0
  ) {
    super(message);
    this.name = 'GeminiCoordinatorError';
    this.parsedGeminiError = parsed;
    this.cooldownUntil = cooldownUntil;
    this.cooldownRemainingSeconds = cooldownRemainingSeconds;
  }
}

/**
 * Coordinates ALL server-side Gemini API calls through:
 * - Sequential execution mutex (max concurrency = 1 for PDF extraction & pacing)
 * - Minimum inter-request spacing to prevent RPM spikes
 * - Shared project/model circuit breaker & cooldown (blocks ALL features on 429 daily quota)
 * - Bounded exponential backoff with jitter for 429 (non-daily), 500, 502, 503, 504
 * - In-flight & TTL idempotency cache to suppress duplicate rapid clicks/retries
 * - Sanitized telemetry & error ring buffer for admin monitoring
 */
export class GeminiRequestCoordinator {
  private mutexTail: Promise<void> = Promise.resolve();
  private lastCallTimestamp = 0;
  private minSpacingMs: number;
  private defaultMaxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private jitterMs: number;
  private dailyQuotaCooldownMinMs: number;
  private rateLimitCooldownMinMs: number;
  private idempotencyTtlMs: number;

  private circuitState: GeminiCircuitState = 'closed';
  private cooldownUntilMs: number | null = null;
  private cooldownReason: string | null = null;
  private cooldownCategory: GeminiErrorCategory | null = null;

  private totalRequests = 0;
  private successCount = 0;
  private failureCount = 0;
  private dedupedCount = 0;
  private rateLimit429Count = 0;
  private dailyQuota429Count = 0;
  private unavailable503Count = 0;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastErrorCategory: GeminiErrorCategory | null = null;
  private lastErrorMessage: string | null = null;
  private recentErrors: SanitizedErrorRecord[] = [];

  private inFlightIdempotent = new Map<string, Promise<unknown>>();
  private completedIdempotent = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(options?: {
    minSpacingMs?: number;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
    dailyQuotaCooldownMinMs?: number;
    rateLimitCooldownMinMs?: number;
    idempotencyTtlMs?: number;
  }) {
    this.minSpacingMs = options?.minSpacingMs ?? 1800;
    this.defaultMaxRetries = options?.maxRetries ?? 4;
    this.baseDelayMs = options?.baseDelayMs ?? 2500;
    this.maxDelayMs = options?.maxDelayMs ?? 60_000;
    this.jitterMs = options?.jitterMs ?? 1200;
    const envDailyCooldown = Number(process.env.GEMINI_DAILY_COOLDOWN_MS || 0);
    this.dailyQuotaCooldownMinMs =
      options?.dailyQuotaCooldownMinMs ??
      (Number.isFinite(envDailyCooldown) && envDailyCooldown > 0 ? envDailyCooldown : 15 * 60 * 1000);
    this.rateLimitCooldownMinMs = options?.rateLimitCooldownMinMs ?? 15_000;
    this.idempotencyTtlMs = options?.idempotencyTtlMs ?? 90_000;
  }

  getCooldownInfo(): GeminiCooldownInfo {
    const now = Date.now();
    if (this.cooldownUntilMs !== null) {
      if (now < this.cooldownUntilMs) {
        return {
          active: true,
          state: this.circuitState,
          category: this.cooldownCategory,
          reason: this.cooldownReason,
          cooldownUntil: new Date(this.cooldownUntilMs).toISOString(),
          remainingSeconds: Math.max(1, Math.ceil((this.cooldownUntilMs - now) / 1000)),
        };
      }
      // Cooldown window expired cleanly; transition back to closed
      this.circuitState = 'closed';
      this.cooldownUntilMs = null;
      this.cooldownReason = null;
      this.cooldownCategory = null;
    }
    return {
      active: false,
      state: this.circuitState,
      category: null,
      reason: null,
      cooldownUntil: null,
      remainingSeconds: 0,
    };
  }

  resetCooldownForVerifiedRecovery(note?: string): void {
    this.circuitState = 'closed';
    this.cooldownUntilMs = null;
    this.cooldownReason = null;
    this.cooldownCategory = null;
    if (note) {
      console.info(`[GeminiCoordinator] Cooldown cleared: ${sanitizeTelemetryMessage(note)}`);
    }
  }

  getTelemetrySnapshot(): GeminiTelemetrySnapshot {
    const cooldown = this.getCooldownInfo();
    return {
      model: getActiveGeminiModel(),
      fallbackModelConfigured: getConfiguredFallbackModel(),
      circuitState: cooldown.state,
      quotaExhausted: cooldown.active && cooldown.state === 'open_daily_quota',
      cooldownActive: cooldown.active,
      cooldownUntil: cooldown.cooldownUntil,
      cooldownRemainingSeconds: cooldown.remainingSeconds,
      cooldownReason: cooldown.reason,
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      failureCount: this.failureCount,
      dedupedCount: this.dedupedCount,
      rateLimit429Count: this.rateLimit429Count,
      dailyQuota429Count: this.dailyQuota429Count,
      unavailable503Count: this.unavailable503Count,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastErrorCategory: this.lastErrorCategory,
      lastErrorMessage: this.lastErrorMessage,
      recentErrors: [...this.recentErrors],
    };
  }

  private recordErrorEntry(label: string, parsed: ParsedGeminiError): void {
    const nowIso = new Date().toISOString();
    this.lastFailureAt = nowIso;
    this.lastErrorCategory = parsed.category;
    this.lastErrorMessage = sanitizeTelemetryMessage(parsed.userMessage);
    this.recentErrors.push({
      timestamp: nowIso,
      operation: sanitizeTelemetryMessage(label).slice(0, 80),
      category: parsed.category,
      httpStatus: parsed.httpStatus,
      message: sanitizeTelemetryMessage(parsed.userMessage),
      retryAfterSeconds: parsed.retryAfterMs ? Math.ceil(parsed.retryAfterMs / 1000) : null,
    });
    if (this.recentErrors.length > 25) {
      this.recentErrors = this.recentErrors.slice(-25);
    }
  }

  private buildCooldownError(cooldown: GeminiCooldownInfo): GeminiCoordinatorError {
    const cat: GeminiErrorCategory = cooldown.category || 'daily_quota_exhausted';
    const msg =
      `${cooldown.reason || 'Gemini API shared cooldown active.'} ` +
      `Retry allowed in ${cooldown.remainingSeconds}s (until ${cooldown.cooldownUntil}).`;
    const parsed: ParsedGeminiError = {
      category: cat,
      httpStatus: cat === 'billing_restricted' ? 403 : cat === 'auth_config_error' ? 401 : 429,
      rawMessage: msg,
      userMessage: msg,
      retryable: false,
      retryAfterMs: cooldown.remainingSeconds * 1000,
    };
    return new GeminiCoordinatorError(
      msg,
      parsed,
      cooldown.cooldownUntil,
      cooldown.remainingSeconds
    );
  }

  private openCircuitForError(parsed: ParsedGeminiError): {
    cooldownUntil: string | null;
    remainingSeconds: number;
  } {
    const now = Date.now();
    let durationMs = 0;

    if (parsed.category === 'daily_quota_exhausted') {
      this.circuitState = 'open_daily_quota';
      durationMs = Math.max(parsed.retryAfterMs || 0, this.dailyQuotaCooldownMinMs);
    } else if (parsed.category === 'rate_limit_429') {
      this.circuitState = 'open_rate_limit';
      durationMs = Math.max(parsed.retryAfterMs || 0, this.rateLimitCooldownMinMs);
    } else if (parsed.category === 'billing_restricted') {
      this.circuitState = 'open_billing';
      durationMs = 5 * 60 * 1000;
    } else if (parsed.category === 'auth_config_error') {
      this.circuitState = 'open_auth';
      durationMs = 60 * 1000;
    } else {
      return { cooldownUntil: null, remainingSeconds: 0 };
    }

    this.cooldownUntilMs = now + durationMs;
    this.cooldownReason = parsed.userMessage;
    this.cooldownCategory = parsed.category;
    return {
      cooldownUntil: new Date(this.cooldownUntilMs).toISOString(),
      remainingSeconds: Math.max(1, Math.ceil(durationMs / 1000)),
    };
  }

  /**
   * Deduplicates simultaneous identical calls or rapid duplicate clicks using an explicit
   * idempotency key (`requestId` or operation fingerprint). Never caches failed quota calls.
   * Note: `fn` itself should invoke `runExclusive(...)` for each actual Gemini API call.
   */
  async runIdempotent<T>(
    idempotencyKey: string,
    fn: () => Promise<T>
  ): Promise<{ value: T; deduped: boolean }> {
    const cleanKey = String(idempotencyKey || '').trim();
    if (!cleanKey) {
      const value = await fn();
      return { value, deduped: false };
    }

    const now = Date.now();
    // Prune expired cache entries opportunistically
    for (const [k, entry] of this.completedIdempotent.entries()) {
      if (entry.expiresAt <= now) {
        this.completedIdempotent.delete(k);
      }
    }

    const cached = this.completedIdempotent.get(cleanKey);
    if (cached && cached.expiresAt > now) {
      this.dedupedCount += 1;
      return { value: cached.value as T, deduped: true };
    }

    const existingPromise = this.inFlightIdempotent.get(cleanKey);
    if (existingPromise) {
      this.dedupedCount += 1;
      const value = (await existingPromise) as T;
      return { value, deduped: true };
    }

    const cooldown = this.getCooldownInfo();
    if (cooldown.active) {
      throw this.buildCooldownError(cooldown);
    }

    const taskPromise = fn()
      .then((result) => {
        this.completedIdempotent.set(cleanKey, {
          value: result,
          expiresAt: Date.now() + this.idempotencyTtlMs,
        });
        return result;
      })
      .finally(() => {
        this.inFlightIdempotent.delete(cleanKey);
      });

    this.inFlightIdempotent.set(cleanKey, taskPromise);
    const value = await taskPromise;
    return { value, deduped: false };
  }

  async runExclusive<T>(
    label: string,
    fn: () => Promise<T>,
    options?: {
      maxRetries?: number;
      shouldAbort?: () => boolean;
      onRetry?: (log: RetryAttemptLog) => void;
    }
  ): Promise<T> {
    // Immediate pre-queue short-circuit when circuit breaker is open
    const preCooldown = this.getCooldownInfo();
    if (preCooldown.active) {
      this.dedupedCount += 1;
      throw this.buildCooldownError(preCooldown);
    }

    const prev = this.mutexTail;
    let release!: () => void;
    this.mutexTail = new Promise<void>((res) => {
      release = res;
    });

    await prev;
    try {
      return await this.executeWithRetry(label, fn, options);
    } finally {
      release();
    }
  }

  private async executeWithRetry<T>(
    label: string,
    fn: () => Promise<T>,
    options?: {
      maxRetries?: number;
      shouldAbort?: () => boolean;
      onRetry?: (log: RetryAttemptLog) => void;
    }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? this.defaultMaxRetries;
    this.totalRequests += 1;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check shared circuit breaker inside mutex before every attempt (including queued jobs)
      const activeCooldown = this.getCooldownInfo();
      if (activeCooldown.active) {
        this.failureCount += 1;
        throw this.buildCooldownError(activeCooldown);
      }

      if (options?.shouldAbort?.()) {
        throw new Error('Job paused or aborted before Gemini API call.');
      }

      // Pace consecutive API calls to smooth RPM/TPM usage
      const elapsed = Date.now() - this.lastCallTimestamp;
      if (elapsed < this.minSpacingMs && this.minSpacingMs > 0) {
        await sleep(this.minSpacingMs - elapsed);
      }

      if (options?.shouldAbort?.()) {
        throw new Error('Job paused or aborted before Gemini API call.');
      }

      this.lastCallTimestamp = Date.now();
      try {
        const result = await fn();
        this.successCount += 1;
        this.lastSuccessAt = new Date().toISOString();
        this.circuitState = 'closed';
        this.cooldownUntilMs = null;
        this.cooldownReason = null;
        this.cooldownCategory = null;
        return result;
      } catch (err) {
        const parsed = parseGeminiApiError(err);

        if (parsed.category === 'daily_quota_exhausted') {
          this.dailyQuota429Count += 1;
        } else if (parsed.category === 'rate_limit_429') {
          this.rateLimit429Count += 1;
        } else if (parsed.category === 'model_unavailable_503') {
          this.unavailable503Count += 1;
        }

        const canRetry = parsed.retryable && attempt < maxRetries && !options?.shouldAbort?.();

        console.warn(
          `[GeminiCoordinator] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}) ` +
            `status=${parsed.httpStatus} category=${parsed.category} retryable=${parsed.retryable} ` +
            `retryAfterMs=${parsed.retryAfterMs ?? 'none'} msg=${parsed.rawMessage.slice(0, 160)}`
        );

        if (!canRetry) {
          this.failureCount += 1;
          this.recordErrorEntry(label, parsed);
          const cd = this.openCircuitForError(parsed);
          throw new GeminiCoordinatorError(
            parsed.userMessage,
            parsed,
            cd.cooldownUntil,
            cd.remainingSeconds
          );
        }

        const delayMs = computeBackoffDelayMs({
          attempt,
          retryAfterMs: parsed.retryAfterMs,
          baseDelayMs: this.baseDelayMs,
          maxDelayMs: this.maxDelayMs,
          jitterMs: this.jitterMs,
        });

        options?.onRetry?.({
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          category: parsed.category,
          reason: parsed.userMessage,
        });

        console.info(
          `[GeminiCoordinator] Backing off ${delayMs}ms before retry ${attempt + 1}/${maxRetries} for ${label}`
        );
        await sleep(delayMs);
      }
    }

    throw new Error(`Gemini request "${label}" failed after ${maxRetries + 1} attempts.`);
  }
}

export async function checkGeminiModelAvailability(
  ai: GoogleGenAI,
  targetModel?: string
): Promise<{
  available: boolean;
  model: string;
  error?: ParsedGeminiError;
}> {
  const model = targetModel || getActiveGeminiModel();
  if (isDeprecatedGeminiModel(model)) {
    const err = parseGeminiApiError(
      new Error(`Model "${model}" is deprecated and disallowed.`),
      model
    );
    return { available: false, model, error: err };
  }
  try {
    await ai.models.get({ model });
    return { available: true, model };
  } catch (err) {
    return {
      available: false,
      model,
      error: parseGeminiApiError(err, model),
    };
  }
}

/**
 * Only returns an optional fallback model if GEMINI_FALLBACK_MODEL is explicitly configured,
 * non-deprecated, and verified live via models.get(). Never switches silently to untested models.
 */
export async function verifyAndSelectFallbackModel(
  ai: GoogleGenAI,
  coordinator: GeminiRequestCoordinator
): Promise<{ selectedModel: string; switched: boolean; reason: string }> {
  const primary = getActiveGeminiModel();
  const cooldown = coordinator.getCooldownInfo();
  if (!cooldown.active) {
    return { selectedModel: primary, switched: false, reason: 'Primary model healthy.' };
  }
  const fallback = getConfiguredFallbackModel();
  if (!fallback) {
    return {
      selectedModel: primary,
      switched: false,
      reason: 'No verified GEMINI_FALLBACK_MODEL configured.',
    };
  }
  const check = await checkGeminiModelAvailability(ai, fallback);
  if (!check.available) {
    return {
      selectedModel: primary,
      switched: false,
      reason: `Configured fallback model "${fallback}" is unavailable: ${check.error?.userMessage || 'check failed'}`,
    };
  }
  return {
    selectedModel: fallback,
    switched: true,
    reason: `Verified fallback model "${fallback}" is available.`,
  };
}
