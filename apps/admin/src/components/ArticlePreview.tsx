import type { Article } from '../types';
import { CATEGORY_LABELS } from '../types';
import { ArticleImage } from './ArticleImage';

export function ArticlePreview({ article }: { article: Article }) {
  const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(article.sourcePublishedAt));
  return (
    <article className="public-preview">
      <nav className="preview-nav"><span className="preview-logo">CEYLON <b>LEDGER</b></span><div><span>HOME</span><span>BUSINESS NEWS</span><span>INTERVIEWS & APPOINTMENTS</span><span>MONEY</span><span>TECHNOLOGY</span><span>TRAVEL & TOURISM</span><span>LUXURY LIVING</span></div></nav>
      <div className="preview-article">
        <div className="preview-kicker"><span>{CATEGORY_LABELS[article.category]}</span><i />{date}</div>
        <h1>{article.draft.headline}</h1>
        <p className="preview-deck">{article.draft.summary}</p>
        <figure><ArticleImage imageUrl={article.imageUrl} sourceUrl={article.sourceUrl} alt={article.draft.headline} /><figcaption>{article.imageCredit}</figcaption></figure>
        <div className="preview-byline">By Ceylon Ledger Editorial · Source: {article.sourceName}</div>
        <div className="preview-body">{article.draft.body.split(/\n\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <aside className="preview-source">This article is based on reporting by <strong>{article.sourceName}</strong>. <a href={article.sourceUrl} target="_blank" rel="noreferrer">View original source</a>.</aside>
      </div>
    </article>
  );
}
