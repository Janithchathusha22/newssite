'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { EditorialStore, CATEGORIES, publicArticle } = require('./store');
const { SupabaseEditorialStore, EditorialRepositoryError } = require('./supabase_store');
const {
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  REWRITABLE_STATUSES,
  rewriteErrorMessage
} = require('./workflow');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PREVIEW_TTL_MS = 30 * 60 * 1000;

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyConfiguredPassword(received, plaintext, encodedHash) {
  const value = String(encodedHash || '').trim();
  if (!value) return safeEqual(received, plaintext);
  const [scheme, saltHex, digestHex, extra] = value.split('$');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32,128}$/i.test(saltHex || '')
    || !/^[a-f0-9]{64,256}$/i.test(digestHex || '') || extra) return false;
  try {
    const expected = Buffer.from(digestHex, 'hex');
    const actual = crypto.scryptSync(String(received || ''), Buffer.from(saltHex, 'hex'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function signPayload(payload, secret) {
  const encoded = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPayload(token, secret, expectedType) {
  try {
    const [encoded, signature, extra] = String(token || '').split('.');
    if (!encoded || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    if (!safeEqual(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.type !== expectedType || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function bearerToken(req) {
  const authorization = String(req.get('authorization') || '');
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function createAdminUser(email) {
  return {
    id: `local-${crypto.createHash('sha1').update(email).digest('hex').slice(0, 12)}`,
    name: process.env.ADMIN_DISPLAY_NAME || 'Newsroom Editor',
    email,
    role: 'admin',
    avatar: ''
  };
}

function articleMissing(res, id) {
  return res.status(404).json({ error: `Article ${id} was not found` });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createEditorialRouter({ express, projectDir, runNewsPipeline, publicSyncState }) {
  const router = express.Router();
  const localStore = new EditorialStore({
    statePath: process.env.EDITORIAL_STATE_PATH || undefined,
    persist: process.env.EDITORIAL_STORE_PERSIST !== 'false'
  });
  const supabaseStore = new SupabaseEditorialStore();
  const requestedBackend = String(
    process.env.EDITORIAL_BACKEND || (process.env.NODE_ENV === 'production' ? 'supabase' : 'auto')
  ).trim().toLowerCase();
  if (!['auto', 'local', 'supabase'].includes(requestedBackend)) {
    throw new Error('EDITORIAL_BACKEND must be auto, local, or supabase');
  }
  let storePromise;
  async function resolveStore() {
    if (requestedBackend === 'local') return localStore;
    if (!storePromise) {
      storePromise = supabaseStore.available().then(available => {
        if (available) {
          console.log('[editorial] Using Supabase as the editorial source of truth.');
          return supabaseStore;
        }
        if (requestedBackend === 'supabase' || process.env.NODE_ENV === 'production') {
          throw new EditorialRepositoryError(
            'Supabase editorial storage is required but unavailable. Apply the migration and verify the server secret.',
            503,
            'SUPABASE_REQUIRED'
          );
        }
        console.warn('[editorial] Supabase workflow schema is unavailable; using the labelled local demo store.');
        return localStore;
      });
    }
    return storePromise;
  }
  const configuredSessionSecret = String(process.env.ADMIN_SESSION_SECRET || '').trim();
  const configuredPreviewSecret = String(process.env.PREVIEW_TOKEN_SECRET || '').trim();
  const sessionSecret = configuredSessionSecret || crypto.randomBytes(32).toString('hex');
  const previewSecret = configuredPreviewSecret || sessionSecret;
  const adminEmail = String(process.env.ADMIN_EMAIL || 'editor@ceylonledger.local').trim().toLowerCase();
  const adminPassword = String(process.env.ADMIN_PASSWORD || 'editor-demo-2026');
  const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
  const developmentLoginEnabled = process.env.NODE_ENV !== 'production'
    || Boolean(process.env.ADMIN_EMAIL && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD));

  if (!configuredSessionSecret) {
    console.warn('[editorial] ADMIN_SESSION_SECRET is not configured; sessions reset when the server restarts.');
  }

  function requireAdmin(req, res, next) {
    const payload = verifyPayload(bearerToken(req), sessionSecret, 'admin');
    if (!payload) return res.status(401).json({ error: 'A valid admin session is required' });
    req.admin = payload.user;
    return next();
  }

  router.post('/admin/login', asyncRoute(async (req, res) => {
    if (!developmentLoginEnabled) return res.status(503).json({ error: 'Admin login is not configured' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!safeEqual(email, adminEmail)
      || !verifyConfiguredPassword(password, adminPassword, adminPasswordHash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Do not issue a session that looks live when the configured editorial
    // repository is unavailable. In Supabase mode this gives the operator a
    // clear migration/configuration error at sign-in instead of opening an
    // empty or browser-only workspace.
    await resolveStore();

    const user = createAdminUser(email);
    const expiresAtMs = Date.now() + SESSION_TTL_MS;
    const token = signPayload({ type: 'admin', user, exp: expiresAtMs }, sessionSecret);
    // `demo` describes the browser-only demo session, not whether development
    // credentials or the local API repository are in use. A successful API
    // authentication is always a real bearer session.
    return res.json({ token, user, demo: false, expiresAt: new Date(expiresAtMs).toISOString() });
  }));

  router.get('/admin/articles', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const articles = await store.listArticles({
      status: req.query.status,
      category: req.query.category,
      search: req.query.search
    });
    return res.json({ articles, total: articles.length });
  }));

  router.get('/admin/articles/:id', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const article = await store.getArticle(req.params.id);
    return article ? res.json({ article }) : articleMissing(res, req.params.id);
  }));

  router.patch('/admin/articles/:id', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const article = await store.updateArticle(req.params.id, req.body || {}, req.admin);
    return article ? res.json({ article }) : articleMissing(res, req.params.id);
  }));

  router.post('/admin/articles/:id/approve', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const existing = await store.getArticle(req.params.id);
    if (!existing) return articleMissing(res, req.params.id);

    // Approval is the newsroom's publication decision. Keep the explicit
    // `approved` transition for its audit/approval metadata, then immediately
    // create the immutable published snapshot consumed by the public routes.
    // Accepting an already-approved row also makes a retry recover safely if
    // the first request was interrupted between the two persistence writes.
    if (existing.status === 'approved') {
      return res.json({ article: await store.transition(existing.id, 'published', req.admin) });
    }
    if (!APPROVABLE_STATUSES.has(existing.status)) {
      return res.status(409).json({
        error: `Only pending-review or changes-requested articles can be approved; this article is ${existing.status}.`
      });
    }
    if (!existing.sourceUrl || existing.validation.some(item => item.severity === 'error')) {
      return res.status(422).json({
        error: 'Resolve factual/source validation errors before approval',
        validation: existing.validation
      });
    }
    const approved = await store.transition(existing.id, 'approved', req.admin);
    if (!approved) return articleMissing(res, req.params.id);
    return res.json({ article: await store.transition(approved.id, 'published', req.admin) });
  }));

  router.post('/admin/articles/:id/publish', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const existing = await store.getArticle(req.params.id);
    if (!existing) return articleMissing(res, req.params.id);
    if (existing.status !== 'approved') {
      return res.status(409).json({ error: 'The article must be approved before it can be published' });
    }
    return res.json({ article: await store.transition(existing.id, 'published', req.admin) });
  }));

  router.post('/admin/articles/:id/reject', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const existing = await store.getArticle(req.params.id);
    if (!existing) return articleMissing(res, req.params.id);
    if (!REJECTABLE_STATUSES.has(existing.status)) {
      return res.status(409).json({ error: `An article in ${existing.status} status cannot be rejected.` });
    }
    return res.json({
      article: await store.transition(existing.id, 'rejected', req.admin, req.body?.reason)
    });
  }));

  router.post('/admin/articles/:id/preview-token', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const article = await store.getArticle(req.params.id);
    if (!article) return articleMissing(res, req.params.id);
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
    const token = signPayload({ type: 'preview', articleId: article.id, exp: Date.parse(expiresAt) }, previewSecret);
    if (typeof store.createPreviewToken === 'function') {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await store.createPreviewToken(article.id, tokenHash, expiresAt, req.admin);
    }
    const publicBase = String(process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '');
    return res.json({ token, url: `${publicBase}/preview/${token}`, expiresAt });
  }));

  router.post('/admin/articles/:id/rewrite', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const article = await store.getArticle(req.params.id);
    if (!article) return articleMissing(res, req.params.id);
    if (!REWRITABLE_STATUSES.has(article.status)) {
      return res.status(409).json({ error: rewriteErrorMessage(article.status) });
    }
    if (!article.original.body) {
      return res.status(422).json({ error: 'A complete source article is required before AI rewriting' });
    }
    const pythonCommand = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
    const scriptPath = path.join(__dirname, 'rewrite_article_cli.py');
    const child = spawn(pythonCommand, [scriptPath], {
      cwd: projectDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => res.status(502).json({ error: `Could not start AI worker: ${error.message}` }));
    child.on('close', async code => {
      if (res.headersSent) return;
      try {
        if (code !== 0) throw new Error(stderr.trim() || `AI worker exited with code ${code}`);
        const result = JSON.parse(stdout.replace(/^\uFEFF/, ''));
        const validation = [
          ...(result.validation_errors || []).map((message, index) => ({
            id: `${article.id}-rewrite-error-${index}`, severity: 'error', label: 'Fact check', message
          })),
          ...(result.ai_warnings || []).map((message, index) => ({
            id: `${article.id}-rewrite-warning-${index}`, severity: 'warning', label: 'AI review', message
          }))
        ];
        const updated = await store.replaceDraft(article.id, {
          headline: result.editorial_headline || result.headline_en,
          summary: result.editorial_summary || result.summary_en,
          content: result.editorial_content,
          category: result.category,
          tags: result.tags,
          rewrite_status: result.rewrite_status
        }, {
          aiModel: result.ai_model,
          promptVersion: result.prompt_version,
          validation
        }, req.admin);
        return res.json({ article: updated });
      } catch (error) {
        return res.status(error.statusCode || 502).json({
          error: error.statusCode ? error.message : 'AI rewrite failed',
          detail: error.message.slice(0, 500)
        });
      }
    });
    child.stdin.end(JSON.stringify({
      id: article.id,
      title: article.original.headline,
      summary: article.original.summary,
      content: article.original.body,
      category: article.category,
      source: article.sourceName,
      url: article.sourceUrl,
      published_at: article.sourcePublishedAt,
      source_image_checked: true
    }));
  }));

  router.get('/admin/top-news', requireAdmin, asyncRoute(async (_req, res) => {
    const store = await resolveStore();
    return res.json({ articles: await store.getTopNews() });
  }));
  router.put('/admin/top-news', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    return res.json({ articles: await store.setTopNews(req.body?.articleIds, req.admin) });
  }));

  router.get('/admin/sources', requireAdmin, asyncRoute(async (_req, res) => {
    const store = await resolveStore();
    return res.json({ sources: await store.listSources() });
  }));
  router.patch('/admin/sources/:id', requireAdmin, asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const source = await store.updateSource(req.params.id, req.body || {});
    return source ? res.json({ source }) : res.status(404).json({ error: 'Source was not found' });
  }));

  router.get('/admin/events', requireAdmin, asyncRoute(async (_req, res) => {
    const store = await resolveStore();
    return res.json({ events: await store.listEvents() });
  }));

  router.post('/admin/scraper/run', requireAdmin, asyncRoute(async (_req, res) => {
    const started = await runNewsPipeline('admin-dashboard');
    return res.status(started ? 202 : 409).json({ started, state: publicSyncState() });
  }));
  router.get('/admin/scraper/status', requireAdmin, (_req, res) => res.json(publicSyncState()));

  // Publication changes should be visible on the next public refresh without
  // a browser or intermediary reusing a stale API response.
  router.use('/public', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/public/categories', (_req, res) => res.json({ categories: CATEGORIES }));
  router.get('/public/home', asyncRoute(async (_req, res) => {
    const store = await resolveStore();
    const [published, topNews] = await Promise.all([
      store.listArticles({ status: 'published' }),
      store.getTopNews()
    ]);
    const topIds = new Set(topNews.map(article => article.id));
    const fallbackTop = published.filter(article => !topIds.has(article.id));
    const finalTop = [...topNews, ...fallbackTop].slice(0, 10).map(publicArticle);
    const sections = Object.fromEntries(CATEGORIES.map(category => [
      category.slug,
      published.filter(article => article.category === category.slug).slice(0, 6).map(publicArticle)
    ]));
    return res.json({
      topNews: finalTop,
      latest: published.slice(0, 18).map(publicArticle),
      sections,
      categories: CATEGORIES,
      demo: Boolean(store.state?.demo || store.isDemo)
    });
  }));

  router.get('/public/top-news', asyncRoute(async (req, res) => {
    const store = await resolveStore();
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.min(10, Math.max(1, requested)) : 10;
    const [published, topNews] = await Promise.all([
      store.listArticles({ status: 'published' }),
      store.getTopNews()
    ]);
    const rankedIds = new Set(topNews.map(article => article.id));
    const articles = [...topNews, ...published.filter(article => !rankedIds.has(article.id))]
      .slice(0, limit)
      .map(publicArticle);
    return res.json({ articles, demo: Boolean(store.state?.demo || store.isDemo) });
  }));

  router.get('/public/categories/:slug', asyncRoute(async (req, res) => {
    if (!CATEGORIES.some(category => category.slug === req.params.slug)) {
      return res.status(404).json({ error: 'Category was not found' });
    }
    const store = await resolveStore();
    const articles = (await store.listArticles({ status: 'published', category: req.params.slug })).map(publicArticle);
    return res.json({
      category: CATEGORIES.find(item => item.slug === req.params.slug),
      articles,
      demo: Boolean(store.state?.demo || store.isDemo)
    });
  }));

  router.get('/public/articles/:slug', asyncRoute(async (req, res) => {
    const store = await resolveStore();
    // Resolve public detail through the immutable published projection. The
    // editorial overview can contain a newer draft than the approved version.
    const published = await store.listArticles({ status: 'published' });
    const article = published.find(item => item.slug === req.params.slug || item.id === req.params.slug);
    if (!article) return articleMissing(res, req.params.slug);
    const related = published
      .filter(item => item.category === article.category)
      .filter(item => item.id !== article.id).slice(0, 4).map(publicArticle);
    return res.json({
      article: publicArticle(article),
      related,
      demo: Boolean(store.state?.demo || store.isDemo)
    });
  }));

  router.get('/preview/:token', asyncRoute(async (req, res) => {
    const payload = verifyPayload(req.params.token, previewSecret, 'preview');
    if (!payload) return res.status(401).json({ error: 'Preview link is invalid or expired' });
    const store = await resolveStore();
    if (typeof store.consumePreviewToken === 'function') {
      const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
      if (!await store.consumePreviewToken(payload.articleId, tokenHash)) {
        return res.status(401).json({ error: 'Preview link is invalid, expired or revoked' });
      }
    }
    const article = await store.getArticle(payload.articleId);
    if (!article) return articleMissing(res, payload.articleId);
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return res.json({ article: publicArticle(article, { preview: true }) });
  }));

  router.use((error, _req, res, _next) => {
    console.error('[editorial]', error.message);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Editorial API failed' });
  });

  return { router, store: localStore, resolveStore };
}

module.exports = { createEditorialRouter, signPayload, verifyPayload };
