import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArticlePreview } from '../components/ArticlePreview';
import { ArticleImage } from '../components/ArticleImage';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { StatusPill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS, type Article, type ArticlePatch, type CategorySlug } from '../types';

type LocalDraft = {
  headline: string;
  summary: string;
  body: string;
  category: CategorySlug;
  tags: string;
  imageUrl: string;
  imageCredit: string;
  editorNote: string;
};

const toLocalDraft = (article: Article): LocalDraft => ({
  ...article.draft,
  category: article.category,
  tags: article.tags.join(', '),
  imageUrl: article.imageUrl,
  imageCredit: article.imageCredit,
  editorNote: article.editorNote ?? '',
});

const formatDateTime = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));

export function ArticleEditorPage({ forcePreview = false }: { forcePreview?: boolean }) {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const { articles, loading, saveArticle, runArticleAction, createPreview } = useNewsroom();
  const { notify } = useToast();
  const article = articles.find((item) => item.id === articleId);
  const [draft, setDraft] = useState<LocalDraft | null>(article ? toLocalDraft(article) : null);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(forcePreview);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [tab, setTab] = useState<'copy' | 'metadata' | 'history'>('copy');
  const [sourceMode, setSourceMode] = useState<'split' | 'draft'>('split');
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    if (article) setDraft(toLocalDraft(article));
  }, [article?.id]);

  useEffect(() => {
    setPreviewOpen(forcePreview);
  }, [forcePreview]);

  const changed = useMemo(() => article && draft ? JSON.stringify(toLocalDraft(article)) !== JSON.stringify(draft) : false, [article, draft]);
  const hasBlockingError = article?.validation.some((issue) => issue.severity === 'error') ?? false;
  const canApprove = article?.status === 'pending_review' || article?.status === 'changes_requested';
  const previewArticle = useMemo(() => article && draft ? {
    ...article,
    category: draft.category,
    tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    imageUrl: draft.imageUrl,
    imageCredit: draft.imageCredit,
    draft: { headline: draft.headline, summary: draft.summary, body: draft.body },
  } : null, [article, draft]);

  if (loading && !article) return <div className="editor-loading"><span className="button-spinner dark" />Loading editorial workspace…</div>;
  if (!article || !draft || !previewArticle) return <div className="panel not-found"><Icon name="articles" /><h2>Article not found</h2><p>This article is no longer available in the current workspace.</p><Link className="button button-primary" to="/articles">Back to articles</Link></div>;

  const patchFromDraft = (): ArticlePatch => ({
    draft: { headline: draft.headline.trim(), summary: draft.summary.trim(), body: draft.body.trim() },
    category: draft.category,
    tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    imageUrl: draft.imageUrl.trim(),
    imageCredit: draft.imageCredit.trim(),
    editorNote: draft.editorNote.trim(),
  });

  const save = async (silent = false) => {
    setSaving(true);
    try {
      await saveArticle(article.id, patchFromDraft());
      if (!silent) notify('Editorial changes saved.');
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to save the article.', 'danger');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const act = async (action: 'approve' | 'publish' | 'rewrite') => {
    setActionBusy(action);
    try {
      if (changed && !(await save(true))) return;
      await runArticleAction(article.id, action);
      notify(action === 'approve' ? 'Article approved and published to the public website.' : action === 'publish' ? 'Article published to the public website.' : 'A fresh AI rewrite is ready for review.');
      if (action === 'approve' || action === 'publish') navigate('/articles/published');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The action could not be completed.', 'danger');
    } finally {
      setActionBusy(null);
    }
  };

  const reject = async () => {
    if (rejectReason.trim().length < 8) {
      notify('Add a clear editorial reason before rejecting.', 'danger');
      return;
    }
    setActionBusy('reject');
    try {
      await runArticleAction(article.id, 'reject', rejectReason.trim());
      setRejectOpen(false);
      notify('Article moved to the rejected archive.', 'neutral');
      navigate('/articles/rejected');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The article could not be rejected.', 'danger');
    } finally {
      setActionBusy(null);
    }
  };

  const generateShareLink = async () => {
    try {
      if (changed && !(await save(true))) return;
      const result = await createPreview(article.id);
      setShareUrl(result.url);
      await navigator.clipboard?.writeText(result.url);
      notify('Preview link copied. It expires in 30 minutes.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create a preview link.', 'danger');
    }
  };

  return (
    <div className="editor-page">
      <div className="editor-toolbar panel">
        <div className="editor-breadcrumb"><Link to="/articles/pending"><Icon name="arrow-left" size={17} />Review queue</Link><i /><StatusPill status={article.status} />{changed && <span className="unsaved-dot"><i />Unsaved changes</span>}</div>
        <div className="editor-actions">
          <button className="button button-secondary" type="button" onClick={() => setPreviewOpen(true)}><Icon name="eye" size={17} />Preview</button>
          <button className="button button-secondary" type="button" disabled={saving || !changed} onClick={() => void save()}>{saving ? <span className="button-spinner dark" /> : <Icon name="save" size={17} />}Save draft</button>
          <button className="button button-danger-text" type="button" onClick={() => setRejectOpen(true)}><Icon name="reject" size={17} />Reject</button>
          {article.status === 'approved'
            ? <button className="button button-primary" type="button" disabled={Boolean(actionBusy)} onClick={() => void act('publish')}>{actionBusy === 'publish' ? <span className="button-spinner" /> : <Icon name="published" size={17} />}Publish now</button>
            : canApprove
              ? <button className="button button-primary" title={hasBlockingError ? 'Resolve blocking factual checks before approval' : undefined} type="button" disabled={Boolean(actionBusy) || hasBlockingError} onClick={() => void act('approve')}>{actionBusy === 'approve' ? <span className="button-spinner" /> : <Icon name="check" size={17} />}Approve &amp; publish</button>
              : null}
        </div>
      </div>

      <div className="editor-layout">
        <section className="panel editor-main">
          <div className="editor-tabs">
            <button type="button" className={tab === 'copy' ? 'active' : ''} onClick={() => setTab('copy')}>Article copy</button>
            <button type="button" className={tab === 'metadata' ? 'active' : ''} onClick={() => setTab('metadata')}>Metadata & image</button>
            <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Source details</button>
          </div>

          {tab === 'copy' && <>
            <div className="compare-toggle"><span>Writing view</span><div><button type="button" className={sourceMode === 'split' ? 'active' : ''} onClick={() => setSourceMode('split')}>Compare</button><button type="button" className={sourceMode === 'draft' ? 'active' : ''} onClick={() => setSourceMode('draft')}>Draft only</button></div></div>
            <div className={`copy-workspace ${sourceMode === 'draft' ? 'draft-only' : ''}`}>
              {sourceMode === 'split' && <div className="copy-column source-column">
                <div className="copy-column-heading"><span><Icon name="archive" size={16} />Original source</span><a href={article.sourceUrl} target="_blank" rel="noreferrer">Open source <Icon name="external" size={13} /></a></div>
                <label><span>Source headline</span><div className="read-only-field">{article.original.headline}</div></label>
                <label><span>Source summary</span><div className="read-only-field summary">{article.original.summary}</div></label>
                <label><span>Source article</span><div className="read-only-field body-copy">{article.original.body.split(/\n\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></label>
              </div>}
              <div className="copy-column draft-column">
                <div className="copy-column-heading"><span><Icon name="sparkles" size={16} />Editorial draft</span><button type="button" disabled={Boolean(actionBusy)} onClick={() => void act('rewrite')}><Icon name="refresh" size={13} />Regenerate</button></div>
                <label><span>Headline <small>{draft.headline.length}/120</small></span><textarea className="headline-input" rows={3} maxLength={120} value={draft.headline} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></label>
                <label><span>Summary <small>{draft.summary.length}/320</small></span><textarea rows={4} maxLength={320} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
                <label><span>Article body <small>{draft.body.split(/\s+/).filter(Boolean).length} words</small></span><textarea className="body-input" rows={18} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></label>
              </div>
            </div>
          </>}

          {tab === 'metadata' && <div className="metadata-form">
            <div className="metadata-grid">
              <label><span>Editorial desk</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as CategorySlug })}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label><span>Tags <small>comma separated</small></span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
            </div>
            <label><span>Image URL</span><input value={draft.imageUrl} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} /></label>
            <label><span>Image credit</span><input value={draft.imageCredit} onChange={(event) => setDraft({ ...draft, imageCredit: event.target.value })} /></label>
            <div className="image-preview-card"><ArticleImage imageUrl={draft.imageUrl} sourceUrl={article.sourceUrl} alt="Article preview" /><div><strong>Featured image preview</strong><span>{draft.imageCredit || 'No image credit supplied'}</span></div></div>
            <label><span>Private editor note</span><textarea rows={5} placeholder="Record context for another editor…" value={draft.editorNote} onChange={(event) => setDraft({ ...draft, editorNote: event.target.value })} /></label>
          </div>}

          {tab === 'history' && <div className="source-details">
            <div><span>Publisher</span><strong>{article.sourceName}</strong><small>{article.sourceDomain}</small></div>
            <div><span>Source author</span><strong>{article.author}</strong></div>
            <div><span>Original publication</span><strong>{formatDateTime(article.sourcePublishedAt)}</strong></div>
            <div><span>Collected</span><strong>{formatDateTime(article.scrapedAt)}</strong></div>
            <div><span>AI model</span><strong>{article.aiModel}</strong><small>{article.promptVersion}</small></div>
            <div className="source-url-detail"><span>Canonical source</span><a href={article.sourceUrl} target="_blank" rel="noreferrer">{article.sourceUrl}<Icon name="external" size={14} /></a></div>
          </div>}
        </section>

        <aside className="editor-sidebar">
          <section className="panel validation-card">
            <div className="sidebar-card-heading"><div><span className="eyebrow">Automated review</span><h3>Factual checks</h3></div><span className={`score-ring ${article.validation.some((issue) => issue.severity === 'error') ? 'score-danger' : 'score-good'}`}>{article.validation.some((issue) => issue.severity === 'error') ? '!' : '✓'}</span></div>
            {article.validation.length ? <div className="validation-list">{article.validation.map((issue) => <div className={`validation-item issue-${issue.severity}`} key={issue.id}><Icon name={issue.severity === 'error' ? 'warning' : issue.severity === 'warning' ? 'info' : 'check'} size={17} /><div><strong>{issue.label}</strong><p>{issue.message}</p></div></div>)}</div> : <div className="all-clear"><Icon name="check" /><strong>All checks passed</strong><p>Numbers, names, dates and qualifications match the source.</p></div>}
            <p className="validation-footnote">Automated checks support — but never replace — editorial judgment.</p>
          </section>
          <section className="panel publication-card">
            <span className="eyebrow">Publication</span><h3>Story details</h3>
            <dl><div><dt>Desk</dt><dd>{CATEGORY_LABELS[draft.category]}</dd></div><div><dt>Source</dt><dd>{article.sourceName}</dd></div><div><dt>Updated</dt><dd>{formatDateTime(article.updatedAt)}</dd></div><div><dt>Top News</dt><dd>{article.topRank ? `Position ${article.topRank}` : 'Not selected'}</dd></div></dl>
            <button className="button button-secondary button-full" type="button" onClick={() => setPreviewOpen(true)}><Icon name="eye" size={17} />Open website preview</button>
            <button className="text-action" type="button" onClick={() => void generateShareLink()}><Icon name="copy" size={15} />Create shareable preview link</button>
            {shareUrl && <div className="share-url"><span>Preview ready</span><code>{shareUrl}</code></div>}
          </section>
        </aside>
      </div>

      <Modal open={previewOpen} onClose={() => { setPreviewOpen(false); if (forcePreview) navigate(`/articles/${article.id}/edit`); }} title="Website preview" eyebrow="Unpublished · Admin only" size="preview"><ArticlePreview article={previewArticle} /></Modal>
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject this article" eyebrow="Editorial decision">
        <div className="reject-dialog"><div className="reject-warning"><Icon name="warning" /><div><strong>This removes the story from the review queue.</strong><p>The source and draft remain in the archive for a full audit trail.</p></div></div><label><span>Reason for rejection</span><textarea rows={5} autoFocus value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Explain the factual, editorial or licensing issue…" /></label><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setRejectOpen(false)}>Cancel</button><button className="button button-danger" type="button" disabled={actionBusy === 'reject'} onClick={() => void reject()}>{actionBusy === 'reject' ? <span className="button-spinner" /> : <Icon name="reject" size={17} />}Reject article</button></div></div>
      </Modal>
    </div>
  );
}
