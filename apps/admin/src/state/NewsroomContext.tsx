import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { adminApi, ApiError, sessionStore } from '../lib/api';
import type {
  AdminSession,
  Article,
  ArticlePatch,
  CollectionRunResult,
  CollectionState,
  EditorialEvent,
  NewsSource,
} from '../types';

type NewsroomContextValue = {
  session: AdminSession | null;
  articles: Article[];
  sources: NewsSource[];
  events: EditorialEvent[];
  collectionState: CollectionState | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string, persistent?: boolean) => Promise<void>;
  loginDemo: (persistent?: boolean) => Promise<void>;
  demoEnabled: boolean;
  logout: () => void;
  refresh: () => Promise<void>;
  saveArticle: (id: string, patch: ArticlePatch) => Promise<Article>;
  runArticleAction: (id: string, action: 'approve' | 'publish' | 'reject' | 'rewrite', reason?: string) => Promise<Article>;
  createPreview: (id: string) => Promise<{ token: string; url: string; expiresAt: string }>;
  saveTopNews: (articleIds: string[]) => Promise<void>;
  toggleSource: (id: string, enabled: boolean) => Promise<void>;
  refreshCollectionStatus: () => Promise<CollectionState>;
  runCollection: () => Promise<CollectionRunResult>;
  resetDemo: () => Promise<void>;
};

const NewsroomContext = createContext<NewsroomContextValue | null>(null);

export function NewsroomProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => sessionStore.get());
  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [events, setEvents] = useState<EditorialEvent[]>([]);
  const [collectionState, setCollectionState] = useState<CollectionState | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      adminApi.getArticles(session.token),
      adminApi.getSources(session.token),
      adminApi.getEvents(session.token),
      adminApi.getCollectionStatus(session.token),
    ]);
    if (results[0].status === 'fulfilled') setArticles(results[0].value);
    if (results[1].status === 'fulfilled') setSources(results[1].value);
    if (results[2].status === 'fulfilled') setEvents(results[2].value);
    if (results[3].status === 'fulfilled') setCollectionState(results[3].value);
    const authenticationFailure = results.find((result) => (
      result.status === 'rejected'
      && result.reason instanceof ApiError
      && result.reason.status === 401
    ));
    if (authenticationFailure) {
      sessionStore.clear();
      setSession(null);
      setArticles([]);
      setSources([]);
      setEvents([]);
      setCollectionState(null);
      setError('Your session expired. Sign in again.');
      setLoading(false);
      return;
    }
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      setError(failure.reason instanceof Error ? failure.reason.message : 'Some newsroom data could not be loaded.');
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, persistent = true) => {
    const nextSession = await adminApi.login(email, password);
    sessionStore.set(nextSession, persistent);
    setSession(nextSession);
  }, []);

  const loginDemo = useCallback(async (persistent = true) => {
    const nextSession = await adminApi.demoLogin();
    sessionStore.set(nextSession, persistent);
    setSession(nextSession);
  }, []);

  const logout = useCallback(() => {
    sessionStore.clear();
    setSession(null);
    setArticles([]);
    setSources([]);
    setEvents([]);
    setCollectionState(null);
  }, []);

  const saveArticle = useCallback(async (id: string, patch: ArticlePatch) => {
    if (!session) throw new Error('Your session has expired.');
    const article = await adminApi.patchArticle(id, patch, session.token);
    setArticles((current) => current.map((item) => (item.id === id ? article : item)));
    return article;
  }, [session]);

  const runArticleAction = useCallback(async (
    id: string,
    action: 'approve' | 'publish' | 'reject' | 'rewrite',
    reason?: string,
  ) => {
    if (!session) throw new Error('Your session has expired.');
    const article = await adminApi.runAction(id, action, session.token, reason);
    setArticles((current) => current.map((item) => (item.id === id ? article : item)));
    return article;
  }, [session]);

  const createPreview = useCallback(async (id: string) => {
    if (!session) throw new Error('Your session has expired.');
    return adminApi.createPreviewToken(id, session.token);
  }, [session]);

  const saveTopNews = useCallback(async (articleIds: string[]) => {
    if (!session) throw new Error('Your session has expired.');
    const topArticles = await adminApi.updateTopNews(articleIds, session.token);
    const rank = new Map(topArticles.map((article) => [article.id, article.topRank]));
    setArticles((current) => current.map((article) => ({
      ...article,
      topRank: rank.get(article.id) ?? null,
    })));
  }, [session]);

  const toggleSource = useCallback(async (id: string, enabled: boolean) => {
    if (!session) throw new Error('Your session has expired.');
    const source = await adminApi.toggleSource(id, enabled, session.token);
    setSources((current) => current.map((item) => (item.id === id ? source : item)));
  }, [session]);

  const refreshCollectionStatus = useCallback(async () => {
    if (!session) throw new Error('Your session has expired.');
    const state = await adminApi.getCollectionStatus(session.token);
    setCollectionState(state);
    return state;
  }, [session]);

  const runCollection = useCallback(async () => {
    if (!session) throw new Error('Your session has expired.');
    const result = await adminApi.runCollection(session.token);
    setCollectionState(result.state);
    return result;
  }, [session]);

  const resetDemo = useCallback(async () => {
    adminApi.resetDemoData();
    await refresh();
  }, [refresh]);

  const value = useMemo<NewsroomContextValue>(() => ({
    session,
    articles,
    sources,
    events,
    collectionState,
    loading,
    error,
    login,
    loginDemo,
    demoEnabled: adminApi.demoEnabled,
    logout,
    refresh,
    saveArticle,
    runArticleAction,
    createPreview,
    saveTopNews,
    toggleSource,
    refreshCollectionStatus,
    runCollection,
    resetDemo,
  }), [session, articles, sources, events, collectionState, loading, error, login, loginDemo, logout, refresh, saveArticle, runArticleAction, createPreview, saveTopNews, toggleSource, refreshCollectionStatus, runCollection, resetDemo]);

  return <NewsroomContext.Provider value={value}>{children}</NewsroomContext.Provider>;
}

export function useNewsroom() {
  const value = useContext(NewsroomContext);
  if (!value) throw new Error('useNewsroom must be used within NewsroomProvider.');
  return value;
}
