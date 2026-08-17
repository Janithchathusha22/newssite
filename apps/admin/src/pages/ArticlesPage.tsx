import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ArticleImage } from '../components/ArticleImage';
import { StatusPill } from '../components/StatusPill';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS, type ArticleStatus, type CategorySlug } from '../types';

const ROUTE_STATUS: Record<string, ArticleStatus | undefined> = {
  '/articles/pending': 'pending_review',
  '/articles/published': 'published',
  '/articles/rejected': 'rejected',
};

const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));

export function ArticlesPage() {
  const { articles, loading, saveArticle } = useNewsroom();
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
                <td><Link className="row-action" to={`/articles/${article.id}/edit`} aria-label={`Open ${article.draft.headline}`}><Icon name="chevron-right" size={18} /></Link></td>
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
    </section>
  );
}
