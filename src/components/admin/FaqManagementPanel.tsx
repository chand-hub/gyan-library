import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Edit2, HelpCircle, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { FaqItem } from '../../types/library';

interface FaqManagementPanelProps {
  hasFirebaseSession: boolean;
  getIdToken: () => Promise<string | null>;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
}

export const FaqManagementPanel: React.FC<FaqManagementPanelProps> = ({
  hasFirebaseSession,
  getIdToken,
  onNotify,
}) => {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionTab, setSectionTab] = useState<'faq' | 'important'>('faq');

  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<FaqItem | null>(null);
  const [section, setSection] = useState<'faq' | 'important'>('faq');
  const [category, setCategory] = useState('Timings');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sortOrder, setSortOrder] = useState(1);
  const [published, setPublished] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadFaqs = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/public-content', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.faqs || []);
      }
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to load FAQ items.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken, onNotify]);

  useEffect(() => {
    loadFaqs();
  }, [loadFaqs]);

  const filtered = useMemo(() => {
    return items
      .filter((i) => i.section === sectionTab)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [items, sectionTab]);

  const openCreate = () => {
    setEditingItem(null);
    setSection(sectionTab);
    setCategory(sectionTab === 'faq' ? 'Timings' : 'Membership');
    setQuestion('');
    setAnswer('');
    setSortOrder(filtered.length + 1);
    setPublished(true);
    setShowModal(true);
  };

  const openEdit = (item: FaqItem) => {
    setEditingItem(item);
    setSection(item.section);
    setCategory(item.category);
    setQuestion(item.question);
    setAnswer(item.answer);
    setSortOrder(item.sortOrder);
    setPublished(item.published !== false);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Session expired.');
      const res = await fetch('/api/admin/faqs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editingItem?.id,
          section,
          category: category.trim(),
          question: question.trim(),
          answer: answer.trim(),
          sortOrder: Number(sortOrder) || 1,
          published,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save FAQ item.');

      if (hasFirebaseSession && data.faq?.id) {
        setDoc(doc(db, 'faqs', data.faq.id), {
          ...data.faq,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      onNotify('ok', `${section === 'faq' ? 'FAQ' : 'Important Question'} saved.`);
      setShowModal(false);
      await loadFaqs();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to save FAQ item.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublished = async (item: FaqItem) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch('/api/admin/faqs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...item,
          published: !item.published,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed updating visibility.');
      if (hasFirebaseSession && data.faq?.id) {
        setDoc(doc(db, 'faqs', data.faq.id), { ...data.faq, updatedAt: serverTimestamp() }).catch(() => {});
      }
      onNotify('ok', `${item.published ? 'Unpublished' : 'Published'} item.`);
      await loadFaqs();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to toggle visibility.');
    }
  };

  const handleDelete = async (item: FaqItem) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetch(`/api/admin/faqs/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Delete failed.');
      if (hasFirebaseSession) {
        deleteDoc(doc(db, 'faqs', item.id)).catch(() => {});
      }
      onNotify('ok', 'Deleted FAQ item.');
      await loadFaqs();
    } catch (err: any) {
      onNotify('err', err?.message || 'Unable to delete FAQ.');
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-sm rounded border border-outline-variant dark:border-slate-700 bg-surface dark:bg-slate-800 text-on-surface dark:text-white focus:border-secondary focus:outline-none';

  return (
    <div className="space-y-6 text-on-surface dark:text-slate-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-primary dark:text-white">
            FAQ &amp; Important Questions CMS
          </h2>
          <p className="text-xs text-on-surface-variant dark:text-slate-400">
            Manage published FAQs and Important Rules/Policy Q&amp;As shown on the public GYAN ADDA LIBRARY website.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadFaqs}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-outline-variant dark:border-slate-700 bg-surface-container-lowest dark:bg-slate-800 text-xs font-semibold text-primary dark:text-white cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-secondary text-on-secondary text-xs font-semibold hover:bg-primary cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add {sectionTab === 'faq' ? 'FAQ' : 'Important Question'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-outline-variant dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setSectionTab('faq')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            sectionTab === 'faq'
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-low dark:hover:bg-slate-800'
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" /> Public FAQs ({items.filter((i) => i.section === 'faq').length})
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('important')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            sectionTab === 'important'
              ? 'bg-primary text-on-primary'
              : 'text-on-surface-variant hover:bg-surface-container-low dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" /> Important Questions ({items.filter((i) => i.section === 'important').length})
        </button>
      </div>

      <div className="space-y-3">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="p-4 sm:p-5 rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-start justify-between gap-4"
          >
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase">
                <span className="px-2 py-0.5 rounded bg-secondary/10 text-secondary dark:text-blue-400">
                  {item.category}
                </span>
                <span className="text-outline">Order #{item.sortOrder}</span>
                <span className={item.published ? 'text-success' : 'text-error'}>
                  {item.published ? 'Published' : 'Hidden'}
                </span>
              </div>
              <h3 className="font-semibold text-sm text-primary dark:text-white break-words">{item.question}</h3>
              <p className="text-xs text-on-surface-variant dark:text-slate-300 leading-relaxed break-words">
                {item.answer}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleTogglePublished(item)}
                className="px-2.5 py-1.5 rounded border border-outline-variant dark:border-slate-700 text-xs font-semibold text-secondary hover:bg-surface-container-low cursor-pointer"
              >
                {item.published ? 'Hide' : 'Publish'}
              </button>
              <button
                type="button"
                onClick={() => openEdit(item)}
                className="p-1.5 rounded text-on-surface-variant hover:text-primary hover:bg-surface-container-low cursor-pointer"
                aria-label="Edit item"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item)}
                className="p-1.5 rounded text-error hover:bg-error-container cursor-pointer"
                aria-label="Delete item"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="p-8 text-center rounded-lg bg-surface-container-lowest dark:bg-slate-900 border border-outline-variant text-xs text-on-surface-variant">
            No items configured in this section yet.
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-primary/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-surface-container-lowest dark:bg-slate-900 rounded-xl border border-outline-variant dark:border-slate-700 p-5 space-y-4 shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-outline-variant dark:border-slate-800 pb-3">
              <h3 className="font-display text-lg font-bold text-primary dark:text-white">
                {editingItem ? 'Edit Question' : 'Add Question'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Section</label>
                  <select
                    value={section}
                    onChange={(e) => setSection(e.target.value as 'faq' | 'important')}
                    className={inputCls}
                  >
                    <option value="faq">FAQs</option>
                    <option value="important">Important Questions</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Category</label>
                  <input type="text" required value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Sort Order</label>
                  <input type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Question</label>
                <input type="text" required value={question} onChange={(e) => setQuestion(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Answer</label>
                <textarea rows={4} required value={answer} onChange={(e) => setAnswer(e.target.value)} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
                <span>Publish on public GYAN ADDA LIBRARY homepage</span>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded bg-secondary text-on-secondary text-sm font-semibold hover:bg-primary disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Question'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
