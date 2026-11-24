import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  Maximize2,
  Minimize2,
  SkipForward,
  XCircle,
} from 'lucide-react';
import { ExamQuestion, TestAttemptRecord, TestType } from '../../types/library';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';

export interface ActiveTestConfig {
  title: string;
  examName: string;
  testType: TestType;
  mode: 'exam' | 'practice';
  subject?: string;
  chapter?: string;
  topic?: string;
  questions: ExamQuestion[];
  durationMinutes: number;
  marksPerCorrect: number;
  negativeMarks: number;
  isTimed: boolean;
}

interface OnlineExamRunnerProps {
  config: ActiveTestConfig;
  studentUid: string;
  studentDocId?: string;
  studentCode: string;
  studentName: string;
  getIdToken: () => Promise<string | null>;
  onComplete: (attempt: TestAttemptRecord) => void;
  onExit: () => void;
}

export const OnlineExamRunner: React.FC<OnlineExamRunnerProps> = ({
  config,
  studentUid,
  studentDocId,
  studentCode,
  studentName,
  getIdToken,
  onComplete,
  onExit,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [attemptId, setAttemptId] = useState<string>('');
  const [startedAtIso] = useState<string>(() => new Date().toISOString());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [markedForReview, setMarkedForReview] = useState<string[]>([]);
  const [timeSpentByQuestion, setTimeSpentByQuestion] = useState<Record<string, number>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    config.isTimed ? Math.max(60, config.durationMinutes * 60) : 0
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Practice mode instant check cache
  const [practiceChecks, setPracticeChecks] = useState<
    Record<string, { isCorrect: boolean; correctIndex: number; explanation: string }>
  >({});
  const [checkingPractice, setCheckingPractice] = useState(false);

  const currentQuestion = config.questions[currentIdx];
  const autoSubmittedRef = useRef(false);

  // Initialize signed server attempt & Firestore in-progress draft
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch('/api/exams/start-attempt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            examName: config.examName,
            testType: config.testType,
            mode: config.mode,
            questionIds: config.questions.map((q) => q.id),
          }),
        });
        const data = await res.json();
        if (!res.ok || !active) return;

        const id = data.attemptId;
        setAttemptId(id);

        await setDoc(doc(db, 'test_attempts', id), {
          studentUid,
          studentDocId: studentDocId || '',
          studentCode,
          studentName,
          examName: config.examName,
          testType: config.testType,
          mode: config.mode,
          subject: config.subject || '',
          chapter: config.chapter || '',
          topic: config.topic || '',
          questionIds: config.questions.map((q) => q.id),
          responses: {},
          markedForReview: [],
          timeSpentByQuestion: {},
          totalQuestions: config.questions.length,
          correctCount: 0,
          incorrectCount: 0,
          unansweredCount: config.questions.length,
          totalMarks: 0,
          maxMarks: config.questions.length * config.marksPerCorrect,
          percentage: 0,
          accuracy: 0,
          timeTakenSeconds: 0,
          subjectBreakdown: [],
          chapterBreakdown: [],
          topicBreakdown: [],
          difficultyBreakdown: [],
          weakSubjects: [],
          weakChapters: [],
          weakTopics: [],
          slowQuestionIds: [],
          status: 'in_progress',
          startedAt: startedAtIso,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('Attempt initialization notice:', e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Countdown + per-question time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds((e) => e + 1);
      if (currentQuestion) {
        setTimeSpentByQuestion((prev) => ({
          ...prev,
          [currentQuestion.id]: (prev[currentQuestion.id] || 0) + 1,
        }));
      }
      if (config.isTimed) {
        setRemainingSeconds((prev) => {
          if (prev <= 1 && !autoSubmittedRef.current) {
            autoSubmittedRef.current = true;
            setTimeout(() => handleFinalSubmit(), 50);
            return 0;
          }
          return Math.max(0, prev - 1);
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [currentQuestion?.id, config.isTimed]);

  // Auto-save answers periodically to Firestore while in progress
  useEffect(() => {
    if (!attemptId) return;
    const t = setTimeout(() => {
      updateDoc(doc(db, 'test_attempts', attemptId), {
        responses,
        markedForReview,
        timeSpentByQuestion,
        timeTakenSeconds: elapsedSeconds,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [responses, markedForReview, attemptId]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && containerRef.current) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Ignore if iframe restricts fullscreen
    }
  };

  const handleSelectOption = (optionIdx: number) => {
    if (!currentQuestion) return;
    setResponses((prev) => ({ ...prev, [currentQuestion.id]: optionIdx }));
  };

  const handleClearResponse = () => {
    if (!currentQuestion) return;
    setResponses((prev) => {
      const next = { ...prev };
      delete next[currentQuestion.id];
      return next;
    });
  };

  const handleToggleMarkReview = () => {
    if (!currentQuestion) return;
    setMarkedForReview((prev) =>
      prev.includes(currentQuestion.id)
        ? prev.filter((id) => id !== currentQuestion.id)
        : [...prev, currentQuestion.id]
    );
  };

  const handleCheckPracticeAnswer = async () => {
    if (config.mode !== 'practice' || !currentQuestion) return;
    const chosen = responses[currentQuestion.id];
    if (typeof chosen !== 'number') {
      setErrorMsg('Select an option first to check its explanation.');
      return;
    }
    setCheckingPractice(true);
    setErrorMsg(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Authentication required.');
      const res = await fetch('/api/exams/check-practice-answer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          selectedIndex: chosen,
          answerSeal: currentQuestion.answerSeal,
          mode: config.mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not verify practice answer.');
      setPracticeChecks((prev) => ({
        ...prev,
        [currentQuestion.id]: {
          isCorrect: data.isCorrect,
          correctIndex: data.correctIndex,
          explanation: data.explanation,
        },
      }));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error checking answer.');
    } finally {
      setCheckingPractice(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setShowConfirmModal(false);
    setErrorMsg(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('Session expired. Please sign in again.');
      const finalAttemptId = attemptId || `att_${Date.now()}`;

      const scoreRes = await fetch('/api/exams/score-attempt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          attemptId: finalAttemptId,
          examName: config.examName,
          marksPerCorrect: config.marksPerCorrect,
          negativeMarks: config.negativeMarks,
          responses,
          timeSpentByQuestion,
          timeTakenSeconds: Math.max(1, elapsedSeconds),
          questions: config.questions.map((q) => ({
            id: q.id,
            subject: q.subject,
            chapter: q.chapter,
            topic: q.topic,
            difficulty: q.difficulty || 'medium',
            answerSeal: q.answerSeal,
          })),
        }),
      });

      const scored = await scoreRes.json();
      if (!scoreRes.ok) throw new Error(scored.error || 'Server scoring failed.');

      const submittedAt = new Date().toISOString();
      const attemptPayload: Omit<TestAttemptRecord, 'id'> = {
        studentUid,
        studentDocId: studentDocId || '',
        studentCode,
        studentName,
        examName: config.examName,
        testType: config.testType,
        mode: config.mode,
        subject: config.subject || '',
        chapter: config.chapter || '',
        topic: config.topic || '',
        questionIds: config.questions.map((q) => q.id),
        responses,
        markedForReview,
        timeSpentByQuestion,
        totalQuestions: scored.totalQuestions,
        correctCount: scored.correctCount,
        incorrectCount: scored.incorrectCount,
        unansweredCount: scored.unansweredCount,
        totalMarks: scored.totalMarks,
        maxMarks: scored.maxMarks,
        percentage: scored.percentage,
        accuracy: scored.accuracy,
        timeTakenSeconds: scored.timeTakenSeconds,
        subjectBreakdown: scored.subjectBreakdown,
        chapterBreakdown: scored.chapterBreakdown,
        topicBreakdown: scored.topicBreakdown,
        difficultyBreakdown: scored.difficultyBreakdown || [],
        weakSubjects: scored.weakSubjects,
        weakChapters: scored.weakChapters,
        weakTopics: scored.weakTopics,
        slowQuestionIds: scored.slowQuestionIds,
        scoreReceipt: scored.scoreReceipt,
        revealedKeys: scored.revealedKeys,
        status: 'submitted',
        startedAt: startedAtIso,
        submittedAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'test_attempts', finalAttemptId), attemptPayload);

      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }

      onComplete({
        id: finalAttemptId,
        ...attemptPayload,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to submit exam.');
      setSubmitting(false);
    }
  };

  const stats = useMemo(() => {
    const answered = Object.keys(responses).length;
    const marked = markedForReview.length;
    const unanswered = config.questions.length - answered;
    return { answered, marked, unanswered };
  }, [responses, markedForReview, config.questions.length]);

  const formatTimer = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const practiceResult = currentQuestion ? practiceChecks[currentQuestion.id] : undefined;

  if (!currentQuestion) return null;

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-[#1C0E29] text-white flex flex-col"
    >
      {/* CBT Top Bar */}
      <header className="bg-[#0E0713] border-b border-[#514871] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-[#B5ADC6] font-semibold">
            {config.examName} · {config.mode === 'exam' ? 'Timed Examination Mode' : 'Practice Mode'}
          </p>
          <h2 className="font-display text-base sm:text-lg font-bold text-white truncate">
            {config.title}
          </h2>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className={`px-3 py-1.5 rounded-lg border text-sm font-mono font-bold tabular-nums flex items-center gap-2 ${
              config.isTimed && remainingSeconds < 120
                ? 'bg-rose-950/70 border-rose-500 text-rose-200'
                : 'bg-[#3D2C56] border-[#7C7397] text-white'
            }`}
          >
            <Clock className="w-4 h-4 text-[#B5ADC6]" />
            {config.isTimed ? formatTimer(remainingSeconds) : formatTimer(elapsedSeconds)}
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
            className="p-2 rounded-lg bg-[#3D2C56] border border-[#7C7397] text-[#CFCEDD] hover:bg-[#514871]"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs sm:text-sm font-bold hover:bg-white transition-colors"
          >
            {submitting ? 'Scoring...' : 'Submit Test'}
          </button>

          <button
            type="button"
            onClick={onExit}
            className="px-3 py-2 rounded-lg border border-[#7C7397] text-xs font-medium text-[#CFCEDD] hover:bg-[#3D2C56]"
          >
            Exit
          </button>
        </div>
      </header>

      {/* Visual Test Progress Bar */}
      <div className="bg-[#0E0713]/80 border-b border-[#514871]/60 px-4 sm:px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-[#3D2C56] overflow-hidden">
            <div
              className="h-full bg-[#B5ADC6] transition-all duration-300"
              style={{
                width: `${
                  config.questions.length > 0
                    ? Math.round((stats.answered / config.questions.length) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          <span className="text-[11px] font-semibold text-[#CFCEDD] tabular-nums shrink-0">
            {stats.answered} / {config.questions.length} Answered (
            {config.questions.length > 0
              ? Math.round((stats.answered / config.questions.length) * 100)
              : 0}
            %)
          </span>
        </div>
      </div>

      {/* Main CBT Grid */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Active Question */}
        <div className="lg:col-span-8 flex flex-col justify-between bg-[#3D2C56] border border-[#7C7397]/60 rounded-xl p-5 sm:p-7 space-y-6">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#514871]">
              <div className="text-xs text-[#CFCEDD] flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-white tabular-nums">
                  Question {currentIdx + 1} of {config.questions.length}
                </span>
                <span aria-hidden="true"> · </span>
                <span>{currentQuestion.subject}</span>
                <span aria-hidden="true"> · </span>
                <span>{currentQuestion.chapter}</span>
                <span
                  className={`ml-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                    currentQuestion.difficulty === 'hard'
                      ? 'bg-rose-950/80 text-rose-200 border border-rose-500/50'
                      : currentQuestion.difficulty === 'easy'
                        ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-500/50'
                        : 'bg-[#1C0E29] text-[#B5ADC6] border border-[#7C7397]/50'
                  }`}
                >
                  {currentQuestion.difficulty === 'medium' ? 'moderate' : currentQuestion.difficulty}
                </span>
              </div>
              <div className="text-xs text-[#B5ADC6] tabular-nums">
                +{config.marksPerCorrect} / −{config.negativeMarks} Marks
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/60 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-base sm:text-lg leading-relaxed text-white font-medium whitespace-pre-line">
                {currentQuestion.questionText}
              </p>
              {currentQuestion.hasDiagramOrTable && currentQuestion.diagramDescription && (
                <div className="p-3.5 rounded-lg bg-[#1C0E29]/80 border border-[#7C7397] text-xs text-[#CFCEDD]">
                  <span className="font-semibold text-[#B5ADC6]">Diagram / Table Note: </span>
                  {currentQuestion.diagramDescription}
                </div>
              )}
            </div>

            {/* 4 Options */}
            <div className="space-y-3 pt-2">
              {currentQuestion.options.map((opt, idx) => {
                const selected = responses[currentQuestion.id] === idx;
                const letter = ['A', 'B', 'C', 'D'][idx];

                let optionStyle =
                  'bg-[#1C0E29]/60 border-[#7C7397]/60 text-[#CFCEDD] hover:border-[#B5ADC6] hover:bg-[#514871]/60';
                if (practiceResult) {
                  if (idx === practiceResult.correctIndex) {
                    optionStyle = 'bg-emerald-950/70 border-emerald-400 text-white';
                  } else if (selected && idx !== practiceResult.correctIndex) {
                    optionStyle = 'bg-rose-950/70 border-rose-400 text-white';
                  }
                } else if (selected) {
                  optionStyle = 'bg-[#675D85] border-[#B5ADC6] text-white shadow-sm';
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-start gap-3.5 ${optionStyle}`}
                  >
                    <span
                      className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${
                        selected
                          ? 'bg-[#B5ADC6] text-[#0E0713]'
                          : 'bg-[#3D2C56] text-[#CFCEDD] border border-[#7C7397]/60'
                      }`}
                    >
                      {letter}
                    </span>
                    <span className="text-sm sm:text-base leading-snug pt-0.5">{opt}</span>
                  </button>
                );
              })}
            </div>

            {/* Practice Mode Immediate Explanation */}
            {config.mode === 'practice' && practiceResult && (
              <div
                className={`p-4 rounded-xl border text-sm space-y-1.5 ${
                  practiceResult.isCorrect
                    ? 'bg-emerald-950/50 border-emerald-500/60 text-emerald-100'
                    : 'bg-rose-950/50 border-rose-500/60 text-rose-100'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold">
                  {practiceResult.isCorrect ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Correct Answer!</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 text-rose-400" />
                      <span>
                        Incorrect · Correct Option: {['A', 'B', 'C', 'D'][practiceResult.correctIndex]}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-xs text-[#CFCEDD] leading-relaxed">{practiceResult.explanation}</p>
              </div>
            )}
          </div>

          {/* Question Footer Navigation */}
          <div className="pt-5 border-t border-[#514871] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMarkReview}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  markedForReview.includes(currentQuestion.id)
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                    : 'bg-[#1C0E29]/60 border-[#7C7397] text-[#CFCEDD] hover:bg-[#514871]'
                }`}
              >
                <Flag className="w-3.5 h-3.5" />
                {markedForReview.includes(currentQuestion.id) ? 'Marked for Review' : 'Mark for Review'}
              </button>

              <button
                type="button"
                onClick={handleClearResponse}
                className="px-3 py-2 rounded-lg border border-[#7C7397] text-xs font-medium text-[#CFCEDD] hover:bg-[#514871]"
              >
                Clear Option
              </button>

              {config.mode === 'practice' && !practiceResult && (
                <button
                  type="button"
                  disabled={checkingPractice}
                  onClick={handleCheckPracticeAnswer}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {checkingPractice ? 'Checking...' : 'Check Answer'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[#7C7397] text-xs font-semibold text-white disabled:opacity-40 hover:bg-[#514871]"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <button
                type="button"
                onClick={() => {
                  if (currentIdx < config.questions.length - 1) {
                    setCurrentIdx((i) => i + 1);
                  } else {
                    setShowConfirmModal(true);
                  }
                }}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white"
              >
                {currentIdx < config.questions.length - 1 ? (
                  <>
                    <span>{typeof responses[currentQuestion.id] === 'number' ? 'Save & Next' : 'Skip & Next'}</span>
                    {typeof responses[currentQuestion.id] === 'number' ? (
                      <ChevronRight className="w-4 h-4" />
                    ) : (
                      <SkipForward className="w-3.5 h-3.5" />
                    )}
                  </>
                ) : (
                  <span>Review & Submit</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Question Palette & Legend */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="bg-[#3D2C56] border border-[#7C7397]/60 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-[#B5ADC6]" /> Question Palette
              </h3>
              <span className="text-xs text-[#CFCEDD] tabular-nums">
                {stats.answered}/{config.questions.length} Answered
              </span>
            </div>

            <div className="grid grid-cols-5 sm:grid-cols-8 lg:grid-cols-5 gap-2 max-h-60 lg:max-h-96 overflow-y-auto pr-1">
              {config.questions.map((q, idx) => {
                const isAnswered = typeof responses[q.id] === 'number';
                const isReview = markedForReview.includes(q.id);
                const isCurrent = idx === currentIdx;

                let tileCls = 'bg-[#1C0E29] border-[#7C7397]/60 text-[#CFCEDD]';
                if (isReview && isAnswered) {
                  tileCls = 'bg-amber-500 border-amber-300 text-[#0E0713] font-bold';
                } else if (isReview) {
                  tileCls = 'bg-amber-900/70 border-amber-400 text-amber-100';
                } else if (isAnswered) {
                  tileCls = 'bg-emerald-600 border-emerald-400 text-white font-bold';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-9 rounded-lg border text-xs font-mono tabular-nums transition-transform ${tileCls} ${
                      isCurrent ? 'ring-2 ring-white scale-105' : ''
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="pt-3 border-t border-[#514871] grid grid-cols-2 gap-2 text-[11px] text-[#CFCEDD]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-emerald-600 inline-block" />
                <span>Answered ({stats.answered})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-[#1C0E29] border border-[#7C7397] inline-block" />
                <span>Unanswered ({stats.unanswered})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs bg-amber-500 inline-block" />
                <span>Marked ({stats.marked})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-xs ring-2 ring-white inline-block" />
                <span>Current</span>
              </div>
            </div>
          </div>

          <div className="bg-[#3D2C56]/80 border border-[#7C7397]/50 rounded-xl p-4 text-xs text-[#CFCEDD] space-y-1.5">
            <p className="font-semibold text-white">Examination Rules</p>
            <p>
              {config.mode === 'exam'
                ? 'Answers and explanations remain hidden until final test submission. Unanswered questions incur zero negative penalty.'
                : 'Practice Mode allows checking step-by-step explanations after attempting each question.'}
            </p>
            <p className="text-[#B5ADC6]">Progress is automatically saved to your account.</p>
          </div>
        </aside>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl bg-[#3D2C56] border border-[#B5ADC6]/40 p-6 space-y-4">
            <h3 className="font-display text-lg font-bold text-white">Submit {config.title}?</h3>
            <div className="grid grid-cols-3 gap-2 text-center bg-[#1C0E29] rounded-lg p-3 text-xs">
              <div>
                <p className="text-[#B5ADC6]">Answered</p>
                <p className="text-lg font-bold text-emerald-400 tabular-nums">{stats.answered}</p>
              </div>
              <div>
                <p className="text-[#B5ADC6]">Marked</p>
                <p className="text-lg font-bold text-amber-400 tabular-nums">{stats.marked}</p>
              </div>
              <div>
                <p className="text-[#B5ADC6]">Skipped</p>
                <p className="text-lg font-bold text-white tabular-nums">{stats.unanswered}</p>
              </div>
            </div>
            <p className="text-xs text-[#CFCEDD]">
              Once submitted, your score sheet, negative marking breakdown, weak topic analytics, and full solution key will be generated.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-lg border border-[#7C7397] text-xs font-semibold text-white hover:bg-[#514871]"
              >
                Continue Test
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleFinalSubmit}
                className="px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white"
              >
                {submitting ? 'Submitting...' : 'Confirm & Score'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
