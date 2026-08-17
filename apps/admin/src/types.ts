export type ArticleStatus =
  | 'scraped'
  | 'ai_processing'
  | 'pending_review'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected'
  | 'failed';

export type ValidationSeverity = 'warning' | 'error' | 'info';

export type ArticleCopy = {
  headline: string;
  summary: string;
  body: string;
};

export type ValidationIssue = {
  id: string;
  severity: ValidationSeverity;
  label: string;
  message: string;
};

export type Article = {
  id: string;
  slug: string;
  status: ArticleStatus;
  category: CategorySlug;
  sourceId: string;
  sourceName: string;
  sourceDomain: string;
  sourceUrl: string;
  author: string;
  sourcePublishedAt: string;
  scrapedAt: string;
  updatedAt: string;
  publishedAt?: string;
  imageUrl: string;
  imageCredit: string;
  original: ArticleCopy;
  draft: ArticleCopy;
  tags: string[];
  validation: ValidationIssue[];
  topRank: number | null;
  aiModel: string;
  promptVersion: string;
  editorNote?: string;
};

export type CategorySlug =
  | 'business-news'
  | 'interviews-appointments'
  | 'money'
  | 'technology'
  | 'travel-tourism'
  | 'luxury-living';

export type SourceHealth = 'healthy' | 'attention' | 'paused';

export type NewsSource = {
  id: string;
  name: string;
  domain: string;
  group: 'General News' | 'Business / Finance' | 'Official / Government';
  status: SourceHealth;
  enabled: boolean;
  lastRunAt: string;
  nextRunAt: string;
  articlesToday: number;
  successRate: number;
  error?: string;
};

export type CollectionState = {
  mode: 'remote' | 'demo';
  enabled: boolean;
  running: boolean;
  lastTrigger: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSucceededAt: string | null;
  lastExitCode: number | null;
  lastError: string;
  consecutiveFailures: number;
  nextRunAt: string | null;
  recentOutput: string[];
  config: {
    intervalMinutes: number;
    retryMinutes: number;
    maxRuntimeMinutes: number;
    freshnessHours: number;
    runOnStart: boolean;
  };
  feed: {
    exists: boolean;
    articleCount: number;
    generatedAt: string | null;
    latestArticleAt: string | null;
    stale: boolean;
    error?: string;
  };
  serverTime: string;
};

export type CollectionRunResult = {
  started: boolean;
  simulated: boolean;
  reason?: 'already_running' | 'disabled' | 'simulated';
  state: CollectionState;
};

export type EditorialEvent = {
  id: string;
  articleId: string;
  action: 'scraped' | 'rewritten' | 'edited' | 'approved' | 'published' | 'rejected';
  label: string;
  actor: string;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: 'Administrator' | 'Editor' | 'Publisher';
  avatar: string;
};

export type AdminSession = {
  token: string;
  user: AdminUser;
  demo: boolean;
  expiresAt: string;
};

export type ArticlePatch = Partial<
  Pick<Article, 'category' | 'tags' | 'topRank' | 'editorNote' | 'imageUrl' | 'imageCredit'>
> & {
  draft?: Partial<ArticleCopy>;
};

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  'business-news': 'Business News',
  'interviews-appointments': 'Interviews & Appointments',
  money: 'Money',
  technology: 'Technology',
  'travel-tourism': 'Travel & Tourism',
  'luxury-living': 'Luxury Living',
};

export const STATUS_LABELS: Record<ArticleStatus, string> = {
  scraped: 'Scraped',
  ai_processing: 'AI processing',
  pending_review: 'Pending review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  rejected: 'Rejected',
  failed: 'Failed',
};
