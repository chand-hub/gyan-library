import React, { useMemo, useState } from 'react';
import { Bookmark, BookOpen, Download, Play, Search } from 'lucide-react';
import { DigitalGKBook, ExamQuestion, StudyBookmark } from '../../types/library';
import { ActiveTestConfig } from './OnlineExamRunner';
import { downloadGKBookAsPdf } from '../../lib/gkBookPdf';
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

interface DigitalGKBookModuleProps {
  books: DigitalGKBook[];
  questions: ExamQuestion[];
  bookmarks: StudyBookmark[];
  userUid: string | null;
  onStartQuiz?: (config: ActiveTestConfig) => void;
  onNotify?: (type: 'ok' | 'err', msg: string) => void;
}

export const DigitalGKBookModule: React.FC<DigitalGKBookModuleProps> = ({
  books,
  questions,
  bookmarks,
  userUid,
  onStartQuiz,
  onNotify,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const sortedBooks = useMemo(
    () => [...books].sort((a, b) => a.subject.localeCompare(b.subject)),
    [books]
  );

  const activeBook = useMemo(() => {
    if (!sortedBooks.length) return null;
    if (selectedSubject) {
      const found = sortedBooks.find((b) => b.subject === selectedSubject);
      if (found) return found;
    }
    return sortedBooks[0];
  }, [sortedBooks, selectedSubject]);

  const filteredChapters = useMemo(() => {
    if (!activeBook) return [];
    const q = search.trim().toLowerCase();
    if (!q) return activeBook.chapters;
    return activeBook.chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q) ||
        c.contentText.toLowerCase().includes(q) ||
        c.keyFacts.some((f) => f.toLowerCase().includes(q))
    );
  }, [activeBook, search]);

  const activeChapter = filteredChapters[selectedChapterIdx] || filteredChapters[0] || null;

  const isBookmarked = useMemo(() => {
    if (!activeBook || !activeChapter) return null;
    return bookmarks.find((b) => b.bookId === activeBook.id && b.chapterId === activeChapter.id) || null;
  }, [bookmarks, activeBook, activeChapter]);

  const linkedQuestions = useMemo(() => {
    if (!activeBook || !activeChapter) return [];
    const matching = questions.filter(
      (q) =>
        q.subject.toLowerCase() === activeBook.subject.toLowerCase() ||
        q.topic.toLowerCase() === (activeChapter.linkedTopic || '').toLowerCase()
    );
    return matching;
  }, [questions, activeBook, activeChapter]);

  const handleToggleBookmark = async () => {
    if (!userUid || !activeBook || !activeChapter) {
      onNotify?.('err', 'Sign in to save study bookmarks.');
      return;
    }
    try {
      if (isBookmarked) {
        await deleteDoc(doc(db, 'study_bookmarks', isBookmarked.id));
        onNotify?.('ok', 'Bookmark removed.');
      } else {
        await addDoc(collection(db, 'study_bookmarks'), {
          userUid,
          bookId: activeBook.id,
          subject: activeBook.subject,
          chapterId: activeChapter.id,
          chapterTitle: activeChapter.title,
          createdAt: serverTimestamp(),
        });
        onNotify?.('ok', `Bookmarked "${activeChapter.title}".`);
      }
    } catch (err: any) {
      onNotify?.('err', err?.message || 'Unable to update bookmark.');
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeBook) return;
    setDownloadingPdf(true);
    try {
      await downloadGKBookAsPdf(activeBook);
      onNotify?.('ok', `${activeBook.subject} study PDF downloaded.`);
    } catch (err: any) {
      onNotify?.('err', err?.message || 'PDF download failed.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!activeBook) {
    return (
      <div className="p-8 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 text-center space-y-2 shadow-sm">
        <BookOpen className="w-8 h-8 text-secondary mx-auto" />
        <p className="text-sm font-semibold text-on-surface dark:text-white">
          Digital GK Books Not Initialized Yet
        </p>
        <p className="text-xs text-on-surface-variant dark:text-slate-300">
          Once initialized by the administrator, all 11 competitive study books appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
            Digital Library Archive
          </p>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Digital GK Books &amp; Chapter Notes
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-300">
            11 competitive subject handbooks with instant bookmarks, chapter quizzes, and PDF export.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-outline dark:text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedChapterIdx(0);
            }}
            placeholder="Search inside book chapters..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-container-lowest dark:bg-slate-950 border border-outline-variant dark:border-slate-700 text-xs text-on-surface dark:text-white placeholder-outline dark:placeholder-slate-400"
          />
        </div>
      </div>

      {/* 11 Subject Shelf Tabs */}
      <div className="flex flex-wrap gap-2">
        {sortedBooks.map((book) => {
          const active = book.id === activeBook.id;
          return (
            <button
              key={book.id}
              type="button"
              onClick={() => {
                setSelectedSubject(book.subject);
                setSelectedChapterIdx(0);
              }}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                active
                  ? 'bg-primary border-primary text-on-primary shadow-xs'
                  : 'bg-surface-container-lowest dark:bg-slate-900 border-outline-variant dark:border-slate-700 text-on-surface dark:text-slate-200 hover:bg-surface-container-low dark:hover:bg-slate-800'
              }`}
            >
              {book.subject}
            </button>
          );
        })}
      </div>

      {/* Reader Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Chapter List */}
        <aside className="lg:col-span-4 space-y-4">
          <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-3 shadow-sm">
            <h3 className="font-display text-base font-bold text-primary dark:text-white">
              {activeBook.title}
            </h3>
            <p className="text-xs text-on-surface-variant dark:text-slate-300">
              {activeBook.description}
            </p>
            {activeBook.pdfDownloadAllowed && (
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={handleDownloadPdf}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:bg-primary transition-colors shadow-xs"
              >
                <Download className="w-3.5 h-3.5" />
                {downloadingPdf ? 'Preparing PDF...' : 'Download Authorized PDF'}
              </button>
            )}
          </div>

          <div className="p-3 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-1.5 shadow-sm">
            <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-secondary dark:text-blue-400">
              Chapters ({filteredChapters.length})
            </p>
            {filteredChapters.map((ch, idx) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setSelectedChapterIdx(idx)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  activeChapter?.id === ch.id
                    ? 'bg-secondary-container/70 dark:bg-blue-950/60 text-primary dark:text-white font-bold border border-secondary/30'
                    : 'text-on-surface-variant dark:text-slate-300 hover:bg-surface-container-low dark:hover:bg-slate-800'
                }`}
              >
                {idx + 1}. {ch.title}
              </button>
            ))}
          </div>

          {bookmarks.length > 0 && (
            <div className="p-4 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-2 shadow-sm">
              <p className="text-xs font-bold text-primary dark:text-blue-300">
                Saved Bookmarks ({bookmarks.length})
              </p>
              <div className="space-y-1">
                {bookmarks.slice(0, 5).map((bm) => (
                  <button
                    key={bm.id}
                    type="button"
                    onClick={() => setSelectedSubject(bm.subject)}
                    className="block w-full text-left text-xs text-secondary dark:text-blue-400 hover:underline truncate font-medium"
                  >
                    · {bm.subject}: {bm.chapterTitle}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Chapter Reading Pane */}
        <div className="lg:col-span-8">
          {activeChapter ? (
            <div className="p-6 sm:p-7 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-outline-variant/60 dark:border-slate-800">
                <div>
                  <p className="text-xs text-secondary dark:text-blue-400 font-semibold">
                    {activeBook.subject} · Linked Topic: {activeChapter.linkedTopic}
                  </p>
                  <h3 className="font-display text-xl sm:text-2xl font-bold text-primary dark:text-white mt-1">
                    {activeChapter.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {userUid && (
                    <button
                      type="button"
                      onClick={handleToggleBookmark}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                        isBookmarked
                          ? 'bg-primary border-primary text-on-primary'
                          : 'bg-surface-container-low dark:bg-slate-800 border-outline-variant dark:border-slate-700 text-on-surface dark:text-white hover:bg-surface-container'
                      }`}
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      {isBookmarked ? 'Bookmarked' : 'Bookmark'}
                    </button>
                  )}

                  {onStartQuiz && linkedQuestions.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        onStartQuiz({
                          title: `${activeBook.subject} · Chapter Quiz`,
                          examName: linkedQuestions[0].examName,
                          testType: 'topic',
                          mode: 'practice',
                          subject: activeBook.subject,
                          topic: activeChapter.linkedTopic,
                          questions: linkedQuestions,
                          durationMinutes: Math.max(5, linkedQuestions.length * 2),
                          marksPerCorrect: 2,
                          negativeMarks: 0.5,
                          isTimed: false,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary text-on-secondary text-xs font-bold hover:bg-primary transition-colors shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5" /> Practice MCQs ({linkedQuestions.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-surface-container-low dark:bg-slate-800 border border-outline-variant/60 dark:border-slate-700 text-sm font-medium text-on-surface-variant dark:text-slate-200">
                {activeChapter.summary}
              </div>

              <div className="text-sm sm:text-base leading-relaxed text-on-surface dark:text-slate-100 whitespace-pre-line">
                {activeChapter.contentText}
              </div>

              {activeChapter.keyFacts && activeChapter.keyFacts.length > 0 && (
                <div className="p-5 rounded-xl bg-secondary-container/40 dark:bg-slate-800/80 border border-secondary/30 dark:border-slate-700 space-y-2.5">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary dark:text-blue-300">
                    High-Yield Exam Takeaways
                  </h4>
                  <ul className="space-y-2 text-xs sm:text-sm text-on-surface dark:text-slate-100">
                    {activeChapter.keyFacts.map((fact, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-mono text-secondary dark:text-blue-400 font-bold">
                          0{idx + 1}.
                        </span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 rounded-xl bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 text-center text-xs text-on-surface-variant dark:text-slate-300">
              No chapters match your search keyword.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
