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
        <div>
          <p className="text-xs font-semibold text-[#B5ADC6]">Daily Competitive Briefings</p>
          <h2 className="font-display text-2xl font-bold text-white">
            Daily Current Affairs & Bihar Special
          </h2>
          <p className="text-xs text-[#CFCEDD] mt-0.5">
            Verified headlines with primary source citations, Hindi &amp; English summaries, and daily revision MCQs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex p-1 rounded-lg bg-[#0E0713] border border-[#514871]">
            {[
              ['bilingual', 'EN + हिन्दी'],
              ['en', 'English'],
              ['hi', 'हिन्दी'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLang(id as any)}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${
                  lang === id ? 'bg-[#B5ADC6] text-[#0E0713]' : 'text-[#CFCEDD]'
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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#B5ADC6] text-[#0E0713] text-xs font-bold hover:bg-white"
            >
              <Play className="w-3.5 h-3.5" /> Take Daily Quiz ({linkedQuizQuestions.length} Qs)
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              selectedCategory === 'ALL'
                ? 'bg-[#B5ADC6] text-[#0E0713]'
                : 'bg-[#1C0E29] text-[#CFCEDD] hover:bg-[#514871]'
            }`}
          >
            All ({publishedItems.length})
          </button>
          {CURRENT_AFFAIRS_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                selectedCategory === cat
                  ? 'bg-[#B5ADC6] text-[#0E0713]'
                  : 'bg-[#1C0E29] text-[#CFCEDD] hover:bg-[#514871]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#514871]">
          <div className="relative">
            <Search className="w-4 h-4 text-[#B5ADC6] absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topic, scheme, Bihar news..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white placeholder-[#9993AC]"
            />
          </div>
          <div>
            <select
              value={monthFilter}
              onChange={(e) => {
                setMonthFilter(e.target.value);
                setDateFilter('');
              }}
              className="w-full px-3 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white"
            >
              <option value="ALL">All Months Archive</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  Archive: {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#B5ADC6] shrink-0" />
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#1C0E29] border border-[#7C7397] text-xs text-white"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-xs text-[#B5ADC6] underline shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* News Cards */}
      {filteredItems.length === 0 ? (
        <div className="p-8 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 text-center text-xs text-[#CFCEDD]">
          No current affairs articles match this filter yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              className="p-5 rounded-xl bg-[#3D2C56] border border-[#7C7397]/60 flex flex-col justify-between space-y-3"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-[11px] text-[#B5ADC6]">
                  <span className="font-semibold">{item.category}</span>
                  <span className="tabular-nums">{item.publishedDate || item.date}</span>
                </div>

                {(lang === 'en' || lang === 'bilingual') && (
                  <div>
                    <h3 className="font-display text-base font-bold text-white leading-snug">
                      {item.titleEn}
                    </h3>
                    <p className="mt-1.5 text-xs text-[#CFCEDD] leading-relaxed">{item.summaryEn}</p>
                  </div>
                )}

                {(lang === 'hi' || lang === 'bilingual') && (
                  <div className={lang === 'bilingual' ? 'pt-2 border-t border-[#514871]' : ''}>
                    <h4 className="text-sm font-bold text-white leading-snug">{item.titleHi}</h4>
                    <p className="mt-1 text-xs text-[#CFCEDD] leading-relaxed">{item.summaryHi}</p>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-[#514871] flex items-center justify-between gap-2 text-[11px]">
                <span className="text-[#B5ADC6] inline-flex items-center gap-1 truncate">
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  {item.sourceTitle}
                </span>
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white font-semibold hover:underline shrink-0"
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
