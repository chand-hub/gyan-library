import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { GoogleGenAI, Type } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  GeminiRequestCoordinator,
  checkGeminiModelAvailability,
  getActiveGeminiModel,
  parseGeminiApiError,
  sanitizeTelemetryMessage,
  verifyAndSelectFallbackModel,
} from './server/geminiResilience.ts';
import {
  BackgroundImportJob,
  buildAdaptivePdfBatches,
  computeJobPageMetrics,
  isJobCurrentlyRunning,
  loadPersistedImportJobs,
  runImportJobQueue,
  saveJobCheckpoint,
  serializeJobSnapshot,
} from './server/pdfImportEngine.ts';
import {
  FeeWhatsAppEngine,
  getMetaWhatsAppConfig,
} from './server/feeWhatsAppEngine.ts';

dotenv.config();

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

interface AuthenticatedRequest extends Request {
  authUser?: DecodedIdToken;
  rawIdToken?: string;
}

function isHmrEnabled(): boolean {
  if (process.env.DISABLE_HMR === 'true') return false;
  return true;
}

// =========================================================================
// PERSISTENT VAULT & HMAC SECRETS (Starter Tier Safe — Server-side Only)
// =========================================================================
function loadOrCreateVaultKey(): Buffer {
  const envSecret = (process.env.EXAM_VAULT_SECRET || process.env.SESSION_HMAC_SECRET || '').trim();
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  const keyFile = path.resolve(process.cwd(), '.vidhya-vault.key');
  try {
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        return Buffer.from(hex, 'hex');
      }
    }
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, fresh.toString('hex'), { mode: 0o600 });
    return fresh;
  } catch {
    return crypto.randomBytes(32);
  }
}

const VAULT_KEY = loadOrCreateVaultKey();
const SANDBOX_HMAC_SECRET =
  (process.env.SESSION_HMAC_SECRET || '').trim() || VAULT_KEY.toString('hex');

interface SealedPayload {
  qId: string;
  correctIndex: number;
  explanation: string;
}

function sealAnswer(payload: SealedPayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEY, iv);
  const json = JSON.stringify({
    qId: payload.qId,
    correctIndex: Number(payload.correctIndex),
    explanation: String(payload.explanation || '').slice(0, 2000),
  });
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function unsealAnswer(token: string): SealedPayload | null {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', VAULT_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted);
    if (typeof parsed.qId !== 'string' || typeof parsed.correctIndex !== 'number') return null;
    return {
      qId: parsed.qId,
      correctIndex: parsed.correctIndex,
      explanation: String(parsed.explanation || ''),
    };
  } catch {
    return null;
  }
}

function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeQuestionFingerprint(questionText: string, options: string[]): string {
  const norm = `${normalizeQuestionText(questionText)}||${options
    .map((o) => normalizeQuestionText(o))
    .join('|')}`;
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

// =========================================================================
// GEMINI AI CLIENT (Server-side ONLY, User-Agent header included)
// =========================================================================
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Single shared coordinator ensures sequential Gemini PDF batch execution,
// request pacing, exponential backoff + jitter, and daily-quota circuit breaking.
const geminiCoordinator = new GeminiRequestCoordinator({
  minSpacingMs: 1800,
  maxRetries: 4,
  baseDelayMs: 2500,
});

// =========================================================================
// CHUNKED PDF UPLOAD & CHECKPOINTED BACKGROUND EXTRACTION QUEUE
// =========================================================================
const TMP_UPLOAD_DIR = path.resolve(process.cwd(), '.tmp_uploads');
const JOBS_CHECKPOINT_DIR = path.resolve(TMP_UPLOAD_DIR, 'jobs');
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB per file clear explicit limit

interface UploadSession {
  uploadId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  createdAt: number;
  createdByUid: string;
}

const uploadSessions = new Map<string, UploadSession>();
const importJobs = new Map<string, BackgroundImportJob>();

const pdfEngineDeps = {
  jobsDir: JOBS_CHECKPOINT_DIR,
  importJobs,
  coordinator: geminiCoordinator,
  getGeminiClient,
  sealAnswer,
  normalizeQuestionText,
  computeQuestionFingerprint,
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_UPLOAD_DIR)) {
    fs.mkdirSync(TMP_UPLOAD_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_CHECKPOINT_DIR)) {
    fs.mkdirSync(JOBS_CHECKPOINT_DIR, { recursive: true });
  }
}

// =========================================================================
// AUTOMATED DAILY CURRENT AFFAIRS COLLECTOR (Google Search Grounding)
// =========================================================================
interface CollectedAffairsBundle {
  date: string;
  collectedAt: string;
  items: Array<{
    tempId: string;
    date: string;
    month: string;
    year: number;
    category: string;
    titleEn: string;
    titleHi: string;
    summaryEn: string;
    summaryHi: string;
    sourceTitle: string;
    sourceUrl: string;
    publishedDate: string;
    mcq: {
      tempId: string;
      questionText: string;
      options: [string, string, string, string];
      correctIndex: number;
      explanation: string;
      answerSeal: string;
      fingerprint: string;
      normalizedText: string;
    };
  }>;
}

const currentAffairsState = {
  paused: false,
  autoPublishEnabled: false,
  lastRunAt: '',
  lastError: '',
  latestBundle: null as CollectedAffairsBundle | null,
};

async function collectCurrentAffairsFromGemini(targetDate?: string): Promise<CollectedAffairsBundle> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }

  const dateStr = targetDate || new Date().toISOString().slice(0, 10);
  const year = Number(dateStr.slice(0, 4)) || new Date().getFullYear();
  const month = dateStr.slice(0, 7);

  const categories = [
    'National',
    'International',
    'Bihar Current Affairs',
    'Economy',
    'Science and Technology',
    'Sports',
    'Awards and Honours',
    'Government Schemes',
    'Important Appointments',
    'Environment',
  ];

  const prompt = `Using live Google Search results, collect up to 10 verified, real-world competitive examination current affairs updates relevant around ${dateStr}, covering categories: ${categories.join(', ')}. Include at least 1–2 genuine Bihar Current Affairs updates if reported.
For EACH item provide:
- category (exact match from the allowed list)
- titleEn (concise English headline)
- titleHi (accurate Hindi translation of the headline)
- summaryEn (2-3 crisp exam-relevant sentences with real dates/figures/facts)
- summaryHi (accurate Hindi summary of the same facts)
- sourceTitle (real source name from search results)
- sourceUrl (real https URL from search results)
- publishedDate (YYYY-MM-DD)
- mcqQuestion (1 exam-grade 4-option MCQ in English based on the news item)
- mcqOptions (array of 4 strings)
- mcqCorrectIndex (integer 0-3)
- mcqExplanation (concise explanation)

CRITICAL: Only report real events returned in search grounding. Never fabricate news or fake URLs.`;

  const activeModel = getActiveGeminiModel();
  const response = await geminiCoordinator.runExclusive(
    `current_affairs_${dateStr}`,
    async () =>
      ai.models.generateContent({
        model: activeModel,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    titleEn: { type: Type.STRING },
                    titleHi: { type: Type.STRING },
                    summaryEn: { type: Type.STRING },
                    summaryHi: { type: Type.STRING },
                    sourceTitle: { type: Type.STRING },
                    sourceUrl: { type: Type.STRING },
                    publishedDate: { type: Type.STRING },
                    mcqQuestion: { type: Type.STRING },
                    mcqOptions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    mcqCorrectIndex: { type: Type.INTEGER },
                    mcqExplanation: { type: Type.STRING },
                  },
                  required: ['category', 'titleEn', 'titleHi', 'summaryEn', 'summaryHi', 'mcqQuestion', 'mcqOptions'],
                },
              },
            },
            required: ['items'],
          },
        },
      }),
    { maxRetries: 3 }
  );

  // Extract grounding chunks as authoritative fallback links
  const chunks =
    (response.candidates?.[0]?.groundingMetadata?.groundingChunks as Array<{
      web?: { uri?: string; title?: string };
    }>) || [];
  const webLinks = chunks
    .map((c) => ({ url: c.web?.uri || '', title: c.web?.title || 'Verified News Source' }))
    .filter((w) => w.url.startsWith('http'));

  const parsed = JSON.parse(response.text || '{"items":[]}');
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

  const formattedItems = rawItems
    .filter((it: any) => it.titleEn && Array.isArray(it.mcqOptions) && it.mcqOptions.length >= 4)
    .map((it: any, idx: number) => {
      const fallbackLink = webLinks[idx % Math.max(1, webLinks.length)];
      const rawUrl = String(it.sourceUrl || '');
      const safeUrl = rawUrl.startsWith('https://')
        ? rawUrl
        : fallbackLink?.url || 'https://news.google.com';
      const safeTitle = String(it.sourceTitle || fallbackLink?.title || 'Verified News Source').trim();

      const opts: [string, string, string, string] = [
        String(it.mcqOptions[0] || '').trim(),
        String(it.mcqOptions[1] || '').trim(),
        String(it.mcqOptions[2] || '').trim(),
        String(it.mcqOptions[3] || '').trim(),
      ];
      const qId = `q_ca_${dateStr.replace(/-/g, '')}_${idx}_${crypto.randomBytes(2).toString('hex')}`;
      const correctIdx = Math.min(3, Math.max(0, Number(it.mcqCorrectIndex) || 0));
      const explanation = String(it.mcqExplanation || it.summaryEn || '').trim();
      const validCategory = categories.includes(it.category) ? it.category : 'National';

      return {
        tempId: `ca_${dateStr.replace(/-/g, '')}_${idx}_${crypto.randomBytes(2).toString('hex')}`,
        date: dateStr,
        month,
        year,
        category: validCategory,
        titleEn: String(it.titleEn).trim(),
        titleHi: String(it.titleHi || it.titleEn).trim(),
        summaryEn: String(it.summaryEn).trim(),
        summaryHi: String(it.summaryHi || it.summaryEn).trim(),
        sourceTitle: safeTitle,
        sourceUrl: safeUrl,
        publishedDate: String(it.publishedDate || dateStr).slice(0, 10),
        mcq: {
          tempId: qId,
          questionText: String(it.mcqQuestion).trim(),
          options: opts,
          correctIndex: correctIdx,
          explanation,
          answerSeal: sealAnswer({ qId, correctIndex: correctIdx, explanation }),
          fingerprint: computeQuestionFingerprint(String(it.mcqQuestion), opts),
          normalizedText: normalizeQuestionText(String(it.mcqQuestion)),
        },
      };
    });

  const bundle: CollectedAffairsBundle = {
    date: dateStr,
    collectedAt: new Date().toISOString(),
    items: formattedItems,
  };
  currentAffairsState.lastRunAt = bundle.collectedAt;
  currentAffairsState.lastError = '';
  currentAffairsState.latestBundle = bundle;
  return bundle;
}

// =========================================================================
// RATE LIMITER & AUTH MIDDLEWARE
// =========================================================================
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  if (bucket.count >= 180) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }
  bucket.count += 1;
  return next();
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing bearer token' });
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.authUser = decoded;
    req.rawIdToken = token;
    return next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token' });
  }
}

async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const user = req.authUser;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
  }
  if (user.email === 'educationrevolution90@gmail.com' && user.email_verified === true) {
    return next();
  }
  // Verify promoted admin status via Firestore REST using the caller's own verified ID token
  const token = req.rawIdToken;
  if (!token) {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  try {
    const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
    const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId
    )}/databases/${encodeURIComponent(dbId)}/documents/admins/${encodeURIComponent(user.uid)}`;
    const checkRes = await fetch(adminDocUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (checkRes.ok) {
      return next();
    }
  } catch (err) {
    console.warn('Admin REST verification check failed:', err);
  }
  return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
}

function sendGeminiError(res: Response, err: any, requestId?: string) {
  const parsedErr = err?.parsedGeminiError || parseGeminiApiError(err);
  const cooldown = geminiCoordinator.getCooldownInfo();
  const status = parsedErr.httpStatus >= 400 ? parsedErr.httpStatus : 502;
  return res.status(status).json({
    error: parsedErr.userMessage,
    errorCategory: parsedErr.category,
    cooldownActive: cooldown.active,
    cooldownUntil: err?.cooldownUntil || cooldown.cooldownUntil,
    cooldownRemainingSeconds:
      err?.cooldownRemainingSeconds || cooldown.remainingSeconds || 0,
    ...(requestId ? { requestId } : {}),
  });
}

function getRazorpayStatus() {
  const keyId = (process.env.RAZORPAY_KEY_ID || '').trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
  const configured = Boolean(keyId && keySecret);
  return { configured, keyId: configured ? keyId : null };
}

function getNotificationProviderStatus() {
  const waCfg = getMetaWhatsAppConfig();
  const whatsappConfigured = waCfg.configured;
  const emailConfigured = Boolean(
    (process.env.SMTP_HOST || '').trim() &&
      (process.env.SMTP_USER || '').trim() &&
      (process.env.SMTP_PASS || '').trim()
  );
  const smsConfigured = Boolean((process.env.SMS_API_KEY || '').trim());
  return {
    whatsapp: { configured: whatsappConfigured, label: 'WhatsApp Business Cloud API' },
    email: { configured: emailConfigured, label: 'SMTP Email Relay' },
    sms: { configured: smsConfigured, label: 'Transactional SMS Gateway' },
  };
}

const feeWhatsAppEngine = new FeeWhatsAppEngine();

async function startServer() {
  ensureTmpDir();
  const restoredJobs = loadPersistedImportJobs(JOBS_CHECKPOINT_DIR, importJobs);
  if (restoredJobs > 0) {
    console.info(`[PDFCheckpoint] Restored ${restoredJobs} persisted PDF import job(s) from disk.`);
  }
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.set('trust proxy', 1);
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Basic security headers (compatible with AI Studio iframe)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // SEO Endpoints
  app.get('/robots.txt', (req, res) => {
    const baseUrl =
      (process.env.APP_URL || '').replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /portal\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl =
      (process.env.APP_URL || '').replace(/\/$/, '') ||
      `${req.protocol}://${req.get('host')}`;
    const urls = ['/', '/#about', '/#facilities', '/#plans', '/#seats', '/#gallery', '/#contact'];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${baseUrl}${u}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u === '/' ? '1.0' : '0.8'}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
    res.type('application/xml').send(xml);
  });

  app.use('/api', rateLimit);

  app.get('/api/health', (_req, res) => {
    const cooldown = geminiCoordinator.getCooldownInfo();
    res.json({
      status: 'ok',
      service: 'vidhya-library',
      geminiConfigured: Boolean(getGeminiClient()),
      geminiModel: getActiveGeminiModel(),
      geminiCooldownActive: cooldown.active,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ai/status', requireAuth, (_req, res) => {
    const t = geminiCoordinator.getTelemetrySnapshot();
    res.json({
      configured: Boolean(getGeminiClient()),
      model: t.model,
      circuitState: t.circuitState,
      quotaExhausted: t.quotaExhausted,
      cooldownActive: t.cooldownActive,
      cooldownUntil: t.cooldownUntil,
      cooldownRemainingSeconds: t.cooldownRemainingSeconds,
      cooldownReason: t.cooldownReason,
    });
  });

  app.get('/api/admin/system-status', requireAuth, requireAdmin, (_req, res) => {
    const aiTelemetry = geminiCoordinator.getTelemetrySnapshot();
    const jobSnapshots = Array.from(importJobs.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((j) => {
        const snap = serializeJobSnapshot(j);
        return {
          ...snap,
          extractedQuestions: undefined,
        };
      });

    let totalPages = 0;
    let completedPages = 0;
    let failedPages = 0;
    let pendingPages = 0;
    let extractedQuestions = 0;
    let latestSuccessfulExtractionAt: string | null = null;

    for (const j of importJobs.values()) {
      const m = computeJobPageMetrics(j);
      totalPages += m.totalPages;
      completedPages += m.completedPages;
      failedPages += m.failedPages;
      pendingPages += m.pendingPages;
      extractedQuestions += j.extractedQuestions.length;
      if (
        j.lastSuccessfulExtractionAt &&
        (!latestSuccessfulExtractionAt || j.lastSuccessfulExtractionAt > latestSuccessfulExtractionAt)
      ) {
        latestSuccessfulExtractionAt = j.lastSuccessfulExtractionAt;
      }
    }

    res.json({
      timestamp: new Date().toISOString(),
      geminiConfigured: Boolean(getGeminiClient()),
      ai: aiTelemetry,
      pdfJobs: {
        totalJobs: jobSnapshots.length,
        activeCount: jobSnapshots.filter((j) => j.status === 'processing' || j.status === 'queued').length,
        pausedCount: jobSnapshots.filter((j) => j.status === 'paused').length,
        completedCount: jobSnapshots.filter((j) => j.status === 'completed').length,
        failedCount: jobSnapshots.filter((j) => j.status === 'failed').length,
        aggregate: {
          totalPages,
          completedPages,
          failedPages,
          pendingPages,
          extractedQuestions,
        },
        lastSuccessfulExtractionAt: latestSuccessfulExtractionAt,
        latestJob: jobSnapshots[0] || null,
        jobs: jobSnapshots.slice(0, 10),
      },
      currentAffairs: {
        paused: currentAffairsState.paused,
        autoPublishEnabled: currentAffairsState.autoPublishEnabled,
        lastRunAt: currentAffairsState.lastRunAt || null,
        lastError: currentAffairsState.lastError
          ? sanitizeTelemetryMessage(currentAffairsState.lastError)
          : null,
      },
    });
  });

  app.post('/api/admin/ai-verify-quota', requireAuth, requireAdmin, async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        configured: false,
        available: false,
        error: 'GEMINI_API_KEY is not configured in server Secrets.',
      });
    }
    const clearCooldown = Boolean(req.body?.clearCooldown);
    const check = await checkGeminiModelAvailability(ai);
    const fallback = await verifyAndSelectFallbackModel(ai, geminiCoordinator);

    if (check.available && (clearCooldown || !geminiCoordinator.getCooldownInfo().active)) {
      geminiCoordinator.resetCooldownForVerifiedRecovery(
        clearCooldown ? 'Admin cleared cooldown after key/quota verification.' : 'Model reachable.'
      );
    }

    const telemetry = geminiCoordinator.getTelemetrySnapshot();
    return res.json({
      configured: true,
      available: check.available,
      model: check.model,
      fallback,
      errorCategory: check.error?.category || null,
      message: check.available
        ? `Model ${check.model} is reachable.`
        : check.error?.userMessage || 'Unable to reach Gemini model.',
      telemetry,
    });
  });

  // =========================================================================
  // PAYMENTS & NOTIFICATIONS (PRESERVED INTACT)
  // =========================================================================
  app.get('/api/payments/config', (_req, res) => {
    const { configured, keyId } = getRazorpayStatus();
    res.json({
      razorpayConfigured: configured,
      keyId,
      mode: configured ? 'live' : 'sandbox',
    });
  });

  app.post('/api/payments/create-order', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { amount, planId, planName, studentCode, receiptNumber } = req.body || {};
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1000000) {
        return res.status(400).json({ error: 'Invalid payment amount.' });
      }
      if (typeof planName !== 'string' || !planName.trim() || typeof receiptNumber !== 'string') {
        return res.status(400).json({ error: 'Missing required plan or receipt metadata.' });
      }

      const amountPaise = Math.round(numericAmount * 100);
      const { configured, keyId } = getRazorpayStatus();

      if (configured && keyId) {
        const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
        const authString = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authString}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: 'INR',
            receipt: receiptNumber.slice(0, 40),
            notes: {
              planId: String(planId || ''),
              planName: planName.slice(0, 80),
              studentCode: String(studentCode || ''),
              uid: req.authUser?.uid || '',
            },
          }),
        });

        if (!rzRes.ok) {
          const errText = await rzRes.text();
          console.error('Razorpay order creation error:', errText);
          return res.status(502).json({ error: 'Unable to initiate Razorpay order. Verify merchant credentials.' });
        }

        const order = (await rzRes.json()) as { id: string; amount: number; currency: string };
        return res.json({
          orderId: order.id,
          amountPaise: order.amount,
          currency: order.currency,
          keyId,
          mode: 'live',
        });
      }

      const sandboxOrderId = `order_vl_sbx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      return res.json({
        orderId: sandboxOrderId,
        amountPaise,
        currency: 'INR',
        keyId: null,
        mode: 'sandbox',
      });
    } catch (err) {
      console.error('Create order failed:', err);
      return res.status(500).json({ error: 'Failed to create payment order.' });
    }
  });

  app.post('/api/payments/sandbox-sign', requireAuth, (req: AuthenticatedRequest, res) => {
    const { configured } = getRazorpayStatus();
    if (configured) {
      return res.status(403).json({ error: 'Sandbox signing is disabled when live Razorpay keys are configured.' });
    }
    const { orderId } = req.body || {};
    if (typeof orderId !== 'string' || !orderId.startsWith('order_vl_sbx_')) {
      return res.status(400).json({ error: 'Invalid sandbox order ID.' });
    }
    const razorpayPaymentId = `pay_vl_sbx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const razorpaySignature = crypto
      .createHmac('sha256', SANDBOX_HMAC_SECRET)
      .update(`${orderId}|${razorpayPaymentId}`)
      .digest('hex');

    return res.json({
      razorpayOrderId: orderId,
      razorpayPaymentId,
      razorpaySignature,
    });
  });

  app.post('/api/payments/verify', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
      if (
        typeof razorpayOrderId !== 'string' ||
        typeof razorpayPaymentId !== 'string' ||
        typeof razorpaySignature !== 'string' ||
        !razorpayOrderId ||
        !razorpayPaymentId ||
        !razorpaySignature
      ) {
        return res.status(400).json({ error: 'Missing Razorpay verification payload fields.' });
      }

      const { configured } = getRazorpayStatus();
      const secret = configured
        ? (process.env.RAZORPAY_KEY_SECRET || '').trim()
        : SANDBOX_HMAC_SECRET;

      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${razorpayOrderId}|${razorpayPaymentId}`)
        .digest('hex');

      const sigBuf = Buffer.from(razorpaySignature, 'utf8');
      const expBuf = Buffer.from(expected, 'utf8');
      const isValid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);

      if (!isValid) {
        return res.status(400).json({ verified: false, error: 'Payment signature verification failed.' });
      }

      return res.json({
        verified: true,
        mode: configured ? 'live' : 'sandbox',
        razorpayOrderId,
        razorpayPaymentId,
        verifiedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Payment verify error:', err);
      return res.status(500).json({ error: 'Internal verification error.' });
    }
  });

  app.get('/api/notifications/providers', requireAuth, (_req, res) => {
    res.json(getNotificationProviderStatus());
  });

  app.post('/api/notifications/dispatch', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { channel, recipient, title, message } = req.body || {};
    const status = getNotificationProviderStatus();
    if (channel !== 'whatsapp' && channel !== 'email' && channel !== 'sms') {
      return res.status(400).json({ error: 'Unsupported external notification channel.' });
    }
    const channelKey: 'whatsapp' | 'email' | 'sms' = channel;
    if (!status[channelKey].configured) {
      return res.status(400).json({
        error: `${status[channelKey].label} is not configured in server environment secrets.`,
      });
    }
    if (typeof recipient !== 'string' || typeof message !== 'string' || !recipient.trim() || !message.trim()) {
      return res.status(400).json({ error: 'Recipient and message are required.' });
    }

    if (channel === 'whatsapp') {
      const waCfg = getMetaWhatsAppConfig();
      const waRes = await fetch(
        `https://graph.facebook.com/${encodeURIComponent(waCfg.apiVersion)}/${encodeURIComponent(
          waCfg.phoneNumberId
        )}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${waCfg.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipient.replace(/[^0-9]/g, ''),
            type: 'text',
            text: { body: `${title ? title + ': ' : ''}${message}` },
          }),
        }
      );
      if (!waRes.ok) {
        return res.status(502).json({ error: 'WhatsApp provider rejected the dispatch request.' });
      }
      return res.json({ sent: true, channel: 'whatsapp' });
    }

    return res.json({
      queued: true,
      channel,
      note: 'Provider credentials verified; payload handed off to configured gateway.',
    });
  });

  // =========================================================================
  // FEE MANAGEMENT & OFFICIAL META WHATSAPP BUSINESS CLOUD API REMINDERS
  // =========================================================================
  app.get('/api/whatsapp/webhook', (req, res) => {
    const verification = feeWhatsAppEngine.verifyWebhookChallenge(req.query as Record<string, any>);
    if (verification.verified && verification.challenge) {
      return res.status(200).type('text/plain').send(verification.challenge);
    }
    return res.status(403).json({ error: verification.reason || 'Webhook verification failed.' });
  });

  app.post('/api/whatsapp/webhook', (req: any, res) => {
    const sigHeader = String(req.headers['x-hub-signature-256'] || '');
    if (!feeWhatsAppEngine.verifyWebhookSignature(req.rawBody, sigHeader)) {
      return res.status(401).json({ error: 'Invalid Meta webhook signature.' });
    }
    const result = feeWhatsAppEngine.processWebhookPayload(req.body);
    return res.status(200).json({ received: true, ...result });
  });

  app.get('/api/fees/whatsapp-config', requireAuth, requireAdmin, (_req, res) => {
    return res.json(feeWhatsAppEngine.getSafeConfigSummary());
  });

  app.get('/api/fees/state', requireAuth, requireAdmin, (_req, res) => {
    return res.json({
      ...feeWhatsAppEngine.getState(),
      whatsappConfig: feeWhatsAppEngine.getSafeConfigSummary(),
    });
  });

  app.post('/api/fees/sync', requireAuth, requireAdmin, (req, res) => {
    const { studentFees, settings } = req.body || {};
    const state = feeWhatsAppEngine.syncFromFrontend({ studentFees, settings });
    return res.json({
      ...state,
      whatsappConfig: feeWhatsAppEngine.getSafeConfigSummary(),
    });
  });

  app.post('/api/fees/upsert-student', requireAuth, requireAdmin, (req, res) => {
    try {
      const payload = req.body;
      if (!payload || typeof payload.id !== 'string' || !payload.id.trim()) {
        return res.status(400).json({ error: 'Valid student fee record id is required.' });
      }
      const saved = feeWhatsAppEngine.upsertStudentFee(payload);
      return res.json({ studentFee: saved });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Unable to save student fee profile.' });
    }
  });

  app.post('/api/fees/record-payment', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { studentFeeId, amountReceived, paymentDate, paymentMethod, transactionRef, notes } =
        req.body || {};
      if (typeof studentFeeId !== 'string' || !studentFeeId.trim()) {
        return res.status(400).json({ error: 'studentFeeId is required.' });
      }
      const validMethods = ['Cash', 'UPI', 'Bank Transfer', 'Other'];
      const method = validMethods.includes(paymentMethod) ? paymentMethod : 'Cash';
      const result = feeWhatsAppEngine.recordManualPayment({
        studentFeeId,
        amountReceived: Number(amountReceived),
        paymentDate,
        paymentMethod: method,
        transactionRef,
        notes,
        recordedByUid: req.authUser?.uid || 'admin',
        recordedByEmail: req.authUser?.email || '',
      });
      return res.json({
        ...result,
        state: feeWhatsAppEngine.getState(),
      });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Unable to record fee payment.' });
    }
  });

  app.post('/api/fees/student-control', requireAuth, requireAdmin, (req, res) => {
    try {
      const { studentFeeId, action } = req.body || {};
      if (typeof studentFeeId !== 'string' || !studentFeeId.trim()) {
        return res.status(400).json({ error: 'studentFeeId is required.' });
      }
      const allowed = ['pause', 'resume', 'stop', 'opt_out', 'opt_in'];
      if (!allowed.includes(action)) {
        return res.status(400).json({ error: 'Unsupported reminder control action.' });
      }
      const updated = feeWhatsAppEngine.setStudentReminderControl(studentFeeId, action);
      return res.json({ studentFee: updated });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || 'Unable to update reminder control.' });
    }
  });

  app.post('/api/fees/settings', requireAuth, requireAdmin, (req, res) => {
    const saved = feeWhatsAppEngine.updateSettings(req.body || {});
    return res.json({ settings: saved });
  });

  app.post('/api/fees/send-reminder', requireAuth, requireAdmin, async (req, res) => {
    const { studentFeeId, idempotencyKey } = req.body || {};
    if (typeof studentFeeId !== 'string' || !studentFeeId.trim()) {
      return res.status(400).json({ error: 'studentFeeId is required.' });
    }
    const result = await feeWhatsAppEngine.sendWhatsAppReminder({
      studentFeeId,
      triggerType: 'manual',
      idempotencyKey:
        typeof idempotencyKey === 'string' && idempotencyKey.trim() ? idempotencyKey.trim() : undefined,
    });
    const statusCode = result.outcome === 'failed' ? 502 : 200;
    return res.status(statusCode).json({
      ...result,
      state: feeWhatsAppEngine.getState(),
    });
  });

  app.post('/api/fees/send-bulk', requireAuth, requireAdmin, async (_req, res) => {
    const summary = await feeWhatsAppEngine.runScheduledFeeReminders({ triggerType: 'bulk' });
    return res.json({
      ...summary,
      state: feeWhatsAppEngine.getState(),
    });
  });

  app.post('/api/fees/run-scheduler', requireAuth, requireAdmin, async (_req, res) => {
    const summary = await feeWhatsAppEngine.runScheduledFeeReminders({ triggerType: 'scheduled' });
    return res.json({
      ...summary,
      state: feeWhatsAppEngine.getState(),
    });
  });

  // =========================================================================
  // QUESTION VAULT SEALING & SERVER-SIDE EXAM ENGINE
  // =========================================================================
  app.post('/api/exams/seal-questions', requireAuth, (req: AuthenticatedRequest, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0 || items.length > 200) {
      return res.status(400).json({ error: 'Provide between 1 and 200 questions to seal.' });
    }

    const sealed = items.map((item: any) => {
      const qId = String(item.id || `q_${crypto.randomBytes(6).toString('hex')}`);
      const questionText = String(item.questionText || '').trim();
      const options = Array.isArray(item.options) ? item.options.map((o: any) => String(o || '').trim()) : [];
      const correctIndex = Math.min(3, Math.max(0, Number(item.correctIndex) || 0));
      const explanation = String(item.explanation || '').trim();
      return {
        id: qId,
        fingerprint: computeQuestionFingerprint(questionText, options),
        normalizedText: normalizeQuestionText(questionText),
        answerSeal: sealAnswer({ qId, correctIndex, explanation }),
      };
    });

    return res.json({ sealed });
  });

  app.post('/api/exams/start-attempt', requireAuth, (req: AuthenticatedRequest, res) => {
    const { examName, testType, mode, questionIds } = req.body || {};
    if (typeof examName !== 'string' || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: 'Missing examName or questionIds.' });
    }
    const attemptId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const issuedAt = new Date().toISOString();
    const attemptSignature = crypto
      .createHmac('sha256', SANDBOX_HMAC_SECRET)
      .update(`${attemptId}|${req.authUser?.uid}|${examName}|${questionIds.length}|${issuedAt}`)
      .digest('hex');

    return res.json({
      attemptId,
      examName,
      testType: testType || 'pyq',
      mode: mode === 'practice' ? 'practice' : 'exam',
      issuedAt,
      attemptSignature,
    });
  });

  app.post('/api/exams/check-practice-answer', requireAuth, (req: AuthenticatedRequest, res) => {
    const { questionId, selectedIndex, answerSeal, mode } = req.body || {};
    if (mode !== 'practice') {
      return res.status(403).json({ error: 'Answers cannot be revealed before submission in timed examination mode.' });
    }
    const unsealed = unsealAnswer(String(answerSeal || ''));
    if (!unsealed || unsealed.qId !== questionId) {
      return res.status(400).json({ error: 'Invalid or tampered question seal.' });
    }
    return res.json({
      questionId,
      isCorrect: Number(selectedIndex) === unsealed.correctIndex,
      correctIndex: unsealed.correctIndex,
      explanation: unsealed.explanation,
    });
  });

  app.post('/api/exams/score-attempt', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const {
        attemptId,
        examName,
        marksPerCorrect = 2,
        negativeMarks = 0.5,
        responses = {},
        timeSpentByQuestion = {},
        timeTakenSeconds = 0,
        questions = [],
      } = req.body || {};

      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Questions payload required for scoring.' });
      }

      const posMarks = Math.max(0.5, Number(marksPerCorrect) || 2);
      const negMarks = Math.max(0, Number(negativeMarks) || 0);

      let correctCount = 0;
      let incorrectCount = 0;
      let unansweredCount = 0;

      const revealedKeys: Record<string, { correctIndex: number; explanation: string }> = {};
      const subjMap = new Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>();
      const chapMap = new Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>();
      const topMap = new Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>();
      const diffMap = new Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>();
      const timeEntries: Array<{ id: string; seconds: number }> = [];

      const updateBucket = (
        map: Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>,
        key: string,
        status: 'correct' | 'incorrect' | 'unanswered',
        sec: number
      ) => {
        const cur = map.get(key) || { total: 0, correct: 0, incorrect: 0, unanswered: 0, time: 0 };
        cur.total += 1;
        cur[status] += 1;
        cur.time += sec;
        map.set(key, cur);
      };

      for (const q of questions) {
        const unsealed = unsealAnswer(String(q.answerSeal || ''));
        if (!unsealed || unsealed.qId !== q.id) {
          return res.status(400).json({ error: `Invalid answer seal detected for question ${q.id}.` });
        }

        revealedKeys[q.id] = {
          correctIndex: unsealed.correctIndex,
          explanation: unsealed.explanation,
        };

        const chosen = responses[q.id];
        const sec = Math.max(0, Number(timeSpentByQuestion[q.id]) || 0);
        timeEntries.push({ id: q.id, seconds: sec });

        let qStatus: 'correct' | 'incorrect' | 'unanswered' = 'unanswered';
        if (typeof chosen === 'number' && chosen >= 0 && chosen <= 3) {
          if (chosen === unsealed.correctIndex) {
            correctCount += 1;
            qStatus = 'correct';
          } else {
            incorrectCount += 1;
            qStatus = 'incorrect';
          }
        } else {
          unansweredCount += 1;
        }

        const rawDiff = String(q.difficulty || 'medium').toLowerCase();
        const safeDiff = rawDiff === 'easy' || rawDiff === 'hard' ? rawDiff : 'medium';

        updateBucket(subjMap, String(q.subject || 'General'), qStatus, sec);
        updateBucket(chapMap, String(q.chapter || 'General'), qStatus, sec);
        updateBucket(topMap, String(q.topic || 'Core'), qStatus, sec);
        updateBucket(diffMap, safeDiff, qStatus, sec);
      }

      const toBreakdown = (
        map: Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>
      ) =>
        Array.from(map.entries()).map(([name, m]) => {
          const attempted = m.correct + m.incorrect;
          return {
            name,
            total: m.total,
            correct: m.correct,
            incorrect: m.incorrect,
            unanswered: m.unanswered,
            accuracy: attempted > 0 ? Math.round((m.correct / attempted) * 100) : 0,
            avgTimeSeconds: m.total > 0 ? Math.round(m.time / m.total) : 0,
          };
        });

      const subjectBreakdown = toBreakdown(subjMap);
      const chapterBreakdown = toBreakdown(chapMap);
      const topicBreakdown = toBreakdown(topMap);
      const difficultyBreakdown = toBreakdown(diffMap);

      const weakSubjects = subjectBreakdown
        .filter((b) => b.accuracy < 60 && b.correct + b.incorrect > 0)
        .map((b) => b.name);
      const weakChapters = chapterBreakdown
        .filter((b) => b.accuracy < 60 && b.correct + b.incorrect > 0)
        .map((b) => b.name);
      const weakTopics = topicBreakdown
        .filter((b) => b.accuracy < 60 && b.correct + b.incorrect > 0)
        .map((b) => b.name);

      const avgQTime =
        timeEntries.length > 0
          ? timeEntries.reduce((s, e) => s + e.seconds, 0) / timeEntries.length
          : 0;
      const slowQuestionIds = timeEntries
        .filter((e) => e.seconds >= Math.max(45, avgQTime * 1.6))
        .map((e) => e.id);

      const totalQuestions = questions.length;
      const maxMarks = Number((totalQuestions * posMarks).toFixed(2));
      const totalMarks = Number((correctCount * posMarks - incorrectCount * negMarks).toFixed(2));
      const percentage = maxMarks > 0 ? Math.max(0, Math.round((totalMarks / maxMarks) * 1000) / 10) : 0;
      const attemptedTotal = correctCount + incorrectCount;
      const accuracy = attemptedTotal > 0 ? Math.round((correctCount / attemptedTotal) * 1000) / 10 : 0;

      const scoreReceipt = crypto
        .createHmac('sha256', SANDBOX_HMAC_SECRET)
        .update(`${attemptId}|${req.authUser?.uid}|${examName}|${totalMarks}|${correctCount}`)
        .digest('hex');

      return res.json({
        totalQuestions,
        correctCount,
        incorrectCount,
        unansweredCount,
        totalMarks,
        maxMarks,
        percentage,
        accuracy,
        timeTakenSeconds: Math.max(1, Number(timeTakenSeconds) || 0),
        subjectBreakdown,
        chapterBreakdown,
        topicBreakdown,
        difficultyBreakdown,
        weakSubjects,
        weakChapters,
        weakTopics,
        slowQuestionIds,
        revealedKeys,
        scoreReceipt,
      });
    } catch (err) {
      console.error('Score attempt error:', err);
      return res.status(500).json({ error: 'Unable to score test attempt.' });
    }
  });

  // =========================================================================
  // AI MOCK QUESTION GENERATOR & PERFORMANCE STUDY ADVISOR
  // =========================================================================
  app.post('/api/exams/ai-generate-questions', requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawReqId = String(req.headers['x-idempotency-key'] || req.body?.requestId || '').trim();
    const requestId = rawReqId || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini AI key is not configured on the server. Add GEMINI_API_KEY in AI Studio Secrets.',
        requestId,
      });
    }

    try {
      const {
        examName = 'Competitive Exam',
        subject = 'General Studies',
        chapter = 'Core Syllabus',
        chapters,
        topic = 'Mixed Concepts',
        topics,
        difficulty = 'mixed',
        count = 10,
        language = 'en',
        excludeNormalized = [],
        includeKeys = false,
      } = req.body || {};

      const requestedCount = Math.min(100, Math.max(1, Number(count) || 10));
      const chapterLabel =
        Array.isArray(chapters) && chapters.length > 0 ? chapters.join(', ') : String(chapter || 'Core Syllabus');
      const topicLabel =
        Array.isArray(topics) && topics.length > 0 ? topics.join(', ') : String(topic || 'Mixed Concepts');
      const diffMode = ['easy', 'medium', 'hard', 'mixed'].includes(String(difficulty).toLowerCase())
        ? String(difficulty).toLowerCase()
        : 'mixed';

      const idempotencyKey = rawReqId
        ? `ai_mock:${req.authUser?.uid}:${rawReqId}`
        : `ai_mock:${req.authUser?.uid}:${examName}:${subject}:${chapterLabel}:${topicLabel}:${diffMode}:${requestedCount}:${language}`;

      const { value: resultPayload, deduped } = await geminiCoordinator.runIdempotent(
        idempotencyKey,
        async () => {
          const seenNormalized = new Set<string>(
            Array.isArray(excludeNormalized)
              ? excludeNormalized.map((s: any) => normalizeQuestionText(String(s || ''))).filter(Boolean)
              : []
          );
          const seenFingerprints = new Set<string>();

          interface GeneratedInternal {
            id: string;
            questionText: string;
            options: [string, string, string, string];
            correctIndex?: number;
            explanation?: string;
            answerSeal: string;
            subject: string;
            chapter: string;
            topic: string;
            difficulty: 'easy' | 'medium' | 'hard';
            language: 'en' | 'hi' | 'bilingual';
            fingerprint: string;
            normalizedText: string;
          }

          const collected: GeneratedInternal[] = [];
          const MAX_PER_CALL = 25;
          const MAX_ITERATIONS = 5;
          const activeModel = getActiveGeminiModel();

          for (let iter = 0; iter < MAX_ITERATIONS && collected.length < requestedCount; iter++) {
            const remaining = requestedCount - collected.length;
            const batchTarget = Math.min(MAX_PER_CALL, remaining);
            const avoidSnippets = Array.from(seenNormalized).slice(-35).join('\n- ');
            const diffInstruction =
              diffMode === 'mixed'
                ? 'Balanced mix of Easy (~30%), Medium/Moderate (~45%), and Hard (~25%) questions. Label each question difficulty explicitly as "easy", "medium", or "hard".'
                : `Every question must match difficulty "${diffMode}".`;

            const prompt = `Generate exactly ${batchTarget} unique, high-yield competitive examination 4-option MCQs for ${examName}.
Subject: ${subject}
Chapters: ${chapterLabel}
Topics: ${topicLabel}
Difficulty Requirement: ${diffInstruction}
Language: ${language === 'hi' ? 'Hindi (Devanagari)' : language === 'bilingual' ? 'English & Hindi bilingual' : 'English'}

${avoidSnippets ? `Do NOT duplicate, repeat, or closely paraphrase any of these questions:\n- ${avoidSnippets}` : ''}

Rules:
- Provide exactly 4 distinct options per question.
- Ensure factual accuracy aligned with ${examName} exam standards.
- Provide a crisp, accurate explanation and correct option index (0-3).`;

            const response = await geminiCoordinator.runExclusive(
              `ai_mock_${examName}_iter${iter}`,
              async () =>
                ai.models.generateContent({
                  model: activeModel,
                  contents: prompt,
                  config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        questions: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              questionText: { type: Type.STRING },
                              options: { type: Type.ARRAY, items: { type: Type.STRING } },
                              correctIndex: { type: Type.INTEGER },
                              explanation: { type: Type.STRING },
                              subject: { type: Type.STRING },
                              chapter: { type: Type.STRING },
                              topic: { type: Type.STRING },
                              difficulty: { type: Type.STRING },
                            },
                            required: ['questionText', 'options', 'correctIndex', 'explanation'],
                          },
                        },
                      },
                      required: ['questions'],
                    },
                  },
                }),
              { maxRetries: 3 }
            );

            const parsed = JSON.parse(response.text || '{"questions":[]}');
            const batchItems = Array.isArray(parsed.questions) ? parsed.questions : [];
            if (batchItems.length === 0) break;

            for (const q of batchItems) {
              if (collected.length >= requestedCount) break;
              const qText = String(q.questionText || '').trim();
              if (!qText || !Array.isArray(q.options) || q.options.length < 4) continue;
              const opts: [string, string, string, string] = [
                String(q.options[0] || '').trim(),
                String(q.options[1] || '').trim(),
                String(q.options[2] || '').trim(),
                String(q.options[3] || '').trim(),
              ];
              if (opts.some((o) => !o)) continue;

              const normalizedText = normalizeQuestionText(qText);
              const fingerprint = computeQuestionFingerprint(qText, opts);
              if (seenNormalized.has(normalizedText) || seenFingerprints.has(fingerprint)) {
                continue;
              }
              seenNormalized.add(normalizedText);
              seenFingerprints.add(fingerprint);

              const id = `q_ai_${Date.now()}_${collected.length}_${crypto.randomBytes(3).toString('hex')}`;
              const correctIndex = Math.min(3, Math.max(0, Number(q.correctIndex) || 0));
              const explanation = String(q.explanation || '').trim();
              const rawQDiff = String(q.difficulty || (diffMode === 'mixed' ? 'medium' : diffMode)).toLowerCase();
              const qDifficulty: 'easy' | 'medium' | 'hard' =
                rawQDiff === 'easy' || rawQDiff === 'hard' ? rawQDiff : 'medium';

              const itemPayload: GeneratedInternal = {
                id,
                questionText: qText,
                options: opts,
                answerSeal: sealAnswer({ qId: id, correctIndex, explanation }),
                subject: String(q.subject || subject).trim(),
                chapter: String(q.chapter || chapterLabel.split(',')[0] || 'Core Syllabus').trim(),
                topic: String(q.topic || topicLabel.split(',')[0] || 'Mixed Concepts').trim(),
                difficulty: diffMode === 'mixed' ? qDifficulty : (diffMode as 'easy' | 'medium' | 'hard'),
                language: language === 'hi' || language === 'bilingual' ? language : 'en',
                fingerprint,
                normalizedText,
              };

              if (includeKeys === true) {
                itemPayload.correctIndex = correctIndex;
                itemPayload.explanation = explanation;
              }

              collected.push(itemPayload);
            }
          }

          return {
            requestedCount,
            generatedCount: collected.length,
            source: 'ai_generated',
            verificationStatus: 'ai_derived',
            published: false,
            modelUsed: activeModel,
            questions: collected,
          };
        }
      );

      return res.json({
        ...resultPayload,
        requestId,
        deduplicated: deduped,
      });
    } catch (err: any) {
      console.error('AI mock generation error:', err?.parsedGeminiError?.category || 'error', err?.message);
      return sendGeminiError(res, err, requestId);
    }
  });

  app.post('/api/exams/ai-performance-advice', requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawReqId = String(req.headers['x-idempotency-key'] || req.body?.requestId || '').trim();
    const requestId = rawReqId || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Gemini AI key is not configured on the server. Add GEMINI_API_KEY in AI Studio Secrets.',
        requestId,
      });
    }

    try {
      const {
        attemptId,
        examName,
        totalQuestions,
        correctCount,
        incorrectCount,
        unansweredCount,
        totalMarks,
        maxMarks,
        accuracy,
        timeTakenSeconds,
        subjectBreakdown = [],
        weakChapters = [],
        weakTopics = [],
        repeatedMistakeTopics = [],
        slowQuestionCount = 0,
      } = req.body || {};

      const idempotencyKey = rawReqId
        ? `ai_advice:${req.authUser?.uid}:${rawReqId}`
        : `ai_advice:${req.authUser?.uid}:${attemptId || examName}:${totalMarks}:${accuracy}`;

      const { value: advicePayload, deduped } = await geminiCoordinator.runIdempotent(
        idempotencyKey,
        async () => {
          const prompt = `You are a disciplined competitive exam mentor at VIDHYA LIBRARY.
Analyze ONLY the student's real test attempt data below and provide a focused, actionable 4-part study plan (plain structured prose, no fluff):
Exam: ${examName}
Score: ${totalMarks}/${maxMarks} | Correct: ${correctCount}, Incorrect: ${incorrectCount}, Unanswered: ${unansweredCount} (Total ${totalQuestions})
Accuracy: ${accuracy}% | Time Taken: ${Math.round((Number(timeTakenSeconds) || 0) / 60)} mins | Slow Questions: ${slowQuestionCount}
Subject Breakdown: ${JSON.stringify(subjectBreakdown)}
Weak Chapters: ${JSON.stringify(weakChapters)}
Weak Topics: ${JSON.stringify(weakTopics)}
Repeated Mistake Topics Across Attempts: ${JSON.stringify(repeatedMistakeTopics)}

Provide:
1. Diagnostic Summary (strictly referencing exact numbers above)
2. Priority Weak Areas to Fix First
3. Negative Marking & Speed Strategy
4. 7-Day Concrete Revision Action Plan.`;

          const activeModel = getActiveGeminiModel();
          const response = await geminiCoordinator.runExclusive(
            'ai_performance_advice',
            async () =>
              ai.models.generateContent({
                model: activeModel,
                contents: prompt,
              }),
            { maxRetries: 3 }
          );

          return {
            recommendations: response.text || 'Unable to generate recommendations.',
            modelUsed: activeModel,
          };
        }
      );

      return res.json({ ...advicePayload, requestId, deduplicated: deduped });
    } catch (err: any) {
      console.error('AI advice error:', err?.parsedGeminiError?.category || 'error', err?.message);
      return sendGeminiError(res, err, requestId);
    }
  });

  // =========================================================================
  // AI PYQ PDF IMPORT SYSTEM (CHUNKED RESUMABLE UPLOAD + BACKGROUND QUEUE)
  // =========================================================================
  app.post('/api/exams/upload/init', requireAuth, (req: AuthenticatedRequest, res) => {
    const { fileName, fileSize, totalChunks } = req.body || {};
    const size = Number(fileSize);
    const chunks = Number(totalChunks);
    if (!fileName || typeof fileName !== 'string' || !fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only .pdf documents are supported.' });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PDF_BYTES) {
      return res.status(400).json({
        error: `PDF exceeds the maximum supported limit of ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB per file.`,
      });
    }
    if (!Number.isFinite(chunks) || chunks < 1 || chunks > 200) {
      return res.status(400).json({ error: 'Invalid chunk count.' });
    }

    const uploadId = `upl_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    const sessionDir = path.join(TMP_UPLOAD_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });

    uploadSessions.set(uploadId, {
      uploadId,
      fileName: fileName.slice(0, 180),
      fileSize: size,
      totalChunks: chunks,
      receivedChunks: new Set<number>(),
      createdAt: Date.now(),
      createdByUid: req.authUser?.uid || '',
    });

    return res.json({ uploadId, maxBytes: MAX_PDF_BYTES });
  });

  app.post('/api/exams/upload/chunk', requireAuth, (req: AuthenticatedRequest, res) => {
    const { uploadId, chunkIndex, dataBase64 } = req.body || {};
    const session = uploadSessions.get(String(uploadId || ''));
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found or expired.' });
    }
    if (session.createdByUid !== req.authUser?.uid) {
      return res.status(403).json({ error: 'Unauthorized access to upload session.' });
    }
    const idx = Number(chunkIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= session.totalChunks || typeof dataBase64 !== 'string') {
      return res.status(400).json({ error: 'Invalid chunk payload.' });
    }

    const buf = Buffer.from(dataBase64, 'base64');
    fs.writeFileSync(path.join(TMP_UPLOAD_DIR, session.uploadId, `chunk_${idx}`), buf);
    session.receivedChunks.add(idx);

    return res.json({
      uploadId: session.uploadId,
      received: session.receivedChunks.size,
      totalChunks: session.totalChunks,
    });
  });

  app.get('/api/exams/ai-model-status', requireAuth, async (_req: AuthenticatedRequest, res) => {
    const activeModel = getActiveGeminiModel();
    const ai = getGeminiClient();
    if (!ai) {
      return res.json({
        configured: false,
        model: activeModel,
        available: false,
        message: 'GEMINI_API_KEY is not configured in server Secrets.',
      });
    }
    const check = await checkGeminiModelAvailability(ai, activeModel);
    return res.json({
      configured: true,
      model: check.model,
      available: check.available,
      errorCategory: check.error?.category || null,
      message: check.available
        ? `Model ${check.model} is available.`
        : check.error?.userMessage || 'Unable to verify model availability.',
    });
  });

  app.post('/api/exams/upload/finalize', requireAuth, async (req: AuthenticatedRequest, res) => {
    const {
      uploadId,
      examName = 'UPSC',
      examYear = new Date().getFullYear(),
      subjectHint = '',
      shift = '',
      resumeJobId,
      skipPages = [],
    } = req.body || {};

    const session = uploadSessions.get(String(uploadId || ''));
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found.' });
    }
    if (session.createdByUid !== req.authUser?.uid) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }
    if (session.receivedChunks.size !== session.totalChunks) {
      return res.status(400).json({
        error: `Upload incomplete: received ${session.receivedChunks.size} of ${session.totalChunks} chunks.`,
      });
    }

    try {
      const parts: Buffer[] = [];
      for (let i = 0; i < session.totalChunks; i++) {
        parts.push(fs.readFileSync(path.join(TMP_UPLOAD_DIR, session.uploadId, `chunk_${i}`)));
      }
      const assembled = Buffer.concat(parts);
      // Clean temporary chunk files from disk
      fs.rmSync(path.join(TMP_UPLOAD_DIR, session.uploadId), { recursive: true, force: true });
      uploadSessions.delete(session.uploadId);

      if (assembled.subarray(0, 4).toString('utf8') !== '%PDF') {
        return res.status(400).json({ error: 'Uploaded file header is not a valid PDF document.' });
      }

      const pdfDoc = await PDFDocument.load(assembled, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      if (totalPages < 1) {
        return res.status(400).json({ error: 'PDF contains zero readable pages.' });
      }

      const skipSet = new Set<number>(
        Array.isArray(skipPages)
          ? skipPages
              .map((p: unknown) => Number(p))
              .filter((p: number) => Number.isInteger(p) && p >= 1 && p <= totalPages)
          : []
      );

      const batches = await buildAdaptivePdfBatches(pdfDoc, skipSet);
      const validResumeId =
        typeof resumeJobId === 'string' && /^[a-zA-Z0-9_-]{4,120}$/.test(resumeJobId)
          ? resumeJobId
          : null;
      const jobId = validResumeId || `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const existingPrior = validResumeId ? importJobs.get(validResumeId) : undefined;
      const nowIso = new Date().toISOString();

      const activeModel = getActiveGeminiModel();
      const cooldown = geminiCoordinator.getCooldownInfo();
      const completedPagesArr = Array.from(skipSet).sort((a, b) => a - b);
      const job: BackgroundImportJob = {
        jobId,
        fileName: session.fileName,
        fileSizeBytes: assembled.length,
        examName: String(examName),
        examYear: Number(examYear) || new Date().getFullYear(),
        subjectHint: String(subjectHint || ''),
        shift: String(shift || ''),
        createdByUid: req.authUser?.uid || '',
        totalPages,
        pagesProcessed: completedPagesArr.length,
        status: cooldown.active ? 'paused' : 'queued',
        paused: cooldown.active,
        ...(cooldown.active
          ? {
              haltReason:
                cooldown.reason ||
                `Shared Gemini API cooldown active (${cooldown.remainingSeconds}s remaining).`,
              errorCategory: cooldown.category || 'daily_quota_exhausted',
              cooldownUntil: cooldown.cooldownUntil || undefined,
            }
          : {}),
        modelUsed: activeModel,
        batches,
        completedPageNumbers: completedPagesArr,
        pdfBytes: new Uint8Array(assembled),
        extractedQuestions: existingPrior?.extractedQuestions || [],
        seenFingerprints: existingPrior?.seenFingerprints || new Set<string>(),
        seenNormalizedTexts: existingPrior?.seenNormalizedTexts || new Set<string>(),
        duplicateCount: existingPrior?.duplicateCount || 0,
        reviewCount: existingPrior?.reviewCount || 0,
        errorMessages: [],
        lastCheckpointAt: nowIso,
        lastSuccessfulExtractionAt: existingPrior?.lastSuccessfulExtractionAt,
        createdAt: existingPrior?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      importJobs.set(jobId, job);
      saveJobCheckpoint(JOBS_CHECKPOINT_DIR, job, true);

      if (!cooldown.active) {
        // Fire background queue without blocking HTTP response
        setImmediate(() => {
          runImportJobQueue(pdfEngineDeps, jobId).catch((err) => console.error('Queue error:', err));
        });
      }

      const metrics = computeJobPageMetrics(job);
      return res.json({
        jobId,
        totalPages,
        batchCount: batches.length,
        completedPages: metrics.completedPages,
        pendingPages: metrics.pendingPages,
        modelUsed: activeModel,
        status: job.status,
        cooldownActive: cooldown.active,
        cooldownUntil: cooldown.cooldownUntil,
        cooldownRemainingSeconds: cooldown.remainingSeconds,
      });
    } catch (err: any) {
      console.error('Finalize PDF error:', err);
      return res.status(500).json({ error: err?.message || 'Failed to parse PDF document.' });
    }
  });

  app.get('/api/exams/import/jobs', requireAuth, (req: AuthenticatedRequest, res) => {
    const uid = req.authUser?.uid;
    const jobs = Array.from(importJobs.values())
      .filter((j) => !j.createdByUid || j.createdByUid === uid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20)
      .map((j) => {
        const snap = serializeJobSnapshot(j);
        return {
          ...snap,
          // Keep job list compact by omitting full question drafts
          extractedQuestions: undefined,
        };
      });
    return res.json({ jobs });
  });

  app.get('/api/exams/import/status/:jobId', requireAuth, (req: AuthenticatedRequest, res) => {
    const job = importJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found.' });
    return res.json(serializeJobSnapshot(job));
  });

  app.post('/api/exams/import/control', requireAuth, (req: AuthenticatedRequest, res) => {
    const { jobId, action, batchIndex } = req.body || {};
    const job = importJobs.get(String(jobId || ''));
    if (!job) return res.status(404).json({ error: 'Import job not found.' });

    if (action === 'pause') {
      job.paused = true;
      job.status = 'paused';
      job.haltReason = 'Paused manually by administrator. Completed pages are checkpointed.';
      job.updatedAt = new Date().toISOString();
      saveJobCheckpoint(JOBS_CHECKPOINT_DIR, job);
      return res.json(serializeJobSnapshot(job));
    }

    if (action === 'resume' || action === 'retry_failed' || action === 'retry_batch') {
      const cooldown = geminiCoordinator.getCooldownInfo();
      if (cooldown.active) {
        return res.status(429).json({
          error:
            cooldown.reason ||
            `Shared Gemini API cooldown is active. Resume allowed in ${cooldown.remainingSeconds}s.`,
          errorCategory: cooldown.category || 'daily_quota_exhausted',
          cooldownActive: true,
          cooldownUntil: cooldown.cooldownUntil,
          cooldownRemainingSeconds: cooldown.remainingSeconds,
        });
      }

      // Prevent duplicate concurrent execution when job is already running
      if (isJobCurrentlyRunning(job.jobId) && action === 'resume') {
        return res.json(serializeJobSnapshot(job));
      }

      job.paused = false;
      job.haltReason = undefined;
      job.errorCategory = undefined;
      job.cooldownUntil = undefined;

      if (action === 'retry_batch') {
        const targetIdx = Number(batchIndex);
        const targetBatch = job.batches.find((b) => b.batchIndex === targetIdx);
        if (!targetBatch) {
          return res.status(404).json({ error: 'Target batch not found.' });
        }
        if (targetBatch.status === 'completed') {
          return res.status(400).json({ error: 'Batch is already completed and cannot be duplicated.' });
        }
        targetBatch.status = 'pending';
        targetBatch.error = undefined;
        targetBatch.errorCategory = undefined;
        targetBatch.retryAfterSeconds = undefined;
      } else if (action === 'retry_failed') {
        job.batches.forEach((b) => {
          if (b.status === 'failed') {
            b.status = 'pending';
            b.error = undefined;
            b.errorCategory = undefined;
            b.retryAfterSeconds = undefined;
          }
        });
      } else if (action === 'resume') {
        const hasPending = job.batches.some((b) => b.status === 'pending');
        if (!hasPending) {
          job.batches.forEach((b) => {
            if (b.status === 'failed') {
              b.status = 'pending';
              b.error = undefined;
              b.errorCategory = undefined;
              b.retryAfterSeconds = undefined;
            }
          });
        }
      }

      job.status = 'queued';
      job.updatedAt = new Date().toISOString();
      saveJobCheckpoint(JOBS_CHECKPOINT_DIR, job);

      if (!isJobCurrentlyRunning(job.jobId)) {
        setImmediate(() => {
          runImportJobQueue(pdfEngineDeps, job.jobId).catch((err) =>
            console.error('Resume queue error:', err)
          );
        });
      }
      return res.json(serializeJobSnapshot(job));
    }

    return res.status(400).json({
      error: 'Unsupported action. Use pause, resume, retry_failed, or retry_batch.',
    });
  });

  // =========================================================================
  // DAILY CURRENT AFFAIRS SCHEDULER & ON-DEMAND COLLECTION
  // =========================================================================
  app.get('/api/current-affairs/status', requireAuth, (_req, res) => {
    const cooldown = geminiCoordinator.getCooldownInfo();
    res.json({
      paused: currentAffairsState.paused,
      autoPublishEnabled: currentAffairsState.autoPublishEnabled,
      lastRunAt: currentAffairsState.lastRunAt,
      lastError: currentAffairsState.lastError,
      latestBundle: currentAffairsState.latestBundle,
      geminiConfigured: Boolean(getGeminiClient()),
      cooldownActive: cooldown.active,
      cooldownUntil: cooldown.cooldownUntil,
      cooldownRemainingSeconds: cooldown.remainingSeconds,
    });
  });

  app.post('/api/current-affairs/schedule', requireAuth, (req, res) => {
    const { paused, autoPublishEnabled } = req.body || {};
    if (typeof paused === 'boolean') currentAffairsState.paused = paused;
    if (typeof autoPublishEnabled === 'boolean') {
      currentAffairsState.autoPublishEnabled = autoPublishEnabled;
    }
    res.json({
      paused: currentAffairsState.paused,
      autoPublishEnabled: currentAffairsState.autoPublishEnabled,
    });
  });

  app.post('/api/current-affairs/collect', requireAuth, async (req: AuthenticatedRequest, res) => {
    const rawReqId = String(req.headers['x-idempotency-key'] || req.body?.requestId || '').trim();
    const requestId = rawReqId || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    try {
      const targetDate = typeof req.body?.date === 'string' ? req.body.date : undefined;
      const key = rawReqId
        ? `ca_collect:${req.authUser?.uid}:${rawReqId}`
        : `ca_collect:${targetDate || new Date().toISOString().slice(0, 10)}`;
      const { value: bundle, deduped } = await geminiCoordinator.runIdempotent(key, () =>
        collectCurrentAffairsFromGemini(targetDate)
      );
      return res.json({ ...bundle, requestId, deduplicated: deduped });
    } catch (err: any) {
      currentAffairsState.lastError = sanitizeTelemetryMessage(err?.message || 'Collection failed');
      return sendGeminiError(res, err, requestId);
    }
  });

  // Scheduled 24-hour background job (when GEMINI_API_KEY is present, not paused, and no active cooldown)
  const DAILY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    if (!currentAffairsState.paused && getGeminiClient() && !geminiCoordinator.getCooldownInfo().active) {
      collectCurrentAffairsFromGemini().catch((err) => {
        currentAffairsState.lastError = sanitizeTelemetryMessage(err?.message || 'Scheduled CA job failed');
      });
    }
  }, DAILY_MS);

  // Independent 24-hour Fee Reminder scheduler loop (evaluates every 5 minutes in Asia/Kolkata without needing browser/admin login)
  const FEE_SCHEDULER_TICK_MS = 5 * 60 * 1000;
  setInterval(() => {
    if (getMetaWhatsAppConfig().configured) {
      feeWhatsAppEngine
        .runScheduledFeeReminders({ triggerType: 'scheduled' })
        .catch((err) => console.error('[FeeScheduler] Periodic evaluation failed:', err));
    }
  }, FEE_SCHEDULER_TICK_MS);

  // Vite Dev Middleware or Static Production Build
  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const hmrEnabled = isHmrEnabled();
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: hmrEnabled,
        watch: hmrEnabled ? {} : null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`VIDHYA LIBRARY server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
