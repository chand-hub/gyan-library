import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Layers,
  Loader2,
  Newspaper,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CurrentAffairsItem,
  DigitalGKBook,
  ExamCategory,
  ExamQuestion,
  MockTestRecord,
  QuestionDifficulty,
  TestAttemptRecord,
  TestType,
} from '../../types/library';
import { backfillQuestionPublishedFlags, seedExamPlatformData } from '../../lib/examSeed';
import { computeQuestionUsageCounts } from '../../lib/questionEngine';
import { downloadCsv } from '../../lib/receiptPdf';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, logAuditEvent } from '../../lib/firebase';
import {
  fetchServerAiStatus,
  formatCooldownRemaining,
  generateAiRequestId,
  readStoredAiCooldown,
  saveStoredAiCooldown,
  SharedAiCooldownState,
} from '../../lib/aiClient';

interface ExamManagementPanelProps {
  exams: ExamCategory[];
  questions: ExamQuestion[];
  mockTests: MockTestRecord[];
  currentAffairs: CurrentAffairsItem[];
  gkBooks: DigitalGKBook[];
  attempts: TestAttemptRecord[];
  actorUid: string;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

interface DraftAiItem {
  id: string;
  questionText: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  answerSeal: string;
  subject: string;
  chapter: string;
  topic: string;
  difficulty: QuestionDifficulty;
  language: 'en' | 'hi' | 'bilingual';
  fingerprint: string;
  normalizedText: string;
}

function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      current.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      current.push(field.trim());
      if (current.some((c) => c.length > 0)) rows.push(current);
      current = [];
      field = '';
    } else {
      field += ch;
    }
  }
  current.push(field.trim());
  if (current.some((c) => c.length > 0)) rows.push(current);
  return rows;
}

export const ExamManagementPanel: React.FC<ExamManagementPanelProps> = ({
  exams,
  questions,
  mockTests,
  currentAffairs,
  gkBooks,
  attempts,
  actorUid,
  getIdToken,
  onNotify,
}) => {
  const [subTab, setSubTab] = useState<'questions' | 'coverage' | 'exams' | 'mocks' | 'news' | 'books' | 'attempts'>('questions');
  const [seeding, setSeeding] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [questionTool, setQuestionTool] = useState<'none' | 'add' | 'bulk' | 'ai_batch'>('add');

  // Add Exam Form
  const [newExamName, setNewExamName] = useState('');
  const [newExamGroup, setNewExamGroup] = useState('Other');
  const [newDuration, setNewDuration] = useState(90);
  const [newPosMarks, setNewPosMarks] = useState(2);
  const [newNegMarks, setNewNegMarks] = useState(0.5);

  // Add Question Form
  const [qExam, setQExam] = useState(exams[0]?.name || 'UPSC');
  const [qSubject, setQSubject] = useState('Indian Polity');
  const [qChapter, setQChapter] = useState('Constitutional Framework');
  const [qTopic, setQTopic] = useState('Core Concepts');
  const [qText, setQText] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [qCorrectIdx, setQCorrectIdx] = useState(0);
  const [qExplanation, setQExplanation] = useState('');
  const [qDifficulty, setQDifficulty] = useState<QuestionDifficulty>('medium');
  const [qYear, setQYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'verified' | 'ai_derived' | 'needs_review'>('ALL');
  const [publishFilter, setPublishFilter] = useState<'ALL' | 'published' | 'unpublished'>('ALL');
  const [examFilter, setExamFilter] = useState('ALL');
  const [searchText, setSearchText] = useState('');

  // Edit Question Modal
  const [editingQ, setEditingQ] = useState<ExamQuestion | null>(null);
  const [editExam, setEditExam] = useState('UPSC');
  const [editSubject, setEditSubject] = useState('');
  const [editChapter, setEditChapter] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<QuestionDifficulty>('medium');
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editText, setEditText] = useState('');
  const [editOpts, setEditOpts] = useState<[string, string, string, string]>(['', '', '', '']);
  const [editCorrectIdx, setEditCorrectIdx] = useState<number>(0);
  const [editExplanation, setEditExplanation] = useState<string>('');
  const [editPublished, setEditPublished] = useState<boolean>(true);
  const [savingEdit, setSavingEdit] = useState(false);

  // Bulk JSON / CSV Import
  const [bulkExam, setBulkExam] = useState(exams[0]?.name || 'UPSC');
  const [bulkFormat, setBulkFormat] = useState<'json' | 'csv'>('json');
  const [bulkPayload, setBulkPayload] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);

  // Admin AI Batch Generator (up to 100 questions)
  const [aiExam, setAiExam] = useState(exams[0]?.name || 'UPSC');
  const [aiSubject, setAiSubject] = useState('Indian Polity');
  const [aiChapter, setAiChapter] = useState('Core Syllabus');
  const [aiTopic, setAiTopic] = useState('Important Concepts');
  const [aiDiff, setAiDiff] = useState<'mixed' | QuestionDifficulty>('mixed');
  const [aiCount, setAiCount] = useState<number>(25);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDrafts, setAiDrafts] = useState<DraftAiItem[]>([]);
  const [publishingDrafts, setPublishingDrafts] = useState(false);

  // Mock Test Builder Form
  const [mockTitle, setMockTitle] = useState('');
  const [mockExam, setMockExam] = useState(exams[0]?.name || 'UPSC');
  const [mockType, setMockType] = useState<TestType>('full_length');
  const [mockCount, setMockCount] = useState(25);

  // Current Affairs Scheduler
  const [collectingCa, setCollectingCa] = useState(false);
  const [caPaused, setCaPaused] = useState(false);
  const [caDate, setCaDate] = useState(new Date().toISOString().slice(0, 10));
  const [aiCooldown, setAiCooldown] = useState<SharedAiCooldownState>(() => readStoredAiCooldown());

  React.useEffect(() => {
    if (!actorUid) return;
    let cancelled = false;
    (async () => {
      const token = await getIdToken();
      if (!token || cancelled) return;
      const s = await fetchServerAiStatus(token);
      if (s && !cancelled) setAiCooldown(s);
    })();
    const t = setInterval(() => setAiCooldown(readStoredAiCooldown()), 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [actorUid, getIdToken]);

  const usageCounts = useMemo(() => computeQuestionUsageCounts(attempts), [attempts]);

  const filteredQuestions = useMemo(() => {
    const term = searchText.trim().toLowerCase();
    return questions.filter((q) => {
      if (examFilter !== 'ALL' && q.examName !== examFilter) return false;
      if (statusFilter !== 'ALL' && q.verificationStatus !== statusFilter) return false;
      if (publishFilter === 'published' && q.published === false) return false;
      if (publishFilter === 'unpublished' && q.published !== false) return false;
      if (
        term &&
        !q.questionText.toLowerCase().includes(term) &&
        !q.subject.toLowerCase().includes(term) &&
        !q.chapter.toLowerCase().includes(term) &&
        !q.questionCode.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [questions, examFilter, statusFilter, publishFilter, searchText]);

  const coverageSummary = useMemo(() => {
    const byExam = new Map<
      string,
      { total: number; published: number; easy: number; medium: number; hard: number; attempts: number; subjects: Set<string>; chapters: Set<string> }
    >();
    questions.forEach((q) => {
      const cur = byExam.get(q.examName) || {
        total: 0,
        published: 0,
        easy: 0,
        medium: 0,
        hard: 0,
        attempts: 0,
        subjects: new Set<string>(),
        chapters: new Set<string>(),
      };
      cur.total += 1;
      if (q.published !== false) cur.published += 1;
      cur[q.difficulty || 'medium'] += 1;
      cur.attempts += usageCounts.get(q.id) || 0;
      if (q.subject) cur.subjects.add(q.subject);
      if (q.chapter) cur.chapters.add(q.chapter);
      byExam.set(q.examName, cur);
    });
    return Array.from(byExam.entries()).map(([examName, m]) => ({
      examName,
      total: m.total,
      published: m.published,
      easy: m.easy,
      medium: m.medium,
      hard: m.hard,
      attempts: m.attempts,
      subjectCount: m.subjects.size,
      chapterCount: m.chapters.size,
    }));
  }, [questions, usageCounts]);

  const handleSeedExamSystem = async () => {
    setSeeding(true);
    try {
      const token = await getIdToken();
      const res = await seedExamPlatformData(token);
      await logAuditEvent(
        'EXAM_BANK_SYNCED',
        'exams',
        'bootstrap',
        `Seeded ${res.exams} exams, ${res.questions} sealed PYQs, ${res.gkBooks} GK books`,
        'admin'
      );
      onNotify(
        'ok',
        `Synced ${res.exams} exams, ${res.questions} sealed questions, and ${res.gkBooks} Digital GK Books.`
      );
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to sync exam dataset.');
    } finally {
      setSeeding(false);
    }
  };

  const handleBackfillPublished = async () => {
    setBackfilling(true);
    try {
      const updated = await backfillQuestionPublishedFlags();
      onNotify(
        'ok',
        updated > 0
          ? `Backfilled published visibility flags on ${updated} legacy questions.`
          : 'All questions already have valid published flags.'
      );
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to sync published flags.');
    } finally {
      setBackfilling(false);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExamName.trim()) return;
    try {
      await addDoc(collection(db, 'exams'), {
        name: newExamName.trim(),
        categoryGroup: newExamGroup.trim(),
        code: newExamName.trim().replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'EXAM',
        defaultDurationMinutes: Number(newDuration) || 90,
        marksPerCorrect: Number(newPosMarks) || 1,
        negativeMarks: Number(newNegMarks) || 0,
        description: `${newExamName.trim()} Competitive Exam Track`,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewExamName('');
      onNotify('ok', `Added exam category "${newExamName.trim()}".`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to add exam category.');
    }
  };

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const qId = `q_man_${Date.now()}`;
      const options: [string, string, string, string] = [
        optA.trim(),
        optB.trim(),
        optC.trim(),
        optD.trim(),
      ];

      const sealRes = await fetch('/api/exams/seal-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: [
            {
              id: qId,
              questionText: qText.trim(),
              options,
              correctIndex: qCorrectIdx,
              explanation: qExplanation.trim(),
            },
          ],
        }),
      });
      const sealData = await sealRes.json();
      if (!sealRes.ok || !sealData.sealed?.[0]) throw new Error(sealData.error || 'Sealing failed.');
      const sealed = sealData.sealed[0];

      const batch = writeBatch(db);
      batch.set(doc(db, 'questions', qId), {
        questionCode: `Q-MAN-${String(Date.now()).slice(-5)}`,
        examName: qExam,
        examCategory: exams.find((x) => x.name === qExam)?.categoryGroup || 'Competitive',
        subject: qSubject.trim(),
        chapter: qChapter.trim(),
        topic: qTopic.trim(),
        questionText: qText.trim(),
        options,
        difficulty: qDifficulty,
        examYear: Number(qYear),
        source: 'manual',
        language: 'en',
        verificationStatus: 'verified',
        published: true,
        usageCount: 0,
        fingerprint: sealed.fingerprint,
        normalizedText: sealed.normalizedText,
        answerSeal: sealed.answerSeal,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'question_keys', qId), {
        questionId: qId,
        correctIndex: qCorrectIdx,
        explanation: qExplanation.trim(),
        derivedBy: 'admin_manual',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setQText('');
      setOptA('');
      setOptB('');
      setOptC('');
      setOptD('');
      setQExplanation('');
      onNotify('ok', 'Question sealed and published to Question Bank.');
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to add question.');
    }
  };

  const openEditQuestion = async (q: ExamQuestion) => {
    setEditingQ(q);
    setEditExam(q.examName);
    setEditSubject(q.subject);
    setEditChapter(q.chapter);
    setEditTopic(q.topic);
    setEditDifficulty(q.difficulty || 'medium');
    setEditYear(q.examYear || new Date().getFullYear());
    setEditText(q.questionText);
    setEditOpts([...q.options] as [string, string, string, string]);
    setEditPublished(q.published !== false);
    setEditCorrectIdx(0);
    setEditExplanation('');
    try {
      const keySnap = await getDoc(doc(db, 'question_keys', q.id));
      if (keySnap.exists()) {
        const kd = keySnap.data();
        setEditCorrectIdx(Number(kd.correctIndex) || 0);
        setEditExplanation(String(kd.explanation || ''));
      }
    } catch {
      // Optional key lookup fallback
    }
  };

  const handleSaveEditedQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQ) return;
    setSavingEdit(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const trimmedOpts: [string, string, string, string] = [
        editOpts[0].trim(),
        editOpts[1].trim(),
        editOpts[2].trim(),
        editOpts[3].trim(),
      ];

      const sealRes = await fetch('/api/exams/seal-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: [
            {
              id: editingQ.id,
              questionText: editText.trim(),
              options: trimmedOpts,
              correctIndex: editCorrectIdx,
              explanation: editExplanation.trim() || 'Reviewed and verified by administrator.',
            },
          ],
        }),
      });
      const sealData = await sealRes.json();
      if (!sealRes.ok || !sealData.sealed?.[0]) throw new Error(sealData.error || 'Sealing failed.');
      const sealed = sealData.sealed[0];

      const batch = writeBatch(db);
      batch.update(doc(db, 'questions', editingQ.id), {
        examName: editExam,
        examCategory: exams.find((x) => x.name === editExam)?.categoryGroup || 'Competitive',
        subject: editSubject.trim(),
        chapter: editChapter.trim(),
        topic: editTopic.trim(),
        difficulty: editDifficulty,
        examYear: Number(editYear) || new Date().getFullYear(),
        questionText: editText.trim(),
        options: trimmedOpts,
        published: editPublished,
        verificationStatus: 'verified',
        fingerprint: sealed.fingerprint,
        normalizedText: sealed.normalizedText,
        answerSeal: sealed.answerSeal,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'question_keys', editingQ.id), {
        questionId: editingQ.id,
        correctIndex: editCorrectIdx,
        explanation: editExplanation.trim() || 'Reviewed and verified by administrator.',
        derivedBy: 'admin_manual',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      setEditingQ(null);
      onNotify('ok', `Updated and re-sealed question ${editingQ.questionCode}.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to update question.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleTogglePublished = async (q: ExamQuestion) => {
    const nextVal = q.published === false;
    await updateDoc(doc(db, 'questions', q.id), {
      published: nextVal,
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', `${q.questionCode} is now ${nextVal ? 'Published' : 'Unpublished'}.`);
  };

  const handleBulkImport = async () => {
    if (!bulkPayload.trim()) return;
    setBulkImporting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');

      interface ParsedBulkRow {
        questionText: string;
        options: [string, string, string, string];
        correctIndex: number;
        explanation: string;
        examName: string;
        subject: string;
        chapter: string;
        topic: string;
        difficulty: QuestionDifficulty;
        examYear: number;
      }

      const parsedRows: ParsedBulkRow[] = [];
      if (bulkFormat === 'json') {
        const arr = JSON.parse(bulkPayload);
        if (!Array.isArray(arr)) throw new Error('JSON must be an array of MCQ objects.');
        for (const row of arr) {
          const opts = Array.isArray(row.options)
            ? row.options
            : [row.optionA, row.optionB, row.optionC, row.optionD];
          if (!row.questionText || !Array.isArray(opts) || opts.length < 4) continue;
          const diffRaw = String(row.difficulty || 'medium').toLowerCase();
          parsedRows.push({
            questionText: String(row.questionText).trim(),
            options: [
              String(opts[0] || '').trim(),
              String(opts[1] || '').trim(),
              String(opts[2] || '').trim(),
              String(opts[3] || '').trim(),
            ],
            correctIndex: Math.min(3, Math.max(0, Number(row.correctIndex) || 0)),
            explanation: String(row.explanation || 'Imported question.').trim(),
            examName: String(row.examName || bulkExam).trim(),
            subject: String(row.subject || 'General Knowledge').trim(),
            chapter: String(row.chapter || 'General').trim(),
            topic: String(row.topic || 'Core Concepts').trim(),
            difficulty: diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'medium',
            examYear: Number(row.examYear) || new Date().getFullYear(),
          });
        }
      } else {
        const lines = parseCsvLines(bulkPayload);
        const startIdx =
          lines[0]?.[0]?.toLowerCase().includes('question') ? 1 : 0;
        for (let i = startIdx; i < lines.length; i++) {
          const cols = lines[i];
          if (cols.length < 6) continue;
          const diffRaw = String(cols[11] || 'medium').toLowerCase();
          parsedRows.push({
            questionText: cols[0],
            options: [cols[1], cols[2], cols[3], cols[4]],
            correctIndex: Math.min(3, Math.max(0, Number(cols[5]) || 0)),
            explanation: cols[6] || 'Imported MCQ.',
            examName: cols[7] || bulkExam,
            subject: cols[8] || 'General Knowledge',
            chapter: cols[9] || 'General',
            topic: cols[10] || 'Core Concepts',
            difficulty: diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'medium',
            examYear: Number(cols[12]) || new Date().getFullYear(),
          });
        }
      }

      if (parsedRows.length === 0) {
        throw new Error('No valid 4-option MCQs found in input.');
      }

      let importedCount = 0;
      const chunkSize = 150;
      for (let offset = 0; offset < parsedRows.length; offset += chunkSize) {
        const slice = parsedRows.slice(offset, offset + chunkSize);
        const ids = slice.map((_, idx) => `q_blk_${Date.now()}_${offset + idx}`);

        const sealRes = await fetch('/api/exams/seal-questions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            items: slice.map((r, i) => ({
              id: ids[i],
              questionText: r.questionText,
              options: r.options,
              correctIndex: r.correctIndex,
              explanation: r.explanation,
            })),
          }),
        });
        const sealData = await sealRes.json();
        if (!sealRes.ok || !Array.isArray(sealData.sealed)) {
          throw new Error(sealData.error || 'Bulk sealing failed.');
        }

        const batch = writeBatch(db);
        slice.forEach((r, i) => {
          const qId = ids[i];
          const sealed = sealData.sealed[i];
          batch.set(doc(db, 'questions', qId), {
            questionCode: `Q-BLK-${String(offset + i + 1).padStart(4, '0')}`,
            examName: r.examName,
            examCategory: exams.find((x) => x.name === r.examName)?.categoryGroup || 'Competitive',
            subject: r.subject,
            chapter: r.chapter,
            topic: r.topic,
            questionText: r.questionText,
            options: r.options,
            difficulty: r.difficulty,
            examYear: r.examYear,
            source: 'manual',
            language: 'en',
            verificationStatus: 'verified',
            published: true,
            usageCount: 0,
            fingerprint: sealed.fingerprint,
            normalizedText: sealed.normalizedText,
            answerSeal: sealed.answerSeal,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(db, 'question_keys', qId), {
            questionId: qId,
            correctIndex: r.correctIndex,
            explanation: r.explanation,
            derivedBy: 'admin_manual',
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        importedCount += slice.length;
      }

      setBulkPayload('');
      onNotify('ok', `Bulk-imported and sealed ${importedCount} questions into the Question Bank.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Bulk import failed.');
    } finally {
      setBulkImporting(false);
    }
  };

  const handleGenerateAdminBatch = async () => {
    if (aiGenerating || aiCooldown.active) return;
    setAiGenerating(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const requestId = generateAiRequestId('admin_mcq');
      const res = await fetch('/api/exams/ai-generate-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-idempotency-key': requestId,
        },
        body: JSON.stringify({
          requestId,
          examName: aiExam,
          subject: aiSubject,
          chapter: aiChapter,
          topic: aiTopic,
          difficulty: aiDiff,
          count: Math.min(100, Math.max(1, aiCount)),
          language: 'en',
          excludeNormalized: questions.map((q) => q.normalizedText).slice(0, 40),
          includeKeys: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.cooldownActive) {
          setAiCooldown(
            saveStoredAiCooldown({
              cooldownUntil: data.cooldownUntil,
              cooldownRemainingSeconds: data.cooldownRemainingSeconds,
              reason: data.error,
              category: data.errorCategory,
            })
          );
        }
        throw new Error(data.error || 'AI generation failed.');
      }
      const existingFps = new Set(questions.map((q) => q.fingerprint));
      const drafts: DraftAiItem[] = (data.questions || []).filter(
        (q: any) => !existingFps.has(q.fingerprint)
      );
      setAiDrafts(drafts);
      onNotify('ok', `Generated ${drafts.length} unique AI MCQs for admin review before publishing.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to generate AI question batch.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePublishAiDrafts = async () => {
    if (aiDrafts.length === 0) return;
    setPublishingDrafts(true);
    try {
      const batch = writeBatch(db);
      aiDrafts.slice(0, 150).forEach((d, idx) => {
        batch.set(doc(db, 'questions', d.id), {
          questionCode: `Q-AI-${Date.now().toString().slice(-4)}-${idx + 1}`,
          examName: aiExam,
          examCategory: exams.find((x) => x.name === aiExam)?.categoryGroup || 'Competitive',
          subject: d.subject || aiSubject,
          chapter: d.chapter || aiChapter,
          topic: d.topic || aiTopic,
          questionText: d.questionText,
          options: d.options,
          difficulty: d.difficulty || 'medium',
          examYear: new Date().getFullYear(),
          source: 'ai_generated',
          language: d.language || 'en',
          verificationStatus: 'verified',
          published: true,
          usageCount: 0,
          fingerprint: d.fingerprint,
          normalizedText: d.normalizedText,
          answerSeal: d.answerSeal,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'question_keys', d.id), {
          questionId: d.id,
          correctIndex: d.correctIndex,
          explanation: d.explanation,
          derivedBy: 'ai_derived',
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      const count = aiDrafts.length;
      setAiDrafts([]);
      onNotify('ok', `Verified and published ${count} AI questions to the live Question Bank.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Failed to publish AI draft questions.');
    } finally {
      setPublishingDrafts(false);
    }
  };

  const handleVerifyQuestion = async (qId: string) => {
    await updateDoc(doc(db, 'questions', qId), {
      verificationStatus: 'verified',
      published: true,
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', 'Question verified and published.');
  };

  const handleCreateMockTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const pool = questions
      .filter((q) => q.examName === mockExam && q.published !== false)
      .slice(0, Math.max(1, mockCount));
    if (pool.length === 0) {
      onNotify('err', `No published questions available for ${mockExam} yet.`);
      return;
    }
    const meta = exams.find((x) => x.name === mockExam);
    await addDoc(collection(db, 'mock_tests'), {
      title: mockTitle.trim() || `${mockExam} Mock Test`,
      examName: mockExam,
      testType: mockType,
      difficulty: 'mixed',
      questionIds: pool.map((p) => p.id),
      durationMinutes: Math.max(10, Math.round(pool.length * 1.5)),
      marksPerCorrect: meta?.marksPerCorrect ?? 2,
      negativeMarks: meta?.negativeMarks ?? 0.5,
      isTimed: true,
      active: true,
      createdByUid: actorUid,
      createdAt: serverTimestamp(),
    });
    setMockTitle('');
    onNotify('ok', `Published mock test with ${pool.length} questions.`);
  };

  const handleCollectCurrentAffairsNow = async () => {
    if (collectingCa || aiCooldown.active) return;
    setCollectingCa(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const requestId = generateAiRequestId('ca');
      const res = await fetch('/api/current-affairs/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-idempotency-key': requestId,
        },
        body: JSON.stringify({ date: caDate, requestId }),
      });
      const bundle = await res.json();
      if (!res.ok) {
        if (bundle?.cooldownActive) {
          setAiCooldown(
            saveStoredAiCooldown({
              cooldownUntil: bundle.cooldownUntil,
              cooldownRemainingSeconds: bundle.cooldownRemainingSeconds,
              reason: bundle.error,
              category: bundle.errorCategory,
            })
          );
        }
        throw new Error(bundle.error || 'Current affairs collection failed.');
      }

      const items: any[] = bundle.items || [];
      if (items.length === 0) throw new Error('No grounded news items returned for this date.');

      const batch = writeBatch(db);
      items.forEach((it) => {
        const qId = it.mcq.tempId;
        batch.set(doc(db, 'questions', qId), {
          questionCode: `Q-CA-${it.date.replace(/-/g, '')}`,
          examName: 'UPSC',
          examCategory: 'Current Affairs',
          subject: 'Current Affairs',
          chapter: it.category,
          topic: it.titleEn.slice(0, 60),
          questionText: it.mcq.questionText,
          options: it.mcq.options,
          difficulty: 'medium',
          examYear: it.year,
          source: 'current_affairs',
          language: 'en',
          verificationStatus: 'verified',
          published: true,
          usageCount: 0,
          fingerprint: it.mcq.fingerprint,
          normalizedText: it.mcq.normalizedText,
          answerSeal: it.mcq.answerSeal,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'question_keys', qId), {
          questionId: qId,
          correctIndex: it.mcq.correctIndex,
          explanation: it.mcq.explanation,
          derivedBy: 'ai_derived',
          updatedAt: serverTimestamp(),
        });
        batch.set(doc(db, 'current_affairs', it.tempId), {
          date: it.date,
          month: it.month,
          year: it.year,
          category: it.category,
          titleEn: it.titleEn,
          titleHi: it.titleHi,
          summaryEn: it.summaryEn,
          summaryHi: it.summaryHi,
          sourceTitle: it.sourceTitle,
          sourceUrl: it.sourceUrl,
          publishedDate: it.publishedDate,
          linkedQuestionIds: [qId],
          status: 'pending_review',
          autoCollected: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      onNotify('ok', `Collected ${items.length} grounded current affairs items & MCQs for admin review.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to collect current affairs.');
    } finally {
      setCollectingCa(false);
    }
  };

  const handleToggleCaPause = async () => {
    const token = await getIdToken();
    if (!token) return;
    const next = !caPaused;
    const res = await fetch('/api/current-affairs/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paused: next }),
    });
    if (res.ok) {
      setCaPaused(next);
      onNotify('ok', next ? 'Daily Current Affairs scheduler paused.' : 'Daily Current Affairs scheduler resumed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider">AI Examination Platform Control</p>
          <h2 className="font-headline text-2xl font-bold text-on-surface mt-0.5">
            Exams, Question Bank, Current Affairs &amp; GK Books
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            disabled={backfilling}
            onClick={handleBackfillPublished}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-primary text-xs font-semibold hover:bg-surface-container-low"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${backfilling ? 'animate-spin' : ''}`} />
            {backfilling ? 'Syncing Flags...' : 'Sync Published Flags'}
          </button>

          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedExamSystem}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary transition-colors"
          >
            <Database className="w-4 h-4" />
            {seeding ? 'Syncing Platform Data...' : 'Initialize / Sync 15 Exams & 11 GK Books'}
          </button>
        </div>
      </div>

      {aiCooldown.active && (
        <div className="p-3.5 rounded-lg bg-warning-container border border-warning/30 text-xs text-on-warning-container">
          Shared Gemini AI Cooldown Active · Next request available in{' '}
          <strong className="tabular-nums">{formatCooldownRemaining(aiCooldown.remainingSeconds)}</strong>.{' '}
          {aiCooldown.reason || ''}
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-surface-container-low border border-outline-variant">
        {[
          ['questions', `Question Bank (${questions.length})`],
          ['coverage', 'Coverage & Usage Stats'],
          ['exams', `Exam Categories (${exams.length})`],
          ['mocks', `Mock Tests (${mockTests.length})`],
          ['news', `Current Affairs (${currentAffairs.length})`],
          ['books', `Digital GK Books (${gkBooks.length})`],
          ['attempts', `Student Attempts (${attempts.length})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id as any)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              subTab === id
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sub-tab: Questions */}
      {subTab === 'questions' && (
        <div className="space-y-6">
          {/* Action Tool Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              ['add', 'Add Single MCQ', Plus],
              ['bulk', 'Bulk JSON / CSV Import', Upload],
              ['ai_batch', 'AI Question Bank Generator (Up to 100)', Sparkles],
            ].map(([id, label, Icon]: any) => (
              <button
                key={id}
                type="button"
                onClick={() => setQuestionTool(questionTool === id ? 'none' : id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  questionTool === id
                    ? 'bg-secondary border-secondary text-on-secondary'
                    : 'bg-surface-container-lowest border-outline-variant text-primary hover:bg-surface-container-low'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {questionTool === 'add' && (
            <form
              onSubmit={handleCreateQuestion}
              className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-4"
            >
              <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                <Plus className="w-4 h-4 text-secondary" /> Add Verified Question
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <select
                  value={qExam}
                  onChange={(e) => setQExam(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.name}>
                      {ex.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={qSubject}
                  onChange={(e) => setQSubject(e.target.value)}
                  placeholder="Subject"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <input
                  type="text"
                  required
                  value={qChapter}
                  onChange={(e) => setQChapter(e.target.value)}
                  placeholder="Chapter"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <input
                  type="text"
                  required
                  value={qTopic}
                  onChange={(e) => setQTopic(e.target.value)}
                  placeholder="Topic"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <div className="flex gap-2">
                  <select
                    value={qDifficulty}
                    onChange={(e) => setQDifficulty(e.target.value as any)}
                    className="flex-1 px-2 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Moderate</option>
                    <option value="hard">Hard</option>
                  </select>
                  <input
                    type="number"
                    value={qYear}
                    onChange={(e) => setQYear(Number(e.target.value))}
                    className="w-20 px-2 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface tabular-nums"
                  />
                </div>
              </div>

              <textarea
                required
                rows={2}
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="Enter complete MCQ question text (supports Hindi & Unicode math symbols)..."
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input required value={optA} onChange={(e) => setOptA(e.target.value)} placeholder="Option A" className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface" />
                <input required value={optB} onChange={(e) => setOptB(e.target.value)} placeholder="Option B" className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface" />
                <input required value={optC} onChange={(e) => setOptC(e.target.value)} placeholder="Option C" className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface" />
                <input required value={optD} onChange={(e) => setOptD(e.target.value)} placeholder="Option D" className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <select
                  value={qCorrectIdx}
                  onChange={(e) => setQCorrectIdx(Number(e.target.value))}
                  className="sm:col-span-3 px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  <option value={0}>Correct: Option A</option>
                  <option value={1}>Correct: Option B</option>
                  <option value={2}>Correct: Option C</option>
                  <option value={3}>Correct: Option D</option>
                </select>
                <input
                  required
                  value={qExplanation}
                  onChange={(e) => setQExplanation(e.target.value)}
                  placeholder="Solution explanation..."
                  className="sm:col-span-7 px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <button
                  type="submit"
                  className="sm:col-span-2 py-2 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary"
                >
                  Save &amp; Seal
                </button>
              </div>
            </form>
          )}

          {questionTool === 'bulk' && (
            <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-secondary" /> Bulk JSON / CSV Question Importer
                </h3>
                <div className="flex items-center gap-2">
                  <select
                    value={bulkExam}
                    onChange={(e) => setBulkExam(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                  >
                    {exams.map((ex) => (
                      <option key={ex.id} value={ex.name}>
                        Default Exam: {ex.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={bulkFormat}
                    onChange={(e) => setBulkFormat(e.target.value as 'json' | 'csv')}
                    className="px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                  >
                    <option value="json">JSON Array</option>
                    <option value="csv">CSV Rows</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant">
                {bulkFormat === 'json'
                  ? 'Paste a JSON array of objects with { questionText, options: [A,B,C,D], correctIndex (0-3), explanation, subject, chapter, topic, difficulty, examYear }.'
                  : 'CSV Columns: questionText,optionA,optionB,optionC,optionD,correctIndex(0-3),explanation,examName,subject,chapter,topic,difficulty,examYear'}
              </p>
              <textarea
                rows={5}
                value={bulkPayload}
                onChange={(e) => setBulkPayload(e.target.value)}
                placeholder={
                  bulkFormat === 'json'
                    ? '[{"questionText":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"...","subject":"Indian Polity","chapter":"Parliament","topic":"Bills","difficulty":"medium"}]'
                    : 'questionText,optionA,optionB,optionC,optionD,correctIndex,explanation,examName,subject,chapter,topic,difficulty,examYear'
                }
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs font-mono text-on-surface"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={bulkImporting || !bulkPayload.trim()}
                  onClick={handleBulkImport}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50"
                >
                  {bulkImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {bulkImporting ? 'Sealing & Importing...' : 'Seal & Publish Bulk Batch'}
                </button>
              </div>
            </div>
          )}

          {questionTool === 'ai_batch' && (
            <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-secondary" /> Admin Batch AI Question Generator (Up to 100 Questions)
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
                <select
                  value={aiExam}
                  onChange={(e) => setAiExam(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.name}>
                      {ex.name}
                    </option>
                  ))}
                </select>
                <input
                  value={aiSubject}
                  onChange={(e) => setAiSubject(e.target.value)}
                  placeholder="Subject"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <input
                  value={aiChapter}
                  onChange={(e) => setAiChapter(e.target.value)}
                  placeholder="Chapter"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <input
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="Topic"
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <select
                  value={aiDiff}
                  onChange={(e) => setAiDiff(e.target.value as any)}
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  <option value="mixed">Mixed Difficulty</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Moderate</option>
                  <option value="hard">Hard</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={aiCount}
                  onChange={(e) => setAiCount(Math.min(100, Math.max(1, Number(e.target.value) || 10)))}
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface tabular-nums"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={aiGenerating || aiCooldown.active}
                  onClick={handleGenerateAdminBatch}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50"
                >
                  {aiGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {aiCooldown.active
                    ? `Cooldown: ${formatCooldownRemaining(aiCooldown.remainingSeconds)}`
                    : aiGenerating
                      ? `Generating ${aiCount} MCQs...`
                      : `Generate ${aiCount} Draft Questions`}
                </button>

                {aiDrafts.length > 0 && (
                  <button
                    type="button"
                    disabled={publishingDrafts}
                    onClick={handlePublishAiDrafts}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-success text-on-success text-xs font-semibold hover:opacity-90"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {publishingDrafts ? 'Publishing...' : `Verify & Publish All (${aiDrafts.length}) to Bank`}
                  </button>
                )}
              </div>

              {aiDrafts.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {aiDrafts.map((d, idx) => (
                    <div
                      key={d.id}
                      className="p-3 rounded-lg bg-surface-container-low border border-outline-variant flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1">
                        <p className="text-secondary font-medium">
                          Draft #{idx + 1} · {d.subject} · {d.difficulty} · Answer: {['A', 'B', 'C', 'D'][d.correctIndex]}
                        </p>
                        <p className="text-on-surface font-medium">{d.questionText}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAiDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                        className="p-1 text-error hover:opacity-80 shrink-0"
                        title="Discard draft"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Question List */}
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <select
                  value={examFilter}
                  onChange={(e) => setExamFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  <option value="ALL">All Exams</option>
                  {exams.map((ex) => (
                    <option key={ex.id} value={ex.name}>
                      {ex.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="verified">Verified</option>
                  <option value="ai_derived">AI Derived</option>
                  <option value="needs_review">Needs Review</option>
                </select>
                <select
                  value={publishFilter}
                  onChange={(e) => setPublishFilter(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                >
                  <option value="ALL">All Visibility</option>
                  <option value="published">Published Only</option>
                  <option value="unpublished">Unpublished Only</option>
                </select>
                <input
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Search question, subject, chapter..."
                  className="px-3 py-1.5 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  downloadCsv(
                    `vidhya-question-bank-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['Code', 'Exam', 'Subject', 'Chapter', 'Topic', 'Year', 'Difficulty', 'Source', 'Status', 'Published', 'Attempts'],
                    filteredQuestions.map((q) => [
                      q.questionCode,
                      q.examName,
                      q.subject,
                      q.chapter,
                      q.topic,
                      q.examYear,
                      q.difficulty,
                      q.source,
                      q.verificationStatus,
                      q.published === false ? 'Unpublished' : 'Published',
                      usageCounts.get(q.id) || 0,
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            </div>

            <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
              {filteredQuestions.map((q) => {
                const isPub = q.published !== false;
                const usedCount = usageCounts.get(q.id) || 0;
                return (
                  <div
                    key={q.id}
                    className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="text-on-surface-variant">
                        <span className="font-mono font-bold text-primary">{q.questionCode}</span> · {q.examName} · {q.subject} · {q.chapter} ·{' '}
                        <span className="uppercase">{q.difficulty}</span> ·{' '}
                        <span className={q.verificationStatus === 'verified' ? 'text-success font-semibold' : 'text-warning font-semibold'}>
                          {q.verificationStatus}
                        </span>{' '}
                        · <span className="tabular-nums">Used {usedCount}x</span>
                      </p>
                      <p className="text-sm text-on-surface font-medium line-clamp-2">{q.questionText}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePublished(q)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md font-semibold ${
                          isPub
                            ? 'bg-success-container text-on-success-container'
                            : 'bg-surface-container-lowest border border-outline-variant text-on-surface-variant'
                        }`}
                      >
                        {isPub ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        {isPub ? 'Published' : 'Hidden'}
                      </button>

                      {q.verificationStatus !== 'verified' && (
                        <button
                          type="button"
                          onClick={() => handleVerifyQuestion(q.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-success text-on-success font-semibold"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verify
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => openEditQuestion(q)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary text-on-primary font-semibold hover:bg-primary-container"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteDoc(doc(db, 'questions', q.id))}
                        aria-label="Delete question"
                        className="p-1.5 rounded-md bg-error-container text-on-error-container hover:opacity-85"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab: Coverage & Usage Statistics */}
      {subTab === 'coverage' && (
        <div className="space-y-4">
          <div className="rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between">
              <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                <Layers className="w-4 h-4 text-secondary" /> Question Bank Coverage &amp; Student Attempt Usage Matrix
              </h3>
              <span className="text-xs text-on-surface-variant tabular-nums">
                {questions.length} Total Questions · {attempts.length} Total Attempts
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Exam</th>
                    <th className="text-right px-4 py-3 font-semibold">Total Qs</th>
                    <th className="text-right px-4 py-3 font-semibold">Published</th>
                    <th className="text-right px-4 py-3 font-semibold">Subjects</th>
                    <th className="text-right px-4 py-3 font-semibold">Chapters</th>
                    <th className="text-right px-4 py-3 font-semibold">Easy</th>
                    <th className="text-right px-4 py-3 font-semibold">Moderate</th>
                    <th className="text-right px-4 py-3 font-semibold">Hard</th>
                    <th className="text-right px-4 py-3 font-semibold">Attempt Usage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {coverageSummary.map((row) => (
                    <tr key={row.examName} className="hover:bg-surface-container-low">
                      <td className="px-4 py-3 font-bold text-on-surface">{row.examName}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{row.total}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-success font-semibold">{row.published}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{row.subjectCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-on-surface-variant">{row.chapterCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-success">{row.easy}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-secondary">{row.medium}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-error">{row.hard}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-on-surface">{row.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab: Exam Categories */}
      {subTab === 'exams' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateExam}
            className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm grid grid-cols-1 sm:grid-cols-6 gap-3 items-end"
          >
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Exam Name</label>
              <input
                required
                value={newExamName}
                onChange={(e) => setNewExamName(e.target.value)}
                placeholder="e.g. CTET / BPSC Teacher"
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Group</label>
              <input
                required
                value={newExamGroup}
                onChange={(e) => setNewExamGroup(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Duration (m)</label>
              <input
                type="number"
                value={newDuration}
                onChange={(e) => setNewDuration(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">+Marks / −Neg</label>
              <div className="flex gap-1">
                <input
                  type="number"
                  step="0.5"
                  value={newPosMarks}
                  onChange={(e) => setNewPosMarks(Number(e.target.value))}
                  className="w-1/2 px-2 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
                <input
                  type="number"
                  step="0.25"
                  value={newNegMarks}
                  onChange={(e) => setNewNegMarks(Number(e.target.value))}
                  className="w-1/2 px-2 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
              </div>
            </div>
            <button
              type="submit"
              className="py-2 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary"
            >
              Add Exam
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {exams.map((ex) => (
              <div
                key={ex.id}
                className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-col justify-between gap-2"
              >
                <div>
                  <p className="text-[11px] font-semibold text-secondary">{ex.categoryGroup} · {ex.code}</p>
                  <h4 className="font-headline text-base font-bold text-on-surface">{ex.name}</h4>
                  <p className="text-xs text-on-surface-variant mt-1 tabular-nums">
                    +{ex.marksPerCorrect} / −{ex.negativeMarks} · {ex.defaultDurationMinutes} mins
                  </p>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-outline-variant text-xs">
                  <span className="text-on-surface-variant">
                    {questions.filter((q) => q.examName === ex.name && q.published !== false).length} Qs published
                  </span>
                  <button
                    type="button"
                    onClick={() => updateDoc(doc(db, 'exams', ex.id), { active: !ex.active })}
                    className={`px-2.5 py-1 rounded-full font-semibold ${
                      ex.active
                        ? 'bg-success-container text-on-success-container'
                        : 'bg-surface-container-low text-on-surface-variant'
                    }`}
                  >
                    {ex.active ? 'Active' : 'Hidden'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab: Mock Tests */}
      {subTab === 'mocks' && (
        <div className="space-y-6">
          <form
            onSubmit={handleCreateMockTest}
            className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm grid grid-cols-1 sm:grid-cols-5 gap-3 items-end"
          >
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Mock Test Title</label>
              <input
                required
                value={mockTitle}
                onChange={(e) => setMockTitle(e.target.value)}
                placeholder="e.g. BPSC 71st Prelims Mock"
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Exam</label>
              <select
                value={mockExam}
                onChange={(e) => setMockExam(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.name}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-on-surface-variant mb-1">Max Questions</label>
              <input
                type="number"
                min={1}
                max={200}
                value={mockCount}
                onChange={(e) => setMockCount(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>
            <button
              type="submit"
              className="py-2 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary"
            >
              Publish Mock Test
            </button>
          </form>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mockTests.map((mt) => (
              <div key={mt.id} className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-2">
                <p className="text-[11px] font-semibold text-secondary">{mt.examName} · {mt.questionIds.length} Questions</p>
                <h4 className="font-headline text-base font-bold text-on-surface">{mt.title}</h4>
                <div className="flex justify-between pt-2 border-t border-outline-variant">
                  <button
                    type="button"
                    onClick={() => updateDoc(doc(db, 'mock_tests', mt.id), { active: !mt.active })}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                      mt.active ? 'bg-success-container text-on-success-container' : 'bg-surface-container-low text-on-surface-variant'
                    }`}
                  >
                    {mt.active ? 'Published' : 'Unpublished'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDoc(doc(db, 'mock_tests', mt.id))}
                    className="text-error text-xs font-semibold hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab: Current Affairs Collector & Moderation */}
      {subTab === 'news' && (
        <div className="space-y-5">
          <div className="p-5 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                <Newspaper className="w-4 h-4 text-secondary" /> Automated Daily Current Affairs Pipeline
              </h3>
              <p className="text-xs text-on-surface-variant mt-1">
                Collects grounded National, International, Economy, Science &amp; Bihar Current Affairs with bilingual summaries &amp; MCQs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={caDate}
                onChange={(e) => setCaDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
              <button
                type="button"
                disabled={collectingCa || aiCooldown.active}
                onClick={handleCollectCurrentAffairsNow}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${collectingCa ? 'animate-spin' : ''}`} />
                {aiCooldown.active
                  ? `Wait ${formatCooldownRemaining(aiCooldown.remainingSeconds)}`
                  : collectingCa
                    ? 'Collecting...'
                    : 'Collect Now (AI Search)'}
              </button>
              <button
                type="button"
                onClick={handleToggleCaPause}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low"
              >
                {caPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {caPaused ? 'Resume Daily Job' : 'Pause Daily Job'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentAffairs.map((ca) => (
              <div key={ca.id} className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-2">
                <div className="flex items-center justify-between text-xs text-on-surface-variant">
                  <span>{ca.category} · {ca.date}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-semibold ${
                      ca.status === 'published'
                        ? 'bg-success-container text-on-success-container'
                        : 'bg-warning-container text-on-warning-container'
                    }`}
                  >
                    {ca.status}
                  </span>
                </div>
                <h4 className="font-bold text-on-surface text-sm">{ca.titleEn}</h4>
                <p className="text-xs text-on-surface-variant line-clamp-2">{ca.summaryEn}</p>
                <div className="flex items-center gap-2 pt-2">
                  {ca.status !== 'published' && (
                    <button
                      type="button"
                      onClick={() => updateDoc(doc(db, 'current_affairs', ca.id), { status: 'published' })}
                      className="px-3 py-1 rounded-md bg-success text-on-success text-xs font-semibold"
                    >
                      Approve &amp; Publish
                    </button>
                  )}
                  {ca.status !== 'archived' && (
                    <button
                      type="button"
                      onClick={() => updateDoc(doc(db, 'current_affairs', ca.id), { status: 'archived' })}
                      className="px-3 py-1 rounded-md bg-surface-container-low text-on-surface-variant text-xs font-semibold"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-tab: GK Books PDF Permissions */}
      {subTab === 'books' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {gkBooks.map((book) => (
            <div key={book.id} className="p-4 rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm space-y-2">
              <p className="text-xs font-semibold text-secondary">{book.subject}</p>
              <h4 className="font-headline text-base font-bold text-on-surface">{book.title}</h4>
              <p className="text-xs text-on-surface-variant">{book.chapters.length} Chapters</p>
              <div className="pt-2 flex items-center justify-between border-t border-outline-variant">
                <span className="text-xs text-on-surface-variant">PDF Download:</span>
                <button
                  type="button"
                  onClick={() =>
                    updateDoc(doc(db, 'gk_books', book.id), {
                      pdfDownloadAllowed: !book.pdfDownloadAllowed,
                    })
                  }
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    book.pdfDownloadAllowed
                      ? 'bg-success-container text-on-success-container'
                      : 'bg-surface-container-low text-on-surface-variant'
                  }`}
                >
                  {book.pdfDownloadAllowed ? 'Authorized' : 'Online Read Only'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-tab: Student Attempts Audit */}
      {subTab === 'attempts' && (
        <div className="rounded-lg bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-surface-container-low text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Student</th>
                  <th className="text-left px-4 py-3 font-semibold">Exam</th>
                  <th className="text-right px-4 py-3 font-semibold">Questions</th>
                  <th className="text-right px-4 py-3 font-semibold">Marks</th>
                  <th className="text-right px-4 py-3 font-semibold">Accuracy</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {attempts.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-container-low">
                    <td className="px-4 py-3 text-on-surface font-medium">
                      {a.studentName} <span className="text-on-surface-variant font-mono">({a.studentCode})</span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{a.examName}</td>
                    <td className="px-4 py-3 text-right text-on-surface-variant tabular-nums">{a.totalQuestions}</td>
                    <td className="px-4 py-3 text-right text-on-surface tabular-nums font-medium">
                      {a.totalMarks}/{a.maxMarks}
                    </td>
                    <td className="px-4 py-3 text-right text-success font-semibold tabular-nums">{a.accuracy}%</td>
                    <td className="px-4 py-3 text-on-surface-variant capitalize">{a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQ && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 backdrop-blur-xs p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEditedQuestion}
            className="w-full max-w-2xl rounded-xl bg-surface-container-lowest border border-outline-variant shadow-xl p-6 space-y-4 text-on-surface"
          >
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <h3 className="font-headline text-lg font-bold text-primary">
                Edit Question · {editingQ.questionCode}
              </h3>
              <button
                type="button"
                onClick={() => setEditingQ(null)}
                className="p-1 text-on-surface-variant hover:text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={editExam}
                onChange={(e) => setEditExam(e.target.value)}
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.name}>
                    {ex.name}
                  </option>
                ))}
              </select>
              <input
                required
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                placeholder="Subject"
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
              <input
                required
                value={editChapter}
                onChange={(e) => setEditChapter(e.target.value)}
                placeholder="Chapter"
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
              <input
                required
                value={editTopic}
                onChange={(e) => setEditTopic(e.target.value)}
                placeholder="Topic"
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
              <select
                value={editDifficulty}
                onChange={(e) => setEditDifficulty(e.target.value as any)}
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              >
                <option value="easy">Easy</option>
                <option value="medium">Moderate</option>
                <option value="hard">Hard</option>
              </select>
              <input
                type="number"
                value={editYear}
                onChange={(e) => setEditYear(Number(e.target.value))}
                className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface tabular-nums"
              />
            </div>

            <textarea
              required
              rows={3}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {editOpts.map((val, idx) => (
                <input
                  key={idx}
                  required
                  value={val}
                  onChange={(e) => {
                    const next = [...editOpts] as [string, string, string, string];
                    next[idx] = e.target.value;
                    setEditOpts(next);
                  }}
                  placeholder={`Option ${['A', 'B', 'C', 'D'][idx]}`}
                  className="px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
                />
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <select
                value={editCorrectIdx}
                onChange={(e) => setEditCorrectIdx(Number(e.target.value))}
                className="sm:col-span-4 px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              >
                <option value={0}>Correct: Option A</option>
                <option value={1}>Correct: Option B</option>
                <option value={2}>Correct: Option C</option>
                <option value={3}>Correct: Option D</option>
              </select>
              <input
                value={editExplanation}
                onChange={(e) => setEditExplanation(e.target.value)}
                placeholder="Solution explanation..."
                className="sm:col-span-8 px-3 py-2 rounded-lg bg-surface border border-outline-variant text-xs text-on-surface"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPublished}
                  onChange={(e) => setEditPublished(e.target.checked)}
                />
                <span>Published &amp; Visible to Students</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingQ(null)}
                  className="px-4 py-2 rounded-lg border border-outline-variant text-xs font-semibold text-primary hover:bg-surface-container-low"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-60"
                >
                  {savingEdit ? 'Saving...' : 'Save & Re-Seal'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
