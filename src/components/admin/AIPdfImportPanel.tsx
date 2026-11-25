import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  FileUp,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Upload,
} from 'lucide-react';
import { ExamCategory, ExamQuestion, ImportJobRecord } from '../../types/library';
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, logAuditEvent, markFirestoreConnected } from '../../lib/firebase';
import {
  fetchServerAiStatus,
  formatCooldownRemaining,
  readStoredAiCooldown,
  saveStoredAiCooldown,
  SharedAiCooldownState,
} from '../../lib/aiClient';

interface AIPdfImportPanelProps {
  exams: ExamCategory[];
  existingQuestions: ExamQuestion[];
  actorUid: string;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

const CHUNK_BYTES = 512 * 1024; // 512 KB resumable chunks
const MAX_PDF_MB = 25;

type GeminiErrorCategory =
  | 'daily_quota_exhausted'
  | 'rate_limit_429'
  | 'model_unavailable_503'
  | 'transient_server_error'
  | 'billing_restricted'
  | 'payload_too_large'
  | 'model_not_found'
  | 'auth_config_error'
  | 'unknown';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(' ').filter((w) => w.length > 2));
  const setB = new Set(b.split(' ').filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((w) => {
    if (setB.has(w)) intersection += 1;
  });
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function parsePageRangeNumbers(range: string): number[] {
  const match = String(range || '').match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];
  const pages: number[] = [];
  for (let p = start; p <= end && pages.length < 1000; p++) {
    pages.push(p);
  }
  return pages;
}

interface ExtractedDraft {
  tempId: string;
  batchIndex?: number;
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

interface BatchSnapshot {
  batchIndex: number;
  startPage: number;
  endPage: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  errorCategory?: GeminiErrorCategory;
  retryAfterSeconds?: number;
  attemptCount?: number;
  extractedCount?: number;
}

interface JobSnapshot {
  jobId: string;
  fileName: string;
  examName: string;
  examYear: number;
  subjectHint?: string;
  shift?: string;
  totalPages: number;
  pagesProcessed: number;
  completedPages: number;
  failedPages: number;
  pendingPages: number;
  status: 'queued' | 'processing' | 'paused' | 'completed' | 'failed';
  paused: boolean;
  haltReason?: string;
  errorCategory?: GeminiErrorCategory | null;
  modelUsed?: string;
  batches: BatchSnapshot[];
  extractedCount: number;
  duplicateCount: number;
  reviewCount: number;
  errorMessages: string[];
  extractedQuestions: ExtractedDraft[];
  lastCheckpointAt?: string;
  lastSuccessfulExtractionAt?: string | null;
  updatedAt?: string;
}

interface ResumeCheckpointTarget {
  jobId: string;
  fileName: string;
  examName: string;
  examYear: number;
  subject: string;
  shift: string;
  totalPages: number;
  pagesProcessed: number;
  skipPages: number[];
}

export const AIPdfImportPanel: React.FC<AIPdfImportPanelProps> = ({
  exams,
  existingQuestions,
  actorUid,
  getIdToken,
  onNotify,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [examName, setExamName] = useState<string>(exams[0]?.name || 'UPSC');
  const [examYear, setExamYear] = useState<number>(new Date().getFullYear());
  const [subjectHint, setSubjectHint] = useState<string>('');
  const [shift, setShift] = useState<string>('');

  const [uploadingState, setUploadingState] = useState<string>('');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [activeJob, setActiveJob] = useState<JobSnapshot | null>(null);
  const [savedJobs, setSavedJobs] = useState<ImportJobRecord[]>([]);
  const [resumeTarget, setResumeTarget] = useState<ResumeCheckpointTarget | null>(null);
  const [importingToDb, setImportingToDb] = useState(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<SharedAiCooldownState>(() => readStoredAiCooldown());
  const [importSummary, setImportSummary] = useState<{
    imported: number;
    duplicates: number;
    needsReview: number;
  } | null>(null);

  // Track which batches & fingerprints have already been persisted to Firestore
  const syncedBatchesByJobRef = useRef<Map<string, Set<number>>>(new Map());
  const committedFingerprintsRef = useRef<Set<string>>(new Set());
  const committedNormsRef = useRef<string[]>([]);
  const importedCountByJobRef = useRef<Map<string, number>>(new Map());
  const syncLockRef = useRef<boolean>(false);
  const lastStatusByJobRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    committedFingerprintsRef.current = new Set(existingQuestions.map((q) => q.fingerprint));
    committedNormsRef.current = existingQuestions.map((q) => q.normalizedText);
  }, [existingQuestions]);

  useEffect(() => {
    if (exams.length > 0 && !exams.some((e) => e.name === examName)) {
      setExamName(exams[0].name);
    }
  }, [exams]);

  // Subscribe to persisted import_jobs checkpoints in Firestore
  useEffect(() => {
    if (!actorUid) return;
    const q = query(collection(db, 'import_jobs'), orderBy('updatedAt', 'desc'), limit(12));
    const unsub = onSnapshot(
      q,
      (snap) => {
        markFirestoreConnected();
        const list: ImportJobRecord[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ImportJobRecord, 'id'>),
        }));
        setSavedJobs(list);
      },
      (err) => {
        console.warn('Unable to subscribe to import_jobs:', err.message);
      }
    );
    return () => unsub();
  }, [actorUid]);

  // Keep shared Gemini cooldown countdown synchronized with server & sessionStorage
  useEffect(() => {
    if (!actorUid) return;
    let cancelled = false;
    (async () => {
      const token = await getIdToken();
      if (!token || cancelled) return;
      const status = await fetchServerAiStatus(token);
      if (status && !cancelled) setCooldown(status);
    })();
    const tick = setInterval(() => {
      setCooldown(readStoredAiCooldown());
    }, 1000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [actorUid, getIdToken]);

  // On mount, check if server has any active/paused jobs persisted on disk
  useEffect(() => {
    if (!actorUid || activeJob) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        const res = await fetch('/api/exams/import/jobs', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const serverJobs = Array.isArray(data?.jobs) ? data.jobs : [];
        const activeOrPaused = serverJobs.find(
          (j: JobSnapshot) => j.status === 'processing' || j.status === 'queued' || j.status === 'paused'
        );
        if (activeOrPaused && !cancelled) {
          const fullRes = await fetch(`/api/exams/import/status/${activeOrPaused.jobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (fullRes.ok && !cancelled) {
            setActiveJob(await fullRes.json());
          }
        }
      } catch {
        // ignore initial check error
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actorUid]);

  const syncJobToFirestore = useCallback(
    async (snap: JobSnapshot, forceManual = false) => {
      if (syncLockRef.current) return;
      syncLockRef.current = true;
      if (forceManual) setImportingToDb(true);

      try {
        const jobId = snap.jobId;
        let syncedBatches = syncedBatchesByJobRef.current.get(jobId);
        if (!syncedBatches) {
          syncedBatches = new Set<number>();
          syncedBatchesByJobRef.current.set(jobId, syncedBatches);
        }

        const completedBatches = snap.batches.filter((b) => b.status === 'completed');
        const unsyncedCompletedBatches = completedBatches.filter((b) => !syncedBatches!.has(b.batchIndex));

        let newlyImported = 0;
        let clientDuplicates = 0;
        let newlyNeedsReview = 0;

        if (unsyncedCompletedBatches.length > 0 || forceManual) {
          const unsyncedIndices = new Set(unsyncedCompletedBatches.map((b) => b.batchIndex));
          const unsyncedRanges = new Set(
            unsyncedCompletedBatches.map((b) => `${b.startPage}-${b.endPage}`)
          );

          const candidateQuestions = snap.extractedQuestions.filter((q) => {
            if (forceManual) return true;
            if (typeof q.batchIndex === 'number') return unsyncedIndices.has(q.batchIndex);
            return unsyncedRanges.has(q.pageRange);
          });

          const uniqueToWrite: ExtractedDraft[] = [];
          for (const q of candidateQuestions) {
            if (committedFingerprintsRef.current.has(q.fingerprint)) {
              clientDuplicates += 1;
              continue;
            }
            const nearDup = committedNormsRef.current.some(
              (norm) => jaccardSimilarity(norm, q.normalizedText) > 0.85
            );
            if (nearDup) {
              clientDuplicates += 1;
              continue;
            }
            committedFingerprintsRef.current.add(q.fingerprint);
            committedNormsRef.current.push(q.normalizedText);
            uniqueToWrite.push(q);
          }

          for (let i = 0; i < uniqueToWrite.length; i += 200) {
            const chunk = uniqueToWrite.slice(i, i + 200);
            const batch = writeBatch(db);
            chunk.forEach((q) => {
              newlyImported += 1;
              if (q.verificationStatus !== 'verified') newlyNeedsReview += 1;

              const docId = `q_fp_${q.fingerprint}`.slice(0, 128);
              const safeExamName = (q.examName || snap.examName || 'Competitive').trim().slice(0, 100);
              const safeSubject = (q.subject || 'General Studies').trim().slice(0, 100);
              const safeChapter = (q.chapter || 'Mixed PYQ').trim().slice(0, 140);
              const safeTopic = (q.topic || 'Core Concepts').trim().slice(0, 140);
              const safeQText =
                q.questionText.trim().length >= 5
                  ? q.questionText.trim().slice(0, 3000)
                  : `${q.questionText.trim()} (MCQ)`.slice(0, 3000);
              const safeOptions: [string, string, string, string] = [
                (q.options[0] || 'Option A').slice(0, 800),
                (q.options[1] || 'Option B').slice(0, 800),
                (q.options[2] || 'Option C').slice(0, 800),
                (q.options[3] || 'Option D').slice(0, 800),
              ];
              const safeNorm =
                q.normalizedText.trim().length >= 3
                  ? q.normalizedText.trim().slice(0, 3000)
                  : safeQText.toLowerCase().slice(0, 3000);
              const safeYear = Math.min(2040, Math.max(1980, Number(q.examYear) || new Date().getFullYear()));
              const catGroup = (
                exams.find((e) => e.name === safeExamName)?.categoryGroup || 'Competitive'
              ).slice(0, 80);

              batch.set(doc(db, 'questions', docId), {
                questionCode: `Q-PDF-${safeYear}-${q.fingerprint.slice(0, 8)}`,
                examName: safeExamName,
                examCategory: catGroup,
                subject: safeSubject.length >= 2 ? safeSubject : 'General Studies',
                chapter: safeChapter || 'Mixed PYQ',
                topic: safeTopic || 'Core Concepts',
                questionText: safeQText,
                options: safeOptions,
                difficulty: q.difficulty,
                examYear: safeYear,
                examShift: (q.examShift || '').slice(0, 80),
                source: 'pyq',
                sourceDocumentId: `doc_${jobId}`,
                language: q.language,
                verificationStatus: q.verificationStatus,
                published: q.verificationStatus !== 'needs_review',
                usageCount: 0,
                hasDiagramOrTable: Boolean(q.hasDiagramOrTable),
                diagramDescription: (q.diagramDescription || '').slice(0, 1000),
                fingerprint: q.fingerprint,
                normalizedText: safeNorm,
                answerSeal: q.answerSeal,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });

              batch.set(doc(db, 'question_keys', docId), {
                questionId: docId,
                correctIndex: Math.min(3, Math.max(0, Number(q.correctIndex) || 0)),
                explanation: (q.explanation || '').slice(0, 3000),
                derivedBy: q.derivedBy,
                updatedAt: serverTimestamp(),
              });
            });
            await batch.commit();
          }

          unsyncedCompletedBatches.forEach((b) => syncedBatches!.add(b.batchIndex));
        }

        const prevImported = importedCountByJobRef.current.get(jobId) || 0;
        const totalImportedForJob = prevImported + newlyImported;
        importedCountByJobRef.current.set(jobId, totalImportedForJob);

        const prevStatusSnapshot = lastStatusByJobRef.current.get(jobId);
        const signature = `${snap.status}|${snap.completedPages}|${snap.failedPages}|${snap.extractedCount}|${newlyImported}`;

        if (newlyImported > 0 || prevStatusSnapshot !== signature || forceManual) {
          lastStatusByJobRef.current.set(jobId, signature);

          const failedRanges = snap.batches
            .filter((b) => b.status === 'failed')
            .map((b) => `${b.startPage}-${b.endPage}`.slice(0, 40))
            .slice(0, 200);
          const safeErrors = snap.errorMessages
            .map((m) => String(m).slice(0, 400))
            .slice(0, 100);

          await setDoc(
            doc(db, 'import_jobs', jobId),
            {
              pagesProcessed: snap.completedPages,
              failedPageRanges: failedRanges,
              extractedCount: snap.extractedCount,
              importedCount: totalImportedForJob,
              duplicateCount: snap.duplicateCount + clientDuplicates,
              reviewCount: snap.reviewCount,
              errorMessages: safeErrors,
              status: snap.status,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );

          if (snap.status === 'completed' || snap.status === 'failed') {
            await updateDoc(doc(db, 'uploaded_documents', `doc_${jobId}`), {
              status: snap.status === 'completed' ? 'completed' : 'failed',
            }).catch(() => {});
          }
        }

        if (newlyImported > 0 || forceManual) {
          setImportSummary((prev) => ({
            imported: (prev?.imported || 0) + newlyImported,
            duplicates: snap.duplicateCount + clientDuplicates,
            needsReview: Math.max(prev?.needsReview || 0, snap.reviewCount, newlyNeedsReview),
          }));
        }

        if (forceManual) {
          await logAuditEvent(
            'AI_PDF_QUESTIONS_IMPORTED',
            'questions',
            jobId,
            `Synced ${newlyImported} new questions from ${snap.fileName} (${snap.duplicateCount + clientDuplicates} duplicates skipped)`,
            'admin'
          );
          onNotify(
            'ok',
            newlyImported > 0
              ? `Synced ${newlyImported} new unique questions to Question Bank.`
              : 'All completed batch questions are already saved in Firestore.'
          );
        }
      } catch (err: any) {
        console.error('Incremental checkpoint sync error:', err);
        if (forceManual) {
          onNotify('err', err?.message || 'Database checkpoint sync failed.');
        }
      } finally {
        syncLockRef.current = false;
        if (forceManual) setImportingToDb(false);
      }
    },
    [exams, onNotify]
  );

  // Automatically save completed batches & checkpoints into Firestore whenever activeJob updates
  useEffect(() => {
    if (!activeJob) return;
    syncJobToFirestore(activeJob, false);
  }, [
    activeJob?.jobId,
    activeJob?.status,
    activeJob?.completedPages,
    activeJob?.failedPages,
    activeJob?.extractedCount,
    syncJobToFirestore,
  ]);

  // Poll active background job while queued or processing
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'queued' && activeJob.status !== 'processing')) return;
    const timer = setInterval(async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`/api/exams/import/status/${activeJob.jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const snap = (await res.json()) as JobSnapshot;
          setActiveJob(snap);
        }
      } catch {
        // transient poll error ignored
      }
    }, 2200);
    return () => clearInterval(timer);
  }, [activeJob?.jobId, activeJob?.status, getIdToken]);

  const handleUploadAndProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      onNotify('err', 'Select one or more PDF question papers first.');
      return;
    }

    for (const f of selectedFiles) {
      if (f.size > MAX_PDF_MB * 1024 * 1024) {
        onNotify('err', `"${f.name}" exceeds the ${MAX_PDF_MB} MB per-file limit.`);
        return;
      }
    }

    const token = await getIdToken();
    if (!token) {
      onNotify('err', 'Authentication token required.');
      return;
    }

    setImportSummary(null);

    try {
      for (let fIdx = 0; fIdx < selectedFiles.length; fIdx++) {
        const file = selectedFiles[fIdx];
        const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
        setUploadingState(`Uploading ${file.name} (${fIdx + 1}/${selectedFiles.length})...`);
        setUploadProgress(0);

        const initRes = await fetch('/api/exams/upload/init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fileName: file.name,
            fileSize: file.size,
            totalChunks,
          }),
        });
        const initData = await initRes.json();
        if (!initRes.ok) throw new Error(initData.error || 'Upload init failed.');

        const uploadId = initData.uploadId;

        for (let c = 0; c < totalChunks; c++) {
          const slice = file.slice(c * CHUNK_BYTES, Math.min(file.size, (c + 1) * CHUNK_BYTES));
          const buf = await slice.arrayBuffer();
          const b64 = arrayBufferToBase64(buf);

          const cRes = await fetch('/api/exams/upload/chunk', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              uploadId,
              chunkIndex: c,
              dataBase64: b64,
            }),
          });
          if (!cRes.ok) {
            const errC = await cRes.json().catch(() => ({}));
            throw new Error(errC.error || `Chunk ${c + 1} upload failed.`);
          }
          setUploadProgress(Math.round(((c + 1) / totalChunks) * 100));
        }

        const matchingResume =
          resumeTarget && resumeTarget.fileName === file.name ? resumeTarget : null;

        setUploadingState(
          matchingResume
            ? `Resuming from checkpoint (${matchingResume.skipPages.length} saved pages skipped)...`
            : `Initializing adaptive batch OCR queue for ${file.name}...`
        );

        const finRes = await fetch('/api/exams/upload/finalize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uploadId,
            examName,
            examYear,
            subjectHint,
            shift,
            resumeJobId: matchingResume?.jobId,
            skipPages: matchingResume?.skipPages || [],
          }),
        });
        const finData = await finRes.json();
        if (!finRes.ok) throw new Error(finData.error || 'Finalize failed.');

        await setDoc(
          doc(db, 'uploaded_documents', `doc_${finData.jobId}`),
          {
            fileName: file.name,
            fileSizeBytes: file.size,
            totalPages: finData.totalPages,
            examName,
            examYear,
            subject: subjectHint || 'Auto-detect',
            shift,
            uploadedByUid: actorUid,
            status: 'processing',
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        if (!matchingResume) {
          await setDoc(doc(db, 'import_jobs', finData.jobId), {
            documentId: `doc_${finData.jobId}`,
            fileName: file.name,
            examName,
            examYear,
            subject: subjectHint || 'Auto-detect',
            shift,
            totalPages: finData.totalPages,
            pagesProcessed: 0,
            failedPageRanges: [],
            extractedCount: 0,
            importedCount: 0,
            duplicateCount: 0,
            reviewCount: 0,
            errorMessages: [],
            status: 'queued',
            createdByUid: actorUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(doc(db, 'import_jobs', finData.jobId), {
            status: 'queued',
            updatedAt: serverTimestamp(),
          });
          setResumeTarget(null);
        }

        const statusRes = await fetch(`/api/exams/import/status/${finData.jobId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (statusRes.ok) {
          setActiveJob(await statusRes.json());
        }
      }

      setUploadingState('');
      onNotify(
        'ok',
        'PDF queued with adaptive multi-page batching, quota protection, and auto-checkpointing.'
      );
    } catch (err: any) {
      setUploadingState('');
      onNotify('err', err?.message || 'PDF upload failed.');
    }
  };

  const handleJobControl = async (
    action: 'pause' | 'resume' | 'retry_failed' | 'retry_batch',
    batchIndex?: number
  ) => {
    if (!activeJob) return;
    if (action !== 'pause' && cooldown.active) {
      onNotify(
        'err',
        `Shared Gemini API cooldown active (${formatCooldownRemaining(cooldown.remainingSeconds)} remaining). Completed batches remain safely saved.`
      );
      return;
    }
    const token = await getIdToken();
    if (!token) return;
    setControlBusy(action === 'retry_batch' ? `batch_${batchIndex}` : action);
    try {
      const res = await fetch('/api/exams/import/control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId: activeJob.jobId, action, batchIndex }),
      });
      const payload = await res.json();
      if (!res.ok) {
        if (payload?.cooldownActive) {
          setCooldown(
            saveStoredAiCooldown({
              cooldownUntil: payload.cooldownUntil,
              cooldownRemainingSeconds: payload.cooldownRemainingSeconds,
              reason: payload.error,
              category: payload.errorCategory,
            })
          );
        }
        onNotify('err', payload.error || `Failed to ${action} job.`);
        return;
      }
      setActiveJob(payload as JobSnapshot);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to control extraction job.');
    } finally {
      setControlBusy(null);
    }
  };

  const handleOpenSavedJob = async (saved: ImportJobRecord) => {
    const token = await getIdToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/exams/import/status/${saved.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const snap = (await res.json()) as JobSnapshot;
        setResumeTarget(null);
        setActiveJob(snap);
        return;
      }

      // Server disk cache unavailable after restart; compute skipPages from Firestore checkpoint
      const failedSet = new Set<number>();
      (saved.failedPageRanges || []).forEach((range) => {
        parsePageRangeNumbers(range).forEach((p) => failedSet.add(p));
      });
      const skipPages: number[] = [];
      for (let p = 1; p <= saved.pagesProcessed; p++) {
        if (!failedSet.has(p)) skipPages.push(p);
      }

      setExamName(saved.examName);
      setExamYear(saved.examYear);
      setSubjectHint(saved.subject === 'Auto-detect' ? '' : saved.subject || '');
      setShift(saved.shift || '');
      setResumeTarget({
        jobId: saved.id,
        fileName: saved.fileName,
        examName: saved.examName,
        examYear: saved.examYear,
        subject: saved.subject,
        shift: saved.shift || '',
        totalPages: saved.totalPages,
        pagesProcessed: saved.pagesProcessed,
        skipPages,
      });
      onNotify(
        'ok',
        `Checkpoint loaded (${saved.pagesProcessed}/${saved.totalPages} pages saved). Re-select "${saved.fileName}" above to resume remaining pages.`
      );
    } catch {
      onNotify('err', 'Unable to inspect saved extraction job.');
    }
  };

  const renderCategoryAlert = (job: JobSnapshot) => {
    if (!job.haltReason && job.errorMessages.length === 0) return null;

    const category = job.errorCategory;
    let title = 'Extraction Notice';
    let tone = 'bg-error-container border-error/40 text-on-error-container';
    let IconComp = AlertTriangle;
    let guidance = '';

    if (category === 'daily_quota_exhausted') {
      title = 'Daily Gemini Quota Exhausted (429 RESOURCE_EXHAUSTED)';
      tone = 'bg-warning-container border-warning/40 text-on-warning-container';
      IconComp = ShieldAlert;
      guidance =
        'Automatic retries were stopped immediately to avoid wasting quota. Completed batches are saved in Firestore. Wait for daily quota reset or enable billing in Google AI Studio, then click Resume Job.';
    } else if (category === 'billing_restricted') {
      title = 'Gemini API Billing / Permission Restriction';
      tone = 'bg-error-container border-error/40 text-on-error-container';
      IconComp = CreditCard;
      guidance =
        'Check Google Cloud / AI Studio billing and API enablement for your key. Completed pages remain safely checkpointed.';
    } else if (category === 'model_unavailable_503') {
      title = `Temporary High Demand on ${job.modelUsed || 'gemini-2.5-flash'} (503 UNAVAILABLE)`;
      tone = 'bg-warning-container border-warning/40 text-on-warning-container';
      IconComp = Clock;
      guidance =
        'Exponential backoff retries ran and completed pages remain saved. Wait 30–60 seconds and click Retry Failed Pages.';
    } else if (category === 'rate_limit_429') {
      title = 'Short-Term Rate Limit Reached (429)';
      tone = 'bg-warning-container border-warning/40 text-on-warning-container';
      IconComp = Clock;
      guidance =
        'API retry cooldown expired after bounded retries. Click Retry Failed Pages shortly to continue from the checkpoint.';
    }

    return (
      <div className={`p-4 rounded-lg border text-xs space-y-2 ${tone}`}>
        <p className="font-bold flex items-center gap-1.5 text-sm">
          <IconComp className="w-4 h-4 shrink-0" />
          <span>{title}</span>
        </p>
        {job.haltReason && <p className="leading-relaxed">{job.haltReason}</p>}
        {guidance && <p className="opacity-90 leading-relaxed">{guidance}</p>}
        {job.errorMessages.length > 0 && (
          <div className="pt-1 border-t border-current/20 space-y-1">
            {job.errorMessages.slice(-5).map((msg, i) => (
              <p key={i} className="opacity-90">
                · {msg}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const completedPct =
    activeJob && activeJob.totalPages > 0
      ? Math.round((activeJob.completedPages / activeJob.totalPages) * 100)
      : 0;
  const failedPct =
    activeJob && activeJob.totalPages > 0
      ? Math.round((activeJob.failedPages / activeJob.totalPages) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Automated Question Extraction</p>
        <h2 className="font-headline text-2xl font-bold text-on-surface mt-0.5">
          AI PYQ PDF Import System
        </h2>
        <p className="text-xs text-on-surface-variant mt-0.5">
          Adaptive multi-page OCR (up to 8 pages/request), concurrency-safe Gemini quota guard, automatic Firestore checkpoints, and single-batch resume.
        </p>
      </div>

      {cooldown.active && (
        <div className="p-4 rounded-lg bg-warning-container border border-warning/40 text-xs text-on-warning-container flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0 break-words">
            <p className="font-bold text-sm flex items-center gap-1.5">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Shared Gemini API Cooldown Active · Retry in {formatCooldownRemaining(cooldown.remainingSeconds)}</span>
            </p>
            <p>{cooldown.reason || 'Resume & Retry controls are paused until quota cooldown ends.'}</p>
          </div>
        </div>
      )}

      {resumeTarget && (
        <div className="p-4 rounded-lg bg-warning-container border border-warning/40 text-xs text-on-warning-container flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 break-words">
            <p className="font-bold text-sm break-all">
              Resuming Checkpoint: {resumeTarget.fileName} ({resumeTarget.pagesProcessed}/{resumeTarget.totalPages} pages saved)
            </p>
            <p className="opacity-90 mt-0.5">
              Select &quot;{resumeTarget.fileName}&quot; below and click Upload &amp; Start AI Extraction to skip {resumeTarget.skipPages.length} completed pages and process only remaining/failed pages.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setResumeTarget(null)}
            className="px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-primary font-semibold shrink-0"
          >
            Cancel Resume
          </button>
        </div>
      )}

      {/* Explicit Upload Policy & Form */}
      <form
        onSubmit={handleUploadAndProcess}
        className="p-4 sm:p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-5"
      >
        <div className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant text-xs text-on-surface-variant flex flex-wrap items-center justify-between gap-2">
          <span>
            Upload Limits: Max <strong className="text-on-surface">{MAX_PDF_MB} MB</strong> per PDF · 512 KB chunks · Up to 8 pages/batch (auto-sized)
          </span>
          <span className="font-semibold text-secondary">Auto-Checkpoint + Duplicate Guard Active</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Examination</label>
            <select
              value={examName}
              onChange={(e) => setExamName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-sm text-on-surface focus:border-secondary focus:outline-none"
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.name}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Examination Year</label>
            <input
              type="number"
              min={1990}
              max={2035}
              required
              value={examYear}
              onChange={(e) => setExamYear(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-sm text-on-surface tabular-nums focus:border-secondary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Subject (Optional / Auto-detect)</label>
            <input
              type="text"
              value={subjectHint}
              onChange={(e) => setSubjectHint(e.target.value)}
              placeholder="Leave blank to auto-detect"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-sm text-on-surface placeholder-outline focus:border-secondary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Paper / Shift (Optional)</label>
            <input
              type="text"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              placeholder="e.g. Shift 1 · Set A"
              className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-sm text-on-surface placeholder-outline focus:border-secondary focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-on-surface-variant mb-2">
            Select PDF Question Papers (Single or Multiple)
          </label>
          <label className="flex flex-col items-center justify-center p-4 sm:p-6 border-2 border-dashed border-outline-variant rounded-xl bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors text-center">
            <FileUp className="w-8 h-8 text-secondary mb-2" />
            <span className="text-sm font-semibold text-on-surface break-all max-w-full">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} PDF file(s) selected (${selectedFiles.map((f) => f.name).join(', ')})`
                : 'Choose PDF file(s) up to 25 MB each'}
            </span>
            <span className="text-xs text-on-surface-variant mt-1">Text PDFs and Scanned Question Papers supported</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
              className="hidden"
            />
          </label>
        </div>

        {uploadingState && (
          <div className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-on-surface">
              <span className="min-w-0 break-words">{uploadingState}</span>
              <span className="tabular-nums font-bold shrink-0">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-surface-container-highest overflow-hidden">
              <div
                className="h-full bg-secondary transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={Boolean(uploadingState) || selectedFiles.length === 0 || cooldown.active}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary transition-colors disabled:opacity-40 cursor-pointer"
          >
            <Upload className="w-4 h-4 shrink-0" />{' '}
            <span>{resumeTarget ? 'Upload PDF & Resume Checkpoint' : 'Upload & Start AI Extraction'}</span>
          </button>
        </div>
      </form>

      {/* Active Extraction Progress, Counters & Controls */}
      {activeJob && (
        <div className="p-4 sm:p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-outline-variant">
            <div className="min-w-0">
              <p className="text-xs text-on-surface-variant break-words">
                Job ID: <span className="font-mono text-primary break-all">{activeJob.jobId}</span> · {activeJob.examName} ({activeJob.examYear})
                {activeJob.modelUsed ? ` · Model: ${activeJob.modelUsed}` : ''}
                {activeJob.lastSuccessfulExtractionAt
                  ? ` · Last OK Batch: ${new Date(activeJob.lastSuccessfulExtractionAt).toLocaleTimeString('en-IN')}`
                  : ''}
              </p>
              <h3 className="font-headline text-lg font-bold text-on-surface flex flex-wrap items-center gap-2 mt-0.5">
                {activeJob.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-secondary shrink-0" />}
                <span className="break-all">{activeJob.fileName}</span>
                <span className="text-xs uppercase font-mono px-2.5 py-0.5 rounded-full bg-secondary-container text-on-secondary-container shrink-0">
                  {activeJob.status}
                </span>
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeJob.status === 'processing' || activeJob.status === 'queued' ? (
                <button
                  type="button"
                  disabled={controlBusy === 'pause'}
                  onClick={() => handleJobControl('pause')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low"
                >
                  <Pause className="w-3.5 h-3.5" /> Pause Job
                </button>
              ) : activeJob.status === 'paused' || activeJob.pendingPages > 0 ? (
                <button
                  type="button"
                  disabled={controlBusy === 'resume' || cooldown.active}
                  onClick={() => handleJobControl('resume')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {cooldown.active
                    ? `Wait ${formatCooldownRemaining(cooldown.remainingSeconds)}`
                    : 'Resume Pending Pages'}
                </button>
              ) : null}

              {activeJob.batches.some((b) => b.status === 'failed') && (
                <button
                  type="button"
                  disabled={controlBusy === 'retry_failed' || cooldown.active}
                  onClick={() => handleJobControl('retry_failed')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning text-on-warning text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry All Failed Pages
                </button>
              )}

              {activeJob.extractedQuestions.length > 0 && (
                <button
                  type="button"
                  disabled={importingToDb}
                  onClick={() => syncJobToFirestore(activeJob, true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-success text-on-success text-xs font-semibold hover:opacity-90"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {importingToDb
                    ? 'Syncing Checkpoint...'
                    : `Verify & Sync ${activeJob.extractedQuestions.length} Questions`}
                </button>
              )}
            </div>
          </div>

          {/* Multi-segment Extraction Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between text-xs text-on-surface-variant">
              <span>
                Extraction Progress: <strong className="text-on-surface">{completedPct}%</strong> completed
                {activeJob.failedPages > 0 ? ` · ${failedPct}% failed` : ''}
              </span>
              <span className="text-[11px] text-outline">
                Auto-checkpointed to Firestore after every batch
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-surface-container overflow-hidden flex">
              <div
                className="h-full bg-success transition-all"
                style={{ width: `${completedPct}%` }}
              />
              <div
                className="h-full bg-error transition-all"
                style={{ width: `${Math.min(100 - completedPct, failedPct)}%` }}
              />
            </div>
          </div>

          {/* Page & Question Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
            {[
              ['Total Pages', activeJob.totalPages, 'text-on-surface'],
              ['Completed Pages', activeJob.completedPages, 'text-success'],
              ['Failed Pages', activeJob.failedPages, activeJob.failedPages > 0 ? 'text-error' : 'text-on-surface'],
              ['Pending Pages', activeJob.pendingPages, 'text-warning'],
              ['Extracted MCQs', activeJob.extractedCount, 'text-primary'],
              ['Duplicates Skipped', importSummary ? importSummary.duplicates : activeJob.duplicateCount, 'text-on-surface'],
              ['Needs Review', importSummary ? importSummary.needsReview : activeJob.reviewCount, 'text-on-surface'],
            ].map(([label, val, colorCls]) => (
              <div key={String(label)} className="min-w-0 p-3 rounded-lg bg-surface-container-low border border-outline-variant">
                <p className="text-[11px] text-on-surface-variant truncate">{label}</p>
                <p className={`text-xl font-bold tabular-nums mt-0.5 ${colorCls}`}>{val}</p>
              </div>
            ))}
          </div>

          {importSummary && (
            <div className="p-3.5 rounded-lg bg-success-container border border-success/30 text-xs text-on-success-container">
              Firestore Sync Active: <strong>{importSummary.imported}</strong> new unique questions saved automatically,{' '}
              <strong>{importSummary.duplicates}</strong> duplicates skipped,{' '}
              <strong>{importSummary.needsReview}</strong> flagged for review.
            </div>
          )}

          {renderCategoryAlert(activeJob)}

          {/* Batch Progress Pills with Per-Batch Manual Retry */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-on-surface-variant">
              Page Batches ({activeJob.batches.length} total API batches)
            </p>
            <div className="flex flex-wrap gap-2">
              {activeJob.batches.map((b) => (
                <div
                  key={b.batchIndex}
                  title={b.error || `Pages ${b.startPage}-${b.endPage} (${b.status})`}
                  className={`px-3 py-1.5 rounded-lg border text-xs tabular-nums flex items-center gap-2 ${
                    b.status === 'completed'
                      ? 'bg-success-container border-success/30 text-on-success-container'
                      : b.status === 'failed'
                        ? 'bg-error-container border-error/30 text-on-error-container'
                        : b.status === 'processing'
                          ? 'bg-secondary-container border-secondary/40 text-on-secondary-container'
                          : 'bg-surface-container-low border-outline-variant text-on-surface-variant'
                  }`}
                >
                  <span>
                    Pages {b.startPage}–{b.endPage} · {b.status}
                    {typeof b.extractedCount === 'number' && b.status === 'completed'
                      ? ` (${b.extractedCount} Qs)`
                      : ''}
                  </span>
                  {b.status === 'failed' && (
                    <button
                      type="button"
                      disabled={controlBusy === `batch_${b.batchIndex}` || cooldown.active}
                      onClick={() => handleJobControl('retry_batch', b.batchIndex)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-warning text-on-warning text-[11px] font-bold hover:opacity-90 disabled:opacity-50"
                    >
                      <RotateCcw className="w-3 h-3" /> Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview Extracted Questions */}
          {activeJob.extractedQuestions.length > 0 && (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              <p className="text-xs font-semibold text-on-surface-variant">
                Preview Extracted Questions ({activeJob.extractedQuestions.length})
              </p>
              {activeJob.extractedQuestions.slice(0, 20).map((q, idx) => (
                <div
                  key={q.tempId}
                  className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant text-xs space-y-1.5 min-w-0 break-words"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-on-surface-variant">
                    <span>
                      #{idx + 1} · {q.subject} · {q.chapter} · Pages {q.pageRange}
                    </span>
                    <span
                      className={
                        q.verificationStatus === 'verified' ? 'text-success font-semibold' : 'text-warning font-semibold'
                      }
                    >
                      {q.verificationStatus === 'verified' ? 'Official Key Verified' : 'AI-Derived / Needs Review'}
                    </span>
                  </div>
                  <p className="text-sm text-on-surface font-medium">{q.questionText}</p>
                  <p className="text-on-surface-variant">
                    Ans: {['A', 'B', 'C', 'D'][q.correctIndex]} ({q.options[q.correctIndex]})
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Persisted Firestore Checkpoint Jobs History */}
      {savedJobs.length > 0 && (
        <div className="p-4 sm:p-6 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-headline text-base font-bold text-on-surface flex items-center gap-2">
              <History className="w-4 h-4 text-secondary shrink-0" />
              <span>Saved Extraction Checkpoints</span>
            </h3>
            <span className="text-xs text-on-surface-variant">Resume incomplete papers without re-processing completed pages</span>
          </div>

          <div className="space-y-2.5">
            {savedJobs.map((job) => {
              const failedCount = (job.failedPageRanges || []).reduce(
                (acc, r) => acc + parsePageRangeNumbers(r).length,
                0
              );
              const pendingCount = Math.max(0, job.totalPages - job.pagesProcessed - failedCount);
              return (
                <div
                  key={job.id}
                  className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface break-all">
                      {job.fileName}{' '}
                      <span className="inline-block text-[11px] font-mono uppercase px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container ml-1">
                        {job.status}
                      </span>
                    </p>
                    <p className="text-on-surface-variant tabular-nums break-words">
                      {job.examName} ({job.examYear}) · Completed: <strong className="text-success">{job.pagesProcessed}</strong>/{job.totalPages} pages · Failed: <strong className="text-error">{failedCount}</strong> · Pending: <strong className="text-warning">{pendingCount}</strong> · Saved Qs: <strong className="text-on-surface">{job.importedCount}</strong>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenSavedJob(job)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition-colors shrink-0"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {job.status === 'completed' ? 'Inspect' : 'Load / Resume'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
