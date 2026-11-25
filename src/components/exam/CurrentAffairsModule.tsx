import React, { useMemo, useState } from 'react';
import { Calendar, ExternalLink, Globe, Play, Search } from 'lucide-react';
import {
  CURRENT_AFFAIRS_CATEGORIES,
  CurrentAffairsCategory,
  CurrentAffairsItem,
  ExamQuestion,
} from '../../types/library';
import { ActiveTestConfig } from './OnlineExamRunner';

interface CurrentAffairsModuleProps {
  items: CurrentAffairsItem[];
  questions: ExamQuestion[];
  onStartQuiz?: (config: ActiveTestConfig) => void;
}

export const CurrentAffairsModule: React.FC<CurrentAffairsModuleProps> = ({
  items,
  questions,
  onStartQuiz,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | CurrentAffairsCategory>('ALL');
  const [lang, setLang] = useState<'en' | 'hi' | 'bilingual'>('bilingual');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const publishedItems = useMemo(
    () =>
      items
        .filter((it) => it.status === 'published')
        .sort((a, b) => b.date.localeCompare(a.date)),
    [items]
  );

  const availableMonths = useMemo(
    () => Array.from(new Set(publishedItems.map((i) => i.month))).sort().reverse(),
    [publishedItems]
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return publishedItems.filter((it) => {
      if (selectedCategory !== 'ALL' && it.category !== selectedCategory) return false;
      if (dateFilter && it.date !== dateFilter) return false;
      if (monthFilter !== 'ALL' && it.month !== monthFilter) return false;
      if (q) {
        return (
          it.titleEn.toLowerCase().includes(q) ||
          it.titleHi.toLowerCase().includes(q) ||
          it.summaryEn.toLowerCase().includes(q) ||
          it.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [publishedItems, selectedCategory, dateFilter, monthFilter, search]);

  const linkedQuizQuestions = useMemo(() => {
    const ids = new Set(filteredItems.flatMap((i) => i.linkedQuestionIds || []));
    return questions.filter((q) => ids.has(q.id));
  }, [filteredItems, questions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
            Daily Competitive Briefings
          </p>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white break-words">
            Daily Current Affairs &amp; Bihar Special
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-300 mt-0.5">
            Verified headlines with primary source citations, Hindi &amp; English summaries, and daily revision MCQs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex flex-wrap p-1 rounded-lg bg-surface-container-low dark:bg-slate-800 border border-outline-variant dark:border-slate-700">
            {[
              ['bilingual', 'EN + हिन्दी'],
              ['en', 'English'],
              ['hi', 'हिन्दी'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLang(id as any)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  lang === id
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'text-on-surface-variant dark:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {onStartQuiz && linkedQuizQuestions.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onStartQuiz({
                  title: `Current Affairs Quiz (${selectedCategory === 'ALL' ? 'All Categories' : selectedCategory})`,
                  examName: 'UPSC',
                  testType: 'current_affairs',
                  mode: 'practice',
                  questions: linkedQuizQuestions,
                  durationMinutes: Math.max(5, linkedQuizQuestions.length * 1.5),
                  marksPerCorrect: 2,
                  negativeMarks: 0.66,
                  isTimed: false,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:bg-primary transition-colors shadow-xs"
            >
              <Play className="w-3.5 h-3.5" /> Take Daily Quiz ({linkedQuizQuestions.length} Qs)
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-3 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              selectedCategory === 'ALL'
                ? 'bg-primary border-primary text-on-primary'
                : 'bg-surface-container-low dark:bg-slate-800 border-outline-variant dark:border-slate-700 text-on-surface-variant dark:text-slate-300 hover:bg-surface-container dark:hover:bg-slate-700'
            }`}
          >
            All ({publishedItems.length})
          </button>
          {CURRENT_AFFAIRS_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                selectedCategory === cat
                  ? 'bg-primary border-primary text-on-primary'
                  : 'bg-surface-container-low dark:bg-slate-800 border-outline-variant dark:border-slate-700 text-on-surface-variant dark:text-slate-300 hover:bg-surface-container dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-outline-variant/60 dark:border-slate-800">
          <div className="relative min-w-0">
            <Search className="w-4 h-4 text-outline dark:text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topic, scheme, Bihar news..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-container-lowest dark:bg-slate-950 border border-outline-variant dark:border-slate-700 text-xs text-on-surface dark:text-white placeholder-outline dark:placeholder-slate-400"
            />
          </div>
          <div className="min-w-0">
            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setDateFilter('');
              }}
              className="w-full px-3 py-2 rounded-lg bg-surface-container-lowest dark:bg-slate-950 border border-outline-variant dark:border-slate-700 text-xs text-on-surface dark:text-white"
            >
              <option value="ALL">All Months Archive</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  Archive: {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-secondary dark:text-blue-400 shrink-0" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-container-lowest dark:bg-slate-950 border border-outline-variant dark:border-slate-700 text-xs text-on-surface dark:text-white"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-xs text-secondary dark:text-blue-400 underline shrink-0 font-medium"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* News Cards */}
      {filteredItems.length === 0 ? (
        <div className="p-8 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 text-center text-xs text-on-surface-variant dark:text-slate-300 shadow-sm">
          No current affairs articles match this filter yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="min-w-0 p-4 sm:p-5 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 flex flex-col justify-between space-y-3 shadow-sm"
            >
              <div className="space-y-2.5 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-secondary dark:text-blue-400 uppercase tracking-wide">
                    {item.category}
                  </span>
                  <span className="font-mono tabular-nums text-on-surface-variant dark:text-slate-400">
                    {item.publishedDate || item.date}
                  </span>
                </div>

                {(lang === 'en' || lang === 'bilingual') && (
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold text-primary dark:text-white leading-snug break-words">
                      {item.titleEn}
                    </h3>
                    <p className="mt-1.5 text-xs text-on-surface-variant dark:text-slate-300 leading-relaxed break-words">
                      {item.summaryEn}
                    </p>
                  </div>
                )}

                {(lang === 'hi' || lang === 'bilingual') && (
                  <div className={`min-w-0 ${lang === 'bilingual' ? 'pt-2 border-t border-outline-variant/60 dark:border-slate-800' : ''}`}>
                    <h4 className="text-sm font-bold text-on-surface dark:text-white leading-snug break-words">
                      {item.titleHi}
                    </h4>
                    <p className="mt-1 text-xs text-on-surface-variant dark:text-slate-300 leading-relaxed break-words">
                      {item.summaryHi}
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-outline-variant/60 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 text-on-surface-variant dark:text-slate-400 inline-flex items-center gap-1 truncate">
                  <Globe className="w-3.5 h-3.5 text-secondary dark:text-blue-400 shrink-0" />
                  <span className="truncate">{item.sourceTitle}</span>
                </span>
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-secondary dark:text-blue-400 font-semibold hover:underline shrink-0"
                >
                  Source <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
