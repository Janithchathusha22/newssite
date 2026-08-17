'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  REWRITABLE_STATUSES,
  VALID_STATUSES,
  canTransition,
  rewriteErrorMessage,
  statusAfterEditorialEdit,
  transitionErrorMessage
} = require('./workflow');
const {
  normalizeArticleImageUrl,
  normalizeLocalImageUrl,
  normalizePublisherImageUrl
} = require('./images');

const PROJECT_DIR = path.resolve(__dirname, '..');
const STATE_PATH = path.join(__dirname, 'editorial_state.json');
const FEED_PATH = path.join(PROJECT_DIR, 'news_feed.json');
const CURATED_PATH = path.join(__dirname, 'curated_articles.json');

const CATEGORIES = [
  { slug: 'business-news', name: 'Business News', order: 1 },
  { slug: 'interviews-appointments', name: 'Interviews & Appointments', order: 2 },
  { slug: 'money', name: 'Money', order: 3 },
  { slug: 'technology', name: 'Technology', order: 4 },
  { slug: 'travel-tourism', name: 'Travel & Tourism', order: 5 },
  { slug: 'luxury-living', name: 'Luxury Living', order: 6 }
];

const REQUIRED_SOURCE_CATALOG = [
  { name: 'Daily Mirror', domain: 'dailymirror.lk', group: 'General News', adapter: 'daily-mirror-html', enabled: true },
  { name: 'Ada Derana', domain: 'adaderana.lk', group: 'General News', adapter: 'ada-derana-rss', enabled: true },
  { name: 'News First', domain: 'newsfirst.lk', group: 'General News', adapter: 'newsfirst-html', enabled: true },
  { name: 'Hiru News', domain: 'hirunews.lk', group: 'General News', adapter: 'hiru-html', enabled: true },
  { name: 'Daily FT', domain: 'ft.lk', group: 'Business / Finance', adapter: 'daily-ft-rss', enabled: true },
  { name: 'EconomyNext', domain: 'economynext.com', group: 'Business / Finance', adapter: 'economynext-wp', enabled: true },
  { name: 'SriLankaBiz', domain: 'srilankabiz.lk', group: 'Business / Finance', adapter: 'srilankabiz-wp', enabled: true },
  { name: 'Lanka Business Online', domain: 'lankabusinessonline.com', group: 'Business / Finance', adapter: 'lbo-wp', enabled: true },
  { name: 'Business Today', domain: 'businesstoday.lk', group: 'Business / Finance', adapter: 'business-today-wp', enabled: true },
  { name: 'news.lk', domain: 'news.lk', group: 'Official / Government', adapter: 'manual-review', enabled: false },
  { name: 'Civil Aviation Authority', domain: 'caa.lk', group: 'Official / Government', adapter: 'manual-review', enabled: false },
  { name: 'Sri Lanka Army', domain: 'army.lk', group: 'Official / Government', adapter: 'manual-review', enabled: false },
  { name: 'The Morning', domain: 'themorning.lk', group: 'General News', adapter: 'manual-review', enabled: false },
  { name: 'The Island', domain: 'island.lk', group: 'General News', adapter: 'island-wp', enabled: true },
  { name: 'Daily News', domain: 'dailynews.lk', group: 'General News', adapter: 'daily-news-wp', enabled: true },
  { name: 'Sri Lanka Mirror', domain: 'srilankamirror.com', group: 'General News', adapter: 'sri-lanka-mirror-wp', enabled: true },
  { name: 'Sunday Observer', domain: 'sundayobserver.lk', group: 'General News', adapter: 'sunday-observer-wp', enabled: true },
  { name: 'Xinhua', domain: 'news.cn', group: 'General News', adapter: 'manual-review', enabled: false }
];

const CATEGORY_SET = new Set(CATEGORIES.map(category => category.slug));
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (_) {
    return fallback;
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanBody(value) {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
}

function actorLabel(actor) {
  if (actor && typeof actor === 'object') {
    return cleanText(actor.name || actor.email || actor.label || actor.id) || 'Newsroom';
  }
  return cleanText(String(actor || '')) || 'Newsroom';
}

function stableId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
}

function slugify(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'news-update';
}

function validDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function sourceDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function categoryFor(article) {
  const supplied = cleanText(article.category).toLowerCase().replace(/&/g, 'and');
  const direct = {
    'business-news': 'business-news',
    'business news': 'business-news',
    'business and corporate': 'business-news',
    'corporate': 'business-news',
    'front page': 'business-news',
    'top story': 'business-news',
    'interviews-appointments': 'interviews-appointments',
    'interviews and appointments': 'interviews-appointments',
    'appointments': 'interviews-appointments',
    'money': 'money',
    'economy and finance': 'money',
    'economy': 'money',
    'financial services': 'money',
    'finance': 'money',
    'markets': 'money',
    'technology': 'technology',
    'travel-tourism': 'travel-tourism',
    'travel and tourism': 'travel-tourism',
    'tourism': 'travel-tourism',
    'luxury-living': 'luxury-living',
    'luxury living': 'luxury-living'
  };
  if (direct[supplied]) return direct[supplied];

  // Classify from the headline/deck, not incidental names deep in the body.
  // An earnings report that quotes a chairman must remain Money, while a
  // headline announcing that chairman is correctly an Appointment.
  const lead = `${article.title || ''} ${article.headline_en || ''} ${article.summary || ''}`.toLowerCase();
  if (/\b(appoint(?:ed|ment)?|assumes duties|new chairman|new commander|director general|chief executive named|secretary to)\b/.test(lead)) return 'interviews-appointments';
  if (/\b(touris\w*|travel|hotel|hospitality|airline|destination|visitor arrivals?)\b/.test(lead)) return 'travel-tourism';
  if (/\b(artificial intelligence|ai|technology|digital transformation|cyber|software|telecom|robot\w*|iot)\b/.test(lead)) return 'technology';
  if (/\b(luxury|premium vehicle|residences?|waterfront|range rover|fashion|lifestyle)\b/.test(lead)) return 'luxury-living';
  if (/\b(bank|finance|financial|profit|pbt|loan|interest rate|monetary|insurance|assets?|inflation|revenue|earnings|quarter|treasury|bonds?|stocks?|markets?)\b|\brs\.|\blkr\b|\busd\b/.test(lead)) return 'money';
  return 'business-news';
}

function imageFor(article) {
  const sourceUrl = article.url || article.link || article.source_url;
  const declaredRemoteImage = [
    article.source_image,
    article.image_url,
    article.main_image_url,
    article.og_image
  ].find(candidate => /^https?:\/\//i.test(String(candidate || '').trim()));
  if (declaredRemoteImage
    && !normalizePublisherImageUrl(declaredRemoteImage, sourceUrl)) {
    // The local file was derived from a rejected source candidate and cannot
    // establish provenance by itself.
    return '';
  }
  const localCandidates = [
    article.local_image_path,
    article.image_local,
    article.image
  ];
  for (const candidate of localCandidates) {
    const normalized = normalizeLocalImageUrl(candidate);
    if (normalized) {
      try {
        if (fs.statSync(path.join(PROJECT_DIR, normalized.slice(1))).isFile()) return normalized;
      } catch (_) {
        // A stale cache path falls through to the verified publisher URL.
      }
    }
  }

  const remoteCandidates = [
    article.source_image,
    article.image_url,
    article.main_image_url,
    article.og_image,
    article.image
  ];
  for (const candidate of remoteCandidates) {
    const normalized = normalizePublisherImageUrl(candidate, sourceUrl);
    if (normalized) return normalized;
  }
  return '';
}

function normalizedTags(value, category) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,|]/)
      : [];
  const tags = [...new Set(values.map(cleanText).filter(Boolean))].slice(0, 8);
  if (tags.length < 3) {
    const defaults = {
      'business-news': ['Sri Lanka', 'Business', 'Corporate'],
      'interviews-appointments': ['Sri Lanka', 'Appointments', 'Leadership'],
      money: ['Sri Lanka', 'Finance', 'Economy'],
      technology: ['Sri Lanka', 'Technology', 'Innovation'],
      'travel-tourism': ['Sri Lanka', 'Travel', 'Tourism'],
      'luxury-living': ['Sri Lanka', 'Luxury', 'Lifestyle']
    };
    for (const tag of defaults[category]) if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 8);
}

function isDeskRelevant(article) {
  const text = `${article.original?.headline || ''} ${article.original?.summary || ''}`.toLowerCase();
  return /\b(business|corporate|company|enterprise|industry|exports?|trade|investment|investors?|economy|economic|finance|financial|bank|profit|loans?|markets?|stocks?|revenue|treasury|bonds?|tax|customs|retail|manufacturing|earnings|quarter|pbt)\b/.test(text)
    || /\b(tourism|tourist|travel|hotel|hospitality|airline|destination|visitors?)\b/.test(text)
    || /\b(technology|digital|cyber|software|telecom|robot|iot|artificial intelligence|ai)\b/.test(text)
    || /\b(appointed|appointment|chairman|commander|director general|chief executive|assumes duties)\b/.test(text)
    || /\b(luxury|premium|residences?|waterfront|range rover|fashion|lifestyle)\b/.test(text);
}

function normalizeFeedArticle(article, index) {
  const sourceUrl = cleanText(article.url || article.link || article.source_url);
  const headline = cleanText(article.raw_title || article.title || article.headline_en) || 'Untitled news report';
  const summary = cleanText(article.raw_summary || article.summary || article.summary_en);
  const body = cleanBody(article.full_text || article.content || summary);
  const category = categoryFor({ ...article, title: headline });
  const id = stableId(sourceUrl || `${article.source || 'source'}:${headline}`);
  const now = new Date().toISOString();
  const sourcePublishedAt = validDate(article.published_at || article.date) || validDate(article.scraped_at) || now;
  const warnings = [];
  if (!sourceUrl) warnings.push({
    id: `${id}-source`, severity: 'error', label: 'Missing source URL',
    message: 'A verified article URL is required before publication.'
  });
  if (!body || body === headline) warnings.push({
    id: `${id}-body`, severity: 'warning', label: 'Short source',
    message: 'The publisher feed did not provide a complete body. Review the source before publishing.'
  });
  if (Array.isArray(article.validation_errors)) {
    article.validation_errors.forEach((message, warningIndex) => warnings.push({
      id: `${id}-validation-${warningIndex}`, severity: 'error', label: 'Fact check', message: cleanText(message)
    }));
  }
  if (Array.isArray(article.ai_warnings)) {
    article.ai_warnings.forEach((message, warningIndex) => warnings.push({
      id: `${id}-ai-${warningIndex}`, severity: 'warning', label: 'AI review', message: cleanText(message)
    }));
  }

  const draftHeadline = cleanText(article.editorial_headline || article.headline_en) || headline;
  const draftSummary = cleanText(article.editorial_summary || article.summary_en) || summary;
  const draftBody = cleanBody(article.editorial_content) || body;
  return {
    id,
    slug: `${slugify(draftHeadline)}-${id.slice(0, 7)}`,
    status: 'pending_review',
    aiStatus: article.rewrite_status === 'ready_for_review' ? 'ready_for_review' : 'needs_review',
    category,
    sourceId: stableId(article.source || sourceDomain(sourceUrl) || 'unknown-source'),
    sourceName: cleanText(article.source_name || article.source) || sourceDomain(sourceUrl) || 'Unknown publisher',
    sourceDomain: sourceDomain(sourceUrl),
    sourceUrl,
    author: cleanText(article.author),
    sourcePublishedAt,
    scrapedAt: validDate(article.scraped_at) || now,
    updatedAt: now,
    publishedAt: null,
    imageUrl: imageFor(article),
    imageCredit: cleanText(article.image_credit) || cleanText(article.source_name || article.source),
    original: { headline, summary, body },
    draft: { headline: draftHeadline, summary: draftSummary, body: draftBody },
    tags: normalizedTags(article.tags, category),
    validation: warnings,
    topRank: null,
    aiModel: cleanText(article.ai_model) || (article.ai_enriched ? 'Groq editorial model' : 'Not processed'),
    promptVersion: cleanText(article.prompt_version) || 'fact-preserving-editorial-v1',
    editorNote: '',
    rejectionReason: '',
    audit: [{ action: 'scraped', at: validDate(article.scraped_at) || now, by: 'news-worker' }],
    _feedIndex: index
  };
}

function normalizeCuratedArticle(article, index) {
  const normalized = normalizeFeedArticle({
    title: article.title,
    summary: `Source listing supplied for editorial verification: ${article.title}`,
    content: '',
    source: article.source_name,
    source_name: article.source_name,
    url: article.source_url,
    published_at: article.original_published_at,
    category: article.category,
    tags: [],
    source_image_checked: false
  }, 10_000 + index);
  normalized.id = `curated-${stableId(`${article.source_url}#brief:${article.title}`)}`;
  normalized.slug = `${slugify(article.title)}-${normalized.id.slice(-7)}`;
  normalized.validation.unshift({
    id: `${normalized.id}-exact-url`,
    severity: 'error',
    label: 'Verify exact article URL',
    message: 'The supplied brief contains a publisher homepage, not the exact article URL. Verify it before approval.'
  });
  normalized.aiStatus = 'not_started';
  normalized.audit = [{ action: 'manual_seed_import', at: new Date().toISOString(), by: 'project-brief' }];
  return normalized;
}

function createInitialState() {
  const feed = readJson(FEED_PATH, []);
  const curated = readJson(CURATED_PATH, []);
  const feedArticles = (Array.isArray(feed) ? feed : [])
    .slice(0, 180)
    .map(normalizeFeedArticle);
  const curatedArticles = (Array.isArray(curated) ? curated : [])
    .map(normalizeCuratedArticle);

  // Seed a visible LOCAL DEMO publication set only. Production/Supabase rows
  // retain their database workflow status and are never auto-published here.
  const selected = [];
  for (const category of CATEGORIES) {
    const matches = feedArticles
      .filter(article => article.category === category.slug && article.sourceUrl && isDeskRelevant(article))
      .sort((left, right) => Number(Boolean(right.imageUrl)) - Number(Boolean(left.imageUrl)));
    selected.push(...matches.slice(0, 3));
  }
  for (const article of feedArticles) {
    if (selected.length >= 24) break;
    if (article.sourceUrl && isDeskRelevant(article) && !selected.includes(article)) selected.push(article);
  }
  const publishedIds = new Set(selected.map(article => article.id));
  const publicationTime = new Date().toISOString();
  feedArticles.forEach(article => {
    if (!publishedIds.has(article.id)) return;
    article.status = 'published';
    article.aiStatus = article.aiStatus === 'not_started' ? 'needs_review' : article.aiStatus;
    article.publishedAt = article.sourcePublishedAt || publicationTime;
    article.audit.push({ action: 'demo_seed_published', at: publicationTime, by: 'local-demo' });
  });

  const published = feedArticles
    .filter(article => article.status === 'published')
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  published.slice(0, 10).forEach((article, index) => { article.topRank = index + 1; });

  const articles = [...curatedArticles, ...feedArticles.slice(0, 90)];
  const sourceMap = new Map(REQUIRED_SOURCE_CATALOG.map(source => [source.domain, {
    id: stableId(source.domain),
    name: source.name,
    domain: source.domain,
    group: source.group,
    adapter: source.adapter,
    enabled: source.enabled,
    status: source.enabled ? 'healthy' : 'paused',
    articleCount: 0,
    lastRunAt: null,
    lastError: ''
  }]));
  articles.forEach(article => {
    const articleDomain = article.sourceDomain || '';
    const catalogKey = [...sourceMap.keys()].find(domain => (
      articleDomain === domain || articleDomain.endsWith(`.${domain}`)
    ));
    const key = catalogKey || articleDomain || article.sourceName;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        id: article.sourceId,
        name: article.sourceName,
        domain: article.sourceDomain,
        enabled: true,
        status: 'healthy',
        articleCount: 0,
        lastRunAt: article.scrapedAt,
        lastError: ''
      });
    }
    article.sourceId = sourceMap.get(key).id;
    sourceMap.get(key).articleCount += 1;
    if (!sourceMap.get(key).lastRunAt
      || Date.parse(article.scrapedAt) > Date.parse(sourceMap.get(key).lastRunAt)) {
      sourceMap.get(key).lastRunAt = article.scrapedAt;
    }
  });
  const sourceGroup = domain => {
    if (['ft.lk', 'economynext.com', 'srilankabiz.lk', 'businesstoday.lk', 'lankabusinessonline.com'].includes(domain)) {
      return 'Business / Finance';
    }
    if (['news.lk', 'army.lk', 'caa.lk'].includes(domain)) return 'Official / Government';
    return 'General News';
  };
  sourceMap.forEach(source => {
    source.group = source.group || sourceGroup(source.domain);
    source.nextRunAt = source.enabled
      ? new Date(Date.parse(source.lastRunAt || publicationTime) + 60 * 60 * 1000).toISOString()
      : null;
    source.articlesToday = source.articleCount;
    source.successRate = source.enabled ? 100 : 0;
    source.error = source.lastError || '';
  });
  return {
    version: 7,
    demo: true,
    categories: CATEGORIES,
    articles,
    sources: [...sourceMap.values()],
    updatedAt: publicationTime
  };
}

class EditorialStore {
  constructor(options = {}) {
    this.statePath = options.statePath || STATE_PATH;
    this.persist = options.persist !== false;
    this.state = this._load();
  }

  _load() {
    const stored = readJson(this.statePath, null);
    if (stored && stored.version === 7 && Array.isArray(stored.articles)) return stored;
    const initial = createInitialState();
    this._save(initial);
    return initial;
  }

  _save(nextState = this.state) {
    if (!this.persist) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(nextState, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.statePath);
  }

  _commit() {
    this.state.updatedAt = new Date().toISOString();
    this._save();
  }

  resetDemo() {
    this.state = createInitialState();
    this._commit();
    return this.state;
  }

  listArticles(filters = {}) {
    const status = cleanText(filters.status);
    const category = cleanText(filters.category);
    const search = cleanText(filters.search).toLowerCase();
    return this.state.articles
      .filter(article => !status || status === 'all' || article.status === status)
      .filter(article => !category || category === 'all' || article.category === category)
      .filter(article => !search || [
        article.original.headline,
        article.draft.headline,
        article.sourceName,
        article.sourceDomain
      ].some(value => String(value || '').toLowerCase().includes(search)))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  getArticle(idOrSlug) {
    return this.state.articles.find(article => article.id === idOrSlug || article.slug === idOrSlug) || null;
  }

  updateArticle(id, changes, actor = 'editor') {
    const article = this.getArticle(id);
    if (!article) return null;
    let editorialChanged = false;
    if (changes.draft && typeof changes.draft === 'object') {
      for (const key of ['headline', 'summary', 'body']) {
        if (typeof changes.draft[key] === 'string') {
          const nextValue = key === 'body' ? cleanBody(changes.draft[key]) : cleanText(changes.draft[key]);
          if (nextValue !== article.draft[key]) {
            article.draft[key] = nextValue;
            editorialChanged = true;
          }
        }
      }
    }
    if (CATEGORY_SET.has(changes.category) && changes.category !== article.category) {
      article.category = changes.category;
      editorialChanged = true;
    }
    if (Array.isArray(changes.tags)) {
      const nextTags = normalizedTags(changes.tags, article.category);
      if (JSON.stringify(nextTags) !== JSON.stringify(article.tags)) {
        article.tags = nextTags;
        editorialChanged = true;
      }
    }
    if (typeof changes.editorNote === 'string') {
      const nextNote = cleanBody(changes.editorNote).slice(0, 4000);
      if (nextNote !== article.editorNote) {
        article.editorNote = nextNote;
        editorialChanged = true;
      }
    }
    if (typeof changes.imageUrl === 'string') {
      const requestedImageUrl = cleanText(changes.imageUrl);
      const nextImageUrl = requestedImageUrl
        ? normalizeArticleImageUrl(requestedImageUrl, article.sourceUrl)
        : '';
      if (requestedImageUrl && !nextImageUrl) {
        const error = new Error('Use only the original publisher image or a cached source image.');
        error.statusCode = 422;
        throw error;
      }
      if (nextImageUrl !== article.imageUrl) {
        article.imageUrl = nextImageUrl;
        editorialChanged = true;
      }
    }
    if (typeof changes.imageCredit === 'string') {
      const nextImageCredit = cleanText(changes.imageCredit);
      if (nextImageCredit !== article.imageCredit) {
        article.imageCredit = nextImageCredit;
        editorialChanged = true;
      }
    }
    let rankChanged = false;
    if (changes.topRank === null || Number.isInteger(changes.topRank)) {
      const nextRank = changes.topRank === null ? null : Math.min(10, Math.max(1, changes.topRank));
      if (nextRank !== article.topRank) {
        article.topRank = nextRank;
        rankChanged = true;
      }
    }
    if (!editorialChanged && !rankChanged) return article;
    if (editorialChanged) {
      const previousStatus = article.status;
      const nextStatus = statusAfterEditorialEdit(previousStatus);
      if (nextStatus !== previousStatus) {
        article.status = nextStatus;
        article.topRank = null;
        article.rejectionReason = '';
        if (previousStatus === 'scheduled') article.scheduledFor = null;
      }
    }
    article.updatedAt = new Date().toISOString();
    article.audit.push({
      action: editorialChanged ? 'edited' : 'top_news_ranked',
      at: article.updatedAt,
      by: actorLabel(actor)
    });
    this._commit();
    return article;
  }

  transition(id, nextStatus, actor = 'editor', note = '') {
    const article = this.getArticle(id);
    if (!article || !VALID_STATUSES.has(nextStatus)) return null;
    if (!canTransition(article.status, nextStatus)) {
      const error = new Error(transitionErrorMessage(article.status, nextStatus));
      error.statusCode = 409;
      error.code = 'ILLEGAL_WORKFLOW_TRANSITION';
      throw error;
    }
    if (article.status === nextStatus) return article;
    if (nextStatus === 'scheduled' && !article.scheduledFor) {
      const error = new Error('A publication time is required before scheduling.');
      error.statusCode = 422;
      error.code = 'SCHEDULE_REQUIRED';
      throw error;
    }
    const previousStatus = article.status;
    article.status = nextStatus;
    article.updatedAt = new Date().toISOString();
    if (nextStatus === 'published') {
      article.publishedAt = article.publishedAt || article.updatedAt;
      article.scheduledFor = null;
    }
    if (nextStatus === 'rejected') {
      article.rejectionReason = cleanBody(note) || 'Rejected during editorial review';
      article.topRank = null;
    }
    article.audit.push({
      action: nextStatus,
      fromStatus: previousStatus,
      at: article.updatedAt,
      by: actorLabel(actor),
      note: cleanBody(note)
    });
    this._commit();
    return article;
  }

  replaceDraft(id, draft, metadata = {}, actor = 'groq-worker') {
    const article = this.getArticle(id);
    if (!article) return null;
    if (!REWRITABLE_STATUSES.has(article.status)) {
      const error = new Error(rewriteErrorMessage(article.status));
      error.statusCode = 409;
      error.code = 'ILLEGAL_REWRITE_STATUS';
      throw error;
    }
    const previousStatus = article.status;
    article.draft = {
      headline: cleanText(draft.headline) || article.original.headline,
      summary: cleanText(draft.summary) || article.original.summary,
      body: cleanBody(draft.content || draft.body) || article.original.body
    };
    if (CATEGORY_SET.has(draft.category)) article.category = draft.category;
    if (Array.isArray(draft.tags)) article.tags = normalizedTags(draft.tags, article.category);
    article.aiStatus = draft.rewrite_status === 'needs_review' ? 'needs_review' : 'ready_for_review';
    article.status = 'pending_review';
    article.rejectionReason = '';
    article.aiModel = cleanText(metadata.aiModel) || article.aiModel;
    article.promptVersion = cleanText(metadata.promptVersion) || article.promptVersion;
    article.validation = Array.isArray(metadata.validation) ? metadata.validation : article.validation;
    article.updatedAt = new Date().toISOString();
    article.audit.push({
      action: 'ai_processed',
      fromStatus: previousStatus,
      toStatus: 'pending_review',
      at: article.updatedAt,
      by: actorLabel(actor)
    });
    this._commit();
    return article;
  }

  getTopNews() {
    return this.state.articles
      .filter(article => article.status === 'published' && Number.isInteger(article.topRank))
      .sort((left, right) => left.topRank - right.topRank)
      .slice(0, 10);
  }

  setTopNews(articleIds, actor = 'editor') {
    const uniqueIds = [...new Set((articleIds || []).map(String))].slice(0, 10);
    const selected = uniqueIds.map(id => this.getArticle(id));
    if (selected.some(article => !article || article.status !== 'published')) {
      const error = new Error('Top News can contain published articles only');
      error.statusCode = 422;
      throw error;
    }
    this.state.articles.forEach(article => { article.topRank = null; });
    selected.forEach((article, index) => {
      article.topRank = index + 1;
      article.updatedAt = new Date().toISOString();
      article.audit.push({ action: 'top_news_ranked', at: article.updatedAt, by: actorLabel(actor), note: `Slot ${index + 1}` });
    });
    this._commit();
    return selected;
  }

  listSources() {
    return [...this.state.sources].sort((left, right) => left.name.localeCompare(right.name));
  }

  listEvents(limit = 30) {
    return this.state.articles
      .flatMap(article => (article.audit || []).map((entry, index) => ({
        id: `${article.id}-${entry.at || index}-${index}`,
        articleId: article.id,
        action: entry.action === 'ai_processed' ? 'rewritten'
          : entry.action === 'demo_seed_published' ? 'published'
            : entry.action === 'manual_seed_import' ? 'scraped'
              : entry.action,
        label: String(entry.action || 'updated').replace(/_/g, ' '),
        actor: entry.by || 'Newsroom',
        createdAt: entry.at || article.updatedAt
      })))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, limit);
  }

  updateSource(id, changes) {
    const source = this.state.sources.find(item => item.id === id);
    if (!source) return null;
    if (typeof changes.enabled === 'boolean') source.enabled = changes.enabled;
    this._commit();
    return source;
  }
}

function publicArticle(article, options = {}) {
  if (!article) return null;
  const imageUrl = normalizeArticleImageUrl(article.imageUrl, article.sourceUrl);
  return {
    id: article.id,
    slug: article.slug,
    headline: article.draft.headline,
    title: article.draft.headline,
    summary: article.draft.summary,
    content: article.draft.body,
    category: article.category,
    tags: article.tags,
    imageUrl,
    image: imageUrl,
    imageCredit: article.imageCredit,
    sourceName: article.sourceName,
    source: article.sourceName,
    sourceUrl: article.sourceUrl,
    author: article.author,
    sourcePublishedAt: article.sourcePublishedAt,
    publishedAt: article.publishedAt,
    date: article.publishedAt,
    topRank: article.topRank,
    preview: Boolean(options.preview)
  };
}

module.exports = {
  CATEGORIES,
  REQUIRED_SOURCE_CATALOG,
  EditorialStore,
  categoryFor,
  createInitialState,
  publicArticle
};
