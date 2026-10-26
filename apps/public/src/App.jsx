import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { categories, categoryBySlug } from './data';
import { getArticle, getCategory, getHome, getPreview, resolveAssetUrl } from './api';
import logoImage from './assets/logo.jpeg';

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

const FacebookIcon = () => (
  <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

const TwitterIcon = () => (
  <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
  </svg>
);

const LinkedInIcon = () => (
  <svg className="social-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
  </svg>
);

function formatDate(value, long = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '';
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString() || Math.abs(now.getTime() - date.getTime()) < 24 * 3600 * 1000;
  if (isToday && !long) {
    const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return `Today, ${timeStr}`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: long ? 'long' : 'short', year: 'numeric'
  }).format(date);
}

function getReadMinutes(article) {
  const words = ((article.body || []).join(' ') || article.summary || article.excerpt || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
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
        <div className="image-fallback" aria-label={`${label} image`}>
          <img src={logoImage} alt="Business Leaders Sri Lanka" className="image-fallback__logo" />
        </div>
      )}
    </div>
  );
}

function CategoryTag({ article }) {
  return <Link className="category-tag" to={`/${article.categorySlug}`}>{article.category}</Link>;
}

function QuickReadModal({ article, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!article) return null;
  const minutes = getReadMinutes(article);
  const paragraphs = (article.body && article.body.length > 0)
    ? article.body
    : [article.summary || article.excerpt].filter(Boolean);

  return (
    <div className="quick-modal-layer" role="dialog" aria-modal="true" aria-label="Executive Briefing">
      <div className="quick-modal-backdrop" onClick={onClose} />
      <div className="quick-modal-card">
        <div className="quick-modal-header">
          <div className="quick-modal-badge">
            <span className="live-dot" />
            <span>Executive Fast Briefing</span>
          </div>
          <button className="quick-modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="quick-modal-meta">
          <span className="category-pill">{article.category}</span>
          <span className="meta-sep">·</span>
          <time>{formatDate(article.publishedAt, true)}</time>
          <span className="meta-sep">·</span>
          <span>{minutes} min read</span>
          <span className="meta-sep">·</span>
          <span>Source: Business Leaders Desk</span>
        </div>

        <h2 className="quick-modal-title">{article.title}</h2>

        <div className="quick-modal-hero">
          <Image article={article} eager />
        </div>

        <div className="quick-modal-body">
          {paragraphs.map((p, idx) => (
            <p key={idx} className={idx === 0 ? 'lead-para' : ''}>{p}</p>
          ))}
        </div>

        <div className="quick-modal-footer">
          <Link to={`/article/${article.slug}`} className="btn-primary" onClick={onClose}>
            Open Full Story Report <Arrow small />
          </Link>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
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
    ).slice(0, 8);
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
          <span>Search Business Leaders Intelligence</span>
          <button onClick={onClose} aria-label="Close search">Close ✕</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by topic, bank, company or market…"
        />
        <div className="search-results">
          {feed.loading && <p className="search-status">Loading intelligence database…</p>}
          {!feed.loading && feed.error && <p className="search-status">{feed.error}</p>}
          {!feed.loading && !feed.error && !feed.articles.length && <p className="search-status">No published stories available to search.</p>}
          {!feed.loading && !feed.error && !!feed.articles.length && query.trim().length < 2 && (
            <p className="search-status">Type 2 or more characters to explore executive reports.</p>
          )}
          {!feed.loading && !feed.error && query.trim().length >= 2 && !matches.length && (
            <p className="search-status">No matching reports found for "{query}".</p>
          )}
          {matches.map((article) => (
            <Link key={article.id} to={`/article/${article.slug}`} onClick={onClose} className="search-result-item">
              <span className="category-pill">{article.category}</span>
              <strong className="search-result-title">{article.title}</strong>
              <time>{formatDate(article.publishedAt)}</time>
              <Arrow small />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignalBar() {
  return (
    <div className="signal-bar">
      <div className="shell signal-bar__inner">
        <div className="signal-bar__live">
          <span className="live-dot" />
          <strong className="live-label">LIVE INTELLIGENCE</strong>
          <span className="signal-date">
            {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} · Colombo Bureau
          </span>
        </div>
        <div className="signal-bar__ticker">
          <div className="ticker-track">
            <span className="ticker-item"><strong className="ticker-tag">CSE ASPI</strong> 12,482.4 <span className="ticker-up">▲ +0.48%</span></span>
            <span className="ticker-sep">/</span>
            <span className="ticker-item"><strong className="ticker-tag">S&P SL20</strong> 3,694.1 <span className="ticker-up">▲ +0.62%</span></span>
            <span className="ticker-sep">/</span>
            <span className="ticker-item"><strong className="ticker-tag">USD/LKR</strong> 302.25 <span className="ticker-down">▼ -0.10%</span></span>
            <span className="ticker-sep">/</span>
            <span className="ticker-item"><strong className="ticker-tag">Brent Crude</strong> $74.40 <span className="ticker-up">▲ +0.35%</span></span>
          </div>
        </div>
        <div className="signal-bar__status">
          <span>Continuous Newsroom Feed</span>
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
      <SignalBar />
      <header className="masthead">
        <div className="shell masthead__inner">
          <div className="masthead__socials">
            <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook"><FacebookIcon /></a>
            <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X"><TwitterIcon /></a>
            <a href="https://whatsapp.com" target="_blank" rel="noreferrer" aria-label="WhatsApp"><WhatsAppIcon /></a>
            <a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn"><LinkedInIcon /></a>
          </div>

          <Link to="/" className="brand-logo-link" aria-label="Business Leaders Sri Lanka home">
            <img src={logoImage} alt="Business Leaders Sri Lanka" className="brand-logo-img" />
            <div className="brand-logo-text">
              <span className="brand-title">BUSINESS LEADERS</span>
              <span className="brand-subtitle">SRI LANKA · EXECUTIVE BUSINESS INTELLIGENCE</span>
            </div>
          </Link>

          <div className="masthead__right">
            <button className="search-button" onClick={() => setSearchOpen(true)} aria-label="Search stories">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
              <span>Search Desk</span>
            </button>
            <button className="mobile-toggle" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="Toggle navigation">
              <MenuIcon open={menuOpen} />
            </button>
          </div>
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

function LeadCard({ article, onQuickRead }) {
  const minutes = getReadMinutes(article);
  return (
    <article className="lead-card">
      <Link to={`/article/${article.slug}`} className="lead-card__image-link">
        <Image article={article} eager />
      </Link>
      <div className="lead-card__body">
        <div className="lead-card__tags">
          <CategoryTag article={article} />
          <span className="read-badge">{minutes} min read</span>
        </div>
        <h2><Link to={`/article/${article.slug}`}>{article.title}</Link></h2>
        <p>{article.excerpt || article.summary}</p>
        <div className="lead-card__footer">
          <div className="story-meta">
            <span>Business Leaders Desk</span>
            <time>{formatDate(article.publishedAt)}</time>
          </div>
          <button
            type="button"
            className="quick-read-btn"
            onClick={() => onQuickRead(article)}
            aria-label={`Quick read ${article.title}`}
          >
            ⚡ Quick Read
          </button>
        </div>
      </div>
    </article>
  );
}

function SideCard({ article, onQuickRead }) {
  const minutes = getReadMinutes(article);
  return (
    <article className="side-card">
      <Link to={`/article/${article.slug}`} className="side-card__image-link">
        <Image article={article} />
      </Link>
      <div className="side-card__content">
        <div className="side-card__top">
          <CategoryTag article={article} />
          <span className="time-badge">{formatDate(article.publishedAt)}</span>
        </div>
        <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
        <div className="side-card__footer">
          <span className="read-badge-subtle">{minutes} min read</span>
          <button
            type="button"
            className="quick-read-link"
            onClick={() => onQuickRead(article)}
          >
            Quick Read
          </button>
        </div>
      </div>
    </article>
  );
}

function HomePage() {
  const [state, setState] = useState({ loading: true, articles: [], topNews: [], demo: false, error: '' });
  const [quickArticle, setQuickArticle] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [streamSearch, setStreamSearch] = useState('');

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

  // Filter latest news stream
  const filteredLatest = state.articles.filter((article) => {
    const matchesCategory = activeCategory === 'all' || article.categorySlug === activeCategory;
    const matchesSearch = !streamSearch.trim() ||
      `${article.title} ${article.category} ${article.summary}`.toLowerCase().includes(streamSearch.trim().toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <main id="main-content">
      {/* Executive Briefing Intro Banner */}
      <section className="edition-intro shell">
        <div className="edition-intro__left">
          <span className="eyebrow">Executive Intelligence & Market Briefing</span>
          <h1>Business Leaders Sri Lanka</h1>
          <p>Verified corporate developments, monetary policy, sovereign debt milestones, and leadership intelligence.</p>
        </div>
        <div className="edition-intro__right">
          <div className="edition-stamp-card">
            <span className="stamp-label">TODAY'S EDITION</span>
            <strong className="stamp-date">
              {new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()).toUpperCase()}
            </strong>
            <span className="stamp-city">Colombo, LK</span>
            <div className="stamp-metric">
              <span className="live-dot" />
              <span>10 Key Briefings Live</span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero & Trending Wire Section */}
      <section className="lead-layout shell" aria-label="Lead stories">
        <div className="lead-layout__main">
          <LeadCard article={lead} onQuickRead={setQuickArticle} />
        </div>
        <aside className="lead-layout__side">
          <div className="side-heading">
            <span className="side-heading__dot" />
            <h3>TRENDING WIRE</h3>
            <span className="side-heading__sub">Editor's Pick</span>
          </div>
          <div className="side-card-list">
            {top.slice(1, 4).map((article) => (
              <SideCard key={article.id} article={article} onQuickRead={setQuickArticle} />
            ))}
          </div>
        </aside>
      </section>

      {/* Redesigned TOP 10 Executive Briefing (2-Column Board) */}
      <section className="top-stories shell section-block">
        <div className="section-heading">
          <div className="section-heading__title">
            <span className="section-badge">01</span>
            <h2>Top 10 Executive Briefing</h2>
          </div>
          <p className="section-heading__sub">Essential intelligence ranked by editorial desk · Today, 22 Oct 2026</p>
        </div>

        <div className="top-briefing-grid">
          {/* Column 1: Items 1 to 5 */}
          <div className="top-column">
            {top.slice(0, 5).map((article, index) => (
              <article key={article.id} className="top-item">
                <span className="top-rank-badge">{String(index + 1).padStart(2, '0')}</span>
                <Link to={`/article/${article.slug}`} className="top-item__thumb">
                  <Image article={article} />
                </Link>
                <div className="top-item__content">
                  <div className="top-item__meta">
                    <CategoryTag article={article} />
                    <span className="meta-sep">·</span>
                    <time>{formatDate(article.publishedAt)}</time>
                  </div>
                  <h4 className="top-item__title">
                    <Link to={`/article/${article.slug}`}>{article.title}</Link>
                  </h4>
                  <div className="top-item__actions">
                    <button
                      type="button"
                      className="top-quick-btn"
                      onClick={() => setQuickArticle(article)}
                      aria-label={`Quick read ${article.title}`}
                    >
                      ⚡ Quick Read
                    </button>
                    <Link to={`/article/${article.slug}`} className="top-read-link" aria-label="Read full report">
                      <Arrow small />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Column 2: Items 6 to 10 */}
          <div className="top-column">
            {top.slice(5, 10).map((article, index) => (
              <article key={article.id} className="top-item">
                <span className="top-rank-badge top-rank-badge--subtle">{String(index + 6).padStart(2, '0')}</span>
                <Link to={`/article/${article.slug}`} className="top-item__thumb">
                  <Image article={article} />
                </Link>
                <div className="top-item__content">
                  <div className="top-item__meta">
                    <CategoryTag article={article} />
                    <span className="meta-sep">·</span>
                    <time>{formatDate(article.publishedAt)}</time>
                  </div>
                  <h4 className="top-item__title">
                    <Link to={`/article/${article.slug}`}>{article.title}</Link>
                  </h4>
                  <div className="top-item__actions">
                    <button
                      type="button"
                      className="top-quick-btn"
                      onClick={() => setQuickArticle(article)}
                      aria-label={`Quick read ${article.title}`}
                    >
                      ⚡ Quick Read
                    </button>
                    <Link to={`/article/${article.slug}`} className="top-read-link" aria-label="Read full report">
                      <Arrow small />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Latest News Stream (අලුත්ම පුවත් - Continuous Wire with Category Tabs) */}
      <section className="latest-stream-section shell section-block">
        <div className="section-heading">
          <div className="section-heading__title">
            <span className="section-badge">02</span>
            <h2>Latest News Stream (අලුත්ම පුවත්)</h2>
          </div>
          <div className="stream-search-box">
            <input
              type="text"
              placeholder="Filter stream by keyword…"
              value={streamSearch}
              onChange={(e) => setStreamSearch(e.target.value)}
              aria-label="Filter latest stream"
            />
            {streamSearch && (
              <button className="stream-search-clear" onClick={() => setStreamSearch('')}>✕</button>
            )}
          </div>
        </div>

        {/* Category Desk Switcher Tabs */}
        <div className="stream-filter-bar">
          <button
            className={`stream-tab ${activeCategory === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >
            All Desks ({state.articles.length})
          </button>
          {categories.map((cat) => {
            const count = state.articles.filter((a) => a.categorySlug === cat.slug).length;
            if (count === 0) return null;
            return (
              <button
                key={cat.slug}
                className={`stream-tab ${activeCategory === cat.slug ? 'is-active' : ''}`}
                onClick={() => setActiveCategory(cat.slug)}
              >
                {cat.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Stream News Cards Grid */}
        <div className="stream-grid">
          {filteredLatest.slice(0, 9).map((article) => {
            const minutes = getReadMinutes(article);
            return (
              <article key={article.id} className="stream-card">
                <Link to={`/article/${article.slug}`} className="stream-card__thumb">
                  <Image article={article} />
                  <span className="stream-card__cat-overlay">{article.category}</span>
                </Link>
                <div className="stream-card__body">
                  <div className="stream-card__meta">
                    <time>{formatDate(article.publishedAt)}</time>
                    <span className="meta-sep">·</span>
                    <span>{minutes} min read</span>
                  </div>
                  <h3 className="stream-card__title">
                    <Link to={`/article/${article.slug}`}>{article.title}</Link>
                  </h3>
                  <p className="stream-card__excerpt">
                    {article.excerpt || article.summary}
                  </p>
                  <div className="stream-card__footer">
                    <button
                      type="button"
                      className="stream-card__quick-btn"
                      onClick={() => setQuickArticle(article)}
                    >
                      ⚡ Quick Read
                    </button>
                    <Link to={`/article/${article.slug}`} className="stream-card__full-link">
                      Full Story →
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Category Deep Dives */}
      {categories.map((category, categoryIndex) => {
        const items = state.articles.filter((article) => article.categorySlug === category.slug).slice(0, 3);
        if (!items.length) return null;
        return (
          <section className="category-section shell" key={category.slug}>
            <div className="section-heading">
              <div className="section-heading__title">
                <span className="section-badge">{String(categoryIndex + 3).padStart(2, '0')}</span>
                <h2>{category.label}</h2>
              </div>
              <Link to={`/${category.slug}`} className="section-view-all">
                View all stories <Arrow small />
              </Link>
            </div>
            <div className="category-grid">
              {items.map((article, index) => (
                <article className={index === 0 ? 'category-card category-card--feature' : 'category-card'} key={article.id}>
                  <Link to={`/article/${article.slug}`} className="category-card__thumb">
                    <Image article={article} />
                  </Link>
                  <div className="category-card__body">
                    <div className="story-meta">
                      <span>Business Leaders</span>
                      <time>{formatDate(article.publishedAt)}</time>
                    </div>
                    <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
                    <p>{article.excerpt || article.summary}</p>
                    <button
                      type="button"
                      className="card-quick-read"
                      onClick={() => setQuickArticle(article)}
                    >
                      ⚡ Quick Read
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}

      <Newsletter />

      {/* Quick Read Modal */}
      {quickArticle && (
        <QuickReadModal article={quickArticle} onClose={() => setQuickArticle(null)} />
      )}
    </main>
  );
}

function CategoryPage() {
  const { slug } = useParams();
  const category = categoryBySlug(slug);
  const [state, setState] = useState({ loading: true, articles: [], demo: false, error: '' });
  const [quickArticle, setQuickArticle] = useState(null);

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
      <header className="category-hero shell">
        <span className="eyebrow">Executive Desk</span>
        <h1>{category.label}</h1>
        <p>Curated executive reporting, policy shifts, and market movements across Sri Lanka.</p>
      </header>
      {!lead ? <FeedState error={state.error} /> : (
        <>
          <section className="category-lead shell">
            <Link to={`/article/${lead.slug}`} className="category-lead__thumb">
              <Image article={lead} eager />
            </Link>
            <div className="category-lead__content">
              <span className="category-lead__label">Featured Desk Report</span>
              <h2><Link to={`/article/${lead.slug}`}>{lead.title}</Link></h2>
              <p>{lead.excerpt || lead.summary}</p>
              <div className="story-meta">
                <span>Business Leaders</span>
                <time>{formatDate(lead.publishedAt)}</time>
              </div>
              <div className="category-lead__actions">
                <Link className="btn-primary" to={`/article/${lead.slug}`}>
                  Read full story <Arrow small />
                </Link>
                <button className="btn-secondary" onClick={() => setQuickArticle(lead)}>
                  ⚡ Quick Read
                </button>
              </div>
            </div>
          </section>
          <section className="archive shell">
            <div className="section-heading">
              <div className="section-heading__title">
                <span className="section-badge">Archive</span>
                <h2>Recent Stories in {category.short}</h2>
              </div>
            </div>
            <div className="archive-grid">
              {rest.map((article) => (
                <article className="archive-card" key={article.id}>
                  <Link to={`/article/${article.slug}`} className="archive-card__thumb">
                    <Image article={article} />
                  </Link>
                  <div className="archive-card__content">
                    <div className="story-meta">
                      <span>Business Leaders</span>
                      <time>{formatDate(article.publishedAt)}</time>
                    </div>
                    <h3><Link to={`/article/${article.slug}`}>{article.title}</Link></h3>
                    <p>{article.excerpt || article.summary}</p>
                    <div className="archive-card__footer">
                      <Link className="text-link" to={`/article/${article.slug}`}>
                        Read full report <Arrow small />
                      </Link>
                      <button className="card-quick-read" onClick={() => setQuickArticle(article)}>
                        ⚡ Quick Read
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
      <Newsletter compact />
      {quickArticle && (
        <QuickReadModal article={quickArticle} onClose={() => setQuickArticle(null)} />
      )}
    </main>
  );
}

function ArticlePage({ preview = false }) {
  const { slug, token } = useParams();
  const [state, setState] = useState({ loading: true, article: null, demo: false, error: '', notFound: false });
  const [related, setRelated] = useState([]);
  const [copied, setCopied] = useState(false);

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

  const copyUrl = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (state.loading) return <LoadingPage />;
  if (state.error) return <FeedState error={state.error} title={preview ? 'Preview unavailable' : 'Story unavailable'} />;
  if (!state.article) return <NotFound />;
  const article = state.article;
  const minutes = getReadMinutes(article);

  return (
    <main id="main-content" className="article-page">
      {preview && (
        <div className="preview-banner" role="status">
          <div className="shell"><strong>Editorial preview</strong><span>Not published · This private link may expire</span></div>
        </div>
      )}
      <article>
        <header className="article-header shell">
          <div className="breadcrumbs">
            <Link to="/">Home</Link>
            <span>/</span>
            <Link to={`/${article.categorySlug}`}>{article.category}</Link>
          </div>
          <CategoryTag article={article} />
          <h1>{article.title}</h1>
          <p className="article-deck">{article.summary || article.excerpt}</p>
          <div className="article-byline">
            <div><span>Reported by</span><strong>Business Leaders Editorial Desk</strong></div>
            <div><span>Published</span><time>{formatDate(article.publishedAt, true)}</time></div>
            <div><span>Reading time</span><strong>{minutes} min read</strong></div>
          </div>
        </header>

        <div className="article-hero shell">
          <Image article={article} eager />
        </div>

        <div className="article-layout shell">
          <aside className="share-rail">
            <span>Share</span>
            <button aria-label="Copy article link" onClick={copyUrl} title="Copy link">
              {copied ? '✓' : '↗'}
            </button>
          </aside>
          <div className="article-copy">
            {(article.body || []).map((paragraph, index) => (
              <p className={index === 0 ? 'article-copy__opening' : ''} key={`${article.id}-${index}`}>{paragraph}</p>
            ))}
            <div className="article-signature-card">
              <img src={logoImage} alt="Business Leaders Sri Lanka" className="article-signature-logo" />
              <div>
                <span>Official Publication</span>
                <strong>Business Leaders Sri Lanka</strong>
                <p>Curated executive insights, capital market developments, and business intelligence for corporate Sri Lanka.</p>
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
          <div className="section-heading">
            <div className="section-heading__title">
              <span className="section-badge">Next</span>
              <h2>Continue reading</h2>
            </div>
          </div>
          <div className="related-grid">
            {related.map((item) => (
              <SideCard article={item} key={item.id} onQuickRead={() => {}} />
            ))}
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
        <span className="newsletter__stamp">Weekly<br />Executive<br />Brief</span>
        <div>
          <span className="eyebrow">Executive Intelligence</span>
          <h2>Know what matters<br />in Sri Lankan business.</h2>
        </div>
        {submitted ? (
          <p className="newsletter__thanks">You’re on the VIP executive list.<br /><small>Watch your inbox for the weekly briefing.</small></p>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }}>
            <label htmlFor={`email-${compact}`}>Corporate email address</label>
            <div>
              <input id={`email-${compact}`} type="email" required placeholder="executive@company.lk" />
              <button>Subscribe <Arrow small /></button>
            </div>
            <small>Weekly business updates only. Unsubscribe anytime.</small>
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
        <p><strong>Business Leaders Sri Lanka</strong> is a premier business publication and digital intelligence platform focused on corporate leadership, appointments, capital markets, enterprise technology, and luxury living.</p>
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
  return (
    <main id="main-content" className="not-found shell">
      <span>404</span>
      <h1>This report is off the record.</h1>
      <p>The story may have moved or is no longer available.</p>
      <Link to="/">Back to latest edition <Arrow small /></Link>
    </main>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer__top">
        <Link to="/" className="footer-logo-link" aria-label="Business Leaders Sri Lanka home">
          <img src={logoImage} alt="Business Leaders Sri Lanka" className="footer-logo-img" />
          <div className="footer-logo-text">
            <strong>BUSINESS LEADERS SRI LANKA</strong>
            <small>Executive Business Intelligence</small>
          </div>
        </Link>
        <p>Weekly Business Newsletter · Essential intelligence on Sri Lankan enterprise, markets and leadership.</p>
      </div>
      <div className="shell footer__grid">
        <div>
          <span>Sections</span>
          {categories.slice(0, 3).map((category) => (
            <Link key={category.slug} to={`/${category.slug}`}>{category.label}</Link>
          ))}
        </div>
        <div>
          <span>Explore</span>
          {categories.slice(3).map((category) => (
            <Link key={category.slug} to={`/${category.slug}`}>{category.label}</Link>
          ))}
        </div>
        <div>
          <span>Editorial</span>
          <Link to="/about">About us</Link>
          <a href="mailto:editor@businessleaders.lk">Contact desk</a>
        </div>
        <div className="footer__source" id="sources">
          <span>Our Promise</span>
          <p>Insightful, verified business intelligence delivered weekly for corporate decision makers across Sri Lanka.</p>
        </div>
      </div>
      <div className="shell footer__bottom">
        <span>© 2026 Business Leaders Sri Lanka. All Rights Reserved.</span>
        <span>ESTD. 2026 · Colombo, Sri Lanka</span>
      </div>
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
