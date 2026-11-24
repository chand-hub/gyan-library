import {
  collection,
  getDocs,
  limit,
  query,
  QueryConstraint,
  QueryDocumentSnapshot,
  startAfter,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  ExamQuestion,
  QuestionDifficulty,
  TestAttemptRecord,
  TestType,
} from '../types/library';

export const ALL_STANDARD_COMPETITIVE_SUBJECTS: string[] = [
  'General Knowledge',
  'General Science',
  'Mathematics',
  'Reasoning',
  'English',
  'Indian Polity',
  'Indian History',
  'Indian Geography',
  'Indian Economy',
  'Current Affairs',
  'Bihar GK',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Awareness',
];

export const EXAM_SUBJECT_MAP: Record<string, string[]> = {
  'SSC CGL': ['Mathematics', 'Reasoning', 'English', 'General Knowledge', 'General Science', 'Current Affairs', 'Computer Awareness'],
  'SSC CHSL': ['Mathematics', 'Reasoning', 'English', 'General Knowledge', 'General Science', 'Current Affairs'],
  'SSC MTS': ['Mathematics', 'Reasoning', 'English', 'General Knowledge', 'General Science'],
  'BPSC': ['Bihar GK', 'Indian History', 'Indian Polity', 'Indian Geography', 'Indian Economy', 'General Science', 'Current Affairs', 'Mathematics'],
  'UPSC': ['Indian Polity', 'Indian History', 'Indian Geography', 'Indian Economy', 'General Science', 'Current Affairs'],
  'Railway NTPC': ['Mathematics', 'Reasoning', 'General Knowledge', 'General Science', 'Current Affairs'],
  'Railway Group D': ['Mathematics', 'Reasoning', 'General Science', 'General Knowledge', 'Current Affairs'],
  'Banking examinations': ['Mathematics', 'Reasoning', 'English', 'General Knowledge', 'Indian Economy', 'Computer Awareness'],
  'NDA': ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'Indian History', 'Indian Geography', 'Indian Polity'],
  'Bihar Police': ['Bihar GK', 'General Knowledge', 'General Science', 'Mathematics', 'Indian Polity', 'Indian History'],
  'Bihar SSC': ['Bihar GK', 'Mathematics', 'Reasoning', 'General Science', 'General Knowledge', 'Current Affairs'],
  'NEET UG': ['Biology', 'Physics', 'Chemistry'],
  'JEE Main': ['Physics', 'Chemistry', 'Mathematics'],
  'JEE Advanced': ['Physics', 'Chemistry', 'Mathematics'],
};

export function getSuggestedSubjectsForExam(examName: string, pool: ExamQuestion[]): string[] {
  const fromPool = new Set(
    pool
      .filter((q) => !examName || q.examName === examName)
      .map((q) => q.subject)
      .filter(Boolean)
  );
  const curated = EXAM_SUBJECT_MAP[examName] || [];
  const merged = new Set<string>([...fromPool, ...curated]);
  if (merged.size === 0) {
    ALL_STANDARD_COMPETITIVE_SUBJECTS.forEach((s) => merged.add(s));
  }
  return Array.from(merged).sort((a, b) => {
    const aHas = fromPool.has(a) ? 0 : 1;
    const bHas = fromPool.has(b) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return a.localeCompare(b);
  });
}

export function shuffleFisherYates<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function deduplicateQuestions(items: ExamQuestion[]): ExamQuestion[] {
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const result: ExamQuestion[] = [];
  for (const q of items) {
    if (!q?.id || seenIds.has(q.id)) continue;
    const fp = q.fingerprint || q.normalizedText || q.questionText.trim().toLowerCase();
    if (fp && seenFingerprints.has(fp)) continue;
    seenIds.add(q.id);
    if (fp) seenFingerprints.add(fp);
    result.push(q);
  }
  return result;
}

export interface QuestionSelectionOptions {
  examName?: string;
  testType?: TestType;
  year?: string;
  shift?: string;
  subjects?: string[];
  chapters?: string[];
  topics?: string[];
  difficulty?: 'mixed' | QuestionDifficulty;
  excludeAttempted?: boolean;
  excludeAttemptedIds?: Set<string>;
  count: number;
}

export interface QuestionSelectionResult {
  matchingAll: ExamQuestion[];
  unseenMatching: ExamQuestion[];
  selected: ExamQuestion[];
  totalMatching: number;
  unseenCount: number;
  requestedCount: number;
  insufficientBy: number;
}

export function selectCustomQuestions(
  pool: ExamQuestion[],
  options: QuestionSelectionOptions
): QuestionSelectionResult {
  const requestedCount = Math.max(1, Math.floor(options.count || 10));
  const subjectsSet = new Set((options.subjects || []).filter((s) => s && s !== 'ALL'));
  const chaptersSet = new Set((options.chapters || []).filter((c) => c && c !== 'ALL'));
  const topicsSet = new Set((options.topics || []).filter((t) => t && t !== 'ALL'));

  const filteredRaw = pool.filter((q) => {
    if (q.published === false) return false;
    if (options.testType === 'current_affairs') {
      if (q.source !== 'current_affairs') return false;
    } else if (options.examName && options.examName !== 'ALL' && q.examName !== options.examName) {
      return false;
    }
    if (options.testType === 'pyq' && q.source !== 'pyq') return false;
    if (options.year && options.year !== 'ALL' && String(q.examYear) !== options.year) return false;
    if (options.shift && options.shift !== 'ALL' && (q.examShift || '') !== options.shift) return false;
    if (subjectsSet.size > 0 && !subjectsSet.has(q.subject)) return false;
    if (chaptersSet.size > 0 && !chaptersSet.has(q.chapter)) return false;
    if (topicsSet.size > 0 && !topicsSet.has(q.topic)) return false;
    if (options.difficulty && options.difficulty !== 'mixed' && q.difficulty !== options.difficulty) {
      return false;
    }
    return true;
  });

  const matchingAll = deduplicateQuestions(filteredRaw);
  const attempted = options.excludeAttemptedIds || new Set<string>();
  const unseenMatching = matchingAll.filter((q) => !attempted.has(q.id));

  const candidatePool = options.excludeAttempted ? unseenMatching : matchingAll;

  let picked: ExamQuestion[];
  if (!options.difficulty || options.difficulty === 'mixed') {
    // Balanced randomized draw across easy, medium, hard buckets
    const easy = shuffleFisherYates(candidatePool.filter((q) => q.difficulty === 'easy'));
    const medium = shuffleFisherYates(candidatePool.filter((q) => q.difficulty === 'medium'));
    const hard = shuffleFisherYates(candidatePool.filter((q) => q.difficulty === 'hard'));

    const balanced: ExamQuestion[] = [];
    const target = Math.min(requestedCount, candidatePool.length);
    const quotas = [
      { arr: easy, take: Math.round(target * 0.3) },
      { arr: medium, take: Math.round(target * 0.45) },
      { arr: hard, take: Math.max(0, target - Math.round(target * 0.3) - Math.round(target * 0.45)) },
    ];
    const usedIds = new Set<string>();

    for (const bucket of quotas) {
      for (let i = 0; i < bucket.take && i < bucket.arr.length && balanced.length < target; i++) {
        balanced.push(bucket.arr[i]);
        usedIds.add(bucket.arr[i].id);
      }
    }

    if (balanced.length < target) {
      const leftovers = shuffleFisherYates(candidatePool.filter((q) => !usedIds.has(q.id)));
      for (const q of leftovers) {
        if (balanced.length >= target) break;
        balanced.push(q);
      }
    }

    picked = shuffleFisherYates(balanced);
  } else {
    picked = shuffleFisherYates(candidatePool).slice(0, Math.min(requestedCount, candidatePool.length));
  }

  return {
    matchingAll,
    unseenMatching,
    selected: picked,
    totalMatching: matchingAll.length,
    unseenCount: unseenMatching.length,
    requestedCount,
    insufficientBy: Math.max(0, requestedCount - candidatePool.length),
  };
}

export async function fetchPublishedQuestionsFromFirestore(params: {
  examName?: string;
  subject?: string;
  difficulty?: QuestionDifficulty | 'mixed';
  maxFetch?: number;
}): Promise<ExamQuestion[]> {
  const maxFetch = Math.min(1000, Math.max(50, params.maxFetch || 500));
  const collected: ExamQuestion[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  const pageSize = 250;

  while (collected.length < maxFetch) {
    const constraints: QueryConstraint[] = [where('published', '==', true)];
    if (params.examName && params.examName !== 'ALL') {
      constraints.push(where('examName', '==', params.examName));
    }
    if (params.subject && params.subject !== 'ALL') {
      constraints.push(where('subject', '==', params.subject));
    }
    if (params.difficulty && params.difficulty !== 'mixed') {
      constraints.push(where('difficulty', '==', params.difficulty));
    }
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
    constraints.push(limit(Math.min(pageSize, maxFetch - collected.length)));

    const snap = await getDocs(query(collection(db, 'questions'), ...constraints));
    if (snap.empty) break;

    snap.docs.forEach((d) => {
      collected.push({ ...(d.data() as ExamQuestion), id: d.id });
    });

    if (snap.docs.length < pageSize) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return deduplicateQuestions(collected);
}

export function computeQuestionUsageCounts(attempts: TestAttemptRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const att of attempts) {
    const ids = Array.isArray(att.questionIds) ? att.questionIds : [];
    for (const qId of ids) {
      counts.set(qId, (counts.get(qId) || 0) + 1);
    }
  }
  return counts;
}
