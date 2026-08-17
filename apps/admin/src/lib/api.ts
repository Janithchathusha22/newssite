import { demoArticles, demoEvents, demoSources } from '../data/demoData';
import type {
  AdminSession,
  AdminUser,
  Article,
  ArticlePatch,
  ArticleStatus,
  CollectionRunResult,
  CollectionState,
  EditorialEvent,
  NewsSource,
} from '../types';

// Same-origin /api is proxied by Vite in development and can be routed to the
// Express service by the production reverse proxy. An explicit URL remains
// available for split-domain deployments.
const API_URL = (import.meta.env.VITE_ADMIN_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const DEMO_SETTING = import.meta.env.VITE_DEMO_MODE;
const DEMO_ENABLED = DEMO_SETTING === 'true' || (DEMO_SETTING === undefined && import.meta.env.DEV);
const PUBLIC_SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:5173').replace(/\/$/, '');

const ARTICLES_KEY = 'newsroom-demo-articles-v2';
const SOURCES_KEY = 'newsroom-demo-sources-v2';
const EVENTS_KEY = 'newsroom-demo-events-v2';
const SESSION_KEY = 'newsroom-admin-session-v2';
const LEGACY_SESSION_KEY = 'newsroom-admin-session-v1';
const DEMO_SESSION_TOKEN = 'demo-session-token';
const DEMO_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type Envelope<T, K extends string> = T | Record<K, T>;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

class DemoSessionRequestError extends ApiError {
  constructor() {
    super('Demo sessions use local newsroom data.', 503);
  }
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const wait = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

function readLocal<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) return JSON.parse(stored) as T;
  } catch {
    // Private browsing and strict storage policies can disable localStorage.
  }
  return clone(fallback);
}

function writeLocal<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory UI state still updates if storage is unavailable.
  }
}

function unwrap<T, K extends string>(payload: Envelope<T, K>, key: K): T {
  return typeof payload === 'object' && payload !== null && key in payload
    ? (payload as Record<K, T>)[key]
    : (payload as T);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  if (token === DEMO_SESSION_TOKEN) throw new DemoSessionRequestError();

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload.message === 'string'
      ? payload.message
      : payload && typeof payload.error === 'string'
        ? payload.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

function demoSession(): AdminSession {
  return {
    token: DEMO_SESSION_TOKEN,
    demo: true,
    expiresAt: new Date(Date.now() + DEMO_SESSION_TTL_MS).toISOString(),
    user: {
      id: 'demo-editor-01',
      name: 'Nadeesha Perera',
      email: 'editor@newsroom.lk',
      role: 'Administrator',
      avatar: 'NP',
    },
  };
}

function ensureArticle(id: string): Article {
  const article = readLocal(ARTICLES_KEY, demoArticles).find((item) => item.id === id);
  if (!article) throw new ApiError('Article not found.', 404);
  return article;
}

function normalizeArticle(article: Article): Article {
  // Keep the canonical source/local value in editor state. ArticleImage turns
  // it into a display URL without accidentally saving a proxy URL to storage.
  return article;
}

function saveArticle(id: string, updater: (article: Article) => Article): Article {
  const articles = readLocal(ARTICLES_KEY, demoArticles);
  const index = articles.findIndex((item) => item.id === id);
  if (index < 0) throw new ApiError('Article not found.', 404);
  const next = updater(clone(articles[index]));
  articles[index] = next;
  writeLocal(ARTICLES_KEY, articles);
  return clone(next);
}

function recordDemoEvent(articleId: string, action: EditorialEvent['action'], label: string) {
  const events = readLocal(EVENTS_KEY, demoEvents);
  events.unshift({
    id: `evt-${Date.now()}`,
    articleId,
    action,
    label,
    actor: 'Nadeesha Perera',
    createdAt: new Date().toISOString(),
  });
  writeLocal(EVENTS_KEY, events.slice(0, 30));
}

async function withDemoFallback<T>(remote: () => Promise<T>, demo: () => Promise<T>): Promise<T> {
  try {
    return await remote();
  } catch (error) {
    // A live API session must never appear to succeed by mutating browser demo
    // data after a server, validation or authorization failure. Only the
    // explicit demo token is allowed to select the local implementation.
    if (!DEMO_ENABLED || !(error instanceof DemoSessionRequestError)) throw error;
    return demo();
  }
}

function normalizeRole(value: unknown): AdminUser['role'] {
  const role = String(value ?? '').trim().toLowerCase();
  if (role === 'admin' || role === 'administrator') return 'Administrator';
  if (role === 'editor') return 'Editor';
  if (role === 'publisher') return 'Publisher';
  throw new ApiError('The admin API returned an unsupported user role.', 502);
}

function validSession(value: unknown): value is AdminSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AdminSession>;
  const user = session.user as Partial<AdminUser> | undefined;
  return typeof session.token === 'string'
    && session.token.length > 0
    && typeof session.demo === 'boolean'
    && typeof session.expiresAt === 'string'
    && Number.isFinite(Date.parse(session.expiresAt))
    && Date.parse(session.expiresAt) > Date.now()
    && Boolean(user)
    && typeof user?.id === 'string'
    && typeof user?.name === 'string'
    && typeof user?.email === 'string'
    && ['Administrator', 'Editor', 'Publisher'].includes(String(user?.role))
    && typeof user?.avatar === 'string'
    && (!session.demo || (DEMO_ENABLED && session.token === DEMO_SESSION_TOKEN));
}

function readSession(storage: Storage): AdminSession | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (validSession(value)) return value;
    storage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable or contain stale data from an interrupted write.
  }
  return null;
}

export const sessionStore = {
  get(): AdminSession | null {
    try {
      // Remove the old unvalidated session format so a previous demo visit
      // cannot keep redirecting a user away from the real login screen.
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
      window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
      return readSession(window.sessionStorage) ?? readSession(window.localStorage);
    } catch {
      return null;
    }
  },
  set(session: AdminSession, persistent = true) {
    if (!validSession(session)) throw new ApiError('The server returned an invalid admin session.', 502);
    this.clear();
    const storage = persistent ? window.localStorage : window.sessionStorage;
    try {
      storage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Strict browser privacy policies may disable persistence. The provider's
      // in-memory session still works for the current page.
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // Clearing in-memory React state still signs out for this page.
    }
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // See localStorage note above.
    }
  },
};

type RemoteSource = Partial<NewsSource> & {
  articleCount?: number;
  lastError?: string;
};

function normalizeSource(source: RemoteSource): NewsSource {
  const lastRunAt = source.lastRunAt ?? '';
  const domain = source.domain ?? '';
  const business = /ft\.lk|economynext|srilankabiz/i.test(domain);
  const official = /news\.lk|army\.lk|caa\.lk/i.test(domain);
  const status = source.status ?? (source.enabled === false ? 'paused' : source.lastError ? 'attention' : 'healthy');
  return {
    id: source.id ?? domain,
    name: source.name ?? domain,
    domain,
    group: source.group ?? (business ? 'Business / Finance' : official ? 'Official / Government' : 'General News'),
    status,
    enabled: source.enabled ?? true,
    lastRunAt,
    nextRunAt: source.nextRunAt ?? (lastRunAt
      ? new Date(new Date(lastRunAt).getTime() + 30 * 60 * 1000).toISOString()
      : ''),
    articlesToday: source.articlesToday ?? source.articleCount ?? 0,
    successRate: source.successRate ?? (status === 'healthy' ? 100 : status === 'attention' ? 85 : 0),
    error: source.error ?? source.lastError,
  };
}

type RemoteCollectionState = Omit<CollectionState, 'mode'>;

function normalizeCollectionState(state: Partial<RemoteCollectionState>, mode: CollectionState['mode']): CollectionState {
  return {
    mode,
    enabled: state.enabled ?? true,
    running: state.running ?? false,
    lastTrigger: state.lastTrigger ?? null,
    lastStartedAt: state.lastStartedAt ?? null,
    lastFinishedAt: state.lastFinishedAt ?? null,
    lastSucceededAt: state.lastSucceededAt ?? null,
    lastExitCode: state.lastExitCode ?? null,
    lastError: state.lastError ?? '',
    consecutiveFailures: state.consecutiveFailures ?? 0,
    nextRunAt: state.nextRunAt ?? null,
    recentOutput: Array.isArray(state.recentOutput) ? state.recentOutput : [],
    config: {
      intervalMinutes: state.config?.intervalMinutes ?? 60,
      retryMinutes: state.config?.retryMinutes ?? 15,
      maxRuntimeMinutes: state.config?.maxRuntimeMinutes ?? 120,
      freshnessHours: state.config?.freshnessHours ?? 26,
      runOnStart: state.config?.runOnStart ?? true,
    },
    feed: {
      exists: state.feed?.exists ?? false,
      articleCount: state.feed?.articleCount ?? 0,
      generatedAt: state.feed?.generatedAt ?? null,
      latestArticleAt: state.feed?.latestArticleAt ?? null,
      stale: state.feed?.stale ?? true,
      error: state.feed?.error,
    },
    serverTime: state.serverTime ?? new Date().toISOString(),
  };
}

function demoCollectionState(): CollectionState {
  return normalizeCollectionState({
    enabled: true,
    running: false,
    lastTrigger: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
    lastExitCode: null,
    lastError: '',
    consecutiveFailures: 0,
    nextRunAt: null,
    recentOutput: [],
    feed: {
      exists: true,
      articleCount: demoArticles.length,
      generatedAt: null,
      latestArticleAt: null,
      stale: false,
    },
  }, 'demo');
}

export const adminApi = {
  publicSiteUrl: PUBLIC_SITE_URL,
  hasRemoteApi: true,
  demoEnabled: DEMO_ENABLED,

  async login(email: string, password: string): Promise<AdminSession> {
    if (!email.trim() || !password.trim()) throw new ApiError('Enter your email and password.', 400);
    const payload = await request<AdminSession>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const name = typeof payload.user?.name === 'string' && payload.user.name.trim()
      ? payload.user.name.trim()
      : 'Newsroom Editor';
    const session: AdminSession = {
      token: String(payload.token ?? ''),
      // A successful HTTP login is an API session. Browser demo mode is entered
      // only through demoLogin(), never as an implicit network fallback.
      demo: false,
      expiresAt: String(payload.expiresAt ?? ''),
      user: {
        id: String(payload.user?.id ?? ''),
        name,
        email: String(payload.user?.email ?? email).trim().toLowerCase(),
        role: normalizeRole(payload.user?.role),
        avatar: typeof payload.user?.avatar === 'string' && payload.user.avatar.trim()
          ? payload.user.avatar.trim()
          : name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase(),
      },
    };
    if (!validSession(session)) throw new ApiError('The admin API returned an invalid session.', 502);
    return session;
  },

  async demoLogin(): Promise<AdminSession> {
    if (!DEMO_ENABLED) throw new ApiError('Demo mode is disabled for this build.', 403);
    await wait(320);
    return demoSession();
  },

  async getArticles(token: string): Promise<Article[]> {
    return withDemoFallback(
      async () => unwrap(await request<Envelope<Article[], 'articles'>>('/api/admin/articles', {}, token), 'articles').map(normalizeArticle),
      async () => {
        await wait();
        return readLocal(ARTICLES_KEY, demoArticles);
      },
    );
  },

  async getArticle(id: string, token: string): Promise<Article> {
    return withDemoFallback(
      async () => normalizeArticle(unwrap(await request<Envelope<Article, 'article'>>(`/api/admin/articles/${id}`, {}, token), 'article')),
      async () => {
        await wait(120);
        return ensureArticle(id);
      },
    );
  },

  async patchArticle(id: string, patch: ArticlePatch, token: string): Promise<Article> {
    return withDemoFallback(
      async () => normalizeArticle(unwrap(await request<Envelope<Article, 'article'>>(`/api/admin/articles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }, token), 'article')),
      async () => {
        await wait(260);
        const article = saveArticle(id, (current) => ({
          ...current,
          ...patch,
          draft: { ...current.draft, ...patch.draft },
          updatedAt: new Date().toISOString(),
        }));
        recordDemoEvent(id, 'edited', 'Editorial draft updated');
        return article;
      },
    );
  },

  async runAction(id: string, action: 'approve' | 'publish' | 'reject' | 'rewrite', token: string, reason?: string): Promise<Article> {
    const body = action === 'reject' ? JSON.stringify({ reason: reason ?? '' }) : undefined;
    return withDemoFallback(
      async () => normalizeArticle(unwrap(await request<Envelope<Article, 'article'>>(`/api/admin/articles/${id}/${action}`, {
        method: 'POST',
        body,
      }, token), 'article')),
      async () => {
        await wait(420);
        if (action === 'approve' && ensureArticle(id).validation.some((issue) => issue.severity === 'error')) {
          throw new ApiError('Resolve factual/source validation errors before approval.', 422);
        }
        const statusMap: Partial<Record<typeof action, ArticleStatus>> = {
          approve: 'published',
          publish: 'published',
          reject: 'rejected',
        };
        const article = saveArticle(id, (current) => {
          if (action === 'rewrite') {
            return {
              ...current,
              status: 'pending_review',
              updatedAt: new Date().toISOString(),
              validation: current.validation.filter((issue) => issue.severity !== 'error'),
            };
          }
          return {
            ...current,
            status: statusMap[action] ?? current.status,
            editorNote: action === 'reject' ? reason : current.editorNote,
            publishedAt: action === 'approve' || action === 'publish' ? new Date().toISOString() : current.publishedAt,
            updatedAt: new Date().toISOString(),
          };
        });
        const eventAction: EditorialEvent['action'] = action === 'rewrite'
          ? 'rewritten'
          : action === 'approve'
            ? 'published'
            : action === 'publish'
              ? 'published'
              : 'rejected';
        const actionLabel = action === 'rewrite'
          ? 'AI rewrite regenerated'
          : action === 'approve'
            ? 'Approved and published editorial article'
            : `${action[0].toUpperCase()}${action.slice(1)} editorial article`;
        recordDemoEvent(id, eventAction, actionLabel);
        return article;
      },
    );
  },

  async createPreviewToken(id: string, token: string): Promise<{ token: string; url: string; expiresAt: string }> {
    return withDemoFallback(
      async () => {
        const payload = await request<{ token: string; url?: string; expiresAt: string }>(`/api/admin/articles/${id}/preview-token`, { method: 'POST' }, token);
        return { ...payload, url: payload.url ?? `${PUBLIC_SITE_URL}/preview/${payload.token}` };
      },
      async () => {
        await wait(160);
        return {
          token: `demo-${id}-${Date.now()}`,
          url: `${window.location.origin}/articles/${id}/preview`,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        };
      },
    );
  },

  async getTopNews(token: string): Promise<Article[]> {
    return withDemoFallback(
      async () => unwrap(await request<Envelope<Article[], 'articles'>>('/api/admin/top-news', {}, token), 'articles').map(normalizeArticle),
      async () => {
        await wait();
        return readLocal(ARTICLES_KEY, demoArticles)
          .filter((article) => article.status === 'published' && article.topRank !== null)
          .sort((a, b) => (a.topRank ?? 99) - (b.topRank ?? 99));
      },
    );
  },

  async updateTopNews(articleIds: string[], token: string): Promise<Article[]> {
    return withDemoFallback(
      async () => unwrap(await request<Envelope<Article[], 'articles'>>('/api/admin/top-news', {
        method: 'PUT',
        body: JSON.stringify({ articleIds }),
      }, token), 'articles').map(normalizeArticle),
      async () => {
        await wait(320);
        const articles = readLocal(ARTICLES_KEY, demoArticles).map((article) => {
          const index = articleIds.indexOf(article.id);
          return { ...article, topRank: index >= 0 ? index + 1 : null };
        });
        writeLocal(ARTICLES_KEY, articles);
        return articles.filter((article) => article.topRank !== null).sort((a, b) => (a.topRank ?? 99) - (b.topRank ?? 99));
      },
    );
  },

  async getSources(token: string): Promise<NewsSource[]> {
    return withDemoFallback(
      async () => unwrap(await request<Envelope<RemoteSource[], 'sources'>>('/api/admin/sources', {}, token), 'sources').map(normalizeSource),
      async () => {
        await wait();
        return readLocal(SOURCES_KEY, demoSources);
      },
    );
  },

  async toggleSource(id: string, enabled: boolean, token: string): Promise<NewsSource> {
    return withDemoFallback(
      async () => normalizeSource(unwrap(await request<Envelope<RemoteSource, 'source'>>(`/api/admin/sources/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      }, token), 'source')),
      async () => {
        await wait(240);
        const sources = readLocal(SOURCES_KEY, demoSources);
        const index = sources.findIndex((source) => source.id === id);
        if (index < 0) throw new ApiError('Source not found.', 404);
        sources[index] = {
          ...sources[index],
          enabled,
          status: enabled ? (sources[index].error && sources[index].error !== 'Paused by administrator.' ? 'attention' : 'healthy') : 'paused',
          error: enabled && sources[index].error === 'Paused by administrator.' ? undefined : enabled ? sources[index].error : 'Paused by administrator.',
        };
        writeLocal(SOURCES_KEY, sources);
        return clone(sources[index]);
      },
    );
  },

  async getCollectionStatus(token: string): Promise<CollectionState> {
    return withDemoFallback(
      async () => normalizeCollectionState(
        await request<RemoteCollectionState>('/api/admin/scraper/status', {}, token),
        'remote',
      ),
      async () => {
        await wait(120);
        return demoCollectionState();
      },
    );
  },

  async runCollection(token: string): Promise<CollectionRunResult> {
    try {
      const payload = await request<{ started: boolean; state: RemoteCollectionState }>(
        '/api/admin/scraper/run',
        { method: 'POST' },
        token,
      );
      return {
        started: payload.started,
        simulated: false,
        state: normalizeCollectionState(payload.state, 'remote'),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const state = normalizeCollectionState(
          await request<RemoteCollectionState>('/api/admin/scraper/status', {}, token),
          'remote',
        );
        return {
          started: false,
          simulated: false,
          reason: state.running ? 'already_running' : 'disabled',
          state,
        };
      }
      if (!DEMO_ENABLED || !(error instanceof DemoSessionRequestError)) throw error;
      await wait(420);
      return {
        started: false,
        simulated: true,
        reason: 'simulated',
        state: demoCollectionState(),
      };
    }
  },

  async getEvents(token: string): Promise<EditorialEvent[]> {
    return withDemoFallback(
      async () => unwrap(await request<Envelope<EditorialEvent[], 'events'>>('/api/admin/events', {}, token), 'events'),
      async () => {
        await wait(110);
        return readLocal(EVENTS_KEY, demoEvents);
      },
    );
  },

  resetDemoData() {
    writeLocal(ARTICLES_KEY, demoArticles);
    writeLocal(SOURCES_KEY, demoSources);
    writeLocal(EVENTS_KEY, demoEvents);
  },
};
