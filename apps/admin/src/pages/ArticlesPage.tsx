import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { ArticleImage } from '../components/ArticleImage';
import { StatusPill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS, type Article, type ArticleStatus, type CategorySlug } from '../types';

const ROUTE_STATUS: Record<string, ArticleStatus | undefined> = {
  '/articles/pending': 'pending_review',
  '/articles/published': 'published',
  '/articles/rejected': 'rejected',
};

const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export function ArticlesPage() {
  const { articles, loading, saveArticle, createArticle, deleteArticle, unpublishArticle, pruneOldArticles, uploadImage } = useNewsroom();
  const { notify } = useToast();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const fixedStatus = ROUTE_STATUS[location.pathname];
  const [query, setQuery] = useState(searchParams.get('search') ?? '');
  const [category, setCategory] = useState<CategorySlug | 'all'>(
    (searchParams.get('category') as CategorySlug | null) ?? 'all'
  );
  const [status, setStatus] = useState<ArticleStatus | 'all'>(fixedStatus ?? 'all');
  const [page, setPage] = useState(1);
  const perPage = 7;

  // Modal states
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Article | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [unpublishTarget, setUnpublishTarget] = useState<Article | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);

  // New Article Form States
  const [newHeadline, setNewHeadline] = useState('');
  const [newCategory, setNewCategory] = useState<CategorySlug>('business-news');
  const [newSummary, setNewSummary] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newTags, setNewTags] = useState('Sri Lanka, Business');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [newImageCredit, setNewImageCredit] = useState('Editorial Desk');
  const [newPublishImmediately, setNewPublishImmediately] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [pruning, setPruning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePrune = async () => {
    if (!window.confirm('Delete all news articles older than 7 days?')) return;
    try {
      setPruning(true);
      const count = await pruneOldArticles(7);
      notify(
        count > 0 ? `Successfully deleted ${count} articles older than 7 days.` : 'No articles older than 7 days found.',
        count > 0 ? 'success' : 'neutral'
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Prune failed', 'danger');
    } finally {
      setPruning(false);
    }
  };

  useEffect(() => {
    setStatus(fixedStatus ?? 'all');
    setPage(1);
  }, [fixedStatus, location.pathname]);

  useEffect(() => {
    const value = searchParams.get('search') ?? '';
    setQuery(value);
    const cat = searchParams.get('category') as CategorySlug | null;
    if (cat && Object.keys(CATEGORY_LABELS).includes(cat)) {
      setCategory(cat);
    } else if (!cat) {
      setCategory('all');
    }
  }, [searchParams]);

  const selectCategory = (nextCat: CategorySlug | 'all') => {
    setCategory(nextCat);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (nextCat !== 'all') next.set('category', nextCat); else next.delete('category');
    setSearchParams(next);
  };

  const filtered = useMemo(() => articles.filter((article) => {
    const haystack = `${article.draft.headline} ${article.original.headline} ${article.sourceName} ${article.tags.join(' ')}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase()))
      && (category === 'all' || article.category === category)
      && (status === 'all' || article.status === status);
  }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [articles, category, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set('search', query.trim()); else next.delete('search');
    setSearchParams(next);
    setPage(1);
  };

  const handleImageFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const res = await uploadImage(file);
      setNewImageUrl(res.url);
      notify('Image uploaded successfully.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Image upload failed', 'danger');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHeadline.trim()) {
      notify('Headline is required.', 'danger');
      return;
    }
    setCreating(true);
    try {
      const tagsArray = newTags.split(',').map(t => t.trim()).filter(Boolean);
      await createArticle({
        headline: newHeadline.trim(),
        summary: newSummary.trim(),
        body: newBody.trim() || newSummary.trim(),
        category: newCategory,
        tags: tagsArray.length ? tagsArray : ['Sri Lanka', 'News'],
        imageUrl: newImageUrl.trim(),
        imageCredit: newImageCredit.trim() || 'Editorial Desk',
        publishImmediately: newPublishImmediately,
      });
      notify(newPublishImmediately ? 'Article created and published to frontend!' : 'Article created as draft.');
      setCreateOpen(false);
      // Reset form
      setNewHeadline('');
      setNewSummary('');
      setNewBody('');
      setNewImageUrl('');
      setNewPublishImmediately(true);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to create article', 'danger');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteArticle(deleteTarget.id);
      notify(`Article "${deleteTarget.draft.headline || deleteTarget.original.headline}" deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete article', 'danger');
    } finally {
      setDeleting(false);
    }
  };

  const handleUnpublishConfirm = async () => {
    if (!unpublishTarget) return;
    setUnpublishing(true);
    try {
      await unpublishArticle(unpublishTarget.id, 'Unpublished from public website');
      notify(`Article "${unpublishTarget.draft.headline || unpublishTarget.original.headline}" unpublished from public site.`);
      setUnpublishTarget(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to unpublish article', 'danger');
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <section className="panel article-library">
      <div className="category-pill-filters">
        <button
          type="button"
          className={`category-pill ${category === 'all' ? 'active' : ''}`}
          onClick={() => selectCategory('all')}
        >
          All Desks
        </button>
        {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
          <button
            type="button"
            className={`category-pill ${category === slug ? 'active' : ''}`}
            key={slug}
            onClick={() => selectCategory(slug as CategorySlug)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="library-toolbar">
        <form className="table-search" onSubmit={submitSearch}>
          <Icon name="search" size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search headline, source or tag…" />
          {query && <button type="button" onClick={() => { setQuery(''); setSearchParams({}); }} aria-label="Clear search"><Icon name="x" size={15} /></button>}
        </form>
        <div className="filter-group">
          <label><span>Category</span><select value={category} onChange={(event) => selectCategory(event.target.value as CategorySlug | 'all')}><option value="all">All desks</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><Icon name="chevron-down" size={15} /></label>
          {!fixedStatus && <label><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as ArticleStatus | 'all'); setPage(1); }}><option value="all">All statuses</option><option value="pending_review">Pending review</option><option value="changes_requested">Changes requested</option><option value="approved">Approved</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="rejected">Rejected</option><option value="failed">Failed</option><option value="scraped">Scraped</option><option value="ai_processing">AI processing</option></select><Icon name="chevron-down" size={15} /></label>}
          <button className="button button-secondary filter-reset" type="button" onClick={() => { selectCategory('all'); setStatus(fixedStatus ?? 'all'); setQuery(''); setSearchParams({}); }}><Icon name="refresh" size={16} />Reset</button>
          <button className="button button-secondary" type="button" title="Clean articles older than 7 days" onClick={handlePrune} disabled={pruning}><Icon name="archive" size={16} />{pruning ? 'Cleaning…' : 'Clean >7d'}</button>
          <button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} />New Article</button>
        </div>
      </div>
      <div className="library-summary"><span><strong>{filtered.length}</strong> {filtered.length === 1 ? 'article' : 'articles'}</span><small>Updated in real time from the editorial workflow</small></div>

      <div className="article-table-wrap">
        <table className="article-table">
          <thead><tr><th>Story</th><th>Desk</th><th>Source</th><th>Status</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {visible.map((article) => (
              <tr key={article.id}>
                <td><Link className="story-cell" to={`/articles/${article.id}/edit`}><ArticleImage imageUrl={article.imageUrl} sourceUrl={article.sourceUrl} /><span><strong>{article.draft.headline || article.original.headline}</strong><small>{article.validation.some((issue) => issue.severity === 'error') && <em className="inline-alert"><Icon name="warning" size={12} />Fact check required</em>}{article.tags.slice(0, 2).join(' · ')}</small></span></Link></td>
                <td>
                  <select
                    className="inline-category-select"
                    value={article.category}
                    onChange={async (e) => {
                      const nextCat = e.target.value as CategorySlug;
                      await saveArticle(article.id, { category: nextCat });
                    }}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option value={value} key={value}>{label}</option>
                    ))}
                  </select>
                </td>
                <td><span className="source-cell"><strong>{article.sourceName}</strong><small>{article.sourceDomain}</small></span></td>
                <td><StatusPill status={article.status} /></td>
                <td><span className="date-cell">{formatDate(article.updatedAt)}<small>{new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(article.updatedAt))}</small></span></td>
                <td>
                  <div className="row-actions-cell">
                    <Link className="row-action" to={`/articles/${article.id}/edit`} aria-label={`Open ${article.draft.headline}`} title="Edit article">
                      <Icon name="chevron-right" size={18} />
                    </Link>
                    {article.status === 'published' && (
                      <button
                        type="button"
                        className="delete-btn-ghost"
                        style={{ color: 'var(--amber, #f59e0b)' }}
                        title="Unpublish / Remove from Public Website"
                        onClick={() => setUnpublishTarget(article)}
                        aria-label="Unpublish article from public site"
                      >
                        <Icon name="archive" size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="delete-btn-ghost"
                      title="Delete article"
                      onClick={() => setDeleteTarget(article)}
                      aria-label="Delete article"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && !visible.length && <div className="empty-state"><Icon name="search" /><strong>No articles found</strong><span>Try removing a filter or searching with another phrase.</span></div>}
      {loading && !visible.length && <div className="table-loading"><span className="button-spinner dark" />Loading newsroom articles…</div>}
      <footer className="table-footer">
        <span>Showing {filtered.length ? (currentPage - 1) * perPage + 1 : 0}–{Math.min(currentPage * perPage, filtered.length)} of {filtered.length}</span>
        <div><button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)}><Icon name="arrow-left" size={16} />Previous</button><span>Page {currentPage} of {totalPages}</span><button type="button" disabled={currentPage === totalPages} onClick={() => setPage((value) => value + 1)}>Next<Icon name="arrow-right" size={16} /></button></div>
      </footer>

      {/* CREATE ARTICLE MODAL */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create New Article" eyebrow="Manual Editorial Entry" size="large">
        <form className="create-article-form" onSubmit={handleCreateArticle}>
          <div className="form-field">
            <label htmlFor="article-headline">Headline / Title *</label>
            <input
              id="article-headline"
              type="text"
              required
              placeholder="e.g. Colombo Stock Exchange gains 120 points as market rallies"
              value={newHeadline}
              onChange={(e) => setNewHeadline(e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label htmlFor="article-category">Editorial Desk / Category *</label>
              <select
                id="article-category"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as CategorySlug)}
              >
                {Object.entries(CATEGORY_LABELS).map(([slug, label]) => (
                  <option key={slug} value={slug}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="article-tags">Tags (comma-separated)</label>
              <input
                id="article-tags"
                type="text"
                placeholder="Sri Lanka, Economy, Markets"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="article-summary">Executive Summary</label>
            <textarea
              id="article-summary"
              rows={3}
              placeholder="Brief bullet point or 2-sentence summary of the news story..."
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor="article-body">Full Article Content</label>
            <textarea
              id="article-body"
              rows={6}
              placeholder="Detailed paragraphs of the news article..."
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
            />
          </div>

          <div className="form-field">
            <span className="form-field-label">Article Image</span>
            {newImageUrl ? (
              <div className="image-upload-preview">
                <img src={newImageUrl} alt="Uploaded preview" />
                <button
                  type="button"
                  className="remove-image-btn"
                  onClick={() => setNewImageUrl('')}
                  title="Remove image"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            ) : (
              <div
                className="image-upload-box"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={handleImageFileChange}
                />
                {uploadingImage ? (
                  <>
                    <span className="button-spinner dark" />
                    <span>Uploading image to server...</span>
                  </>
                ) : (
                  <>
                    <Icon name="edit" size={24} />
                    <strong>Click to upload an image from your device</strong>
                    <small>Supports PNG, JPG, WebP</small>
                  </>
                )}
              </div>
            )}
            <input
              type="text"
              placeholder="Or enter image URL (e.g. /downloaded_images/... or https://...)"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              style={{ marginTop: '8px' }}
            />
          </div>

          <div className="form-field">
            <label htmlFor="article-credit">Image Credit</label>
            <input
              id="article-credit"
              type="text"
              placeholder="e.g. Daily FT / Reuters / Editorial Desk"
              value={newImageCredit}
              onChange={(e) => setNewImageCredit(e.target.value)}
            />
          </div>

          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={newPublishImmediately}
              onChange={(e) => setNewPublishImmediately(e.target.checked)}
            />
            <span>Approve & Publish immediately to Public Website</span>
          </label>

          <div className="modal-actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={creating || uploadingImage}
            >
              {creating ? <span className="button-spinner" /> : <Icon name="check" size={16} />}
              {newPublishImmediately ? 'Publish Article' : 'Save as Draft'}
            </button>
          </div>
        </form>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete News Article"
        eyebrow="Confirm Deletion"
      >
        <div style={{ padding: '10px 4px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p>
            Are you sure you want to permanently delete:
            <br />
            <strong>"{deleteTarget?.draft.headline || deleteTarget?.original.headline}"</strong>?
          </p>
          <p style={{ color: 'var(--red)', fontSize: '13px' }}>
            This will remove the article from the newsroom library and the public website.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={handleDeleteConfirm}
              disabled={deleting}
            >
              {deleting ? <span className="button-spinner" /> : <Icon name="trash" size={16} />}
              Delete Permanently
            </button>
          </div>
        </div>
      </Modal>

      {/* UNPUBLISH CONFIRMATION MODAL */}
      <Modal
        open={Boolean(unpublishTarget)}
        onClose={() => setUnpublishTarget(null)}
        title="Remove from Public Website?"
        eyebrow="Unpublish Article"
      >
        <div style={{ padding: '4px 0' }}>
          <p style={{ margin: '0 0 12px', fontSize: '14px', lineHeight: 1.5 }}>
            Are you sure you want to take down <strong>"{unpublishTarget?.draft.headline || unpublishTarget?.original.headline}"</strong> from the public site?
          </p>
          <p style={{ color: 'var(--amber, #f59e0b)', fontSize: '13px', margin: '0 0 20px' }}>
            This story will be immediately removed from the live public frontend, category desks, and Top News, and moved to review.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setUnpublishTarget(null)}
              disabled={unpublishing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-primary"
              style={{ background: '#d97706', borderColor: '#d97706', color: '#fff' }}
              onClick={handleUnpublishConfirm}
              disabled={unpublishing}
            >
              {unpublishing ? <span className="button-spinner" /> : <Icon name="archive" size={16} />}
              Unpublish Story
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
