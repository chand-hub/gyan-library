import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Check,
  Filter,
  Loader2,
  Play,
  Shuffle,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  ExamCategory,
  ExamQuestion,
  MockTestRecord,
  QuestionDifficulty,
  TestAttemptRecord,
  TestType,
} from '../../types/library';
import { ActiveTestConfig } from './OnlineExamRunner';
import {
  fetchPublishedQuestionsFromFirestore,
  getSuggestedSubjectsForExam,
  selectCustomQuestions,
} from '../../lib/questionEngine';
import {
  SharedAiCooldownState,
  fetchServerAiStatus,
  formatCooldownRemaining,
  generateAiRequestId,
  readStoredAiCooldown,
  saveStoredAiCooldown,
} from '../../lib/aiClient';

interface CompetitiveExamHubProps {
  exams: ExamCategory[];
  questions: ExamQuestion[];
  mockTests: MockTestRecord[];
  attempts: TestAttemptRecord[];
  getIdToken: () => Promise<string | null>;
  onStartTest: (config: ActiveTestConfig) => void;
  onViewAttemptReport: (attempt: TestAttemptRecord) => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

const TEST_TYPES: Array<{ id: TestType; label: string; desc: string }> = [
  { id: 'pyq', label: 'Previous Year Questions (PYQ)', desc: 'Authentic past exam papers with negative marking' },
  { id: 'ai_mock', label: 'AI-Generated Mock Tests', desc: 'Fresh unseen exam-pattern questions built by AI' },
  { id: 'subject', label: 'Subject-Wise Practice', desc: 'Focused practice filtered by subject' },
  { id: 'chapter', label: 'Chapter-Wise Practice', desc: 'Target one or multiple chapters deeply' },
  { id: 'topic', label: 'Topic-Wise Practice', desc: 'Laser-focus on micro-topics & weak areas' },
  { id: 'current_affairs', label: 'Daily Current Affairs Quiz', desc: 'MCQs linked to verified national & Bihar news' },
  { id: 'full_length', label: 'Full-Length Examination', desc: 'Simulated full-syllabus timed test' },
];

const QUESTION_COUNT_PRESETS = [10, 20, 25, 50, 75, 100];

export const CompetitiveExamHub: React.FC<CompetitiveExamHubProps> = ({
  exams,
  questions,
  mockTests,
  attempts,
  getIdToken,
  onStartTest,
  onViewAttemptReport,
  onNotify,
}) => {
  const activeExams = useMemo(() => {
    return exams
      .filter((e) => e.active)
      .sort((a, b) => {
        const ac = questions.filter((q) => q.examName === a.name).length;
        const bc = questions.filter((q) => q.examName === b.name).length;
        if (ac > 0 && bc === 0) return -1;
        if (ac === 0 && bc > 0) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [exams, questions]);

  const [selectedExam, setSelectedExam] = useState<string>('');
  const effectiveExam = useMemo(() => {
    if (selectedExam && activeExams.some((e) => e.name === selectedExam)) {
      return selectedExam;
    }
    const withQuestions = activeExams.find((e) => questions.some((q) => q.examName === e.name));
    return withQuestions?.name || activeExams[0]?.name || '';
  }, [selectedExam, activeExams, questions]);

  const [testType, setTestType] = useState<TestType>('pyq');
  const [mode, setMode] = useState<'exam' | 'practice'>('exam');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<'mixed' | QuestionDifficulty>('mixed');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [customCountMode, setCustomCountMode] = useState<boolean>(false);
  const [customCountInput, setCustomCountInput] = useState<string>('30');
  const [timerEnabled, setTimerEnabled] = useState<boolean>(true);
  const [customDurationMinutes, setCustomDurationMinutes] = useState<number>(0);
  const [excludeAttempted, setExcludeAttempted] = useState<boolean>(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [preparingTest, setPreparingTest] = useState(false);
  const [aiCooldown, setAiCooldown] = useState<SharedAiCooldownState>(() => readStoredAiCooldown());

  useEffect(() => {
    let active = true;
    (async () => {
      const token = await getIdToken();
      if (!token || !active) return;
      const srv = await fetchServerAiStatus(token);
      if (srv && active) setAiCooldown(srv);
    })();
    return () => {
      active = false;
    };
  }, [getIdToken]);

  useEffect(() => {
    if (!aiCooldown.active) return;
    const t = setInterval(() => {
      setAiCooldown(readStoredAiCooldown());
    }, 1000);
    return () => clearInterval(t);
  }, [aiCooldown.active]);

  const selectedExamMeta = useMemo(
    () => exams.find((e) => e.name === effectiveExam),
    [exams, effectiveExam]
  );

  const attemptedQuestionIds = useMemo(() => {
    const set = new Set<string>();
    attempts.forEach((a) => {
      Object.keys(a.responses || {}).forEach((id) => set.add(id));
    });
    return set;
  }, [attempts]);

  const examScopedQuestions = useMemo(() => {
    if (testType === 'current_affairs') {
      return questions.filter((q) => q.source === 'current_affairs' && q.published !== false);
    }
    return questions.filter((q) => {
      if (q.published === false) return false;
      if (effectiveExam && q.examName !== effectiveExam) return false;
      if (testType === 'pyq') return q.source === 'pyq';
      return true;
    });
  }, [questions, effectiveExam, testType]);

  const availableYears = useMemo(
    () =>
      Array.from(new Set(examScopedQuestions.map((q) => q.examYear)))
        .filter((y) => y > 0)
        .sort((a, b) => b - a),
    [examScopedQuestions]
  );

  const suggestedSubjects = useMemo(
    () => getSuggestedSubjectsForExam(effectiveExam, examScopedQuestions),
    [effectiveExam, examScopedQuestions]
  );

  const availableChapters = useMemo(() => {
    const base =
      selectedSubjects.length === 0
        ? examScopedQuestions
        : examScopedQuestions.filter((q) => selectedSubjects.includes(q.subject));
    return Array.from(new Set(base.map((q) => q.chapter).filter(Boolean))).sort();
  }, [examScopedQuestions, selectedSubjects]);

  const availableTopics = useMemo(() => {
    let base = examScopedQuestions;
    if (selectedSubjects.length > 0) {
      base = base.filter((q) => selectedSubjects.includes(q.subject));
    }
    if (selectedChapters.length > 0) {
      base = base.filter((q) => selectedChapters.includes(q.chapter));
    }
    return Array.from(new Set(base.map((q) => q.topic).filter(Boolean))).sort();
  }, [examScopedQuestions, selectedSubjects, selectedChapters]);

  const availableShifts = useMemo(
    () =>
      Array.from(
        new Set(examScopedQuestions.map((q) => q.examShift || '').filter((s) => s.trim().length > 0))
      ).sort(),
    [examScopedQuestions]
  );

  const effectiveQuestionCount = useMemo(() => {
    if (customCountMode) {
      const parsed = Math.floor(Number(customCountInput) || 10);
      return Math.min(200, Math.max(1, parsed));
    }
    return Math.min(200, Math.max(1, questionCount));
  }, [customCountMode, customCountInput, questionCount]);

  const selectionPreview = useMemo(
    () =>
      selectCustomQuestions(questions, {
        examName: effectiveExam,
        testType,
        year: yearFilter,
        shift: shiftFilter,
        subjects: selectedSubjects,
        chapters: selectedChapters,
        topics: selectedTopics,
        difficulty: difficultyFilter,
        excludeAttempted,
        excludeAttemptedIds: attemptedQuestionIds,
        count: effectiveQuestionCount,
      }),
    [
      questions,
      effectiveExam,
      testType,
      yearFilter,
      shiftFilter,
      selectedSubjects,
      selectedChapters,
      selectedTopics,
      difficultyFilter,
      excludeAttempted,
      attemptedQuestionIds,
      effectiveQuestionCount,
    ]
  );

  const candidatePoolCount = excludeAttempted
    ? selectionPreview.unseenCount
    : selectionPreview.totalMatching;

  const toggleMulti = (
    val: string,
    current: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    onClearChildren?: () => void
  ) => {
    setter(
      current.includes(val) ? current.filter((x) => x !== val) : [...current, val]
    );
    if (onClearChildren) onClearChildren();
  };

  const handleLaunchFilteredTest = async (useAllAvailableIfShort = false) => {
    setPreparingTest(true);
    try {
      let sourceQuestions = questions;
      if (selectionPreview.selected.length === 0) {
        // Perform live paginated Firestore check in case listener subset missed items
        const fetched = await fetchPublishedQuestionsFromFirestore({
          examName: testType === 'current_affairs' ? undefined : effectiveExam,
          subject: selectedSubjects.length === 1 ? selectedSubjects[0] : undefined,
          difficulty: difficultyFilter,
          maxFetch: 500,
        });
        if (fetched.length > 0) {
          sourceQuestions = fetched;
        }
      }

      const finalPick = selectCustomQuestions(sourceQuestions, {
        examName: effectiveExam,
        testType,
        year: yearFilter,
        shift: shiftFilter,
        subjects: selectedSubjects,
        chapters: selectedChapters,
        topics: selectedTopics,
        difficulty: difficultyFilter,
        excludeAttempted,
        excludeAttemptedIds: attemptedQuestionIds,
        count: useAllAvailableIfShort
          ? Math.max(1, candidatePoolCount)
          : effectiveQuestionCount,
      });

      if (finalPick.selected.length === 0) {
        onNotify(
          'err',
          excludeAttempted && finalPick.totalMatching > 0
            ? 'All matching questions have already been attempted. Disable "Unseen Only" or generate a fresh AI Mock Test.'
            : 'No published questions match your selected filters yet. Try choosing All Chapters/Subjects or Generate Fresh AI Mock.'
        );
        return;
      }

      const marks = selectedExamMeta?.marksPerCorrect ?? 2;
      const neg = selectedExamMeta?.negativeMarks ?? 0.5;
      const defaultDuration =
        testType === 'full_length'
          ? selectedExamMeta?.defaultDurationMinutes ?? Math.max(20, Math.round(finalPick.selected.length * 1.2))
          : Math.max(5, Math.round(finalPick.selected.length * 1.25));
      const finalDuration =
        customDurationMinutes > 0 ? customDurationMinutes : defaultDuration;

      onStartTest({
        title: `${effectiveExam || 'Competitive'} · ${
          selectedSubjects.length === 1 ? selectedSubjects[0] : TEST_TYPES.find((t) => t.id === testType)?.label || 'Custom Test'
        }`,
        examName: effectiveExam || 'General',
        testType,
        mode,
        subject: selectedSubjects.length > 0 ? selectedSubjects.join(', ') : undefined,
        chapter: selectedChapters.length > 0 ? selectedChapters.join(', ') : undefined,
        topic: selectedTopics.length > 0 ? selectedTopics.join(', ') : undefined,
        questions: finalPick.selected,
        durationMinutes: finalDuration,
        marksPerCorrect: marks,
        negativeMarks: neg,
        isTimed: timerEnabled && mode === 'exam',
      });
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to prepare test session.');
    } finally {
      setPreparingTest(false);
    }
  };

  const handleGenerateAiMock = async () => {
    if (!effectiveExam || aiGenerating) return;
    const curCd = readStoredAiCooldown();
    if (curCd.active) {
      setAiCooldown(curCd);
      onNotify(
        'err',
        `AI generator is in shared cooldown (${formatCooldownRemaining(curCd.remainingSeconds)} remaining).`
      );
      return;
    }

    setAiGenerating(true);
    const requestId = generateAiRequestId('mock');
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');

      const targetCount = Math.min(100, Math.max(1, effectiveQuestionCount));
      const excludeNormalized = questions
        .filter((q) => attemptedQuestionIds.has(q.id))
        .map((q) => q.normalizedText)
        .slice(0, 35);

      const res = await fetch('/api/exams/ai-generate-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': requestId,
        },
        body: JSON.stringify({
          requestId,
          examName: effectiveExam,
          subject: selectedSubjects.length > 0 ? selectedSubjects.join(', ') : 'Core Syllabus',
          chapters: selectedChapters.length > 0 ? selectedChapters : undefined,
          chapter: selectedChapters.length === 1 ? selectedChapters[0] : 'High-Yield Syllabus',
          topics: selectedTopics.length > 0 ? selectedTopics : undefined,
          topic: selectedTopics.length === 1 ? selectedTopics[0] : 'Exam Pattern MCQs',
          difficulty: difficultyFilter,
          count: targetCount,
          language: 'en',
          excludeNormalized,
          includeKeys: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.cooldownUntil || data.cooldownRemainingSeconds > 0) {
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

      const rawQs: any[] = data.questions || [];
      if (rawQs.length === 0) {
        throw new Error('AI returned 0 valid questions. Try adjusting your subject or difficulty filters.');
      }

      // Build in-session sealed ExamQuestion objects directly without client-side writes to shared question bank
      const readyQuestions: ExamQuestion[] = rawQs.map((q, idx) => ({
        id: q.id,
        questionCode: `Q-AI-${Date.now().toString().slice(-4)}-${idx + 1}`,
        examName: effectiveExam,
        examCategory: selectedExamMeta?.categoryGroup || 'Competitive',
        subject: q.subject || selectedSubjects[0] || 'General Studies',
        chapter: q.chapter || selectedChapters[0] || 'Core Syllabus',
        topic: q.topic || selectedTopics[0] || 'Exam Concepts',
        questionText: q.questionText,
        options: q.options,
        difficulty: q.difficulty || 'medium',
        examYear: new Date().getFullYear(),
        source: 'ai_generated',
        language: q.language || 'en',
        verificationStatus: 'ai_derived',
        published: false,
        fingerprint: q.fingerprint,
        normalizedText: q.normalizedText,
        answerSeal: q.answerSeal,
        createdAt: null,
        updatedAt: null,
      }));

      const finalDuration =
        customDurationMinutes > 0
          ? customDurationMinutes
          : Math.max(5, Math.round(readyQuestions.length * 1.25));

      onNotify('ok', `Generated ${readyQuestions.length} fresh unseen AI questions. Launching test...`);
      onStartTest({
        title: `${effectiveExam} · AI Custom Mock (${readyQuestions.length} Qs)`,
        examName: effectiveExam,
        testType: 'ai_mock',
        mode,
        subject: selectedSubjects.length > 0 ? selectedSubjects.join(', ') : undefined,
        chapter: selectedChapters.length > 0 ? selectedChapters.join(', ') : undefined,
        topic: selectedTopics.length > 0 ? selectedTopics.join(', ') : undefined,
        questions: readyQuestions,
        durationMinutes: finalDuration,
        marksPerCorrect: selectedExamMeta?.marksPerCorrect ?? 2,
        negativeMarks: selectedExamMeta?.negativeMarks ?? 0.5,
        isTimed: timerEnabled && mode === 'exam',
      });
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to generate AI Mock Test.');
    } finally {
      setAiGenerating(false);
    }
  };

  const submittedAttempts = useMemo(
    () =>
      attempts
        .filter((a) => a.status === 'submitted')
        .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '')),
    [attempts]
  );

  const publishedMockTests = useMemo(
    () => mockTests.filter((m) => m.active && (!effectiveExam || m.examName === effectiveExam)),
    [mockTests, effectiveExam]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#B5ADC6]">AI Examination &amp; Practice Portal</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Competitive Exam Hub
          </h2>
          <p className="text-xs text-[#CFCEDD] mt-0.5">
            Customize question counts (10 to 100+ MCQs), multi-chapter selection, difficulty mix, and timed CBT simulation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0E0713] border border-[#514871]">
            <button
              type="button"
              onClick={() => {
                setMode('exam');
                setTimerEnabled(true);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'exam' ? 'bg-[#B5ADC6] text-[#0E0713]' : 'text-[#CFCEDD]'
              }`}
            >
              Timed Exam Mode
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('practice');
                setTimerEnabled(false);
              }}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'practice' ? 'bg-[#B5ADC6] text-[#0E0713]' : 'text-[#CFCEDD]'
              }`}
            >
              Untimed Practice
            </button>
          </div>
        </div>
      </div>

      {/* Exam Selector Grid */}
      {activeExams.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#3D2C56] border border-[#7C7397] text-center space-y-2">
          <BookOpen className="w-8 h-8 text-[#B5ADC6] mx-auto" />
          <p className="text-sm font-semibold text-white">Question Bank Initialization Pending</p>
          <p className="text-xs text-[#CFCEDD]">
            Ask your library administrator to sync the Exam Categories &amp; Question Bank from the Admin Console.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#B5ADC6] uppercase tracking-wider">
              A. Select Target Examination ({activeExams.length} Tracks Available)
            </label>
            <div className="flex flex-wrap gap-2">
              {activeExams.map((ex) => {
                const count = questions.filter((q) => q.examName === ex.name && q.published !== false).length;
                const active = effectiveExam === ex.name;
                return (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => {
                      setSelectedExam(ex.name);
                      setYearFilter('ALL');
                      setSelectedSubjects([]);
                      setSelectedChapters([]);
                      setSelectedTopics([]);
                      setShiftFilter('ALL');
                    }}
                    className={`px-3.5 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713]'
                        : 'bg-[#3D2C56] border-[#7C7397]/60 text-white hover:bg-[#514871]'
                    }`}
                  >
                    {ex.name}{' '}
                    <span className="opacity-75 tabular-nums">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Test Type Selector */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#B5ADC6] uppercase tracking-wider">
              B. Select Test Format
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {TEST_TYPES.map((t) => {
                const active = testType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTestType(t.id)}
                    className={`text-left p-3.5 rounded-xl border transition-colors ${
                      active
                        ? 'bg-[#675D85] border-[#B5ADC6] text-white'
                        : 'bg-[#3D2C56] border-[#7C7397]/50 text-[#CFCEDD] hover:bg-[#514871]'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">{t.label}</p>
                    <p className="text-[11px] text-[#CFCEDD] mt-1 line-clamp-2">{t.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Dynamic Custom Test Builder */}
          <div className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#514871]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Filter className="w-4 h-4 text-[#B5ADC6]" /> C. Custom Test Configuration
              </h3>
              {selectedExamMeta && (
                <p className="text-xs text-[#CFCEDD] tabular-nums">
                  Marking: +{selectedExamMeta.marksPerCorrect} / −{selectedExamMeta.negativeMarks} · Randomized Non-Repeating Draw
                </p>
              )}
            </div>

            {/* Subjects Multi-Select Pills */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#CFCEDD]">
                  Subjects ({selectedSubjects.length === 0 ? 'All Subjects' : `${selectedSubjects.length} selected`})
                </label>
                {selectedSubjects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSubjects([]);
                      setSelectedChapters([]);
                      setSelectedTopics([]);
                    }}
                    className="text-[11px] text-[#B5ADC6] hover:text-white underline"
                  >
                    Reset to All Subjects
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSubjects([]);
                    setSelectedChapters([]);
                    setSelectedTopics([]);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    selectedSubjects.length === 0
                      ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713]'
                      : 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD] hover:bg-[#514871]'
                  }`}
                >
                  All Subjects
                </button>
                {suggestedSubjects.map((subj) => {
                  const active = selectedSubjects.includes(subj);
                  const subjCount = examScopedQuestions.filter((q) => q.subject === subj).length;
                  return (
                    <button
                      key={subj}
                      type="button"
                      onClick={() =>
                        toggleMulti(subj, selectedSubjects, setSelectedSubjects, () => {
                          setSelectedChapters([]);
                          setSelectedTopics([]);
                        })
                      }
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        active
                          ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713] font-bold'
                          : 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD] hover:bg-[#514871]'
                      }`}
                    >
                      {active && <Check className="w-3 h-3" />}
                      <span>{subj}</span>
                      <span className="opacity-70 tabular-nums">({subjCount})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Multi-Chapter Selection */}
            {availableChapters.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#CFCEDD]">
                    Chapters ({selectedChapters.length === 0 ? 'All Chapters' : `${selectedChapters.length} selected`})
                  </label>
                  {selectedChapters.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedChapters([]);
                        setSelectedTopics([]);
                      }}
                      className="text-[11px] text-[#B5ADC6] hover:text-white underline"
                    >
                      Select All Chapters
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChapters([]);
                      setSelectedTopics([]);
                    }}
                    className={`px-2.5 py-1 rounded-md text-xs border ${
                      selectedChapters.length === 0
                        ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713] font-bold'
                        : 'bg-[#1C0E29] border-[#7C7397]/50 text-[#CFCEDD]'
                    }`}
                  >
                    All Chapters ({availableChapters.length})
                  </button>
                  {availableChapters.map((chap) => {
                    const active = selectedChapters.includes(chap);
                    return (
                      <button
                        key={chap}
                        type="button"
                        onClick={() =>
                          toggleMulti(chap, selectedChapters, setSelectedChapters, () =>
                            setSelectedTopics([])
                          )
                        }
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border ${
                          active
                            ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713] font-bold'
                            : 'bg-[#1C0E29] border-[#7C7397]/50 text-[#CFCEDD] hover:bg-[#514871]'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                        <span>{chap}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Multi-Topic Selection */}
            {availableTopics.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#CFCEDD]">
                    Topics ({selectedTopics.length === 0 ? 'All Topics' : `${selectedTopics.length} selected`})
                  </label>
                  {selectedTopics.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTopics([])}
                      className="text-[11px] text-[#B5ADC6] hover:text-white underline"
                    >
                      Select All Topics
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setSelectedTopics([])}
                    className={`px-2.5 py-1 rounded-md text-xs border ${
                      selectedTopics.length === 0
                        ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713] font-bold'
                        : 'bg-[#1C0E29] border-[#7C7397]/50 text-[#CFCEDD]'
                    }`}
                  >
                    All Topics ({availableTopics.length})
                  </button>
                  {availableTopics.map((tp) => {
                    const active = selectedTopics.includes(tp);
                    return (
                      <button
                        key={tp}
                        type="button"
                        onClick={() => toggleMulti(tp, selectedTopics, setSelectedTopics)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border ${
                          active
                            ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713] font-bold'
                            : 'bg-[#1C0E29] border-[#7C7397]/50 text-[#CFCEDD] hover:bg-[#514871]'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                        <span>{tp}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Difficulty + Question Count + Year/Shift/Timer Row */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Difficulty Selector */}
              <div className="lg:col-span-4 space-y-1.5">
                <label className="block text-xs font-semibold text-[#CFCEDD]">Difficulty Level</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      ['mixed', 'Mixed'],
                      ['easy', 'Easy'],
                      ['medium', 'Moderate'],
                      ['hard', 'Hard'],
                    ] as const
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDifficultyFilter(val)}
                      className={`py-2 px-2 rounded-lg border text-xs font-semibold transition-colors ${
                        difficultyFilter === val
                          ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713]'
                          : 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD] hover:bg-[#514871]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Question Count Selector (10, 20, 25, 50, 75, 100 + Custom) */}
              <div className="lg:col-span-5 space-y-1.5">
                <label className="block text-xs font-semibold text-[#CFCEDD]">
                  Number of Questions (1 to 200)
                </label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {QUESTION_COUNT_PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setCustomCountMode(false);
                        setQuestionCount(n);
                      }}
                      className={`px-3 py-2 rounded-lg border text-xs font-bold tabular-nums transition-colors ${
                        !customCountMode && questionCount === n
                          ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713]'
                          : 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD] hover:bg-[#514871]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCustomCountMode(true)}
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                      customCountMode
                        ? 'bg-[#B5ADC6] border-[#B5ADC6] text-[#0E0713]'
                        : 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD] hover:bg-[#514871]'
                    }`}
                  >
                    Custom
                  </button>
                  {customCountMode && (
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={customCountInput}
                      onChange={(e) => setCustomCountInput(e.target.value)}
                      className="w-20 px-2.5 py-2 rounded-lg bg-[#1C0E29] border border-[#B5ADC6] text-xs font-bold text-white tabular-nums"
                      aria-label="Custom question count"
                    />
                  )}
                </div>
              </div>

              {/* Year / Timer / Shift */}
              <div className="lg:col-span-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-[#CFCEDD] mb-1">Exam Year</label>
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white"
                  >
                    <option value="ALL">All Years ({availableYears.length})</option>
                    {availableYears.map((y) => (
                      <option key={y} value={String(y)}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-[#CFCEDD] mb-1">Timer (mins)</label>
                  <input
                    type="number"
                    min={0}
                    max={300}
                    placeholder="Auto"
                    value={customDurationMinutes || ''}
                    onChange={(e) => setCustomDurationMinutes(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2.5 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white tabular-nums"
                  />
                </div>
              </div>
            </div>

            {availableShifts.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#CFCEDD]">Exam Shift:</span>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white"
                >
                  <option value="ALL">All Shifts</option>
                  {availableShifts.map((sh) => (
                    <option key={sh} value={sh}>
                      {sh}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Insufficient Question Pool Warning */}
            {selectionPreview.insufficientBy > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-100">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-200">
                      Only {candidatePoolCount} published question{candidatePoolCount === 1 ? '' : 's'} currently available for this exact filter (requested {effectiveQuestionCount}).
                    </p>
                    <p className="text-amber-100/80 mt-0.5">
                      You can start right away with the available {candidatePoolCount} questions, broaden chapters/subjects, or generate {Math.min(100, effectiveQuestionCount)} fresh AI practice questions.
                    </p>
                  </div>
                </div>
                {candidatePoolCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleLaunchFilteredTest(true)}
                    disabled={preparingTest}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-400 text-[#0E0713] font-bold whitespace-nowrap hover:bg-amber-300 shrink-0"
                  >
                    Start with {candidatePoolCount} Qs
                  </button>
                )}
              </div>
            )}

            {/* Live Stats & Launch Controls */}
            <div className="pt-3 border-t border-[#514871] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeAttempted}
                      onChange={(e) => setExcludeAttempted(e.target.checked)}
                    />
                    <span>Unseen Only (exclude attempted)</span>
                  </label>
                  {mode === 'exam' && (
                    <label className="inline-flex items-center gap-2 text-xs text-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={timerEnabled}
                        onChange={(e) => setTimerEnabled(e.target.checked)}
                      />
                      <span>Countdown Timer &amp; Auto-Submit</span>
                    </label>
                  )}
                </div>
                <p className="text-xs text-[#CFCEDD] tabular-nums flex items-center gap-2">
                  <Shuffle className="w-3.5 h-3.5 text-[#B5ADC6]" />
                  <span>
                    Available in Bank: <strong className="text-white">{selectionPreview.totalMatching}</strong> · Unseen Remaining:{' '}
                    <strong className="text-white">{selectionPreview.unseenCount}</strong> · Selected to Launch:{' '}
                    <strong className="text-[#B5ADC6]">{selectionPreview.selected.length}</strong>
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleGenerateAiMock}
                  disabled={aiGenerating || preparingTest || aiCooldown.active}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#675D85] border border-[#B5ADC6] text-white text-xs sm:text-sm font-semibold hover:bg-[#7C7397] transition-colors disabled:opacity-60"
                >
                  {aiGenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#B5ADC6]" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-[#B5ADC6]" />
                  )}
                  {aiGenerating
                    ? `Generating ${Math.min(100, effectiveQuestionCount)} AI MCQs...`
                    : aiCooldown.active
                      ? `AI Cooldown (${formatCooldownRemaining(aiCooldown.remainingSeconds)})`
                      : `Generate ${Math.min(100, effectiveQuestionCount)} AI Questions`}
                </button>

                <button
                  type="button"
                  onClick={() => handleLaunchFilteredTest(false)}
                  disabled={preparingTest || aiGenerating || selectionPreview.selected.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs sm:text-sm font-bold hover:bg-white transition-colors disabled:opacity-40"
                >
                  {preparingTest ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {preparingTest
                    ? 'Preparing Test...'
                    : `Start ${mode === 'exam' ? 'Exam' : 'Practice'} (${selectionPreview.selected.length} Qs)`}
                </button>
              </div>
            </div>
          </div>

          {/* Curated Admin Mock Tests */}
          {publishedMockTests.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-[#B5ADC6]" /> Assigned Full-Length &amp; Curated Mock Tests
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {publishedMockTests.map((mt) => {
                  const testQs = questions.filter((q) => mt.questionIds.includes(q.id));
                  return (
                    <div
                      key={mt.id}
                      className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <p className="text-[11px] text-[#B5ADC6]">
                          {mt.examName} · {mt.durationMinutes} mins · {testQs.length} Qs
                        </p>
                        <h4 className="font-display text-base font-bold text-white mt-1">{mt.title}</h4>
                        <p className="text-xs text-[#CFCEDD] mt-1 tabular-nums">
                          +{mt.marksPerCorrect} / −{mt.negativeMarks} Negative Marking
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={testQs.length === 0}
                        onClick={() =>
                          onStartTest({
                            title: mt.title,
                            examName: mt.examName,
                            testType: mt.testType,
                            mode: mt.isTimed ? 'exam' : 'practice',
                            questions: testQs,
                            durationMinutes: mt.durationMinutes,
                            marksPerCorrect: mt.marksPerCorrect,
                            negativeMarks: mt.negativeMarks,
                            isTimed: mt.isTimed,
                          })
                        }
                        className="w-full py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white disabled:opacity-40"
                      >
                        Launch Mock Test
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Past Attempts History */}
          <div className="rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#514871] flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#B5ADC6]" /> Recent Exam Attempts &amp; Performance Reports
              </h3>
              <span className="text-xs text-[#CFCEDD] tabular-nums">
                {submittedAttempts.length} Completed
              </span>
            </div>

            {submittedAttempts.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#CFCEDD]">
                Complete your first test or practice session above to unlock detailed subject, chapter, difficulty &amp; AI performance analytics.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-[#0E0713]/60 text-[#B5ADC6]">
                    <tr>
                      <th className="text-left px-4 py-3">Exam</th>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-right px-4 py-3">Questions</th>
                      <th className="text-right px-4 py-3">Score</th>
                      <th className="text-right px-4 py-3">Accuracy</th>
                      <th className="text-left px-4 py-3">Weak Topics</th>
                      <th className="text-right px-4 py-3">Report</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#514871]">
                    {submittedAttempts.slice(0, 15).map((att) => (
                      <tr key={att.id}>
                        <td className="px-4 py-3 font-semibold text-white">
                          {att.examName} <span className="text-[#B5ADC6] font-normal">· {att.mode}</span>
                        </td>
                        <td className="px-4 py-3 text-[#CFCEDD] tabular-nums">
                          {att.submittedAt?.slice(0, 10) || '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-[#CFCEDD] tabular-nums">
                          {att.totalQuestions}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-white tabular-nums">
                          {att.totalMarks} / {att.maxMarks} ({att.percentage}%)
                        </td>
                        <td className="px-4 py-3 text-right text-emerald-300 tabular-nums">
                          {att.accuracy}%
                        </td>
                        <td className="px-4 py-3 text-xs text-amber-200 max-w-xs truncate">
                          {(att.weakTopics || []).join(', ') || 'None flagged'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => onViewAttemptReport(att)}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[#675D85] text-white text-xs font-semibold hover:bg-[#7C7397]"
                          >
                            <Target className="w-3.5 h-3.5" /> View Analytics
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
