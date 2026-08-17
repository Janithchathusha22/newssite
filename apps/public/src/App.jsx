import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { categories, categoryBySlug } from './data';
import { getArticle, getCategory, getHome, getPreview, resolveAssetUrl } from './api';

const Arrow = ({ small = false }) => (
  <svg className={small ? 'icon icon--small' : 'icon'} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M13 6l6 6-6 6" />
  </svg>
);

const MenuIcon = ({ open }) => (
  <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
    {open ? <path d="m5 5 14 14M19 5 5 19" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
  </svg>
);

function formatDate(value, long = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: long ? 'long' : 'short', year: 'numeric'
  }).format(date);
}

function Image({ article, className = '', eager = false }) {
  const [failed, setFailed] = useState(false);
  const label = article.category || 'News';
  const src = resolveAssetUrl(article.image, article.sourceUrl);
  const colorKey = article.categorySlug || 'business-news';

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div className={`story-image ${className} story-image--${colorKey} ${failed || !src ? 'is-fallback' : ''}`}>
      {!failed && src ? (
        <img
          src={src}
          alt={article.imageAlt || article.title}
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="image-fallback" aria-label={`${label} image unavailable`}>
          <span>BL</span>
          <small>{label}</small>
        </div>
      )}
    </div>
  );
}

function CategoryTag({ article }) {
  return <Link className="category-tag" to={`/${article.categorySlug}`}>{article.category}</Link>;
}

function SearchPanel({ onClose }) {
  const [query, setQuery] = useState('');
  const [feed, setFeed] = useState({ loading: true, articles: [], error: '' });

  useEffect(() => {
    let active = true;
    getHome().then((result) => {
      if (active) setFeed({ loading: false, articles: result.articles || [], error: result.error || '' });
    });
    return () => { active = false; };
  }, []);

  const matches = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return clean.length < 2 ? [] : feed.articles.filter((article) =>
      `${article.title} ${article.category} ${article.source}`.toLowerCase().includes(clean)
    ).slice(0, 6);
  }, [feed.articles, query]);

  useEffect(() => {
    const escape = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div className="search-layer" role="dialog" aria-modal="true" aria-label="Search stories">
      <button className="search-layer__backdrop" aria-label="Close search" onClick={onClose} />
      <div className="search-panel">
        <div className="search-panel__top">
          <span>Search Business Leaders</span>
          <button onClick={onClose} aria-label="Close search">Close</button>
        </div>
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by story, leadership or sector…" />
        <div className="search-results">
          {feed.loading && <p>Loading the latest reports…</p>}
          {!feed.loading && feed.error && <p>{feed.error}</p>}
          {!feed.loading && !feed.error && !feed.articles.length && <p>No published stories are available to search yet.</p>}
          {!feed.loading && !feed.error && !!feed.articles.length && query.trim().length < 2 && <p>Start typing to explore executive reports.</p>}
          {!feed.loading && !feed.error && query.trim().length >= 2 && !matches.length && <p>No matching stories found.</p>}
          {matches.map((article) => (
            <Link key={article.id} to={`/article/${article.slug}`} onClick={onClose}>
              <small>{article.category}</small>
              <strong>{article.title}</strong>
              <Arrow small />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="signal-bar">
        <div className="shell signal-bar__inner">
          <span className="signal-bar__date">{formatDate(new Date().toISOString(), true)}</span>
          <span><i /> Weekly Business Newsletter · Estd. 2026 Colombo Sri Lanka</span>
          <Link to="/about">About Business Leaders</Link>
        </div>
      </div>
      <header className="masthead">
        <div className="shell masthead__inner">
          <button className="mobile-toggle" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Toggle navigation">
            <MenuIcon open={menuOpen} />
          </button>
          <Link to="/" className="wordmark" aria-label="Business Leaders Sri Lanka home">
            <span className="wordmark__mark">BL</span>
            <span className="wordmark__type">Business <em>Leaders</em></span>
          </Link>
          <p className="masthead__promise">Weekly Business Newsletter<br />Colombo, Sri Lanka</p>
          <button className="search-button" onClick={() => setSearchOpen(true)} aria-label="Search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <span>Search</span>
          </button>
        </div>
      </header>
      <nav className={`main-nav ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <div className="shell main-nav__inner">
          <NavLink to="/" end>Home</NavLink>
          {categories.map((category) => (
            <NavLink key={category.slug} to={`/${category.slug}`}>{category.label}</NavLink>
          ))}
          <button className="mobile-search" onClick={() => { setSearchOpen(true); setMenuOpen(false); }}>Search stories</button>
        </div>
      </nav>
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} />}
    </>
  );
}

function LoadingPage() {
  return (
    <div className="shell loading-page" aria-label="Loading stories">
      <div className="skeleton skeleton--title" />
      <div className="skeleton-grid"><div className="skeleton skeleton--hero" /><div className="skeleton skeleton--hero" /></div>
    </div>
  );
}

function DemoNotice({ show }) {
  if (!show) return null;
  return null;
}

function LeadCard({ article }) {
  return (
    <article className="lead-card">
      <Link to={`/article/${article.slug}`} className="lead-card__image-link"><Image article={article} eager /></Link>
      <div className="lead-card__body">
        <CategoryTag article={article} />
        <h2><Link to={`/article/${article.slug}`}>{article.title}</Link></h2>
        <p>{article.excerpt}</p>
        <div className="story-meta"><span>Business Leaders</span><time>{formatDate(article.publishedAt)}</time></div>
      </div>
    </article>
  );
}

function SideCard({ article }) {
  return (
    <article className="side-card">
      <Link to={`/article/${article.slug}`}><Image article={article} /></Link>
      <div>
        <CategoryTag article={article} />
        <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
        <div className="story-meta"><span>Business Leaders</span><time>{formatDate(article.publishedAt)}</time></div>
      </div>
    </article>
  );
}

function HomePage() {
  const [state, setState] = useState({ loading: true, articles: [], topNews: [], demo: false, error: '' });

  useEffect(() => {
    let active = true;
    const load = () => getHome().then((result) => active && setState({ ...result, loading: false }));
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  if (state.loading) return <LoadingPage />;
  const top = state.topNews.length ? state.topNews : state.articles.slice(0, 10);
  const lead = top[0] || state.articles[0];
  if (!lead) {
    return (
      <main id="main-content">
        <FeedState error={state.error} />
      </main>
    );
  }

  return (
    <main id="main-content">
      <div className="shell"><DemoNotice show={state.demo} /></div>
      <section className="edition-intro shell">
        <div>
          <span className="eyebrow">Weekly Business Edition</span>
          <h1>business<br />leaders<br /><em>sri lanka</em></h1>
        </div>
        <p>Strategic decisions, executive leadership, capital markets and corporate intelligence shaping Sri Lanka.</p>
        <span className="edition-no">ESTD. 2026<br />Colombo</span>
      </section>

      <section className="lead-layout shell" aria-label="Lead stories">
        <LeadCard article={lead} />
        <div className="lead-layout__side">
          {top.slice(1, 3).map((article) => <SideCard key={article.id} article={article} />)}
        </div>
      </section>

      <section className="top-stories shell section-block">
        <div className="section-heading">
          <div><span>01</span><h2>Top 10</h2></div>
          <p>This week’s essential executive reading</p>
        </div>
        <ol className="top-list">
          {top.slice(0, 10).map((article, index) => (
            <li key={article.id}>
              <span className="top-list__number">{String(index + 1).padStart(2, '0')}</span>
              <div className="top-list__story">
                <CategoryTag article={article} />
                <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
                <div className="story-meta"><span>Business Leaders</span><time>{formatDate(article.publishedAt)}</time></div>
              </div>
              <Link className="circle-link" to={`/article/${article.slug}`} aria-label={`Read ${article.title}`}><Arrow /></Link>
            </li>
          ))}
        </ol>
      </section>

      {categories.map((category, categoryIndex) => {
        const items = state.articles.filter((article) => article.categorySlug === category.slug).slice(0, 3);
        if (!items.length) return null;
        return (
          <section className={`category-section shell ${categoryIndex % 2 ? 'category-section--tint' : ''}`} key={category.slug}>
            <div className="section-heading">
              <div><span>{String(categoryIndex + 2).padStart(2, '0')}</span><h2>{category.label}</h2></div>
              <Link to={`/${category.slug}`}>View all <Arrow small /></Link>
            </div>
            <div className="category-grid">
              {items.map((article, index) => (
                <article className={index === 0 ? 'category-card category-card--feature' : 'category-card'} key={article.id}>
                  <Link to={`/article/${article.slug}`}><Image article={article} /></Link>
                  <div className="category-card__body">
                    <div className="story-meta"><span>Business Leaders</span><time>{formatDate(article.publishedAt)}</time></div>
                    <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
                    {index === 0 && <p>{article.excerpt}</p>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
      <Newsletter />
    </main>
  );
}

function CategoryPage() {
  const { slug } = useParams();
  const category = categoryBySlug(slug);
  const [state, setState] = useState({ loading: true, articles: [], demo: false, error: '' });

  useEffect(() => {
    let active = true;
    setState({ loading: true, articles: [], demo: false, error: '' });
    const load = () => getCategory(slug).then((result) => active && setState({ ...result, loading: false }));
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    void load();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [slug]);

  if (!category) return <NotFound />;
  if (state.loading) return <LoadingPage />;
  const [lead, ...rest] = state.articles;

  return (
    <main id="main-content" className="category-page">
      <div className="shell"><DemoNotice show={state.demo} /></div>
      <header className="category-hero shell">
        <span className="eyebrow">Section</span>
        <h1>{category.label}</h1>
        <p>Executive reporting, analysis and market movements across Sri Lanka.</p>
      </header>
      {!lead ? <FeedState error={state.error} /> : (
        <>
          <section className="category-lead shell">
            <Link to={`/article/${lead.slug}`}><Image article={lead} eager /></Link>
            <div>
              <span className="category-lead__label">Featured Report</span>
              <h2><Link to={`/article/${lead.slug}`}>{lead.title}</Link></h2>
              <p>{lead.excerpt}</p>
              <div className="story-meta"><span>Business Leaders</span><time>{formatDate(lead.publishedAt)}</time></div>
              <Link className="text-link" to={`/article/${lead.slug}`}>Read full story <Arrow small /></Link>
            </div>
          </section>
          <section className="archive shell">
            <div className="section-heading"><div><span>Archive</span><h2>Latest in {category.short}</h2></div></div>
            <div className="archive-grid">
              {rest.map((article) => (
                <article className="archive-card" key={article.id}>
                  <Link to={`/article/${article.slug}`}><Image article={article} /></Link>
                  <div>
                    <div className="story-meta"><span>Business Leaders</span><time>{formatDate(article.publishedAt)}</time></div>
                    <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
                    <p>{article.excerpt}</p>
                    <Link className="text-link" to={`/article/${article.slug}`}>Continue reading <Arrow small /></Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      <Newsletter compact />
    </main>
  );
}

function ArticlePage({ preview = false }) {
  const { slug, token } = useParams();
  const [state, setState] = useState({ loading: true, article: null, demo: false, error: '', notFound: false });
  const [related, setRelated] = useState([]);

  useEffect(() => {
    let active = true;
    setState({ loading: true, article: null, demo: false, error: '', notFound: false });
    setRelated([]);
    const loader = preview ? getPreview(token) : getArticle(slug);
    loader.then((result) => {
      if (!active) return;
      setRelated((result.related || []).slice(0, 3));
      setState({ ...result, loading: false });
    });
    return () => { active = false; };
  }, [slug, token, preview]);

  useEffect(() => {
    let active = true;
    if (preview || related.length || !state.article?.categorySlug) return () => { active = false; };
    getCategory(state.article.categorySlug).then((result) => {
      if (!active || result.error) return;
      setRelated(result.articles
        .filter((item) => item.slug !== state.article.slug)
        .slice(0, 3));
    });
    return () => { active = false; };
  }, [preview, related.length, state.article?.categorySlug, state.article?.slug]);

  useEffect(() => {
    if (!preview) return undefined;
    const existing = document.querySelector('meta[name="robots"]');
    const previous = existing?.getAttribute('content');
    const meta = existing || document.createElement('meta');
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex, nofollow, noarchive');
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (!existing) meta.remove();
      else if (previous) existing.setAttribute('content', previous);
      else existing.removeAttribute('content');
    };
  }, [preview]);

  if (state.loading) return <LoadingPage />;
  if (state.error) return <FeedState error={state.error} title={preview ? 'Preview unavailable' : 'Story unavailable'} />;
  if (!state.article) return <NotFound />;
  const article = state.article;
  const minutes = Math.max(1, Math.ceil((article.body || []).join(' ').split(/\s+/).length / 210));

  return (
    <main id="main-content" className="article-page">
      {preview && (
        <div className="preview-banner" role="status">
          <div className="shell"><strong>Editorial preview</strong><span>Not published · This private link may expire</span></div>
        </div>
      )}
      <div className="shell"><DemoNotice show={state.demo} /></div>
      <article>
        <header className="article-header shell">
          <div className="breadcrumbs"><Link to="/">Home</Link><span>/</span><Link to={`/${article.categorySlug}`}>{article.category}</Link></div>
          <CategoryTag article={article} />
          <h1>{article.title}</h1>
          <p className="article-deck">{article.summary || article.excerpt}</p>
          <div className="article-byline">
            <div><span>Reported by</span><strong>Business Leaders Editorial Desk</strong></div>
            <div><span>Published</span><time>{formatDate(article.publishedAt, true)}</time></div>
            <div><span>Reading time</span><strong>{minutes} min read</strong></div>
          </div>
        </header>
        <div className="article-hero shell"><Image article={article} eager /></div>
        <div className="article-layout shell">
          <aside className="share-rail">
            <span>Share</span>
            <button aria-label="Copy article link" onClick={() => navigator.clipboard?.writeText(window.location.href)}>↗</button>
          </aside>
          <div className="article-copy">
            {(article.body || []).map((paragraph, index) => (
              <p className={index === 0 ? 'article-copy__opening' : ''} key={`${article.id}-${index}`}>{paragraph}</p>
            ))}
            <div className="source-card">
              <div className="source-card__icon">BL</div>
              <div>
                <span>Official Publication</span>
                <strong>Business Leaders Sri Lanka</strong>
                <p>Curated executive insights, market data, and business intelligence for corporate Sri Lanka.</p>
              </div>
            </div>
          </div>
          <aside className="article-aside">
            <span className="eyebrow">In this section</span>
            <h3>{article.category}</h3>
            <p>More executive analysis from the Business Leaders newsroom.</p>
            <Link to={`/${article.categorySlug}`}>Explore section <Arrow small /></Link>
          </aside>
        </div>
      </article>
      {!!related.length && (
        <section className="related shell">
          <div className="section-heading"><div><span>Next</span><h2>Continue reading</h2></div></div>
          <div className="related-grid">
            {related.map((item) => <SideCard article={item} key={item.id} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function Newsletter({ compact = false }) {
  const [submitted, setSubmitted] = useState(false);
  return (
    <section className={`newsletter ${compact ? 'newsletter--compact' : ''}`}>
      <div className="shell newsletter__inner">
        <span className="newsletter__stamp">Weekly<br />Business<br />Brief</span>
        <div><span className="eyebrow">Executive Briefing</span><h2>Know what matters<br />in Sri Lankan business.</h2></div>
        {submitted ? <p className="newsletter__thanks">You’re on the VIP list.<br /><small>Watch your inbox for the weekly briefing.</small></p> : (
          <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
            <label htmlFor={`email-${compact}`}>Corporate email address</label>
            <div><input id={`email-${compact}`} type="email" required placeholder="ceo@company.lk" /><button>Subscribe <Arrow small /></button></div>
            <small>Weekly business updates only. Unsubscribe at any time.</small>
          </form>
        )}
      </div>
    </section>
  );
}

function AboutPage() {
  return (
    <main id="main-content" className="simple-page shell">
      <span className="eyebrow">About us</span>
      <h1>Executive intelligence on<br /><em>Sri Lanka’s business horizon.</em></h1>
      <div className="simple-page__copy">
        <p><strong>Business Leaders Sri Lanka</strong> is a premier weekly business publication and digital intelligence platform focused on corporate leadership, appointments, capital markets, enterprise technology, and luxury living.</p>
        <p>Every story is curated and verified by our editorial desk to deliver actionable clarity for founders, C-suite executives, institutional investors, and innovators shaping Sri Lanka’s economic future.</p>
      </div>
    </main>
  );
}

function FeedState({ error = '', title = '' }) {
  const unavailable = Boolean(error);
  return (
    <div className="empty-state shell" role={unavailable ? 'alert' : 'status'}>
      <span>{unavailable ? 'Service Notice' : 'BL'}</span>
      <h2>{title || (unavailable ? 'News feed unavailable' : 'No published stories yet')}</h2>
      <p>{error || 'New reports will appear here after editorial review.'}</p>
      {unavailable
        ? <button type="button" onClick={() => window.location.reload()}>Try again</button>
        : <Link to="/">Return home</Link>}
    </div>
  );
}

function NotFound() {
  return <main id="main-content" className="not-found shell"><span>404</span><h1>This report is off the record.</h1><p>The story may have moved or is no longer available.</p><Link to="/">Back to latest edition <Arrow small /></Link></main>;
}

function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer__top">
        <Link to="/" className="wordmark wordmark--footer"><span className="wordmark__mark">BL</span><span className="wordmark__type">Business <em>Leaders</em></span></Link>
        <p>Weekly Business Newsletter · Colombo, Sri Lanka</p>
      </div>
      <div className="shell footer__grid">
        <div><span>Sections</span>{categories.slice(0, 3).map((category) => <Link key={category.slug} to={`/${category.slug}`}>{category.label}</Link>)}</div>
        <div><span>Explore</span>{categories.slice(3).map((category) => <Link key={category.slug} to={`/${category.slug}`}>{category.label}</Link>)}</div>
        <div><span>Editorial</span><Link to="/about">About us</Link><a href="mailto:editor@businessleaders.lk">Contact desk</a></div>
        <div className="footer__source" id="sources"><span>Our Promise</span><p>Insightful, verified business intelligence delivered weekly for corporate decision makers across Sri Lanka.</p></div>
      </div>
      <div className="shell footer__bottom"><span>© 2026 Business Leaders Sri Lanka. All Rights Reserved.</span><span>ESTD. 2026 · Colombo, Sri Lanka</span></div>
    </footer>
  );
}

function ScrollManager() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  return null;
}

export default function App() {
  return (
    <div className="site">
      <ScrollManager />
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/category/:slug" element={<CategoryPage />} />
        <Route path="/article/:slug" element={<ArticlePage />} />
        <Route path="/preview/:token" element={<ArticlePage preview />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/:slug" element={<CategoryPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </div>
  );
}
