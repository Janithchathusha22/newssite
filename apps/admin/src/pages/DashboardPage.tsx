import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { ArticleImage } from '../components/ArticleImage';
import { StatusPill } from '../components/StatusPill';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS } from '../types';

const relativeTime = (date: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export function DashboardPage() {
  const { articles, sources, events, loading } = useNewsroom();
  const metrics: { label: string; value: number; note: string; icon: IconName; tone: string; to: string }[] = [
    { label: 'Pending review', value: articles.filter((a) => a.status === 'pending_review').length, note: 'Ready for an editor', icon: 'clock', tone: 'amber', to: '/articles/pending' },
    { label: 'Published', value: articles.filter((a) => a.status === 'published').length, note: 'Live in this workspace', icon: 'published', tone: 'green', to: '/articles/published' },
    { label: 'Needs attention', value: articles.filter((a) => a.validation.some((v) => v.severity === 'error')).length, note: 'Factual checks flagged', icon: 'warning', tone: 'red', to: '/articles/pending' },
    { label: 'Healthy sources', value: sources.filter((s) => s.status === 'healthy').length, note: `${sources.length} sources configured`, icon: 'sources', tone: 'blue', to: '/sources' },
  ];
  const queue = articles.filter((article) => article.status === 'pending_review').slice(0, 4);
  const publishedCount = articles.filter((a) => a.status === 'published').length;
  const publishedByCategory = Object.entries(CATEGORY_LABELS).map(([slug, label]) => {
    const count = publishedCount > 0
      ? articles.filter((article) => article.status === 'published' && article.category === slug).length
      : articles.filter((article) => article.category === slug).length;
    return { slug, label, count };
  }).sort((a, b) => b.count - a.count);
  const maxCategory = Math.max(...publishedByCategory.map((item) => item.count), 1);

  if (loading && !articles.length) return <DashboardSkeleton />;

  return (
    <div className="dashboard-grid">
      <section className="metric-grid">
        {metrics.map((metric) => (
          <Link className="metric-card" to={metric.to} key={metric.label}>
            <span className={`metric-icon tone-${metric.tone}`}><Icon name={metric.icon} /></span>
            <div><span>{metric.label}</span><strong>{metric.value.toString().padStart(2, '0')}</strong><small>{metric.note}</small></div>
            <Icon name="arrow-right" size={17} className="metric-arrow" />
          </Link>
        ))}
      </section>

      <section className="panel queue-panel dashboard-span-2">
        <div className="panel-heading"><div><span className="eyebrow">Priority desk</span><h2>Review queue</h2></div><Link to="/articles/pending">View all <Icon name="arrow-right" size={15} /></Link></div>
        <div className="compact-article-list">
          {queue.map((article) => (
            <Link to={`/articles/${article.id}/edit`} className="compact-article" key={article.id}>
              <ArticleImage imageUrl={article.imageUrl} sourceUrl={article.sourceUrl} />
              <div className="compact-copy">
                <span className="article-category">{CATEGORY_LABELS[article.category]}</span>
                <strong>{article.draft.headline}</strong>
                <small>{article.sourceName} · {relativeTime(article.updatedAt)}</small>
              </div>
              <div className="compact-status">
                {article.validation.some((issue) => issue.severity === 'error')
                  ? <span className="flag flag-danger"><Icon name="warning" size={14} />Check facts</span>
                  : article.validation.some((issue) => issue.severity === 'warning')
                    ? <span className="flag flag-warning"><Icon name="info" size={14} />Review note</span>
                    : <span className="flag flag-success"><Icon name="check" size={14} />Matched</span>}
                <Icon name="chevron-right" size={18} />
              </div>
            </Link>
          ))}
          {!queue.length && <div className="empty-state compact-empty"><Icon name="check" /><strong>Review queue is clear</strong><span>There are no pending articles right now.</span></div>}
        </div>
      </section>

      <section className="panel activity-panel">
        <div className="panel-heading"><div><span className="eyebrow">Live record</span><h2>Recent activity</h2></div></div>
        <div className="timeline">
          {events.slice(0, 5).map((event) => {
            const article = articles.find((item) => item.id === event.articleId);
            return (
              <div className="timeline-item" key={event.id}>
                <i className={`timeline-dot event-${event.action}`} />
                <div><strong>{event.label}</strong><span>{article?.draft.headline ?? 'Editorial article'}</span><small>{event.actor} · {relativeTime(event.createdAt)}</small></div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel category-panel">
        <div className="panel-heading"><div><span className="eyebrow">Coverage mix</span><h2>{publishedCount > 0 ? 'Published by desk' : 'Articles by desk'}</h2></div><Link to="/articles">View all</Link></div>
        <div className="category-bars">
          {publishedByCategory.map((item) => (
            <Link to={`/articles?category=${item.slug}`} className="category-bar category-bar-link" key={item.label}>
              <div><span>{item.label}</span><strong>{item.count}</strong></div>
              <i><b style={{ width: `${Math.max(item.count ? 14 : 0, (item.count / maxCategory) * 100)}%` }} /></i>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel top-mini-panel">
        <div className="panel-heading"><div><span className="eyebrow">Homepage</span><h2>Top News order</h2></div><Link to="/top-news">Manage <Icon name="arrow-right" size={15} /></Link></div>
        <div className="ranked-mini-list">
          {articles.filter((article) => article.topRank !== null).sort((a, b) => (a.topRank ?? 99) - (b.topRank ?? 99)).slice(0, 5).map((article) => (
            <div key={article.id}><i>{article.topRank}</i><span>{article.draft.headline}</span></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DashboardSkeleton() {
  return <div className="skeleton-page"><div className="skeleton metric-skeleton" /><div className="skeleton metric-skeleton" /><div className="skeleton metric-skeleton" /><div className="skeleton metric-skeleton" /><div className="skeleton panel-skeleton" /></div>;
}
