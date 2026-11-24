import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import {
  GeminiErrorCategory,
  GeminiRequestCoordinator,
  ParsedGeminiError,
  getActiveGeminiModel,
  parseGeminiApiError,
} from './geminiResilience.ts';

export const MAX_PAGES_PER_BATCH = 8;
export const MAX_BATCH_PDF_BYTES = 3_500_000; // ~3.5 MB raw PDF (~4.7 MB base64) per Gemini request

export interface ExtractedDraftQuestion {
  tempId: string;
  batchIndex: number;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  answerSeal: string;
  verificationStatus: 'verified' | 'ai_derived' | 'needs_review';
  derivedBy: 'official_key' | 'ai_derived';
  examName: string;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  language: 'en' | 'hi' | 'bilingual';
  examYear: number;
  examShift: string;
  hasDiagramOrTable: boolean;
  diagramDescription: string;
  fingerprint: string;
  normalizedText: string;
  pageRange: string;
}

export interface BatchExtractionState {
  batchIndex: number;
  startPage: number;
  endPage: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  errorCategory?: GeminiErrorCategory;
  retryAfterSeconds?: number;
  attemptCount?: number;
  byteSize?: number;
  extractedCount?: number;
}

export interface BackgroundImportJob {
  jobId: string;
  fileName: string;
  fileSizeBytes: number;
  examName: string;
  examYear: number;
  subjectHint: string;
  shift: string;
  createdByUid: string;
  totalPages: number;
  pagesProcessed: number;
  status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
  paused: boolean;
  haltReason?: string;
  errorCategory?: GeminiErrorCategory;
  modelUsed: string;
  batches: BatchExtractionState[];
  completedPageNumbers: number[];
  pdfBytes: Uint8Array;
  extractedQuestions: ExtractedDraftQuestion[];
  seenFingerprints: Set<string>;
  seenNormalizedTexts: Set<string>;
  duplicateCount: number;
  reviewCount: number;
  errorMessages: string[];
  lastCheckpointAt: string;
  lastSuccessfulExtractionAt?: string;
  cooldownUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EngineDeps {
  jobsDir: string;
  importJobs: Map<string, BackgroundImportJob>;
  coordinator: GeminiRequestCoordinator;
  getGeminiClient: () => GoogleGenAI | null;
  sealAnswer: (payload: { qId: string; correctIndex: number; explanation: string }) => string;
  normalizeQuestionText: (text: string) => string;
  computeQuestionFingerprint: (questionText: string, options: string[]) => string;
}

const activeRunningJobs = new Set<string>();

export function isJobCurrentlyRunning(jobId: string): boolean {
  return activeRunningJobs.has(jobId);
}

export function computeJobPageMetrics(job: BackgroundImportJob) {
  let completedPages = 0;
  let failedPages = 0;
  let pendingPages = 0;

  for (const b of job.batches) {
    const span = Math.max(0, b.endPage - b.startPage + 1);
    if (b.status === 'completed') {
      completedPages += span;
    } else if (b.status === 'failed') {
      failedPages += span;
    } else {
      pendingPages += span;
    }
  }

  return {
    totalPages: job.totalPages,
    completedPages: Math.min(job.totalPages, completedPages),
    failedPages: Math.min(job.totalPages, failedPages),
    pendingPages: Math.min(job.totalPages, pendingPages),
  };
}

export function serializeJobSnapshot(job: BackgroundImportJob) {
  const metrics = computeJobPageMetrics(job);
  return {
    jobId: job.jobId,
    fileName: job.fileName,
    examName: job.examName,
    examYear: job.examYear,
    subjectHint: job.subjectHint,
    shift: job.shift,
    totalPages: job.totalPages,
    pagesProcessed: metrics.completedPages,
    completedPages: metrics.completedPages,
    failedPages: metrics.failedPages,
    pendingPages: metrics.pendingPages,
    status: job.status,
    paused: job.paused,
    haltReason: job.haltReason || '',
    errorCategory: job.errorCategory || null,
    modelUsed: job.modelUsed,
    batches: job.batches,
    extractedCount: job.extractedQuestions.length,
    duplicateCount: job.duplicateCount,
    reviewCount: job.reviewCount,
    errorMessages: job.errorMessages.slice(-25),
    extractedQuestions: job.extractedQuestions,
    lastCheckpointAt: job.lastCheckpointAt,
    lastSuccessfulExtractionAt: job.lastSuccessfulExtractionAt || null,
    cooldownUntil: job.cooldownUntil || null,
    updatedAt: job.updatedAt,
  };
}

export function saveJobCheckpoint(jobsDir: string, job: BackgroundImportJob, writePdf = false): void {
  try {
    const jobDir = path.join(jobsDir, job.jobId);
    if (!fs.existsSync(jobDir)) {
      fs.mkdirSync(jobDir, { recursive: true });
    }
    if (writePdf) {
      const pdfPath = path.join(jobDir, 'source.pdf');
      if (!fs.existsSync(pdfPath) && job.pdfBytes.length > 0) {
        fs.writeFileSync(pdfPath, Buffer.from(job.pdfBytes));
      }
    }

    const now = new Date().toISOString();
    job.lastCheckpointAt = now;
    const serializable = {
      jobId: job.jobId,
      fileName: job.fileName,
      fileSizeBytes: job.fileSizeBytes,
      examName: job.examName,
      examYear: job.examYear,
      subjectHint: job.subjectHint,
      shift: job.shift,
      createdByUid: job.createdByUid,
      totalPages: job.totalPages,
      pagesProcessed: job.pagesProcessed,
      status: job.status,
      paused: job.paused,
      haltReason: job.haltReason,
      errorCategory: job.errorCategory,
      modelUsed: job.modelUsed,
      batches: job.batches,
      completedPageNumbers: job.completedPageNumbers,
      extractedQuestions: job.extractedQuestions,
      seenFingerprints: Array.from(job.seenFingerprints),
      seenNormalizedTexts: Array.from(job.seenNormalizedTexts),
      duplicateCount: job.duplicateCount,
      reviewCount: job.reviewCount,
      errorMessages: job.errorMessages,
      lastCheckpointAt: job.lastCheckpointAt,
      lastSuccessfulExtractionAt: job.lastSuccessfulExtractionAt,
      cooldownUntil: job.cooldownUntil,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };

    const checkpointPath = path.join(jobDir, 'checkpoint.json');
    const tmpPath = path.join(jobDir, 'checkpoint.json.tmp');
    fs.writeFileSync(tmpPath, JSON.stringify(serializable), 'utf8');
    fs.renameSync(tmpPath, checkpointPath);
  } catch (err) {
    console.error(`[PDFCheckpoint] Failed to persist checkpoint for ${job.jobId}:`, err);
  }
}

export function loadPersistedImportJobs(
  jobsDir: string,
  importJobs: Map<string, BackgroundImportJob>
): number {
  if (!fs.existsSync(jobsDir)) return 0;
  let restored = 0;

  const entries = fs.readdirSync(jobsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobDir = path.join(jobsDir, entry.name);
    const checkpointPath = path.join(jobDir, 'checkpoint.json');
    const pdfPath = path.join(jobDir, 'source.pdf');
    if (!fs.existsSync(checkpointPath) || !fs.existsSync(pdfPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
      const batches: BatchExtractionState[] = Array.isArray(raw.batches)
        ? raw.batches.map((b: BatchExtractionState) => ({
            ...b,
            status: b.status === 'processing' ? 'pending' : b.status,
          }))
        : [];

      const wasMidFlight = raw.status === 'processing' || raw.status === 'queued';
      const job: BackgroundImportJob = {
        jobId: String(raw.jobId),
        fileName: String(raw.fileName || 'document.pdf'),
        fileSizeBytes: Number(raw.fileSizeBytes || pdfBytes.length),
        examName: String(raw.examName || 'Competitive Exam'),
        examYear: Number(raw.examYear || new Date().getFullYear()),
        subjectHint: String(raw.subjectHint || ''),
        shift: String(raw.shift || ''),
        createdByUid: String(raw.createdByUid || ''),
        totalPages: Number(raw.totalPages || 1),
        pagesProcessed: Number(raw.pagesProcessed || 0),
        status: wasMidFlight ? 'paused' : raw.status || 'paused',
        paused: wasMidFlight ? true : Boolean(raw.paused),
        haltReason: wasMidFlight
          ? 'Server restarted while extraction was in progress. Completed pages were checkpointed — click Resume to continue.'
          : raw.haltReason,
        errorCategory: raw.errorCategory,
        modelUsed: String(raw.modelUsed || getActiveGeminiModel()),
        batches,
        completedPageNumbers: Array.isArray(raw.completedPageNumbers) ? raw.completedPageNumbers : [],
        pdfBytes,
        extractedQuestions: Array.isArray(raw.extractedQuestions) ? raw.extractedQuestions : [],
        seenFingerprints: new Set(Array.isArray(raw.seenFingerprints) ? raw.seenFingerprints : []),
        seenNormalizedTexts: new Set(Array.isArray(raw.seenNormalizedTexts) ? raw.seenNormalizedTexts : []),
        duplicateCount: Number(raw.duplicateCount || 0),
        reviewCount: Number(raw.reviewCount || 0),
        errorMessages: Array.isArray(raw.errorMessages) ? raw.errorMessages : [],
        lastCheckpointAt: String(raw.lastCheckpointAt || new Date().toISOString()),
        lastSuccessfulExtractionAt: raw.lastSuccessfulExtractionAt ? String(raw.lastSuccessfulExtractionAt) : undefined,
        cooldownUntil: raw.cooldownUntil ? String(raw.cooldownUntil) : undefined,
        createdAt: String(raw.createdAt || new Date().toISOString()),
        updatedAt: String(raw.updatedAt || new Date().toISOString()),
      };

      importJobs.set(job.jobId, job);
      restored += 1;
    } catch (err) {
      console.warn(`[PDFCheckpoint] Failed to restore job from ${jobDir}:`, err);
    }
  }

  return restored;
}

export async function buildAdaptivePdfBatches(
  pdfDoc: PDFDocument,
  skipPages: Set<number> = new Set(),
  maxPagesPerBatch: number = MAX_PAGES_PER_BATCH,
  maxBytesPerBatch: number = MAX_BATCH_PDF_BYTES
): Promise<BatchExtractionState[]> {
  const totalPages = pdfDoc.getPageCount();
  const batches: BatchExtractionState[] = [];
  let bIdx = 0;
  let page = 1;

  while (page <= totalPages) {
    // Group contiguous skipped (already-completed) pages so checkpoint UI stays clean
    if (skipPages.has(page)) {
      const skipStart = page;
      while (page <= totalPages && skipPages.has(page) && page - skipStart + 1 < maxPagesPerBatch) {
        page += 1;
      }
      const skipEnd = page - 1;
      batches.push({
        batchIndex: bIdx++,
        startPage: skipStart,
        endPage: skipEnd,
        status: 'completed',
      });
      continue;
    }

    // Greedily pack up to maxPagesPerBatch unskipped pages without exceeding maxBytesPerBatch
    let windowEnd = page;
    while (
      windowEnd + 1 <= totalPages &&
      !skipPages.has(windowEnd + 1) &&
      windowEnd + 1 - page + 1 <= maxPagesPerBatch
    ) {
      windowEnd += 1;
    }

    let chosenEnd = windowEnd;
    let chosenBytes = 0;

    while (chosenEnd >= page) {
      const subDoc = await PDFDocument.create();
      const indices: number[] = [];
      for (let p = page - 1; p < chosenEnd; p++) {
        indices.push(p);
      }
      const copied = await subDoc.copyPages(pdfDoc, indices);
      copied.forEach((cp) => subDoc.addPage(cp));
      const subBytes = await subDoc.save();
      chosenBytes = subBytes.length;

      if (chosenBytes <= maxBytesPerBatch || chosenEnd === page) {
        break;
      }
      // Shrink batch size cleanly if scanned page images push sub-PDF above byte threshold
      const step = Math.max(1, Math.floor((chosenEnd - page + 1) / 2));
      chosenEnd = Math.max(page, chosenEnd - step);
    }

    batches.push({
      batchIndex: bIdx++,
      startPage: page,
      endPage: chosenEnd,
      status: 'pending',
      byteSize: chosenBytes,
    });
    page = chosenEnd + 1;
  }

  return batches;
}

async function extractBatchWithGemini(
  deps: EngineDeps,
  job: BackgroundImportJob,
  batch: BatchExtractionState
): Promise<number> {
  const ai = deps.getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server secrets.');
  }

  const fullDoc = await PDFDocument.load(job.pdfBytes, { ignoreEncryption: true });
  const subDoc = await PDFDocument.create();
  const pageIndices: number[] = [];
  for (let p = batch.startPage - 1; p < batch.endPage && p < fullDoc.getPageCount(); p++) {
    pageIndices.push(p);
  }
  const copied = await subDoc.copyPages(fullDoc, pageIndices);
  copied.forEach((p) => subDoc.addPage(p));
  const subBytes = await subDoc.save();
  batch.byteSize = subBytes.length;
  const base64Pdf = Buffer.from(subBytes).toString('base64');

  const prompt = `You are an expert competitive examination question parser for Indian exams (${job.examName}, Year ${job.examYear}).
Extract ALL 4-option Multiple Choice Questions (MCQs) visible across PDF pages ${batch.startPage}-${batch.endPage}, performing full OCR if scanned or image-based.
Rules:
1. Preserve exact Hindi, English, or Bilingual text accurately. Preserve math/scientific symbols using clean Unicode or inline notation (e.g., H₂SO₄, x², √2, ∫).
2. If a question references a diagram, graph, or table, set hasDiagramOrTable=true and describe the diagram/table clearly in diagramDescription so students have context.
3. Categorize each question's subject (hint: ${job.subjectHint || 'Auto-detect'}), chapter, topic, and difficulty (easy/medium/hard).
4. Check if an official answer key appears on these pages. If found, set derivedByOfficialKey=true and verificationStatus='verified'. If no official answer key appears here, derive the most accurate answer yourself, set derivedByOfficialKey=false, verificationStatus='ai_derived' (or 'needs_review' if ambiguous), and provide a concise step-by-step explanation.
5. Do not invent questions not present on these pages. Always provide exactly 4 options. Ignore blank instruction/cover pages.`;

  const activeModel = getActiveGeminiModel();
  job.modelUsed = activeModel;

  const response = await deps.coordinator.runExclusive(
    `pdf_job=${job.jobId} pages=${batch.startPage}-${batch.endPage}`,
    async () => {
      batch.attemptCount = (batch.attemptCount || 0) + 1;
      return await ai.models.generateContent({
        model: activeModel,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
              { text: prompt },
            ],
          },
        ],
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
                    optionA: { type: Type.STRING },
                    optionB: { type: Type.STRING },
                    optionC: { type: Type.STRING },
                    optionD: { type: Type.STRING },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                    derivedByOfficialKey: { type: Type.BOOLEAN },
                    needsReview: { type: Type.BOOLEAN },
                    subject: { type: Type.STRING },
                    chapter: { type: Type.STRING },
                    topic: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                    language: { type: Type.STRING },
                    hasDiagramOrTable: { type: Type.BOOLEAN },
                    diagramDescription: { type: Type.STRING },
                  },
                  required: ['questionText', 'optionA', 'optionB', 'optionC', 'optionD', 'correctIndex'],
                },
              },
            },
            required: ['questions'],
          },
        },
      });
    },
    {
      maxRetries: 4,
      shouldAbort: () => job.paused,
      onRetry: (retryLog) => {
        batch.error = `Retrying (${retryLog.attempt}/${retryLog.maxRetries}) in ${Math.ceil(retryLog.delayMs / 1000)}s: ${retryLog.category}`;
        batch.errorCategory = retryLog.category;
        job.updatedAt = new Date().toISOString();
        saveJobCheckpoint(deps.jobsDir, job);
      },
    }
  );

  const parsed = JSON.parse(response.text || '{"questions":[]}');
  const items = Array.isArray(parsed.questions) ? parsed.questions : [];
  let addedInBatch = 0;

  for (const item of items) {
    const qText = String(item.questionText || '').trim();
    const opts: [string, string, string, string] = [
      String(item.optionA || '').trim(),
      String(item.optionB || '').trim(),
      String(item.optionC || '').trim(),
      String(item.optionD || '').trim(),
    ];
    if (!qText || opts.some((o) => !o)) continue;

    const normalizedText = deps.normalizeQuestionText(qText);
    const fingerprint = deps.computeQuestionFingerprint(qText, opts);
    if (job.seenFingerprints.has(fingerprint) || job.seenNormalizedTexts.has(normalizedText)) {
      job.duplicateCount += 1;
      continue;
    }
    job.seenFingerprints.add(fingerprint);
    job.seenNormalizedTexts.add(normalizedText);

    const safeIdx = Math.min(3, Math.max(0, Number(item.correctIndex) || 0));
    const verificationStatus: 'verified' | 'ai_derived' | 'needs_review' = item.needsReview
      ? 'needs_review'
      : item.derivedByOfficialKey
        ? 'verified'
        : 'ai_derived';
    if (verificationStatus !== 'verified') {
      job.reviewCount += 1;
    }

    const tempId = `q_fp_${fingerprint}`;
    const explanation = String(item.explanation || 'Explanation generated during PYQ import.').trim();
    const diffRaw = String(item.difficulty || 'medium').toLowerCase();
    const difficulty: 'easy' | 'medium' | 'hard' =
      diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'medium';
    const langRaw = String(item.language || 'en').toLowerCase();
    const language: 'en' | 'hi' | 'bilingual' =
      langRaw === 'hi' || langRaw === 'bilingual' ? langRaw : 'en';

    job.extractedQuestions.push({
      tempId,
      batchIndex: batch.batchIndex,
      questionText: qText,
      options: opts,
      correctIndex: safeIdx,
      explanation,
      answerSeal: deps.sealAnswer({ qId: tempId, correctIndex: safeIdx, explanation }),
      verificationStatus,
      derivedBy: item.derivedByOfficialKey ? 'official_key' : 'ai_derived',
      examName: job.examName,
      subject: String(item.subject || job.subjectHint || 'General Studies').trim(),
      chapter: String(item.chapter || 'Mixed PYQ').trim(),
      topic: String(item.topic || 'Core Concepts').trim(),
      difficulty,
      language,
      examYear: job.examYear,
      examShift: job.shift || '',
      hasDiagramOrTable: Boolean(item.hasDiagramOrTable),
      diagramDescription: String(item.diagramDescription || '').trim(),
      fingerprint,
      normalizedText,
      pageRange: `${batch.startPage}-${batch.endPage}`,
    });
    addedInBatch += 1;
  }

  return addedInBatch;
}

function shouldHaltQueueOnError(category: GeminiErrorCategory): boolean {
  return (
    category === 'daily_quota_exhausted' ||
    category === 'rate_limit_429' ||
    category === 'model_unavailable_503' ||
    category === 'transient_server_error' ||
    category === 'billing_restricted' ||
    category === 'auth_config_error' ||
    category === 'model_not_found'
  );
}

export async function runImportJobQueue(deps: EngineDeps, jobId: string): Promise<void> {
  if (activeRunningJobs.has(jobId)) {
    return;
  }
  const job = deps.importJobs.get(jobId);
  if (!job) return;

  if (job.paused) {
    job.status = 'paused';
    job.updatedAt = new Date().toISOString();
    saveJobCheckpoint(deps.jobsDir, job);
    return;
  }

  activeRunningJobs.add(jobId);
  try {
    const preCooldown = deps.coordinator.getCooldownInfo();
    if (preCooldown.active) {
      job.paused = true;
      job.status = 'paused';
      job.haltReason =
        preCooldown.reason ||
        `Shared Gemini API cooldown active (${preCooldown.remainingSeconds}s remaining).`;
      job.errorCategory = preCooldown.category || 'daily_quota_exhausted';
      job.cooldownUntil = preCooldown.cooldownUntil || undefined;
      job.updatedAt = new Date().toISOString();
      saveJobCheckpoint(deps.jobsDir, job);
      return;
    }

    job.status = 'processing';
    job.haltReason = undefined;
    job.errorCategory = undefined;
    job.cooldownUntil = undefined;
    job.modelUsed = getActiveGeminiModel();
    job.updatedAt = new Date().toISOString();
    saveJobCheckpoint(deps.jobsDir, job);

    for (let idx = 0; idx < job.batches.length; idx++) {
      const batch = job.batches[idx];
      if (job.paused) {
        job.status = 'paused';
        job.updatedAt = new Date().toISOString();
        saveJobCheckpoint(deps.jobsDir, job);
        return;
      }

      if (batch.status !== 'pending') continue;

      const loopCooldown = deps.coordinator.getCooldownInfo();
      if (loopCooldown.active) {
        job.paused = true;
        job.status = 'paused';
        job.haltReason =
          loopCooldown.reason ||
          `Shared Gemini API cooldown active (${loopCooldown.remainingSeconds}s remaining).`;
        job.errorCategory = loopCooldown.category || 'daily_quota_exhausted';
        job.cooldownUntil = loopCooldown.cooldownUntil || undefined;
        job.updatedAt = new Date().toISOString();
        saveJobCheckpoint(deps.jobsDir, job);
        return;
      }

      // Double-check against completedPageNumbers to prevent duplicate page processing
      const allBatchPagesDone = Array.from(
        { length: batch.endPage - batch.startPage + 1 },
        (_, k) => batch.startPage + k
      ).every((p) => job.completedPageNumbers.includes(p));

      if (allBatchPagesDone) {
        batch.status = 'completed';
        batch.error = undefined;
        saveJobCheckpoint(deps.jobsDir, job);
        continue;
      }

      batch.status = 'processing';
      batch.error = undefined;
      batch.errorCategory = undefined;
      batch.retryAfterSeconds = undefined;
      job.updatedAt = new Date().toISOString();

      try {
        console.info(
          `[PDFImport] Processing job=${job.jobId} batch=${batch.batchIndex} pages=${batch.startPage}-${batch.endPage}`
        );
        const extractedCount = await extractBatchWithGemini(deps, job, batch);
        batch.status = 'completed';
        batch.error = undefined;
        batch.extractedCount = extractedCount;

        const completedSet = new Set(job.completedPageNumbers);
        for (let p = batch.startPage; p <= batch.endPage; p++) {
          completedSet.add(p);
        }
        job.completedPageNumbers = Array.from(completedSet).sort((a, b) => a - b);
        job.pagesProcessed = computeJobPageMetrics(job).completedPages;
        const nowIso = new Date().toISOString();
        job.lastSuccessfulExtractionAt = nowIso;
        job.updatedAt = nowIso;
        saveJobCheckpoint(deps.jobsDir, job);
        console.info(
          `[PDFImport] Completed batch=${batch.batchIndex} (${batch.startPage}-${batch.endPage}), extracted=${extractedCount}, totalCompletedPages=${job.pagesProcessed}/${job.totalPages}`
        );
      } catch (err: any) {
        if (job.paused) {
          // User explicitly paused during execution; keep batch pending rather than failed
          batch.status = 'pending';
          batch.error = undefined;
          job.status = 'paused';
          job.updatedAt = new Date().toISOString();
          saveJobCheckpoint(deps.jobsDir, job);
          return;
        }

        const parsed: ParsedGeminiError = err?.parsedGeminiError || parseGeminiApiError(err);

        // If a multi-page batch exceeded payload/token bounds, split cleanly into 2 smaller batches
        if (parsed.category === 'payload_too_large' && batch.endPage > batch.startPage) {
          const mid = Math.floor((batch.startPage + batch.endPage) / 2);
          const firstHalf: BatchExtractionState = {
            batchIndex: batch.batchIndex,
            startPage: batch.startPage,
            endPage: mid,
            status: 'pending',
          };
          const secondHalf: BatchExtractionState = {
            batchIndex: batch.batchIndex + 1,
            startPage: mid + 1,
            endPage: batch.endPage,
            status: 'pending',
          };
          job.batches.splice(idx, 1, firstHalf, secondHalf);
          job.batches.forEach((b, bPos) => {
            b.batchIndex = bPos;
          });
          job.updatedAt = new Date().toISOString();
          saveJobCheckpoint(deps.jobsDir, job);
          idx -= 1; // re-evaluate split first half immediately
          continue;
        }

        batch.status = 'failed';
        batch.errorCategory = parsed.category;
        batch.retryAfterSeconds = parsed.retryAfterMs ? Math.ceil(parsed.retryAfterMs / 1000) : undefined;
        const errMsg = `Pages ${batch.startPage}-${batch.endPage}: ${parsed.userMessage}`;
        batch.error = errMsg;
        if (!job.errorMessages.includes(errMsg)) {
          job.errorMessages.push(errMsg);
        }
        job.updatedAt = new Date().toISOString();

        const cooldownNow = deps.coordinator.getCooldownInfo();
        if (shouldHaltQueueOnError(parsed.category) || cooldownNow.active) {
          job.paused = true;
          job.status = 'paused';
          job.haltReason = parsed.userMessage;
          job.errorCategory = parsed.category;
          job.cooldownUntil = cooldownNow.cooldownUntil || err?.cooldownUntil || undefined;
          saveJobCheckpoint(deps.jobsDir, job);
          console.warn(
            `[PDFImport] Halted job=${job.jobId} at pages=${batch.startPage}-${batch.endPage} due to ${parsed.category}. Remaining pending batches preserved.`
          );
          return;
        }

        saveJobCheckpoint(deps.jobsDir, job);
      }
    }

    const anyFailed = job.batches.some((b) => b.status === 'failed');
    const anyPending = job.batches.some((b) => b.status === 'pending' || b.status === 'processing');
    if (anyPending) {
      job.status = 'paused';
    } else if (anyFailed) {
      job.status = job.completedPageNumbers.length === 0 ? 'failed' : 'paused';
      if (!job.haltReason) {
        job.haltReason = 'Some page batches failed. Completed pages are saved — use Retry Failed Pages.';
      }
    } else {
      job.status = 'completed';
    }
    job.updatedAt = new Date().toISOString();
    saveJobCheckpoint(deps.jobsDir, job);
  } finally {
    activeRunningJobs.delete(jobId);
  }
}
