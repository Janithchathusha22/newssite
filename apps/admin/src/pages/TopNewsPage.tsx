import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ArticleImage } from '../components/ArticleImage';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS } from '../types';

export function TopNewsPage() {
  const { articles, saveTopNews } = useNewsroom();
  const { notify } = useToast();
  const initial = useMemo(() => articles.filter((article) => article.topRank !== null).sort((a, b) => (a.topRank ?? 99) - (b.topRank ?? 99)).map((article) => article.id), [articles]);
  const [ids, setIds] = useState(initial);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setIds(initial), [initial.join('|')]);

  const slots = Array.from({ length: 10 }, (_, index) => articles.find((article) => article.id === ids[index]));
  const changed = JSON.stringify(ids) !== JSON.stringify(initial);
  const candidates = articles.filter((article) => article.status === 'published' && !ids.includes(article.id) && `${article.draft.headline} ${article.sourceName}`.toLowerCase().includes(query.toLowerCase()));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    setIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const choose = (id: string) => {
    if (pickerSlot === null) return;
    setIds((current) => {
      const next = [...current];
      next[pickerSlot] = id;
      return next.slice(0, 10);
    });
    setPickerSlot(null);
    setQuery('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveTopNews(ids.filter(Boolean).slice(0, 10));
      notify('Homepage Top News order updated.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not update Top News.', 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="top-news-layout">
      <section className="panel top-news-manager">
        <div className="panel-heading top-manager-heading"><div><span className="eyebrow">Slots 1–10</span><h2>Homepage sequence</h2><p>Use the arrows to adjust priority. Position one becomes the lead story.</p></div><button className="button button-primary" type="button" disabled={!changed || saving} onClick={() => void save()}>{saving ? <span className="button-spinner" /> : <Icon name="save" size={17} />}Save order</button></div>
        <div className="top-slot-list">
          {slots.map((article, index) => article ? (
            <div className={`top-slot ${index === 0 ? 'lead-slot' : ''}`} key={`${index}-${article.id}`}>
              <div className="slot-handle"><Icon name="menu" size={18} /><strong>{String(index + 1).padStart(2, '0')}</strong></div>
              <ArticleImage imageUrl={article.imageUrl} sourceUrl={article.sourceUrl} />
              <div className="slot-copy"><span>{index === 0 ? 'Lead story' : CATEGORY_LABELS[article.category]}</span><strong>{article.draft.headline}</strong><small>{article.sourceName} · {article.status.replace('_', ' ')}</small></div>
              <div className="slot-controls"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up"><Icon name="chevron-down" className="rotate-180" size={17} /></button><button type="button" disabled={index >= ids.length - 1} onClick={() => move(index, 1)} aria-label="Move down"><Icon name="chevron-down" size={17} /></button><button type="button" onClick={() => setPickerSlot(index)}>Replace</button><button className="remove-slot" type="button" onClick={() => setIds((current) => current.filter((id) => id !== article.id))} aria-label="Remove"><Icon name="x" size={16} /></button></div>
            </div>
          ) : (
            <button className="top-slot empty-slot" type="button" key={index} onClick={() => setPickerSlot(index)}><div className="slot-handle"><strong>{String(index + 1).padStart(2, '0')}</strong></div><span className="empty-plus">+</span><div><strong>Add a Top News story</strong><small>Choose a published article</small></div></button>
          ))}
        </div>
      </section>

      <aside className="top-news-aside">
        <section className="panel top-preview-card"><span className="eyebrow">Homepage preview</span><h3>Top Stories</h3>{slots[0] ? <><ArticleImage imageUrl={slots[0].imageUrl} sourceUrl={slots[0].sourceUrl} /><span className="article-category">{CATEGORY_LABELS[slots[0].category]}</span><strong>{slots[0].draft.headline}</strong><p>{slots[0].draft.summary}</p></> : <div className="empty-preview">No lead story selected.</div>}<div className="preview-mini-stack">{slots.slice(1, 4).filter(Boolean).map((article, index) => article && <div key={article.id}><i>{index + 2}</i><span>{article.draft.headline}</span></div>)}</div></section>
        <section className="panel top-help-card"><Icon name="info" /><div><strong>Curation rules</strong><p>Only published articles can occupy Top News. Empty slots can be auto-filled by the public API using the latest published stories.</p></div></section>
      </aside>

      <Modal open={pickerSlot !== null} onClose={() => { setPickerSlot(null); setQuery(''); }} title={`Choose story for position ${pickerSlot !== null ? pickerSlot + 1 : ''}`} eyebrow="Homepage curation" size="large">
        <div className="story-picker"><label className="table-search"><Icon name="search" size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search eligible stories…" /></label><div className="picker-list">{candidates.map((article) => <button type="button" onClick={() => choose(article.id)} key={article.id}><ArticleImage imageUrl={article.imageUrl} sourceUrl={article.sourceUrl} /><div><span>{CATEGORY_LABELS[article.category]} · {article.sourceName}</span><strong>{article.draft.headline}</strong></div><Icon name="arrow-right" size={17} /></button>)}{!candidates.length && <div className="empty-state"><Icon name="search" /><strong>No eligible stories</strong><span>Try a different search or remove another Top News story first.</span></div>}</div></div>
      </Modal>
    </div>
  );
}
