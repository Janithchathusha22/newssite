'use strict';

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

/**
 * Production editorial repository backed by Supabase PostgREST.
 *
 * This module is server-only. It deliberately accepts only a Supabase secret
 * key/service-role key and never falls back to an anonymous browser key.
 */

const CATEGORY_SET = new Set([
  'business-news',
  'interviews-appointments',
  'money',
  'technology',
  'travel-tourism',
  'luxury-living'
]);

const STATUS_ACTION = Object.freeze({
  scraped: 'scraped',
  ai_processing: 'ai_processing_started',
  pending_review: 'ai_processed',
  changes_requested: 'changes_requested',
  approved: 'approved',
  scheduled: 'scheduled',
  published: 'published',
  rejected: 'rejected',
  failed: 'failed'
});

const SOURCE_GROUP_LABELS = Object.freeze({
  general_news: 'General News',
  business_finance: 'Business / Finance',
  official_government: 'Official / Government',
  other: 'General News'
});

const TAG_DEFAULTS = Object.freeze({
  'business-news': ['Sri Lanka', 'Business', 'Corporate'],
  'interviews-appointments': ['Sri Lanka', 'Appointments', 'Leadership'],
  money: ['Sri Lanka', 'Finance', 'Economy'],
  technology: ['Sri Lanka', 'Technology', 'Innovation'],
  'travel-tourism': ['Sri Lanka', 'Travel', 'Tourism'],
  'luxury-living': ['Sri Lanka', 'Luxury', 'Lifestyle']
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIMPLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;
const PROJECT_DIR = path.resolve(__dirname, '..');

class EditorialRepositoryError extends Error {
  constructor(message, statusCode = 500, code = 'EDITORIAL_REPOSITORY_ERROR') {
    super(message);
    this.name = 'EditorialRepositoryError';
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace?.(this, EditorialRepositoryError);
  }
}

function cleanText(value, maximum = 10000) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function cleanBody(value, maximum = 500000) {
  return typeof value === 'string'
    ? value
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, maximum)
    : '';
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function validIso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function sourceDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '');
  } catch (_) {
    return '';
  }
}

function hasEditorialSourceUrl(row) {
  return Boolean(cleanText(row?.canonical_url) || cleanText(row?.source_url));
}

function imageUrlFor(row) {
  const sourceUrl = row.source_url || row.canonical_url;
  const declaredRemote = cleanText(row.image_url);
  if (declaredRemote && !normalizePublisherImageUrl(declaredRemote, sourceUrl)) return '';
  // Prefer the deterministic local cache. Remote source URLs remain as a
  // provenance/fallback field in Supabase and may be blocked by hotlink rules.
  const local = normalizeLocalImageUrl(row.local_image_path);
  if (local) {
    try {
      if (fs.statSync(path.join(PROJECT_DIR, local.slice(1))).isFile()) return local;
    } catch (_) {
      // Fall back to the publisher URL when a deploy lacks this cache file.
    }
  }
  return normalizePublisherImageUrl(
    declaredRemote,
    sourceUrl
  );
}

function normalizedTags(value, category) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,|]/)
      : [];
  const tags = [...new Set(source.map(item => cleanText(item, 100)).filter(Boolean))].slice(0, 8);
  for (const fallback of TAG_DEFAULTS[category] || []) {
    if (tags.length >= 3) break;
    if (!tags.includes(fallback)) tags.push(fallback);
  }
  return tags.slice(0, 8);
}

function arraysEqual(left, right) {
  return JSON.stringify(arrayValue(left)) === JSON.stringify(arrayValue(right));
}

function issueFrom(value, articleId, index, severity) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const message = cleanText(value.message || value.detail || value.label, 1000);
    if (!message) return null;
    return {
      id: cleanText(value.id, 160) || `${articleId}-${severity}-${index}`,
      severity: ['error', 'warning', 'info'].includes(value.severity) ? value.severity : severity,
      label: cleanText(value.label, 160) || (severity === 'error' ? 'Fact check' : 'AI review'),
      message
    };
  }
  const message = cleanText(String(value || ''), 1000);
  if (!message) return null;
  return {
    id: `${articleId}-${severity}-${index}`,
    severity,
    label: severity === 'error' ? 'Fact check' : 'AI review',
    message
  };
}

function validationFor(row) {
  return [
    ...arrayValue(row.validation_errors).map((item, index) => issueFrom(item, row.id, index, 'error')),
    ...arrayValue(row.ai_warnings).map((item, index) => issueFrom(item, row.id, index, 'warning'))
  ].filter(Boolean);
}

function splitValidation(validation) {
  const errors = [];
  const warnings = [];
  for (const value of arrayValue(validation)) {
    if (value && typeof value === 'object' && value.severity === 'error') errors.push(value);
    else if (value !== null && value !== undefined) warnings.push(value);
  }
  return { errors, warnings };
}

function actorInfo(actor) {
  if (actor && typeof actor === 'object') {
    const id = UUID_PATTERN.test(String(actor.id || '')) ? String(actor.id) : null;
    const label = cleanText(actor.name || actor.email || actor.label || id || 'Newsroom', 200);
    return { id, label };
  }
  const raw = cleanText(String(actor || ''), 200);
  return {
    id: UUID_PATTERN.test(raw) ? raw : null,
    label: raw || 'Newsroom'
  };
}

function safeDatabaseMessage(payload, status) {
  if (status === 401 || status === 403) return 'Supabase editorial access was denied.';
  if (status === 404) return 'The Supabase editorial schema is not available.';
  if (status === 409 || status === 412) return 'The editorial record changed while it was being saved.';
  const code = cleanText(payload && typeof payload === 'object' ? payload.code : '', 40);
  if (code === '23505') return 'A conflicting editorial record already exists.';
  if (code === '23503') return 'A related editorial record is missing or invalid.';
  if (code === '23514' || code === '22P02') return 'The editorial change did not pass database validation.';
  if (code === '42P01' || code === '42703' || code === 'PGRST205') {
    return 'The Supabase editorial schema is incomplete. Apply the editorial workflow migration.';
  }
  // Do not forward Postgres/PostgREST details to an API client. They can
  // expose table names, policies, predicates, or request fragments.
  return 'The Supabase editorial request failed.';
}

function chunk(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function colomboDayStartIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const utc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 0, 0, 0);
  return new Date(utc - (5.5 * 60 * 60 * 1000)).toISOString();
}

function mapOverviewRow(row, extras = {}) {
  const sourceName = cleanText(row.source_name) || 'Unknown publisher';
  const category = CATEGORY_SET.has(row.category_slug) ? row.category_slug : 'business-news';
  const originalHeadline = cleanText(row.original_title) || 'Untitled news report';
  const originalSummary = cleanText(row.original_summary);
  const originalBody = cleanBody(row.original_content);
  const draftHeadline = cleanText(row.current_headline) || originalHeadline;
  const draftSummary = cleanText(row.current_summary) || originalSummary;
  const draftBody = cleanBody(row.current_content) || originalBody;
  const nowFallback = validIso(row.updated_at) || validIso(row.scraped_at) || new Date(0).toISOString();
  const version = extras.version || {};
  const article = {
    id: String(row.id),
    slug: cleanText(row.slug) || String(row.id),
    status: row.workflow_status || 'scraped',
    aiStatus: row.ai_status || 'not_started',
    category,
    sourceId: String(row.source_ref_id || row.publisher_article_id || ''),
    sourceName,
    sourceDomain: sourceDomain(row.source_url || row.canonical_url),
    sourceUrl: cleanText(row.source_url || row.canonical_url),
    author: cleanText(row.author),
    sourcePublishedAt: validIso(row.source_published_at) || validIso(row.scraped_at) || nowFallback,
    scrapedAt: validIso(row.scraped_at) || nowFallback,
    updatedAt: validIso(row.updated_at) || nowFallback,
    publishedAt: validIso(row.site_published_at),
    scheduledFor: validIso(row.scheduled_for),
    imageUrl: imageUrlFor(row),
    imageCredit: extras.imageCredit !== undefined
      ? cleanText(extras.imageCredit)
      : `Source image · ${sourceName}`,
    imageAlt: cleanText(row.image_alt),
    original: {
      headline: originalHeadline,
      summary: originalSummary,
      body: originalBody
    },
    draft: {
      headline: draftHeadline,
      summary: draftSummary,
      body: draftBody
    },
    tags: normalizedTags(row.current_tags, category),
    validation: validationFor(row),
    topRank: Number.isInteger(extras.topRank) ? extras.topRank : null,
    aiModel: cleanText(version.ai_model) || 'Not processed',
    promptVersion: cleanText(version.prompt_version) || 'fact-preserving-editorial-v1',
    editorNote: cleanBody(version.change_note || row.rejection_reason, 4000),
    rejectionReason: cleanBody(row.rejection_reason, 4000),
    currentVersionId: row.current_version_id || null,
    currentVersionNumber: Number(row.current_version_number) || null,
    publishedVersionId: row.published_version_id || null,
    audit: arrayValue(extras.audit)
  };
  // Keep PostgreSQL's full timestamp precision for optimistic-concurrency
  // filters. Date#toISOString truncates database microseconds and would make
  // an unchanged row look stale. The non-enumerable token never enters the
  // admin/public JSON response.
  Object.defineProperty(article, '_updatedAtToken', {
    value: cleanText(row.updated_at, 100),
    enumerable: false,
    configurable: false,
    writable: false
  });
  return article;
}

function mapPublishedRow(row, extras = {}) {
  const sourceName = cleanText(row.source_name) || 'Unknown publisher';
  const category = CATEGORY_SET.has(row.category_slug) ? row.category_slug : 'business-news';
  const headline = cleanText(row.headline) || 'Untitled news report';
  const summary = cleanText(row.summary);
  const body = cleanBody(row.content);
  const publishedAt = validIso(row.site_published_at) || new Date(0).toISOString();
  return {
    id: String(row.id),
    slug: cleanText(row.slug) || String(row.id),
    status: 'published',
    aiStatus: 'ready_for_review',
    category,
    sourceId: '',
    sourceName,
    sourceDomain: sourceDomain(row.source_url || row.canonical_url),
    sourceUrl: cleanText(row.source_url || row.canonical_url),
    author: cleanText(row.author),
    sourcePublishedAt: validIso(row.source_published_at) || publishedAt,
    scrapedAt: validIso(row.source_published_at) || publishedAt,
    updatedAt: publishedAt,
    publishedAt,
    imageUrl: imageUrlFor(row),
    imageCredit: extras.imageCredit !== undefined
      ? cleanText(extras.imageCredit)
      : `Source image · ${sourceName}`,
    imageAlt: cleanText(row.image_alt),
    original: { headline, summary, body },
    draft: { headline, summary, body },
    tags: normalizedTags(row.tags, category),
    validation: [],
    topRank: Number.isInteger(row.slot_number) ? row.slot_number : Number(row.slot_number) || null,
    aiModel: 'Published editorial version',
    promptVersion: 'fact-preserving-editorial-v1',
    editorNote: '',
    rejectionReason: '',
    audit: []
  };
}

function mappedEventAction(action) {
  if (action === 'ai_processed' || action === 'ai_processing_started') return 'rewritten';
  if (action === 'approved') return 'approved';
  if (action === 'published' || action === 'scheduled') return 'published';
  if (action === 'rejected' || action === 'failed') return 'rejected';
  if (action === 'scraped') return 'scraped';
  return 'edited';
}

function eventLabel(action) {
  const labels = {
    scraped: 'Article collected',
    ai_processing_started: 'AI rewrite started',
    ai_processed: 'AI rewrite completed',
    validation_failed: 'Validation needs review',
    edited: 'Editorial draft updated',
    preview_created: 'Preview created',
    changes_requested: 'Changes requested',
    approved: 'Article approved',
    scheduled: 'Article scheduled',
    published: 'Article published',
    unpublished: 'Article unpublished',
    rejected: 'Article rejected',
    failed: 'Editorial processing failed',
    restored: 'Article restored'
  };
  return labels[action] || cleanText(String(action || 'updated').replace(/_/g, ' '), 120);
}

class SupabaseEditorialStore {
  constructor() {
    this.isDemo = false;
    this.state = { demo: false };
    this.url = cleanText(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, 1000).replace(/\/+$/, '');
    this.key = cleanText(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
    this.fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
    this.timeoutMs = 15000;
    this._categoryCache = new Map();
    this._topNewsWrite = Promise.resolve();
  }

  _configured() {
    if (!this.url || !this.key || !this.fetch) return false;
    try {
      const parsed = new URL(this.url);
      return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
    } catch (_) {
      return false;
    }
  }

  async available() {
    if (!this._configured()) return false;
    try {
      await this._request('editorial_article_overview', {
        params: { select: 'id', limit: 1 }
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async _request(resource, options = {}) {
    if (!this._configured()) {
      throw new EditorialRepositoryError(
        'Supabase editorial storage is not configured on the server.',
        503,
        'SUPABASE_NOT_CONFIGURED'
      );
    }
    if (!/^(?:rpc\/)?[a-z][a-z0-9_]*$/i.test(resource)) {
      throw new EditorialRepositoryError('Invalid editorial resource.', 500, 'INVALID_RESOURCE');
    }

    const target = new URL(`${this.url}/rest/v1/${resource}`);
    for (const [name, value] of Object.entries(options.params || {})) {
      if (value !== undefined && value !== null && value !== '') target.searchParams.set(name, String(value));
    }

    const headers = {
      apikey: this.key,
      Accept: 'application/json',
      'Accept-Profile': 'public',
      'Content-Profile': 'public',
      ...(options.headers || {})
    };
    // New sb_secret_* keys authenticate through `apikey`; legacy service-role
    // JWTs also need the bearer header for PostgREST role propagation.
    if (/^[^.]+\.[^.]+\.[^.]+$/.test(this.key)) headers.Authorization = `Bearer ${this.key}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(target, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      });
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      throw new EditorialRepositoryError(
        timedOut ? 'The Supabase editorial request timed out.' : 'Supabase editorial storage is unavailable.',
        503,
        timedOut ? 'SUPABASE_TIMEOUT' : 'SUPABASE_UNAVAILABLE'
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = null;
      }
    }
    if (!response.ok) {
      throw new EditorialRepositoryError(
        safeDatabaseMessage(payload, response.status),
        response.status >= 500 ? 502 : response.status,
        cleanText(payload?.code, 80) || 'SUPABASE_REQUEST_FAILED'
      );
    }
    return payload;
  }

  async _optionalRequest(resource, options = {}) {
    try {
      return await this._request(resource, options);
    } catch (_) {
      return [];
    }
  }

  async _versionsById(versionIds) {
    const ids = [...new Set(versionIds.filter(id => UUID_PATTERN.test(String(id))))];
    const rows = [];
    for (const group of chunk(ids)) {
      const result = await this._request('article_versions', {
        params: {
          select: 'id,ai_model,prompt_version,change_note,created_by,created_at',
          id: `in.(${group.join(',')})`
        }
      });
      rows.push(...arrayValue(result));
    }
    return new Map(rows.map(row => [row.id, row]));
  }

  async _topRanks() {
    const rows = await this._request('home_top_news_slots', {
      params: { select: 'slot_number,article_id', order: 'slot_number.asc' }
    });
    return new Map(arrayValue(rows).filter(row => row.article_id).map(row => [row.article_id, Number(row.slot_number)]));
  }

  async _imageCredits(articleIds) {
    const ids = [...new Set(articleIds.filter(id => UUID_PATTERN.test(String(id))))];
    const credits = new Map();
    for (const group of chunk(ids)) {
      const rows = await this._optionalRequest('editorial_actions', {
        params: {
          select: 'article_id,metadata,created_at',
          article_id: `in.(${group.join(',')})`,
          action: 'eq.edited',
          'metadata->>image_credit': 'not.is.null',
          order: 'created_at.desc',
          limit: 1000
        }
      });
      for (const row of arrayValue(rows)) {
        if (!credits.has(row.article_id)
          && row.metadata
          && Object.prototype.hasOwnProperty.call(row.metadata, 'image_credit')) {
          credits.set(row.article_id, cleanText(row.metadata.image_credit));
        }
      }
    }
    return credits;
  }

  async _enrichOverviewRows(rows, includeAudit = false) {
    if (!rows.length) return [];
    const [versions, ranks, credits] = await Promise.all([
      this._versionsById(rows.map(row => row.current_version_id)),
      this._topRanks(),
      this._imageCredits(rows.map(row => row.id))
    ]);
    const mapped = rows.map(row => mapOverviewRow(row, {
      version: versions.get(row.current_version_id),
      topRank: ranks.get(row.id),
      imageCredit: credits.get(row.id)
    }));
    if (includeAudit && mapped.length === 1) mapped[0].audit = await this._articleAudit(mapped[0].id);
    return mapped;
  }

  async listArticles(filters = {}) {
    const status = cleanText(filters.status, 40);
    const category = cleanText(filters.category, 80);
    const search = cleanText(filters.search, 120)
      .replace(/[^\p{L}\p{N}\s'&.-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Public API callers use listArticles({ status: 'published' }). Resolve
    // those reads through the immutable published version rather than through
    // a mutable current draft in the editorial overview.
    if (status === 'published') {
      const publishedParams = {
        select: '*',
        order: 'site_published_at.desc.nullslast',
        limit: 1000
      };
      if (category && category !== 'all') {
        if (!CATEGORY_SET.has(category)) return [];
        publishedParams.category_slug = `eq.${category}`;
      }
      if (search) {
        const term = search.replace(/"/g, '');
        publishedParams.or = `(headline.ilike.*${term}*,summary.ilike.*${term}*,source_name.ilike.*${term}*)`;
      }
      const rows = arrayValue(await this._request('published_articles', { params: publishedParams }));
      const [ranks, credits] = await Promise.all([
        this._topRanks(),
        this._imageCredits(rows.map(row => row.id))
      ]);
      return arrayValue(rows).map(row => ({
        ...mapPublishedRow(row, {
          imageCredit: credits.has(row.id) ? credits.get(row.id) : undefined
        }),
        topRank: ranks.get(row.id) || null
      }));
    }

    const params = {
      select: '*',
      order: 'updated_at.desc.nullslast',
      limit: 1000,
      // news_articles predates the editorial schema in some installations.
      // Those legacy rows have neither source URL and cannot be reviewed
      // safely. Filter them in PostgREST before the limit is applied, while
      // leaving the top-level `or` parameter available for text search.
      'not.and': '(canonical_url.is.null,source_url.is.null)'
    };
    if (status && status !== 'all') {
      if (!VALID_STATUSES.has(status)) return [];
      params.workflow_status = `eq.${status}`;
    }
    if (category && category !== 'all') {
      if (!CATEGORY_SET.has(category)) return [];
      params.category_slug = `eq.${category}`;
    }
    if (search) {
      const term = search.replace(/"/g, '');
      params.or = `(original_title.ilike.*${term}*,current_headline.ilike.*${term}*,source_name.ilike.*${term}*)`;
    }
    // Keep the local guard as defence in depth for malformed empty-string
    // legacy values and for mocked/non-PostgREST repository adapters.
    const rows = arrayValue(await this._request('editorial_article_overview', { params }))
      .filter(hasEditorialSourceUrl);
    return this._enrichOverviewRows(rows);
  }

  async _findArticle(idOrSlug, includeAudit = false) {
    const value = cleanText(String(idOrSlug || ''), 160);
    if (!value) return null;
    const params = { select: '*', limit: 1 };
    if (UUID_PATTERN.test(value)) params.id = `eq.${value}`;
    else if (SIMPLE_SLUG_PATTERN.test(value)) params.slug = `eq.${value.toLowerCase()}`;
    else return null;
    const rows = arrayValue(await this._request('editorial_article_overview', { params }));
    if (!rows.length) return null;
    const articles = await this._enrichOverviewRows([rows[0]], includeAudit);
    return articles[0] || null;
  }

  async getArticle(idOrSlug) {
    return this._findArticle(idOrSlug, true);
  }

  async _categoryId(slug) {
    if (!CATEGORY_SET.has(slug)) return null;
    if (this._categoryCache.has(slug)) return this._categoryCache.get(slug);
    const rows = arrayValue(await this._request('categories', {
      params: { select: 'id', slug: `eq.${slug}`, limit: 1 }
    }));
    const id = rows[0]?.id || null;
    if (id) this._categoryCache.set(slug, id);
    return id;
  }

  async _insertVersion(article, values, origin, metadata, actor) {
    const categoryId = await this._categoryId(values.category);
    if (!categoryId) {
      throw new EditorialRepositoryError('The selected editorial category does not exist.', 422, 'INVALID_CATEGORY');
    }
    const info = actorInfo(actor);
    const rows = arrayValue(await this._request('article_versions', {
      method: 'POST',
      params: { select: 'id,version_number' },
      headers: { Prefer: 'return=representation' },
      body: {
        article_id: article.id,
        origin,
        headline: cleanText(values.headline) || article.original.headline,
        summary: cleanText(values.summary),
        content: cleanBody(values.body || values.content),
        category_id: categoryId,
        tags: normalizedTags(values.tags, values.category),
        language: 'en',
        ai_model: cleanText(metadata.aiModel || article.aiModel, 200) || null,
        prompt_version: cleanText(metadata.promptVersion || article.promptVersion, 200) || null,
        ai_warnings: arrayValue(metadata.aiWarnings),
        validation_errors: arrayValue(metadata.validationErrors),
        requires_human_review: Boolean(metadata.requiresHumanReview),
        change_note: cleanBody(metadata.changeNote, 4000) || null,
        ...(info.id ? { created_by: info.id } : {})
      }
    }));
    if (!rows[0]?.id) {
      throw new EditorialRepositoryError('The editorial draft version could not be created.', 502, 'VERSION_CREATE_FAILED');
    }
    return rows[0];
  }

  async _deleteVersionQuietly(versionId) {
    if (!UUID_PATTERN.test(String(versionId || ''))) return;
    await this._optionalRequest('article_versions', {
      method: 'DELETE',
      params: { id: `eq.${versionId}` },
      headers: { Prefer: 'return=minimal' }
    });
  }

  async _patchArticle(id, patch, expectedUpdatedAt) {
    const params = { id: `eq.${id}`, select: 'id,updated_at' };
    if (expectedUpdatedAt) params.updated_at = `eq.${expectedUpdatedAt}`;
    const rows = arrayValue(await this._request('news_articles', {
      method: 'PATCH',
      params,
      headers: { Prefer: 'return=representation' },
      body: patch
    }));
    if (rows.length) return rows[0];
    const existing = arrayValue(await this._request('news_articles', {
      params: { select: 'id', id: `eq.${id}`, limit: 1 }
    }));
    if (!existing.length) return null;
    throw new EditorialRepositoryError(
      'This article was changed by another editor. Refresh it before saving again.',
      409,
      'OPTIMISTIC_CONCURRENCY_CONFLICT'
    );
  }

  async _insertAction(articleId, action, actor, note = '', metadata = {}) {
    const info = actorInfo(actor);
    const body = {
      article_id: articleId,
      action,
      note: cleanBody(note, 4000) || null,
      metadata: { ...metadata, actor: info.label },
      ...(VALID_STATUSES.has(metadata.from_status) ? { from_status: metadata.from_status } : {}),
      ...(VALID_STATUSES.has(metadata.to_status) ? { to_status: metadata.to_status } : {}),
      ...(info.id ? { performed_by: info.id } : {})
    };
    return this._optionalRequest('editorial_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body
    });
  }

  async _decorateTransitionAction(articleId, previousStatus, nextStatus, actor, note) {
    const action = STATUS_ACTION[nextStatus];
    if (!action) return;
    const rows = arrayValue(await this._optionalRequest('editorial_actions', {
      params: {
        select: 'id,metadata',
        article_id: `eq.${articleId}`,
        action: `eq.${action}`,
        to_status: `eq.${nextStatus}`,
        order: 'created_at.desc',
        limit: 1
      }
    }));
    if (!rows[0]?.id) {
      await this._insertAction(articleId, action, actor, note, {
        from_status: previousStatus,
        to_status: nextStatus
      });
      return;
    }
    const info = actorInfo(actor);
    await this._optionalRequest('editorial_actions', {
      method: 'PATCH',
      params: { id: `eq.${rows[0].id}` },
      headers: { Prefer: 'return=minimal' },
      body: {
        note: cleanBody(note, 4000) || null,
        metadata: { ...(rows[0].metadata || {}), actor: info.label },
        ...(info.id ? { performed_by: info.id } : {})
      }
    });
  }

  async _clearTopSlot(articleId) {
    await this._request('home_top_news_slots', {
      method: 'PATCH',
      params: { article_id: `eq.${articleId}` },
      headers: { Prefer: 'return=minimal' },
      body: { article_id: null, starts_at: null, ends_at: null, updated_by: null }
    });
  }

  async updateArticle(id, changes = {}, actor = 'editor') {
    const article = await this._findArticle(id);
    if (!article) return null;
    const draftPatch = changes.draft && typeof changes.draft === 'object' ? changes.draft : {};
    const category = CATEGORY_SET.has(changes.category) ? changes.category : article.category;
    const nextDraft = {
      headline: typeof draftPatch.headline === 'string' ? cleanText(draftPatch.headline) : article.draft.headline,
      summary: typeof draftPatch.summary === 'string' ? cleanText(draftPatch.summary) : article.draft.summary,
      body: typeof draftPatch.body === 'string' ? cleanBody(draftPatch.body) : article.draft.body,
      category,
      tags: Array.isArray(changes.tags) ? normalizedTags(changes.tags, category) : article.tags
    };
    const editorNote = typeof changes.editorNote === 'string'
      ? cleanBody(changes.editorNote, 4000)
      : cleanBody(article.editorNote, 4000);
    const requestedImageUrl = typeof changes.imageUrl === 'string'
      ? cleanText(changes.imageUrl, 4000)
      : article.imageUrl;
    const imageUrl = requestedImageUrl
      ? normalizeArticleImageUrl(requestedImageUrl, article.sourceUrl)
      : '';
    if (requestedImageUrl && !imageUrl) {
      throw new EditorialRepositoryError(
        'Use only the original publisher image or a cached source image.',
        422,
        'INVALID_ARTICLE_IMAGE'
      );
    }
    const imageCredit = typeof changes.imageCredit === 'string'
      ? cleanText(changes.imageCredit, 1000)
      : article.imageCredit;
    const imageChanged = imageUrl !== article.imageUrl;
    const creditChanged = imageCredit !== article.imageCredit;
    const versionChanged = !article.currentVersionId
      || nextDraft.headline !== article.draft.headline
      || nextDraft.summary !== article.draft.summary
      || nextDraft.body !== article.draft.body
      || category !== article.category
      || !arraysEqual(nextDraft.tags, article.tags)
      || editorNote !== cleanBody(article.editorNote, 4000)
      // article_versions has no image-credit column. Creating an immutable
      // editorial snapshot still advances updated_at while the credit itself
      // is retained in the corresponding audit metadata.
      || creditChanged;
    const editorialChanged = versionChanged || imageChanged || creditChanged;
    let version = null;

    if (versionChanged) {
      const split = splitValidation(article.validation);
      version = await this._insertVersion(article, nextDraft, 'editor', {
        aiModel: article.aiModel,
        promptVersion: article.promptVersion,
        aiWarnings: split.warnings,
        validationErrors: split.errors,
        requiresHumanReview: split.errors.length > 0 || article.aiStatus === 'needs_review',
        changeNote: editorNote
      }, actor);
    }

    if (editorialChanged) {
      const categoryId = versionChanged ? await this._categoryId(category) : null;
      const status = statusAfterEditorialEdit(article.status);
      const patch = {
        ...(version ? { current_version_id: version.id, category_id: categoryId } : {}),
        ...(imageChanged ? (
          normalizeLocalImageUrl(imageUrl)
            ? { image_url: null, local_image_path: imageUrl.replace(/^\//, '') }
            : { image_url: imageUrl || null, local_image_path: null }
        ) : {}),
        ...(status !== article.status ? {
          workflow_status: status,
          ...(article.rejectionReason ? { rejection_reason: null } : {}),
          ...(article.status === 'scheduled' ? { scheduled_for: null } : {})
        } : {})
      };
      try {
        const updated = await this._patchArticle(article.id, patch, article._updatedAtToken || article.updatedAt);
        if (!updated) {
          await this._deleteVersionQuietly(version?.id);
          return null;
        }
      } catch (error) {
        await this._deleteVersionQuietly(version?.id);
        throw error;
      }
      await this._insertAction(article.id, 'edited', actor, editorNote, {
        ...(creditChanged ? { image_credit: imageCredit } : {}),
        version_id: version?.id || article.currentVersionId || null
      });
      if (status !== article.status) {
        await this._decorateTransitionAction(article.id, article.status, status, actor, editorNote);
        await this._clearTopSlot(article.id);
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, 'topRank')) {
      const requestedRank = changes.topRank === null ? null : Number(changes.topRank);
      const refreshed = editorialChanged ? await this._findArticle(article.id) : article;
      if (requestedRank === null && refreshed?.topRank !== null) {
        await this._clearTopSlot(article.id);
      } else if (Number.isInteger(requestedRank) && requestedRank >= 1 && requestedRank <= 10
        && refreshed?.status === 'published' && requestedRank !== refreshed.topRank) {
        const ids = (await this.getTopNews()).map(item => item.id).filter(itemId => itemId !== article.id);
        ids.splice(requestedRank - 1, 0, article.id);
        await this.setTopNews(ids.slice(0, 10), actor);
      }
    }
    return this.getArticle(article.id);
  }

  async transition(id, nextStatus, actor = 'editor', note = '') {
    if (!VALID_STATUSES.has(nextStatus)) return null;
    const article = await this._findArticle(id);
    if (!article) return null;
    if (!canTransition(article.status, nextStatus)) {
      throw new EditorialRepositoryError(
        transitionErrorMessage(article.status, nextStatus),
        409,
        'ILLEGAL_WORKFLOW_TRANSITION'
      );
    }
    if (article.status === nextStatus) return article;
    if (['approved', 'scheduled', 'published'].includes(nextStatus) && !article.currentVersionId) {
      throw new EditorialRepositoryError('Create an editorial draft before approval or publication.', 422, 'DRAFT_REQUIRED');
    }
    if (nextStatus === 'scheduled' && !article.scheduledFor) {
      throw new EditorialRepositoryError('A publication time is required before scheduling.', 422, 'SCHEDULE_REQUIRED');
    }

    const info = actorInfo(actor);
    const now = new Date().toISOString();
    const patch = { workflow_status: nextStatus };
    if (nextStatus === 'approved') {
      patch.approved_at = now;
      patch.reviewed_at = now;
      if (info.id) {
        patch.approved_by = info.id;
        patch.reviewed_by = info.id;
      }
    }
    if (nextStatus === 'published') {
      patch.published_version_id = article.currentVersionId;
      patch.site_published_at = article.publishedAt || now;
      patch.scheduled_for = null;
    }
    if (nextStatus === 'rejected') {
      patch.rejection_reason = cleanBody(note, 4000) || 'Rejected during editorial review';
    } else if (article.rejectionReason) {
      patch.rejection_reason = null;
    }

    const updated = await this._patchArticle(article.id, patch, article._updatedAtToken || article.updatedAt);
    if (!updated) return null;
    await this._decorateTransitionAction(article.id, article.status, nextStatus, actor, note);
    if (nextStatus !== 'published') await this._clearTopSlot(article.id);
    return this.getArticle(article.id);
  }

  async replaceDraft(id, draft = {}, metadata = {}, actor = 'groq-worker') {
    const article = await this._findArticle(id);
    if (!article) return null;
    if (!REWRITABLE_STATUSES.has(article.status)) {
      throw new EditorialRepositoryError(
        rewriteErrorMessage(article.status),
        409,
        'ILLEGAL_REWRITE_STATUS'
      );
    }
    const category = CATEGORY_SET.has(draft.category) ? draft.category : article.category;
    const suppliedValidation = Array.isArray(metadata.validation) ? metadata.validation : [];
    const split = splitValidation(suppliedValidation);
    const validationErrors = Array.isArray(metadata.validationErrors) ? metadata.validationErrors : split.errors;
    const aiWarnings = Array.isArray(metadata.aiWarnings) ? metadata.aiWarnings : split.warnings;
    const needsReview = draft.rewrite_status === 'needs_review' || validationErrors.length > 0;
    const values = {
      headline: cleanText(draft.headline) || article.original.headline,
      summary: cleanText(draft.summary) || article.original.summary,
      body: cleanBody(draft.content || draft.body) || article.original.body,
      category,
      tags: Array.isArray(draft.tags) ? draft.tags : article.tags
    };
    const version = await this._insertVersion(article, values, 'ai', {
      aiModel: metadata.aiModel,
      promptVersion: metadata.promptVersion,
      aiWarnings,
      validationErrors,
      requiresHumanReview: needsReview,
      changeNote: metadata.changeNote
    }, actor);
    const categoryId = await this._categoryId(category);
    try {
      const updated = await this._patchArticle(article.id, {
        current_version_id: version.id,
        category_id: categoryId,
        ai_status: needsReview ? 'needs_review' : 'ready_for_review',
        workflow_status: 'pending_review',
        rejection_reason: null
      }, article._updatedAtToken || article.updatedAt);
      if (!updated) {
        await this._deleteVersionQuietly(version.id);
        return null;
      }
    } catch (error) {
      await this._deleteVersionQuietly(version.id);
      throw error;
    }
    if (article.status === 'pending_review') {
      await this._insertAction(article.id, 'ai_processed', actor, metadata.changeNote, { version_id: version.id });
    } else {
      await this._decorateTransitionAction(article.id, article.status, 'pending_review', actor, metadata.changeNote);
    }
    if (article.status === 'published') await this._clearTopSlot(article.id);
    return this.getArticle(article.id);
  }

  async createPreviewToken(articleId, tokenHash, expiresAt, actor = 'editor') {
    if (!UUID_PATTERN.test(String(articleId || '')) || !/^[a-f0-9]{64}$/i.test(String(tokenHash || ''))) {
      throw new EditorialRepositoryError('The preview token is invalid.', 422, 'INVALID_PREVIEW_TOKEN');
    }
    const expiry = validIso(expiresAt);
    if (!expiry || Date.parse(expiry) <= Date.now()) {
      throw new EditorialRepositoryError('The preview expiry is invalid.', 422, 'INVALID_PREVIEW_EXPIRY');
    }
    const info = actorInfo(actor);
    await this._request('article_preview_tokens', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        article_id: articleId,
        token_hash: String(tokenHash).toLowerCase(),
        expires_at: expiry,
        max_uses: null,
        ...(info.id ? { created_by: info.id } : {})
      }
    });
    await this._insertAction(articleId, 'preview_created', actor, '', { expires_at: expiry });
    return true;
  }

  async consumePreviewToken(articleId, tokenHash) {
    if (!UUID_PATTERN.test(String(articleId || '')) || !/^[a-f0-9]{64}$/i.test(String(tokenHash || ''))) return false;
    const now = new Date().toISOString();
    const rows = arrayValue(await this._request('article_preview_tokens', {
      params: {
        select: 'id,use_count,max_uses',
        article_id: `eq.${articleId}`,
        token_hash: `eq.${String(tokenHash).toLowerCase()}`,
        revoked_at: 'is.null',
        expires_at: `gt.${now}`,
        limit: 1
      }
    }));
    const token = rows[0];
    if (!token?.id) return false;
    const useCount = Math.max(0, Number(token.use_count) || 0);
    const maxUses = token.max_uses === null || token.max_uses === undefined
      ? null
      : Math.max(0, Number(token.max_uses) || 0);
    if (maxUses !== null && useCount >= maxUses) return false;
    const updated = arrayValue(await this._request('article_preview_tokens', {
      method: 'PATCH',
      params: {
        select: 'id',
        id: `eq.${token.id}`,
        use_count: `eq.${useCount}`,
        revoked_at: 'is.null',
        expires_at: `gt.${now}`
      },
      headers: { Prefer: 'return=representation' },
      body: { use_count: useCount + 1, last_used_at: now }
    }));
    return Boolean(updated[0]?.id);
  }

  async getTopNews() {
    const rows = arrayValue(await this._request('published_top_news', {
      params: { select: '*', order: 'slot_number.asc', limit: 10 }
    }));
    const credits = await this._imageCredits(rows.map(row => row.id));
    return rows.map(row => mapPublishedRow(row, {
      imageCredit: credits.has(row.id) ? credits.get(row.id) : undefined
    }));
  }

  async setTopNews(articleIds, actor = 'editor') {
    const uniqueIds = [...new Set(arrayValue(articleIds).map(value => String(value)))].slice(0, 10);
    if (uniqueIds.some(id => !UUID_PATTERN.test(id))) {
      throw new EditorialRepositoryError('Top News contains an invalid article identifier.', 422, 'INVALID_TOP_NEWS_ARTICLE');
    }
    const operation = async () => {
      if (uniqueIds.length) {
        const rows = arrayValue(await this._request('editorial_article_overview', {
          params: {
            select: 'id,workflow_status,site_published_at',
            id: `in.(${uniqueIds.join(',')})`
          }
        }));
        const eligible = new Set(rows
          .filter(row => row.workflow_status === 'published' && validIso(row.site_published_at))
          .map(row => row.id));
        if (uniqueIds.some(id => !eligible.has(id))) {
          throw new EditorialRepositoryError('Top News can contain published articles only.', 422, 'TOP_NEWS_REQUIRES_PUBLISHED');
        }
      }

      const info = actorInfo(actor);
      await this._request('rpc/replace_home_top_news', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { selected_article_ids: uniqueIds, actor_id: info.id }
      });
      await Promise.all(uniqueIds.map((articleId, index) => this._insertAction(
        articleId,
        'edited',
        actor,
        `Top News slot ${index + 1}`,
        { kind: 'top_news_ranked', slot_number: index + 1 }
      )));
      return this.getTopNews();
    };
    const queued = this._topNewsWrite.then(operation, operation);
    this._topNewsWrite = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async listSources() {
    const [sources, recentArticles] = await Promise.all([
      this._request('news_sources', { params: { select: '*', order: 'name.asc' } }),
      this._request('news_articles', {
        params: {
          select: 'source_ref_id',
          scraped_at: `gte.${colomboDayStartIso()}`,
          limit: 10000
        }
      })
    ]);
    const counts = new Map();
    for (const article of arrayValue(recentArticles)) {
      if (article.source_ref_id) counts.set(article.source_ref_id, (counts.get(article.source_ref_id) || 0) + 1);
    }
    return arrayValue(sources).map(row => {
      // Registry edits are not scrape events. In particular, toggling enabled
      // changes updated_at, so only the pipeline-maintained field may drive
      // last/next collection labels.
      const lastRun = validIso(row.last_scraped_at) || '';
      const interval = Number(row.scrape_interval_minutes) || 60;
      const enabled = Boolean(row.enabled);
      const error = cleanText(row.last_error, 1000);
      const notCollected = enabled && !lastRun;
      return {
        id: String(row.id),
        name: cleanText(row.name) || cleanText(row.domain) || 'Unknown source',
        domain: cleanText(row.domain),
        group: SOURCE_GROUP_LABELS[row.source_group] || 'General News',
        status: !enabled ? 'paused' : error || notCollected ? 'attention' : 'healthy',
        enabled,
        lastRunAt: lastRun,
        nextRunAt: enabled && lastRun
          ? new Date(Date.parse(lastRun) + interval * 60 * 1000).toISOString()
          : '',
        articlesToday: counts.get(row.id) || 0,
        articleCount: counts.get(row.id) || 0,
        successRate: !enabled || error || notCollected ? 0 : 100,
        error: !enabled
          ? 'Paused by administrator.'
          : error || (notCollected ? 'No completed collection recorded yet.' : ''),
        lastError: error,
        scrapeIntervalMinutes: interval,
        adapterKey: cleanText(row.adapter_key),
        feedUrl: cleanText(row.feed_url)
      };
    });
  }

  async updateSource(id, changes = {}) {
    if (!UUID_PATTERN.test(String(id || ''))) return null;
    const rows = arrayValue(await this._request('news_sources', {
      params: { select: '*', id: `eq.${id}`, limit: 1 }
    }));
    if (!rows.length) return null;
    const current = rows[0];
    const patch = {};
    if (typeof changes.enabled === 'boolean') patch.enabled = changes.enabled;
    if (Number.isInteger(changes.scrapeIntervalMinutes)
      && changes.scrapeIntervalMinutes >= 5 && changes.scrapeIntervalMinutes <= 10080) {
      patch.scrape_interval_minutes = changes.scrapeIntervalMinutes;
    }
    if (typeof changes.feedUrl === 'string') patch.feed_url = cleanText(changes.feedUrl, 4000) || null;
    if (typeof changes.adapterKey === 'string') patch.adapter_key = cleanText(changes.adapterKey, 200) || null;
    if (!Object.keys(patch).length) return (await this.listSources()).find(source => source.id === id) || null;
    const updated = arrayValue(await this._request('news_sources', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        updated_at: `eq.${current.updated_at}`,
        select: '*'
      },
      headers: { Prefer: 'return=representation' },
      body: patch
    }));
    if (!updated.length) {
      throw new EditorialRepositoryError(
        'This source was changed by another administrator. Refresh it before saving again.',
        409,
        'OPTIMISTIC_CONCURRENCY_CONFLICT'
      );
    }
    return (await this.listSources()).find(source => source.id === id) || null;
  }

  async _actions(limit, articleId = null) {
    const params = {
      select: 'id,article_id,action,from_status,to_status,note,metadata,performed_by,created_at',
      order: 'created_at.desc',
      limit: Math.min(500, Math.max(1, Number(limit) || 30))
    };
    if (articleId) params.article_id = `eq.${articleId}`;
    return arrayValue(await this._request('editorial_actions', { params }));
  }

  async _profileNames(actorIds) {
    const ids = [...new Set(actorIds.filter(id => UUID_PATTERN.test(String(id))))];
    if (!ids.length) return new Map();
    const rows = [];
    for (const group of chunk(ids)) {
      const result = await this._optionalRequest('admin_profiles', {
        params: {
          select: 'user_id,display_name',
          user_id: `in.(${group.join(',')})`
        }
      });
      rows.push(...arrayValue(result));
    }
    return new Map(rows.map(row => [row.user_id, cleanText(row.display_name)]));
  }

  async _mappedEvents(rows) {
    const profiles = await this._profileNames(rows.map(row => row.performed_by));
    return rows.map(row => ({
      id: String(row.id),
      articleId: String(row.article_id),
      action: mappedEventAction(row.action),
      rawAction: row.action,
      label: cleanText(row.metadata?.label, 200) || eventLabel(row.action),
      actor: cleanText(row.metadata?.actor, 200)
        || profiles.get(row.performed_by)
        || 'Newsroom',
      createdAt: validIso(row.created_at) || new Date(0).toISOString(),
      note: cleanBody(row.note, 4000),
      fromStatus: row.from_status || null,
      toStatus: row.to_status || null,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    }));
  }

  async _articleAudit(articleId) {
    const events = await this._mappedEvents(await this._actions(200, articleId));
    return events.map(event => ({
      action: event.rawAction,
      at: event.createdAt,
      by: event.actor,
      note: event.note,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus
    }));
  }

  async listEvents(limit = 30) {
    return this._mappedEvents(await this._actions(limit));
  }
}

module.exports = {
  EditorialRepositoryError,
  SupabaseEditorialStore,
  SupabaseStore: SupabaseEditorialStore
};
