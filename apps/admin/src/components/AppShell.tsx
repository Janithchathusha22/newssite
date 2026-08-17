import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useNewsroom } from '../state/NewsroomContext';
import { CATEGORY_LABELS } from '../types';
import { Icon, type IconName } from './Icon';

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  end?: boolean;
};

const PAGE_COPY: Record<string, { eyebrow: string; title: string; subtitle: string }> = {
  '/dashboard': { eyebrow: 'Editorial command centre', title: 'Welcome', subtitle: 'Here’s what needs your attention across the newsroom today.' },
  '/articles': { eyebrow: 'Content library', title: 'All articles', subtitle: 'Search, filter and manage every story in the editorial pipeline.' },
  '/articles/pending': { eyebrow: 'Review queue', title: 'Pending review', subtitle: 'Compare source copy with AI drafts before anything goes live.' },
  '/articles/published': { eyebrow: 'Live newsroom', title: 'Published articles', subtitle: 'Review stories currently visible on the public website.' },
  '/articles/rejected': { eyebrow: 'Editorial archive', title: 'Rejected articles', subtitle: 'Track rejected drafts and their editorial reasons.' },
  '/top-news': { eyebrow: 'Homepage curation', title: 'Top News', subtitle: 'Choose and order the ten stories featured on the homepage.' },
  '/sources': { eyebrow: 'Ingestion health', title: 'News sources', subtitle: 'Monitor publisher feeds and control automated collection.' },
};

function pageCopy(pathname: string) {
  if (/^\/articles\/[^/]+\/(edit|preview)$/.test(pathname)) {
    return { eyebrow: 'Editorial workspace', title: 'Article review', subtitle: 'Verify every fact, refine the copy and control publication.' };
  }
  return PAGE_COPY[pathname] ?? PAGE_COPY['/dashboard'];
}

export function AppShell() {
  const { session, articles, logout, refresh, loading } = useNewsroom();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  useEffect(() => {
    setSidebarOpen(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [location.pathname]);

  const pending = articles.filter((article) => article.status === 'pending_review').length;
  const rejected = articles.filter((article) => article.status === 'rejected').length;
  const baseCopy = pageCopy(location.pathname);
  const firstName = session?.user.name.trim().split(/\s+/)[0] || 'Editor';
  const copy = location.pathname === '/dashboard'
    ? { ...baseCopy, title: `Welcome, ${firstName}` }
    : baseCopy;
  const nav: NavItem[] = useMemo(() => [
    { to: '/dashboard', label: 'Overview', icon: 'dashboard' },
    { to: '/articles/pending', label: 'Pending review', icon: 'clock', badge: pending },
    { to: '/articles', label: 'All articles', icon: 'articles', end: true },
    { to: '/articles/published', label: 'Published', icon: 'published' },
    { to: '/articles/rejected', label: 'Rejected', icon: 'archive', badge: rejected },
  ], [pending, rejected]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    if (globalSearch.trim()) navigate(`/articles?search=${encodeURIComponent(globalSearch.trim())}`);
    setSearchOpen(false);
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-mark">BL</div>
          <div className="brand-copy"><strong>Business Leaders</strong><span>Editorial Console</span></div>
          <button className="sidebar-close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close menu"><Icon name="x" /></button>
        </div>
        <div className="sidebar-scroll">
          <p className="nav-label">Newsroom</p>
          <nav className="side-nav">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Icon name={item.icon} size={19} /><span>{item.label}</span>{Boolean(item.badge) && <em>{item.badge}</em>}
              </NavLink>
            ))}
          </nav>
          <p className="nav-label nav-label-space">Publish</p>
          <nav className="side-nav">
            <NavLink to="/top-news" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="top-news" size={19} /><span>Top News</span></NavLink>
            <NavLink to="/sources" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon name="sources" size={19} /><span>Sources</span></NavLink>
          </nav>
          <div className="sidebar-workflow">
            <span className="workflow-kicker"><i /> Workflow active</span>
            <strong>Approval required</strong>
            <p>Only editor-approved stories can reach the public website.</p>
          </div>
        </div>
        <div className="account-block">
          <div className="avatar">{session?.user.avatar ?? 'BL'}</div>
          <div className="account-copy"><strong>{session?.user.name}</strong><span>{session?.user.role}</span></div>
          <button type="button" className="icon-button dark" onClick={logout} aria-label="Sign out"><Icon name="logout" size={18} /></button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <div className="app-content">
        <header className="topbar">
          <button type="button" className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="topbar-location"><span>Business Leaders</span><Icon name="chevron-right" size={14} /><strong>Admin</strong></div>
          <div className="topbar-actions">
            {searchOpen ? (
              <form className="global-search" onSubmit={submitSearch}>
                <Icon name="search" size={17} />
                <input autoFocus value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Search articles…" />
                <button type="button" onClick={() => setSearchOpen(false)}><Icon name="x" size={15} /></button>
              </form>
            ) : <button type="button" className="icon-button" onClick={() => setSearchOpen(true)} aria-label="Search"><Icon name="search" /></button>}
            <button type="button" className="icon-button notification-button" aria-label="Notifications"><Icon name="bell" /><i /></button>
            <button type="button" className="button button-secondary refresh-button" disabled={loading} onClick={() => void refresh()}><Icon name="refresh" size={17} className={loading ? 'spin' : ''} /><span>Sync</span></button>
          </div>
        </header>

        <main className="page-wrap">
          <header className="page-heading">
            <div>
              <span className="eyebrow">{copy.eyebrow}</span>
              <h1>{copy.title}</h1>
              <p>{copy.subtitle}</p>
            </div>
            <div className="date-chip"><Icon name="calendar" size={17} /><span>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</span></div>
          </header>
          {session?.demo && (
            <div className="demo-banner"><Icon name="sparkles" size={17} /><span><strong>Demo workspace</strong> — actions persist in this browser. Connect the API to use live newsroom data.</span></div>
          )}
          <Outlet />
        </main>
        <footer className="app-footer"><span>Business Leaders Editorial Console</span><span>{Object.values(CATEGORY_LABELS).length} desks · Approval workflow enabled</span></footer>
      </div>
    </div>
  );
}
