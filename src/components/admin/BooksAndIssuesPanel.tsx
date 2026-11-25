import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { BookIssueRecord, BookRecord, StudentRecord } from '../../types/library';
import { Plus, Search, Trash2, BookOpenCheck, X } from 'lucide-react';

interface BooksAndIssuesPanelProps {
  books: BookRecord[];
  issues: BookIssueRecord[];
  students: StudentRecord[];
  canDelete: boolean;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

export const BooksAndIssuesPanel: React.FC<BooksAndIssuesPanelProps> = ({
  books,
  issues,
  students,
  canDelete,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [subTab, setSubTab] = useState<'catalog' | 'issues'>('catalog');
  const [showAddBook, setShowAddBook] = useState(false);

  // Add Book Form
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [publisher, setPublisher] = useState('');
  const [isbn, setIsbn] = useState('');
  const [categoryName, setCategoryName] = useState('UPSC & Civil Services');
  const [totalCopies, setTotalCopies] = useState(3);
  const [shelfNumber, setShelfNumber] = useState('S-01');
  const [pubYear, setPubYear] = useState(2025);

  // Direct Issue Form
  const [issueBook, setIssueBook] = useState<BookRecord | null>(null);
  const [issueStudentId, setIssueStudentId] = useState('');
  const [dueDays, setDueDays] = useState(14);

  const filteredBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.categoryName.toLowerCase().includes(q)
    );
  }, [books, search]);

  const handleAddBook = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, 'books'), {
        title: title.trim(),
        author: author.trim(),
        publisher: publisher.trim() || 'Academic Press',
        isbn: isbn.trim(),
        categoryName: categoryName.trim(),
        totalCopies: Number(totalCopies),
        availableCopies: Number(totalCopies),
        shelfNumber: shelfNumber.trim(),
        publicationYear: Number(pubYear),
        isDemo: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowAddBook(false);
      setTitle('');
      setAuthor('');
      setPublisher('');
      setIsbn('');
      onNotify('ok', `Added "${title}" to inventory.`);
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to add book.');
    }
  };

  const handleDirectIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueBook || !issueStudentId) return;
    if (issueBook.availableCopies < 1) {
      onNotify('err', 'No copies available to issue.');
      return;
    }
    const student = students.find((s) => s.id === issueStudentId);
    if (!student) return;

    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);

    await addDoc(collection(db, 'book_issues'), {
      bookId: issueBook.id,
      bookTitle: issueBook.title,
      studentDocId: student.id,
      studentUid: student.uid,
      studentCode: student.studentCode,
      studentName: student.fullName,
      issueDate,
      dueDate,
      fineAmount: 0,
      status: 'issued',
      isDemo: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'books', issueBook.id), {
      availableCopies: Math.max(0, issueBook.availableCopies - 1),
      updatedAt: serverTimestamp(),
    });

    setIssueBook(null);
    setIssueStudentId('');
    onNotify('ok', `Issued "${issueBook.title}" to ${student.fullName} (Due: ${dueDate}).`);
  };

  const handleApproveRequest = async (issue: BookIssueRecord) => {
    const book = books.find((b) => b.id === issue.bookId);
    if (!book || book.availableCopies < 1) {
      onNotify('err', 'No copies currently available.');
      return;
    }
    const issueDate = new Date().toISOString().slice(0, 10);
    const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    await updateDoc(doc(db, 'book_issues', issue.id), {
      issueDate,
      dueDate,
      status: 'issued',
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'books', book.id), {
      availableCopies: Math.max(0, book.availableCopies - 1),
      updatedAt: serverTimestamp(),
    });
    onNotify('ok', `Issued "${issue.bookTitle}" to ${issue.studentName}.`);
  };

  const handleReturnBook = async (issue: BookIssueRecord) => {
    const returnDate = new Date().toISOString().slice(0, 10);
    let fine = issue.fineAmount || 0;
    if (issue.dueDate && returnDate > issue.dueDate) {
      const overdueDays = Math.ceil(
        (new Date(returnDate).getTime() - new Date(issue.dueDate).getTime()) / 86400000
      );
      fine = Math.max(fine, overdueDays * 10);
    }

    await updateDoc(doc(db, 'book_issues', issue.id), {
      returnDate,
      fineAmount: fine,
      status: 'returned',
      updatedAt: serverTimestamp(),
    });

    const book = books.find((b) => b.id === issue.bookId);
    if (book) {
      await updateDoc(doc(db, 'books', book.id), {
        availableCopies: Math.min(book.totalCopies, book.availableCopies + 1),
        updatedAt: serverTimestamp(),
      });
    }

    onNotify('ok', `Book returned${fine > 0 ? ` with late fine ₹${fine}` : ''}.`);
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            Book Inventory &amp; Circulation
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Manage {books.length} titles, track available copies, issue volumes, and calculate overdue fines.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap p-1 bg-surface-container-low dark:bg-slate-900 rounded border border-outline-variant dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSubTab('catalog')}
              className={`px-3 py-1.5 text-xs font-semibold rounded cursor-pointer ${
                subTab === 'catalog' ? 'bg-primary text-on-primary' : 'text-on-surface-variant dark:text-slate-300'
              }`}
            >
              Inventory ({books.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('issues')}
              className={`px-3 py-1.5 text-xs font-semibold rounded cursor-pointer ${
                subTab === 'issues' ? 'bg-primary text-on-primary' : 'text-on-surface-variant dark:text-slate-300'
              }`}
            >
              Issues &amp; Returns ({issues.filter((i) => i.status !== 'returned').length})
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowAddBook((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Book
          </button>
        </div>
      </div>

      {showAddBook && (
        <form
          onSubmit={handleAddBook}
          className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3"
        >
          <input
            type="text"
            required
            placeholder="Book Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`sm:col-span-2 ${inputCls}`}
          />
          <input
            type="text"
            required
            placeholder="Author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            required
            placeholder="ISBN"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <input
            type="text"
            required
            placeholder="Category"
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            required
            placeholder="Publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            className={inputCls}
          />
          <input
            type="text"
            required
            placeholder="Shelf (e.g. S-01)"
            value={shelfNumber}
            onChange={(e) => setShelfNumber(e.target.value)}
            className={inputCls}
          />
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <input
              type="number"
              min={1}
              required
              placeholder="Copies"
              value={totalCopies}
              onChange={(e) => setTotalCopies(Number(e.target.value))}
              className="flex-1 min-w-[70px] sm:w-20 sm:flex-none px-2 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white"
            />
            <input
              type="number"
              min={1900}
              max={2100}
              required
              value={pubYear}
              onChange={(e) => setPubYear(Number(e.target.value))}
              className="flex-1 min-w-[80px] sm:w-24 sm:flex-none px-2 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white"
            />
            <button
              type="submit"
              className="w-full sm:w-auto flex-1 px-3 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {subTab === 'catalog' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="w-4 h-4 text-outline absolute left-3 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, author, ISBN..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-900 text-on-surface dark:text-white placeholder:text-outline focus:border-secondary focus:outline-none"
            />
          </div>

          <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Title &amp; Author</th>
                  <th className="text-left px-4 py-3 font-semibold">Category</th>
                  <th className="text-left px-4 py-3 font-semibold">ISBN</th>
                  <th className="text-left px-4 py-3 font-semibold">Shelf</th>
                  <th className="text-right px-4 py-3 font-semibold">Copies</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
                {filteredBooks.map((b) => (
                  <tr key={b.id} className="hover:bg-surface-container-low/50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-on-surface dark:text-white">{b.title}</p>
                      <p className="text-xs text-on-surface-variant dark:text-slate-400">{b.author}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-on-surface-variant dark:text-slate-300">{b.categoryName}</td>
                    <td className="px-4 py-3 font-mono text-xs text-on-surface-variant dark:text-slate-400">{b.isbn}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-secondary dark:text-blue-400">{b.shelfNumber}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-on-surface dark:text-white">
                      {b.availableCopies} / {b.totalCopies}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={b.availableCopies < 1}
                        onClick={() => setIssueBook(b)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary disabled:opacity-40 cursor-pointer"
                      >
                        <BookOpenCheck className="w-3.5 h-3.5" /> Issue
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc(db, 'books', b.id)).then(() => onNotify('ok', 'Book removed.'))}
                          className="p-1.5 text-error hover:bg-error-container rounded cursor-pointer"
                          aria-label="Delete book"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'issues' && (
        <div className="rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low dark:bg-slate-800/80 text-xs uppercase text-on-surface-variant dark:text-slate-300 border-b border-outline-variant dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Student</th>
                <th className="text-left px-4 py-3 font-semibold">Book</th>
                <th className="text-left px-4 py-3 font-semibold">Due Date</th>
                <th className="text-right px-4 py-3 font-semibold">Fine</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/60 dark:divide-slate-800">
              {issues.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-on-surface dark:text-white">{i.studentName}</p>
                    <p className="font-mono text-xs text-on-surface-variant dark:text-slate-400">{i.studentCode}</p>
                  </td>
                  <td className="px-4 py-3 text-on-surface dark:text-slate-200">{i.bookTitle}</td>
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant dark:text-slate-300">{i.dueDate || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium text-on-surface dark:text-white">₹{i.fineAmount}</td>
                  <td className="px-4 py-3 capitalize font-semibold text-secondary dark:text-blue-400">{i.status}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {i.status === 'requested' && (
                      <button
                        type="button"
                        onClick={() => handleApproveRequest(i)}
                        className="px-2.5 py-1 rounded bg-success text-on-success text-xs font-semibold cursor-pointer"
                      >
                        Approve Issue
                      </button>
                    )}
                    {(i.status === 'issued' || i.status === 'overdue') && (
                      <button
                        type="button"
                        onClick={() => handleReturnBook(i)}
                        className="px-2.5 py-1 rounded bg-primary text-on-primary text-xs font-semibold hover:bg-primary-container cursor-pointer"
                      >
                        Accept Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {issueBook && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <form
            onSubmit={handleDirectIssue}
            className="w-full max-w-md bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-700 rounded-xl p-4 sm:p-6 space-y-4 max-h-[90dvh] overflow-y-auto my-auto text-on-surface dark:text-slate-100 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-outline-variant dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold text-primary dark:text-white">Issue Book</h3>
              <button type="button" onClick={() => setIssueBook(null)} className="text-on-surface-variant hover:text-primary cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm font-semibold text-secondary dark:text-blue-400">{issueBook.title}</p>
            <div>
              <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Select Student</label>
              <select
                required
                value={issueStudentId}
                onChange={(e) => setIssueStudentId(e.target.value)}
                className={inputCls}
              >
                <option value="">Choose student...</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.studentCode} — {s.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface dark:text-slate-300 mb-1">Loan Period (Days)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={dueDays}
                onChange={(e) => setDueDays(Number(e.target.value))}
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary cursor-pointer"
            >
              Confirm Issue
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
