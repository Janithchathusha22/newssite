'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SupabaseEditorialStore } = require('./editorial/supabase_store');
const {
  normalizeArticleImageUrl,
  normalizePublisherImageUrl
} = require('./editorial/images');

test('article image normalization binds remote assets to their publisher', () => {
  assert.equal(
    normalizePublisherImageUrl(
      'https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn/story.jpg',
      'https://www.ft.lk/front-page/example/44-123'
    ),
    'https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn/story.jpg'
  );
  assert.equal(
    normalizePublisherImageUrl(
      'https://images.unsplash.com/photo-123.jpg',
      'https://economynext.com/example-story-123'
    ),
    ''
  );
  assert.equal(
    normalizePublisherImageUrl(
      'https://economynext.com/wp-content/uploads/wrong.jpg',
      'https://www.dailymirror.lk/news/example/123-456'
    ),
    ''
  );
  assert.equal(
    normalizeArticleImageUrl(
      'assets/news_images/abc123.jpg',
      'https://economynext.com/example-story-123'
    ),
    '/assets/news_images/abc123.jpg'
  );
  assert.match(
    normalizePublisherImageUrl(
      'https://firebasestorage.googleapis.com/v0/b/the-morning-39270.appspot.com/o/articles%2Fstory.jpg?alt=media',
      'https://www.themorning.lk/articles/example-story'
    ),
    /^https:\/\/firebasestorage\.googleapis\.com\//
  );
  assert.equal(
    normalizeArticleImageUrl('../credentials.json', 'https://economynext.com/example-story-123'),
    ''
  );
});

test('Supabase article mapping preserves the exact database timestamp for writes', async () => {
  const store = new SupabaseEditorialStore();
  const rawTimestamp = '2026-08-13T08:15:30.123456+00:00';
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'safe-draft',
    workflow_status: 'pending_review',
    ai_status: 'needs_review',
    category_slug: 'money',
    source_name: 'Publisher',
    source_url: 'https://example.com/safe-draft',
    original_title: 'Source headline',
    original_summary: 'Source summary',
    original_content: 'Source content',
    current_headline: 'Draft headline',
    current_summary: 'Draft summary',
    current_content: 'Draft content',
    current_tags: ['Finance'],
    ai_warnings: ['Human review is required.'],
    validation_errors: [],
    current_version_id: null,
    updated_at: rawTimestamp,
    scraped_at: rawTimestamp,
  };

  store._request = async (resource) => resource === 'editorial_article_overview' ? [row] : [];
  const [article] = await store.listArticles({ status: 'pending_review' });

  assert.equal(article.updatedAt, '2026-08-13T08:15:30.123Z');
  assert.equal(article._updatedAtToken, rawTimestamp);
  assert.equal(article.validation[0].message, 'Human review is required.');
  assert.equal(JSON.stringify(article).includes('_updatedAtToken'), false);

  let patchParams;
  store._request = async (resource, options) => {
    if (resource === 'news_articles' && options.method === 'PATCH') {
      patchParams = options.params;
      return [{ id: row.id, updated_at: rawTimestamp }];
    }
    return [];
  };
  await store._patchArticle(row.id, { workflow_status: 'approved' }, article._updatedAtToken);
  assert.equal(patchParams.updated_at, `eq.${rawTimestamp}`);
});

test('admin article listing excludes URL-less legacy rows without breaking filters or images', async () => {
  const store = new SupabaseEditorialStore();
  const timestamp = '2026-08-13T10:00:00Z';
  const row = (id, values = {}) => ({
    id,
    slug: `story-${id.slice(0, 4)}`,
    workflow_status: 'pending_review',
    ai_status: 'ready_for_review',
    category_slug: 'money',
    source_name: 'Daily Mirror',
    source_url: null,
    canonical_url: null,
    original_title: 'Sri Lanka business story',
    original_summary: 'Source summary',
    original_content: 'Source content',
    current_headline: 'Sri Lanka business story',
    current_summary: 'Draft summary',
    current_content: 'Draft content',
    current_tags: ['Finance'],
    ai_warnings: [],
    validation_errors: [],
    current_version_id: null,
    updated_at: timestamp,
    scraped_at: timestamp,
    ...values
  });
  const canonicalOnlyId = '11111111-1111-4111-8111-111111111111';
  const sourceOnlyId = '22222222-2222-4222-8222-222222222222';
  let overviewParams;

  store._request = async (resource, options = {}) => {
    if (resource !== 'editorial_article_overview') return [];
    overviewParams = options.params;
    return [
      row('33333333-3333-4333-8333-333333333333'),
      row('44444444-4444-4444-8444-444444444444', { canonical_url: ' ', source_url: '' }),
      row(canonicalOnlyId, {
        canonical_url: 'https://www.dailymirror.lk/business-news/story/273-123',
        image_url: 'https://www.dailymirror.lk/images/story.jpg'
      }),
      row(sourceOnlyId, {
        source_name: 'EconomyNext',
        source_url: 'https://economynext.com/sri-lanka-business-story-123',
        image_url: 'https://economynext.com/wp-content/uploads/story.jpg'
      })
    ];
  };

  const articles = await store.listArticles({
    status: 'pending_review',
    category: 'money',
    search: 'Sri Lanka'
  });

  assert.equal(overviewParams['not.and'], '(canonical_url.is.null,source_url.is.null)');
  assert.equal(overviewParams.workflow_status, 'eq.pending_review');
  assert.equal(overviewParams.category_slug, 'eq.money');
  assert.match(overviewParams.or, /original_title\.ilike\.\*Sri Lanka\*/);
  assert.deepEqual(articles.map(article => article.id), [canonicalOnlyId, sourceOnlyId]);
  assert.equal(articles[0].sourceUrl, 'https://www.dailymirror.lk/business-news/story/273-123');
  assert.equal(articles[0].imageUrl, 'https://www.dailymirror.lk/images/story.jpg');
  assert.equal(articles[1].sourceUrl, 'https://economynext.com/sri-lanka-business-story-123');
  assert.equal(articles[1].imageUrl, 'https://economynext.com/wp-content/uploads/story.jpg');
});

test('source health uses scrape timestamps, never registry edit timestamps', async () => {
  const store = new SupabaseEditorialStore();
  store._request = async (resource) => {
    if (resource === 'news_sources') {
      return [{
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Publisher',
        domain: 'publisher.example',
        source_group: 'general_news',
        enabled: true,
        scrape_interval_minutes: 60,
        last_scraped_at: null,
        last_success_at: null,
        last_error: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-13T08:15:00Z'
      }];
    }
    return [];
  };

  const [neverCollected] = await store.listSources();
  assert.equal(neverCollected.lastRunAt, '');
  assert.equal(neverCollected.nextRunAt, '');
  assert.equal(neverCollected.status, 'attention');
  assert.equal(neverCollected.successRate, 0);
  assert.match(neverCollected.error, /no completed collection/i);

  store._request = async (resource) => resource === 'news_sources' ? [{
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Publisher',
    domain: 'publisher.example',
    source_group: 'general_news',
    enabled: true,
    scrape_interval_minutes: 60,
    last_scraped_at: '2026-08-13T09:00:00Z',
    last_success_at: '2026-08-13T09:00:00Z',
    last_error: null,
    updated_at: '2026-08-13T10:30:00Z'
  }] : [];
  const [collected] = await store.listSources();
  assert.equal(collected.lastRunAt, '2026-08-13T09:00:00.000Z');
  assert.equal(collected.nextRunAt, '2026-08-13T10:00:00.000Z');
  assert.equal(collected.status, 'healthy');
});

function workflowArticle(status) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    status,
    category: 'money',
    sourceUrl: 'https://example.com/story',
    original: { headline: 'Source headline', summary: 'Source summary', body: 'Source body' },
    draft: { headline: 'Draft headline', summary: 'Draft summary', body: 'Draft body' },
    tags: ['Finance'],
    validation: [],
    currentVersionId: '22222222-2222-4222-8222-222222222222',
    aiStatus: 'ready_for_review',
    aiModel: 'test-model',
    promptVersion: 'test-prompt',
    editorNote: '',
    rejectionReason: status === 'rejected' ? 'Old rejection' : '',
    imageUrl: '',
    imageCredit: '',
    publishedAt: status === 'published' ? '2026-08-13T08:00:00.000Z' : null,
    scheduledFor: status === 'scheduled' ? '2026-08-14T08:00:00.000Z' : null,
    updatedAt: '2026-08-13T08:15:30.123Z',
    _updatedAtToken: '2026-08-13T08:15:30.123456+00:00'
  };
}

test('Supabase workflow rejects unsafe transitions before writing', async () => {
  const store = new SupabaseEditorialStore();
  let writes = 0;
  store._findArticle = async () => workflowArticle('published');
  store._patchArticle = async () => { writes += 1; };

  await assert.rejects(
    store.transition('11111111-1111-4111-8111-111111111111', 'approved'),
    error => error.statusCode === 409 && error.code === 'ILLEGAL_WORKFLOW_TRANSITION'
  );
  await assert.rejects(
    store.transition('11111111-1111-4111-8111-111111111111', 'rejected'),
    error => error.statusCode === 409 && error.code === 'ILLEGAL_WORKFLOW_TRANSITION'
  );
  await assert.rejects(
    store.replaceDraft('11111111-1111-4111-8111-111111111111', { headline: 'Unsafe rewrite' }),
    error => error.statusCode === 409 && error.code === 'ILLEGAL_REWRITE_STATUS'
  );
  assert.equal(writes, 0, 'illegal workflow actions must not reach PostgREST');
});

test('Supabase publication and material-edit reopen paths remain legal', async () => {
  const store = new SupabaseEditorialStore();
  const approved = workflowArticle('approved');
  let transitionPatch;
  store._findArticle = async () => approved;
  store._patchArticle = async (_id, patch) => {
    transitionPatch = patch;
    return { id: approved.id };
  };
  store._decorateTransitionAction = async () => {};
  store._clearTopSlot = async () => {};
  store.getArticle = async () => ({ ...approved, status: 'published' });

  const published = await store.transition(approved.id, 'published', 'test-editor');
  assert.equal(published.status, 'published');
  assert.equal(transitionPatch.workflow_status, 'published');
  assert.equal(transitionPatch.published_version_id, approved.currentVersionId);

  const live = workflowArticle('published');
  let editPatch;
  store._findArticle = async () => live;
  store._insertVersion = async () => ({ id: '33333333-3333-4333-8333-333333333333' });
  store._categoryId = async () => '44444444-4444-4444-8444-444444444444';
  store._patchArticle = async (_id, patch) => {
    editPatch = patch;
    return { id: live.id };
  };
  store._insertAction = async () => {};
  store._decorateTransitionAction = async () => {};
  store._clearTopSlot = async () => {};
  store.getArticle = async () => ({ ...live, status: 'changes_requested' });

  const reopened = await store.updateArticle(live.id, {
    draft: { headline: 'Corrected live headline' }
  }, 'test-editor');
  assert.equal(reopened.status, 'changes_requested');
  assert.equal(editPatch.workflow_status, 'changes_requested');
  assert.equal(editPatch.current_version_id, '33333333-3333-4333-8333-333333333333');
});

test('Top News replacement uses one transactional database RPC', async () => {
  const store = new SupabaseEditorialStore();
  const articleId = '22222222-2222-4222-8222-222222222222';
  const mutations = [];
  store._request = async (resource, options = {}) => {
    if (resource === 'editorial_article_overview') {
      return [{ id: articleId, workflow_status: 'published', site_published_at: '2026-08-13T08:00:00Z' }];
    }
    if (options.method && options.method !== 'GET') mutations.push({ resource, options });
    return [];
  };

  await store.setTopNews([articleId], 'editor@example.com');

  const rankingWrites = mutations.filter((entry) => entry.resource === 'rpc/replace_home_top_news');
  assert.equal(rankingWrites.length, 1);
  assert.deepEqual(rankingWrites[0].options.body, {
    selected_article_ids: [articleId],
    actor_id: null,
  });
  assert.equal(mutations.some((entry) => entry.resource === 'home_top_news_slots'), false);
});

test('preview tokens are stored as hashes and consumed with a guarded counter', async () => {
  const store = new SupabaseEditorialStore();
  const articleId = '33333333-3333-4333-8333-333333333333';
  const tokenId = '44444444-4444-4444-8444-444444444444';
  const tokenHash = 'a'.repeat(64);
  const writes = [];
  store._request = async (resource, options = {}) => {
    if (options.method && options.method !== 'GET') writes.push({ resource, options });
    if (resource === 'article_preview_tokens' && !options.method) {
      return [{ id: tokenId, use_count: 0, max_uses: null }];
    }
    if (resource === 'article_preview_tokens' && options.method === 'PATCH') return [{ id: tokenId }];
    return [];
  };

  const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await store.createPreviewToken(articleId, tokenHash, futureExpiry, 'editor@example.com');
  assert.equal(writes[0].resource, 'article_preview_tokens');
  assert.equal(writes[0].options.body.token_hash, tokenHash);
  assert.equal(Object.hasOwn(writes[0].options.body, 'created_by'), false);

  assert.equal(await store.consumePreviewToken(articleId, tokenHash), true);
  const counterWrite = writes.find((entry) => entry.resource === 'article_preview_tokens' && entry.options.method === 'PATCH');
  assert.equal(counterWrite.options.params.use_count, 'eq.0');
  assert.equal(counterWrite.options.body.use_count, 1);
});
