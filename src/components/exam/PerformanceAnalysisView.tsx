import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  Clock,
  Layers,
  Play,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { BreakdownMetric, ExamQuestion, TestAttemptRecord } from '../../types/library';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  SharedAiCooldownState,
  fetchServerAiStatus,
  formatCooldownRemaining,
  generateAiRequestId,
  readStoredAiCooldown,
  saveStoredAiCooldown,
} from '../../lib/aiClient';

interface PerformanceAnalysisViewProps {
  attempt: TestAttemptRecord;
  allAttempts: TestAttemptRecord[];
  questionsMap: Map<string, ExamQuestion>;
  getIdToken: () => Promise<string | null>;
  onPracticeWeakTopic: (topicOrChapter: string, type: 'topic' | 'chapter') => void;
  onBack: () => void;
}

export const PerformanceAnalysisView: React.FC<PerformanceAnalysisViewProps> = ({
  attempt,
  allAttempts,
  questionsMap,
  getIdToken,
  onPracticeWeakTopic,
  onBack,
}) => {
  const [aiAdvice, setAiAdvice] = useState<string>(attempt.aiRecommendations || '');
  const [loadingAdvice, setLoadingAdvice] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [solutionFilter, setSolutionFilter] = useState<'all' | 'incorrect' | 'correct' | 'slow'>('all');
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

  const attemptedCount = attempt.correctCount + attempt.incorrectCount;

  const performanceTier = useMemo(() => {
    if (attempt.accuracy >= 85) {
      return {
        label: 'Merit Top-Tier Readiness',
        tone: 'bg-success-container/70 dark:bg-emerald-950/60 border-success/50 text-on-success-container dark:text-emerald-100',
        note: 'High conceptual clarity and disciplined accuracy. Increase test volume and speed.',
      };
    }
    if (attempt.accuracy >= 65) {
      return {
        label: 'Competitive Qualifying Zone',
        tone: 'bg-secondary-container/70 dark:bg-blue-950/60 border-secondary/50 text-on-secondary-container dark:text-blue-100',
        note: 'Strong foundation. Target weak chapters and eliminate careless negative marking.',
      };
    }
    return {
      label: 'Focused Revision Required',
      tone: 'bg-warning-container/70 dark:bg-amber-950/60 border-warning/50 text-on-warning-container dark:text-amber-100',
      note: 'Prioritize concept revision in your lowest-scoring chapters before timed drills.',
    };
  }, [attempt.accuracy]);

  const difficultyBreakdown = useMemo<BreakdownMetric[]>(() => {
    if (Array.isArray(attempt.difficultyBreakdown) && attempt.difficultyBreakdown.length > 0) {
      return attempt.difficultyBreakdown;
    }
    const map = new Map<string, { total: number; correct: number; incorrect: number; unanswered: number; time: number }>();
    for (const qId of attempt.questionIds || []) {
      const q = questionsMap.get(qId);
      const diff = q?.difficulty || 'medium';
      const key = attempt.revealedKeys?.[qId];
      const chosen = attempt.responses?.[qId];
      const sec = attempt.timeSpentByQuestion?.[qId] || 0;
      const cur = map.get(diff) || { total: 0, correct: 0, incorrect: 0, unanswered: 0, time: 0 };
      cur.total += 1;
      cur.time += sec;
      if (typeof chosen === 'number' && key) {
        if (chosen === key.correctIndex) cur.correct += 1;
        else cur.incorrect += 1;
      } else {
        cur.unanswered += 1;
      }
      map.set(diff, cur);
    }
    return ['easy', 'medium', 'hard']
      .filter((k) => map.has(k))
      .map((k) => {
        const m = map.get(k)!;
        const att = m.correct + m.incorrect;
        return {
          name: k,
          total: m.total,
          correct: m.correct,
          incorrect: m.incorrect,
          unanswered: m.unanswered,
          accuracy: att > 0 ? Math.round((m.correct / att) * 100) : 0,
          avgTimeSeconds: m.total > 0 ? Math.round(m.time / m.total) : 0,
        };
      });
  }, [attempt, questionsMap]);

  const repeatedMistakeTopics = useMemo(() => {
    const counts: Record<string, number> = {};
    allAttempts
      .filter((a) => a.status === 'submitted')
      .forEach((a) => {
        (a.weakTopics || []).forEach((t) => {
          counts[t] = (counts[t] || 0) + 1;
        });
      });
    return Object.entries(counts)
      .filter(([, count]) => count >= 2)
      .map(([topic]) => topic);
  }, [allAttempts]);

  const historicalTrend = useMemo(() => {
    return allAttempts
      .filter((a) => a.status === 'submitted')
      .slice(-8)
      .map((a, i) => ({
        label: `#${i + 1} ${a.examName.slice(0, 6)}`,
        accuracy: a.accuracy,
        percentage: a.percentage,
      }));
  }, [allAttempts]);

  const strongSubjects = useMemo(
    () => (attempt.subjectBreakdown || []).filter((s) => s.accuracy >= 70).map((s) => s.name),
    [attempt.subjectBreakdown]
  );

  const suggestedChapters = useMemo(() => {
    const sorted = [...(attempt.chapterBreakdown || [])]
      .filter((c) => c.correct + c.incorrect > 0)
      .sort((a, b) => a.accuracy - b.accuracy);
    return sorted.slice(0, 4);
  }, [attempt.chapterBreakdown]);

  const recommendedNextTarget = useMemo(() => {
    if (attempt.weakTopics && attempt.weakTopics.length > 0) {
      return { name: attempt.weakTopics[0], type: 'topic' as const };
    }
    if (suggestedChapters.length > 0) {
      return { name: suggestedChapters[0].name, type: 'chapter' as const };
    }
    return null;
  }, [attempt.weakTopics, suggestedChapters]);

  const handleGenerateAiRecommendations = async () => {
    if (loadingAdvice) return;
    const currentCd = readStoredAiCooldown();
    if (currentCd.active) {
      setAiCooldown(currentCd);
      setAdviceError(
        `AI study mentor is in shared cooldown (${formatCooldownRemaining(currentCd.remainingSeconds)} remaining).`
      );
      return;
    }

    setLoadingAdvice(true);
    setAdviceError(null);
    const requestId = generateAiRequestId('advice');
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Sign in required.');
      const res = await fetch('/api/exams/ai-performance-advice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Idempotency-Key': requestId,
        },
        body: JSON.stringify({
          requestId,
          attemptId: attempt.id,
          examName: attempt.examName,
          totalQuestions: attempt.totalQuestions,
          correctCount: attempt.correctCount,
          incorrectCount: attempt.incorrectCount,
          unansweredCount: attempt.unansweredCount,
          totalMarks: attempt.totalMarks,
          maxMarks: attempt.maxMarks,
          accuracy: attempt.accuracy,
          timeTakenSeconds: attempt.timeTakenSeconds,
          subjectBreakdown: attempt.subjectBreakdown,
          weakChapters: attempt.weakChapters,
          weakTopics: attempt.weakTopics,
          repeatedMistakeTopics,
          slowQuestionCount: (attempt.slowQuestionIds || []).length,
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
        throw new Error(data.error || 'Could not generate Gemini study plan.');
      }
      setAiAdvice(data.recommendations);

      await updateDoc(doc(db, 'test_attempts', attempt.id), {
        aiRecommendations: data.recommendations,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    } catch (err: any) {
      setAdviceError(err?.message || 'AI mentor unavailable right now.');
    } finally {
      setLoadingAdvice(false);
    }
  };

  const reviewedQuestions = useMemo(() => {
    return attempt.questionIds
      .map((qId, idx) => {
        const q = questionsMap.get(qId);
        const key = attempt.revealedKeys?.[qId];
        const chosen = attempt.responses?.[qId];
        const timeSec = attempt.timeSpentByQuestion?.[qId] || 0;
        const isCorrect = typeof chosen === 'number' && key ? chosen === key.correctIndex : false;
        const isIncorrect = typeof chosen === 'number' && key ? chosen !== key.correctIndex : false;
        const isSlow = (attempt.slowQuestionIds || []).includes(qId);
        return { idx: idx + 1, qId, q, key, chosen, timeSec, isCorrect, isIncorrect, isSlow };
      })
      .filter((item) => {
        if (solutionFilter === 'incorrect') return item.isIncorrect;
        if (solutionFilter === 'correct') return item.isCorrect;
        if (solutionFilter === 'slow') return item.isSlow;
        return true;
      });
  }, [attempt, questionsMap, solutionFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-700 text-xs font-semibold text-on-surface dark:text-white hover:bg-surface-container-low dark:hover:bg-slate-800 shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Exam Hub
          </button>
          <div>
            <p className="text-xs font-semibold text-secondary dark:text-blue-400 font-mono">
              {attempt.examName} · {attempt.submittedAt?.slice(0, 10) || 'Completed'} · {attempt.totalQuestions} Questions
            </p>
            <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
              Detailed Performance Report
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerateAiRecommendations}
          disabled={loadingAdvice || aiCooldown.active}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-secondary text-on-secondary text-xs sm:text-sm font-bold hover:bg-primary transition-colors disabled:opacity-50 shadow-xs"
        >
          <Sparkles className="w-4 h-4" />
          {loadingAdvice
            ? 'Analyzing Attempt...'
            : aiCooldown.active
              ? `AI Cooldown (${formatCooldownRemaining(aiCooldown.remainingSeconds)})`
              : aiAdvice
                ? 'Refresh AI Study Plan'
                : 'Get AI Study Recommendations'}
        </button>
      </div>

      {/* Final Performance Summary Banner */}
      <div className={`p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${performanceTier.tone}`}>
        <div className="flex items-start gap-3">
          <Award className="w-6 h-6 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs uppercase tracking-wider font-bold opacity-85">
              Final Performance Summary
            </p>
            <h3 className="font-display text-lg font-bold">{performanceTier.label}</h3>
            <p className="text-xs opacity-90 mt-0.5">{performanceTier.note}</p>
          </div>
        </div>
        {recommendedNextTarget && (
          <button
            type="button"
            onClick={() => onPracticeWeakTopic(recommendedNextTarget.name, recommendedNextTarget.type)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-primary-container shrink-0 shadow-xs"
          >
            <Play className="w-3.5 h-3.5" />
            Practice Recommended: {recommendedNextTarget.name}
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Total Marks', val: `${attempt.totalMarks} / ${attempt.maxMarks}` },
          { label: 'Score %', val: `${attempt.percentage}%` },
          { label: 'Accuracy', val: `${attempt.accuracy}%` },
          { label: 'Attempted', val: `${attemptedCount} / ${attempt.totalQuestions}` },
          { label: 'Correct', val: `${attempt.correctCount}` },
          { label: 'Incorrect', val: `${attempt.incorrectCount}` },
          { label: 'Unanswered', val: `${attempt.unansweredCount}` },
          {
            label: 'Time Taken',
            val: `${Math.floor(attempt.timeTakenSeconds / 60)}m ${attempt.timeTakenSeconds % 60}s`,
          },
        ].map((card) => (
          <div
            key={card.label}
            className="p-3.5 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-xs"
          >
            <p className="text-[11px] font-medium text-on-surface-variant dark:text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 font-display text-lg font-bold text-primary dark:text-white font-mono tabular-nums">
              {card.val}
            </p>
          </div>
        ))}
      </div>

      {/* Difficulty-Wise Accuracy Breakdown */}
      {difficultyBreakdown.length > 0 && (
        <div className="p-5 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-primary dark:text-blue-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-secondary dark:text-blue-400" /> Difficulty-Wise Performance Breakdown
            </h3>
            <span className="text-xs text-on-surface-variant dark:text-slate-400">
              Balanced across question complexity
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {difficultyBreakdown.map((d) => {
              const label =
                d.name === 'medium' ? 'Moderate' : d.name.charAt(0).toUpperCase() + d.name.slice(1);
              return (
                <div
                  key={d.name}
                  className="p-4 rounded-xl bg-surface-container-low dark:bg-slate-800/80 border border-outline-variant/60 dark:border-slate-700 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-on-surface dark:text-white">{label}</span>
                    <span className="text-xs font-bold text-secondary dark:text-blue-400 font-mono tabular-nums">
                      {d.accuracy}% Accuracy
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-variant dark:bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full ${
                        d.accuracy >= 70
                          ? 'bg-success'
                          : d.accuracy >= 50
                            ? 'bg-secondary'
                            : 'bg-error'
                      }`}
                      style={{ width: `${Math.min(100, d.accuracy)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-on-surface-variant dark:text-slate-300 font-mono tabular-nums">
                    Total {d.total} · Correct {d.correct} · Wrong {d.incorrect} · Avg {d.avgTimeSeconds}s
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Personalized Recommendations */}
      {(aiAdvice || adviceError) && (
        <div className="p-6 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-secondary/40 space-y-3 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-bold text-primary dark:text-white">
            <Sparkles className="w-4 h-4 text-secondary dark:text-blue-400" />
            <span>Personalized AI Study Plan (Grounded in Your Attempt Metrics)</span>
          </div>
          {adviceError ? (
            <p className="text-xs text-error dark:text-rose-300 font-medium">{adviceError}</p>
          ) : (
            <div className="text-sm text-on-surface-variant dark:text-slate-200 leading-relaxed whitespace-pre-line">
              {aiAdvice}
            </div>
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary dark:text-blue-300 mb-3">
            Subject-Wise Accuracy (%)
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attempt.subjectBreakdown || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" />
                <XAxis dataKey="name" tick={{ fill: '#44474E', fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#44474E', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#C4C6CF',
                    color: '#0B1C30',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="accuracy" fill="#0051D5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary dark:text-blue-300 mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-secondary dark:text-blue-400" /> Historical Progress Comparison
          </h3>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historicalTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#C4C6CF" />
                <XAxis dataKey="label" tick={{ fill: '#44474E', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#44474E', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#C4C6CF',
                    color: '#0B1C30',
                    borderRadius: '8px',
                  }}
                />
                <Line type="monotone" dataKey="accuracy" stroke="#0051D5" strokeWidth={2.5} />
                <Line type="monotone" dataKey="percentage" stroke="#004B73" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Diagnostic Strengths & Suggested Chapters for Improvement */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-2 shadow-xs">
          <p className="text-xs font-bold text-success dark:text-emerald-400">Strong Subjects</p>
          {strongSubjects.length === 0 ? (
            <p className="text-xs text-on-surface-variant dark:text-slate-400">
              Keep practicing to cross 70% accuracy.
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-on-surface dark:text-white font-medium">
              {strongSubjects.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-2 shadow-xs">
          <p className="text-xs font-bold text-error dark:text-rose-400">Weak Subjects</p>
          {(attempt.weakSubjects || []).length === 0 ? (
            <p className="text-xs text-on-surface-variant dark:text-slate-400">
              No weak subjects flagged below 60%.
            </p>
          ) : (
            <ul className="space-y-1 text-xs text-on-surface dark:text-white font-medium">
              {attempt.weakSubjects.map((s) => (
                <li key={s}>· {s}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-2 shadow-xs">
          <p className="text-xs font-bold text-warning dark:text-amber-400">
            Suggested Chapters for Improvement
          </p>
          {suggestedChapters.length === 0 ? (
            <p className="text-xs text-on-surface-variant dark:text-slate-400">
              All attempted chapters look balanced.
            </p>
          ) : (
            <div className="space-y-2">
              {suggestedChapters.map((ch) => (
                <div key={ch.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-on-surface dark:text-white truncate font-medium">
                    {ch.name}{' '}
                    <span className="text-secondary dark:text-blue-400 font-mono tabular-nums">
                      ({ch.accuracy}%)
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onPracticeWeakTopic(ch.name, 'chapter')}
                    className="px-2 py-1 rounded-md bg-secondary text-on-secondary font-bold text-[11px] hover:bg-primary shrink-0"
                  >
                    Practice
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-2 shadow-xs">
          <p className="text-xs font-bold text-primary dark:text-blue-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-secondary dark:text-blue-400" /> Repeated Mistakes &amp; Speed
          </p>
          <p className="text-xs text-on-surface-variant dark:text-slate-300">
            Slow questions (&gt;45s / 1.6x avg):{' '}
            <span className="font-bold text-on-surface dark:text-white font-mono tabular-nums">
              {(attempt.slowQuestionIds || []).length}
            </span>
          </p>
          {repeatedMistakeTopics.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-warning dark:text-amber-300 font-medium">
                Repeated mistakes: {repeatedMistakeTopics.slice(0, 3).join(', ')}
              </p>
              <button
                type="button"
                onClick={() => onPracticeWeakTopic(repeatedMistakeTopics[0], 'topic')}
                className="px-2.5 py-1 rounded-md bg-primary text-on-primary text-[11px] font-semibold hover:bg-primary-container"
              >
                Drill {repeatedMistakeTopics[0]}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chapter & Topic Table */}
      <div className="rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-outline-variant/60 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary dark:text-white flex items-center gap-2">
            <Target className="w-4 h-4 text-secondary dark:text-blue-400" /> Chapter &amp; Topic Accuracy Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-surface-container-low dark:bg-slate-800 text-on-surface-variant dark:text-slate-300">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Chapter</th>
                <th className="text-right px-4 py-3 font-semibold">Questions</th>
                <th className="text-right px-4 py-3 font-semibold">Correct</th>
                <th className="text-right px-4 py-3 font-semibold">Incorrect</th>
                <th className="text-right px-4 py-3 font-semibold">Accuracy</th>
                <th className="text-right px-4 py-3 font-semibold">Avg Time</th>
                <th className="text-right px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50 dark:divide-slate-800">
              {(attempt.chapterBreakdown || []).map((row) => (
                <tr key={row.name} className="hover:bg-surface-container-low/50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-medium text-on-surface dark:text-white">{row.name}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-on-surface-variant dark:text-slate-300">
                    {row.total}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-success dark:text-emerald-400">
                    {row.correct}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-error dark:text-rose-400">
                    {row.incorrect}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-on-surface dark:text-white">
                    {row.accuracy}%
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-on-surface-variant dark:text-slate-300">
                    {row.avgTimeSeconds}s
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onPracticeWeakTopic(row.name, 'chapter')}
                      className="px-2.5 py-1 rounded-md bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary transition-colors"
                    >
                      Retake Chapter
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Question-by-Question Solution Review */}
      <div className="rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 p-5 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-primary dark:text-white">
            Solution Review &amp; Explanations
          </h3>
          <div className="flex flex-wrap gap-1 p-1 bg-surface-container-low dark:bg-slate-800 rounded-lg border border-outline-variant dark:border-slate-700">
            {[
              ['all', 'All Questions'],
              ['incorrect', 'Incorrect'],
              ['correct', 'Correct'],
              ['slow', 'Slow Time'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSolutionFilter(id as any)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  solutionFilter === id
                    ? 'bg-primary text-on-primary font-bold'
                    : 'text-on-surface-variant dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {reviewedQuestions.map((item) => {
            if (!item.q || !item.key) return null;
            const letters = ['A', 'B', 'C', 'D'];
            return (
              <div
                key={item.qId}
                className="p-4 rounded-xl bg-surface-container-low/50 dark:bg-slate-800/50 border border-outline-variant dark:border-slate-700 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-secondary dark:text-blue-400">
                    Q{item.idx} · {item.q.subject} · {item.q.topic} ·{' '}
                    <span className="uppercase">{item.q.difficulty === 'medium' ? 'moderate' : item.q.difficulty}</span>
                  </span>
                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    <span className="text-on-surface-variant dark:text-slate-300">Time: {item.timeSec}s</span>
                    {item.isCorrect ? (
                      <span className="inline-flex items-center gap-1 text-success dark:text-emerald-400 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                      </span>
                    ) : item.isIncorrect ? (
                      <span className="inline-flex items-center gap-1 text-error dark:text-rose-400 font-semibold">
                        <XCircle className="w-3.5 h-3.5" /> Incorrect
                      </span>
                    ) : (
                      <span className="text-outline dark:text-slate-400">Unanswered</span>
                    )}
                  </div>
                </div>
                <p className="text-sm text-on-surface dark:text-white font-medium">{item.q.questionText}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {item.q.options.map((opt, oi) => {
                    const isRight = oi === item.key!.correctIndex;
                    const isPicked = oi === item.chosen;
                    return (
                      <div
                        key={oi}
                        className={`p-2.5 rounded-lg border ${
                          isRight
                            ? 'bg-success-container/70 dark:bg-emerald-950/60 border-success text-on-success-container dark:text-emerald-100 font-medium'
                            : isPicked
                              ? 'bg-error-container/70 dark:bg-rose-950/60 border-error text-on-error-container dark:text-rose-100 font-medium'
                              : 'bg-surface-container-lowest dark:bg-slate-900 border-outline-variant dark:border-slate-700 text-on-surface-variant dark:text-slate-300'
                        }`}
                      >
                        <span className="font-bold mr-1.5">{letters[oi]}.</span>
                        {opt}
                      </div>
                    );
                  })}
                </div>
                <div className="p-3 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant/60 dark:border-slate-700 text-xs text-on-surface-variant dark:text-slate-300 leading-relaxed">
                  <span className="font-semibold text-primary dark:text-white">Explanation: </span>
                  {item.key.explanation}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
