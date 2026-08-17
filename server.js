const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { createEditorialRouter } = require('./editorial/api');
const {
  normalizePublisherImageUrl,
  parsePublisherUrl,
  publisherSuffix
} = require('./editorial/images');

const app = express();
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const developmentOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
];
app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || process.env.NODE_ENV !== 'production'
      || allowedOrigins.includes(origin) || developmentOrigins.includes(origin)) {
      return callback(null, true);
    }
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app') || hostname === 'vercel.app') {
        return callback(null, true);
      }
    } catch (_) {}
    return callback(new Error('Origin is not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

// The repository still contains the previous direct-feed prototype. Keep it
// available for local comparison, but never expose raw scraper data from a
// production API unless an operator opts in explicitly.
const legacyPublicApiEnabled = process.env.NODE_ENV !== 'production'
  || envBoolean('LEGACY_PUBLIC_API_ENABLED', false);

function requireLegacyPublicApi(_req, res, next) {
  if (!legacyPublicApiEnabled) return res.status(404).json({ error: 'Not found' });
  return next();
}

function envMinutes(name, fallback, minimum = 1) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

const syncConfig = {
  intervalMinutes: envMinutes('AUTO_SYNC_INTERVAL_MINUTES', 60, 5),
  retryMinutes: envMinutes('AUTO_SYNC_RETRY_MINUTES', 15, 1),
  maxRuntimeMinutes: envMinutes('AUTO_SYNC_MAX_RUNTIME_MINUTES', 120, 5),
  freshnessHours: envMinutes('SYNC_FRESHNESS_HOURS', 26, 1),
  runOnStart: envBoolean('AUTO_SYNC_RUN_ON_START', true)
};

const syncStatePath = path.join(__dirname, '.sync-state.json');

function loadPersistedSyncState() {
  try {
    const saved = JSON.parse(fs.readFileSync(syncStatePath, 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (_) {
    return {};
  }
}

const persistedSyncState = loadPersistedSyncState();

const autoSyncState = {
  enabled: envBoolean('AUTO_SYNC_ENABLED', true),
  running: false,
  lastTrigger: persistedSyncState.lastTrigger || null,
  lastStartedAt: persistedSyncState.lastStartedAt || null,
  lastFinishedAt: persistedSyncState.lastFinishedAt || null,
  lastSucceededAt: persistedSyncState.lastSucceededAt || null,
  lastExitCode: persistedSyncState.lastExitCode ?? null,
  lastError: persistedSyncState.lastError || '',
  consecutiveFailures: Number(persistedSyncState.consecutiveFailures || 0),
  nextRunAt: null,
  recentOutput: []
};

let autoSyncTimer = null;
let feedSummaryCache = null;
let editorialReadinessProbe = null;

function persistSyncState() {
  const safeState = {
    lastTrigger: autoSyncState.lastTrigger,
    lastStartedAt: autoSyncState.lastStartedAt,
    lastFinishedAt: autoSyncState.lastFinishedAt,
    lastSucceededAt: autoSyncState.lastSucceededAt,
    lastExitCode: autoSyncState.lastExitCode,
    lastError: autoSyncState.lastError,
    consecutiveFailures: autoSyncState.consecutiveFailures
  };
  const temporaryPath = `${syncStatePath}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(safeState, null, 2), 'utf8');
    fs.renameSync(temporaryPath, syncStatePath);
  } catch (error) {
    console.error(`[sync] Could not persist scheduler state: ${error.message}`);
    try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
  }
}

function appendSyncOutput(chunk, stream = 'stdout') {
  const prefix = stream === 'stderr' ? '[stderr] ' : '';
  const lines = String(chunk).replace(/\r/g, '').split('\n').filter(Boolean);
  autoSyncState.recentOutput.push(...lines.map(line => `${prefix}${line}`));
  autoSyncState.recentOutput = autoSyncState.recentOutput.slice(-80);
}

function getFeedSummary() {
  const feedPath = path.join(__dirname, 'news_feed.json');
  try {
    const stats = fs.statSync(feedPath);
    if (feedSummaryCache?.mtimeMs === stats.mtimeMs) return feedSummaryCache.value;
    const articles = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
    const timestamps = Array.isArray(articles)
      ? articles.flatMap(article => [
          article?.published_at,
          article?.published_date,
          article?.date,
          article?.scraped_at
        ]).filter(value => Number.isFinite(Date.parse(value)))
      : [];
    const latestTimestamp = timestamps.length
      ? new Date(Math.max(...timestamps.map(value => Date.parse(value)))).toISOString()
      : null;
    const generatedAt = stats.mtime.toISOString();
    const value = {
      exists: true,
      articleCount: Array.isArray(articles) ? articles.length : 0,
      generatedAt,
      latestArticleAt: latestTimestamp,
      stale: Date.now() - stats.mtimeMs > syncConfig.freshnessHours * 60 * 60 * 1000
    };
    feedSummaryCache = { mtimeMs: stats.mtimeMs, value };
    return value;
  } catch (error) {
    return {
      exists: false,
      articleCount: 0,
      generatedAt: null,
      latestArticleAt: null,
      stale: true,
      error: error.message
    };
  }
}

function publicSyncState() {
  return {
    ...autoSyncState,
    config: syncConfig,
    feed: getFeedSummary(),
    serverTime: new Date().toISOString()
  };
}

function scheduleNextSync(delayMinutes) {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  if (!autoSyncState.enabled) {
    autoSyncState.nextRunAt = null;
    return;
  }
  const delayMs = delayMinutes * 60 * 1000;
  autoSyncState.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  autoSyncTimer = setTimeout(() => { void requestNewsPipeline('scheduled'); }, delayMs);
  autoSyncTimer.unref();
}

async function requestNewsPipeline(trigger = 'scheduled') {
  if (!autoSyncState.enabled || autoSyncState.running) return false;
  if (editorialReadinessProbe) {
    try {
      await editorialReadinessProbe();
    } catch (_) {
      const finishedAt = new Date().toISOString();
      autoSyncState.lastTrigger = trigger;
      autoSyncState.lastFinishedAt = finishedAt;
      autoSyncState.lastExitCode = -1;
      autoSyncState.lastError = 'The Supabase editorial workflow is not ready; collection was not started.';
      autoSyncState.consecutiveFailures += 1;
      persistSyncState();
      scheduleNextSync(syncConfig.retryMinutes);
      console.error(`[sync] ${autoSyncState.lastError}`);
      return false;
    }
  }
  return runNewsPipeline(trigger);
}

function runNewsPipeline(trigger = 'scheduled') {
  if (!autoSyncState.enabled || autoSyncState.running) return false;

  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }

  const pythonCommand = process.env.PYTHON_EXECUTABLE
    || (process.platform === 'win32' ? 'python' : 'python3');
  autoSyncState.running = true;
  autoSyncState.lastTrigger = trigger;
  autoSyncState.lastStartedAt = new Date().toISOString();
  autoSyncState.lastError = '';
  autoSyncState.nextRunAt = null;
  autoSyncState.recentOutput = [];
  console.log(`[sync] Starting ${trigger} publisher refresh...`);

  let child;
  try {
    child = spawn(pythonCommand, ['daily_runner.py'], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      shell: false,
      windowsHide: true
    });
  } catch (error) {
    autoSyncState.running = false;
    autoSyncState.lastFinishedAt = new Date().toISOString();
    autoSyncState.lastError = error.message;
    autoSyncState.lastExitCode = -1;
    autoSyncState.consecutiveFailures += 1;
    persistSyncState();
    scheduleNextSync(syncConfig.retryMinutes);
    console.error(`[sync] Could not start Python: ${error.message}`);
    return false;
  }

  const runtimeTimer = setTimeout(() => {
    autoSyncState.lastError = `Pipeline exceeded ${syncConfig.maxRuntimeMinutes} minute runtime limit`;
    console.error(`[sync] ${autoSyncState.lastError}; terminating process.`);
    child.kill('SIGTERM');
    const forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
    forceKillTimer.unref();
  }, syncConfig.maxRuntimeMinutes * 60 * 1000);
  runtimeTimer.unref();

  child.stdout.on('data', chunk => {
    appendSyncOutput(chunk);
    process.stdout.write(`[scraper] ${chunk}`);
  });
  child.stderr.on('data', chunk => {
    appendSyncOutput(chunk, 'stderr');
    process.stderr.write(`[scraper] ${chunk}`);
  });
  child.on('error', error => {
    autoSyncState.lastError = error.message;
    console.error(`[sync] Python process error: ${error.message}`);
  });
  child.on('close', code => {
    clearTimeout(runtimeTimer);
    autoSyncState.running = false;
    autoSyncState.lastFinishedAt = new Date().toISOString();
    autoSyncState.lastExitCode = code;
    if (code !== 0 && !autoSyncState.lastError) {
      autoSyncState.lastError = `Pipeline exited with code ${code}`;
    }
    if (code === 0) {
      autoSyncState.lastSucceededAt = autoSyncState.lastFinishedAt;
      autoSyncState.lastError = '';
      autoSyncState.consecutiveFailures = 0;
    } else {
      autoSyncState.consecutiveFailures += 1;
    }
    feedSummaryCache = null;
    persistSyncState();
    scheduleNextSync(code === 0 ? syncConfig.intervalMinutes : syncConfig.retryMinutes);
    console.log(`[sync] Publisher refresh finished with code ${code}.`);
  });
  return true;
}

app.get('/api/sync-status', requireLegacyPublicApi, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicSyncState());
});

app.get('/api/health', async (_req, res) => {
  const state = publicSyncState();
  let editorial = {
    ready: false,
    mode: 'unavailable'
  };
  if (editorialReadinessProbe) {
    try {
      const repository = await editorialReadinessProbe();
      const localDemo = Boolean(repository?.state?.demo || repository?.isDemo);
      editorial = {
        ready: !localDemo || process.env.EDITORIAL_BACKEND === 'local',
        mode: localDemo ? 'local' : 'supabase'
      };
    } catch (_) {
      // Readiness is deliberately reported without leaking configuration or
      // database error details through the unauthenticated health endpoint.
    }
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: !state.feed.stale && state.consecutiveFailures === 0 && editorial.ready,
    schedulerEnabled: state.enabled,
    running: state.running,
    lastSucceededAt: state.lastSucceededAt,
    nextRunAt: state.nextRunAt,
    feed: state.feed,
    editorial,
    serverTime: state.serverTime
  });
});

function safeTokenMatch(received, expected) {
  const receivedBuffer = Buffer.from(String(received || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));
  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

// Optional authenticated hook for an external hosting cron. An HTTP cron can
// wake a sleeping service and is more reliable than an in-process timer alone.
app.post('/api/sync/run', async (req, res) => {
  const expectedToken = String(process.env.SYNC_TRIGGER_TOKEN || '').trim();
  if (!expectedToken) {
    return res.status(503).json({ error: 'External sync trigger is not configured' });
  }
  const authorization = String(req.get('authorization') || '');
  const receivedToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : String(req.get('x-sync-token') || '').trim();
  if (!safeTokenMatch(receivedToken, expectedToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const started = await requestNewsPipeline('external-cron');
  const status = started ? 202 : autoSyncState.lastExitCode === -1 ? 503 : 409;
  return res.status(status).json({ started, state: publicSyncState() });
});

// Serve only the public frontend and image-cache folders. Keeping this explicit
// prevents credentials and environment files in the project root being exposed.
[
  ['/assets/news_images', path.join(__dirname, 'assets', 'news_images')],
  ['/ft_images', path.join(__dirname, 'ft_images')],
  ['/news_images', path.join(__dirname, 'news_images')],
  ['/images', path.join(__dirname, 'images')],
  ['/downloaded_images', path.join(__dirname, 'downloaded_images')]
].forEach(([route, directory]) => {
  app.use(route, express.static(directory, {
    dotfiles: 'deny',
    index: false,
    fallthrough: true,
    maxAge: '1d'
  }));
});

const http = require('http');
const https = require('https');

// Force IPv4 to prevent timeouts on some environments
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

function isAllowedArticleHost(hostname) {
  return Boolean(publisherSuffix(hostname));
}

function parseAllowedPublisherUrl(rawUrl) {
  return parsePublisherUrl(rawUrl);
}

function getLargestSrcsetCandidate(srcset) {
  if (typeof srcset !== 'string' || !srcset.trim()) return '';

  return srcset
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(/\s+/);
      const descriptor = parts[1] || '1x';
      const score = descriptor.endsWith('w')
        ? Number.parseFloat(descriptor)
        : Number.parseFloat(descriptor) * 1000;
      return { url: parts[0], score: Number.isFinite(score) ? score : 0 };
    })
    .filter(candidate => candidate.url)
    .sort((a, b) => b.score - a.score)[0]?.url || '';
}

function getImageFromJsonLd(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = getImageFromJsonLd(item);
      if (candidate) return candidate;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  for (const key of ['image', 'thumbnailUrl', 'contentUrl']) {
    if (value[key]) {
      const candidate = getImageFromJsonLd(value[key]);
      if (candidate) return candidate;
    }
  }
  if (typeof value.url === 'string' && /imageobject/i.test(String(value['@type'] || ''))) {
    return value.url;
  }
  if (value['@graph']) return getImageFromJsonLd(value['@graph']);
  return '';
}

function extractOriginalArticleImage($, articleUrl) {
  const candidates = [];
  const addCandidate = rawValue => {
    let absoluteValue = rawValue;
    try {
      absoluteValue = new URL(String(rawValue || ''), articleUrl).href;
    } catch (_) {
      absoluteValue = '';
    }
    const normalized = normalizePublisherImageUrl(absoluteValue, articleUrl);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="og:image"]',
    'meta[name="twitter:image"]',
    'meta[property="twitter:image"]'
  ].forEach(selector => addCandidate($(selector).first().attr('content')));

  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      addCandidate(getImageFromJsonLd(JSON.parse($(element).html() || '')));
    } catch (_) {
      // Some publisher pages contain malformed analytics JSON-LD; ignore it.
    }
  });

  const articleImageSelectors = [
    '.main-img img',
    '.article-image img',
    '.featured-image img',
    '.article-content img',
    '.article-body img',
    '.entry-content img',
    'article img'
  ].join(', ');

  $(articleImageSelectors).each((_, element) => {
    const image = $(element);
    const width = Number.parseInt(image.attr('width'), 10);
    const height = Number.parseInt(image.attr('height'), 10);
    if ((Number.isFinite(width) && width > 0 && width < 160)
      || (Number.isFinite(height) && height > 0 && height < 120)) return;

    [
      image.attr('data-src'),
      image.attr('data-lazy-src'),
      image.attr('data-original'),
      image.attr('data-image'),
      getLargestSrcsetCandidate(image.attr('data-srcset')),
      getLargestSrcsetCandidate(image.attr('srcset')),
      image.attr('src')
    ].forEach(addCandidate);
  });

  return candidates[0] || '';
}

// Proxy publisher-owned images so browsers do not lose them to hotlink rules.
// This endpoint never substitutes a stock/generated image.
app.get('/api/image-proxy', async (req, res) => {
  try {
    const articleUrl = parseAllowedPublisherUrl(req.query.source);
    const normalizedImageUrl = articleUrl
      ? normalizePublisherImageUrl(String(req.query.url || ''), articleUrl.href)
      : '';
    if (!articleUrl || !normalizedImageUrl) {
      return res.status(400).json({ error: 'Unsupported image source' });
    }
    const imageUrl = new URL(normalizedImageUrl);

    const response = await axiosInstance.get(imageUrl.href, {
      responseType: 'arraybuffer',
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
      maxRedirects: 3,
      beforeRedirect: options => {
        const redirectUrl = `${options.protocol}//${options.hostname}${options.port ? `:${options.port}` : ''}${options.path || '/'}`;
        if (!normalizePublisherImageUrl(redirectUrl, articleUrl.href)) {
          throw new Error('Image redirect left the publisher allowlist');
        }
      },
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: `${articleUrl.origin}/`
      }
    });

    const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return res.status(415).json({ error: 'Publisher response was not an image' });
    }
    if (!response.data || response.data.byteLength < 64) {
      return res.status(502).json({ error: 'Original image is unavailable' });
    }

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff'
    });
    return res.send(Buffer.from(response.data));
  } catch (error) {
    console.error('Image proxy error:', error.message);
    return res.status(502).json({ error: 'Original image is unavailable' });
  }
});

// ---------------------------------------------------------
// 1. FT.LK News Scraper Proxy Endpoint
// ---------------------------------------------------------
app.get('/api/scrape-news', requireLegacyPublicApi, async (req, res) => {
  try {
    const articleUrl = parseAllowedPublisherUrl(req.query.url);

    if (!articleUrl) {
      return res.status(400).json({ error: 'A supported publisher URL is required' });
    }

    // Request Block වීම වළක්වන Headers
    const response = await axiosInstance.get(articleUrl.href, {
      maxRedirects: 3,
      beforeRedirect: options => {
        if (!['http:', 'https:'].includes(options.protocol) || !isAllowedArticleHost(options.hostname)) {
          throw new Error('Article redirect left the publisher allowlist');
        }
      },
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': `${articleUrl.origin}/`
      }
    });

    const $ = cheerio.load(response.data);

    const title = $('h1').first().text().trim() || $('title').text().trim();

    const imageUrl = extractOriginalArticleImage($, articleUrl.href);

    let fullContent = [];
    $('p').each((index, element) => {
      const pText = $(element).text().trim();
      // Filter out footer and copyright text
      if (pText.length > 20 && !pText.startsWith('Copyright') && !pText.startsWith('Daily FT')) {
        fullContent.push(pText);
      }
    });

    res.json({
      success: true,
      url: articleUrl.href,
      title: title,
      imageUrl: imageUrl,
      content: fullContent.join('\n\n'),
      scrapedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scraping Error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch news article',
      details: error.message
    });
  }
});

// ---------------------------------------------------------
// CSE API Configuration
// ---------------------------------------------------------
const CSE_BASE_URL = 'https://www.cse.lk/';
const CSE_API_URL = 'https://www.cse.lk/api/';

// 2. Company Info + Logo Endpoint
app.get('/api/company/:symbol', requireLegacyPublicApi, async (req, res) => {
  const { symbol } = req.params;
  try {
    const params = new URLSearchParams();
    params.append('symbol', symbol.toUpperCase());

    const response = await axiosInstance.post(`${CSE_API_URL}companyInfoSummery`, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data = response.data;

    let logoUrl = null;
    if (data.reqLogo && data.reqLogo.path) {
      logoUrl = new URL(data.reqLogo.path, CSE_BASE_URL).href;
    }

    const result = {
      symbol: data.reqSymbolInfo?.symbol || symbol.toUpperCase(),
      name: data.reqSymbolInfo?.name || symbol.toUpperCase(),
      price: data.reqSymbolInfo?.lastTradedPrice,
      change: data.reqSymbolInfo?.change,
      changePercentage: data.reqSymbolInfo?.changePercentage,
      logoUrl: logoUrl
    };

    return res.json(result);
  } catch (error) {
    console.error('Error fetching live CSE company data:', error.message);
    try {
      const cseDataPath = path.join(__dirname, 'cse_data.json');
      if (fs.existsSync(cseDataPath)) {
        const cseData = JSON.parse(fs.readFileSync(cseDataPath, 'utf8'));
        const matched = cseData.stocks?.find(s => s.symbol.toUpperCase() === symbol.toUpperCase());
        if (matched) {
          return res.json({
            symbol: matched.symbol,
            name: matched.name,
            price: matched.lastTradedPrice,
            change: matched.change,
            changePercentage: matched.changePercentage,
            logoUrl: null
          });
        }
      }
    } catch (_) {}
    return res.status(500).json({ error: 'Failed to retrieve company data' });
  }
});

// 3. Today Market Stock Prices Endpoint
app.get('/api/stocks/today', requireLegacyPublicApi, async (req, res) => {
  try {
    const response = await axiosInstance.post(`${CSE_API_URL}todaySharePrice`, '', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error fetching today share prices:', error.message);
    res.status(500).json({ error: 'Failed to fetch today share prices' });
  }
});

// 4. Market Summary Endpoint
app.get('/api/market-summary', requireLegacyPublicApi, async (req, res) => {
  try {
    const response = await axiosInstance.post(`${CSE_API_URL}marketSummery`, '', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Error fetching live market summary:', error.message);
    try {
      const cseDataPath = path.join(__dirname, 'cse_data.json');
      if (fs.existsSync(cseDataPath)) {
        const cseData = JSON.parse(fs.readFileSync(cseDataPath, 'utf8'));
        if (cseData.marketSummary) {
          return res.json(cseData.marketSummary);
        }
      }
    } catch (_) {}
    return res.status(500).json({ error: 'Failed to fetch market summary' });
  }
});

// Editorial/public API. Scraped records enter a review queue; approval creates
// the published snapshot returned by the public routes.
const editorial = createEditorialRouter({
  express,
  projectDir: __dirname,
  runNewsPipeline: requestNewsPipeline,
  publicSyncState
});
editorialReadinessProbe = editorial.resolveStore;
app.use('/api', editorial.router);

const PUBLIC_FILES = new Set([
  'index.html',
  'app.js',
  'styles.css',
  'news_feed.js',
  'news_feed.json',
  'daily_news_export.xlsx'
]);

app.get('/', (req, res) => {
  if (!legacyPublicApiEnabled) {
    return res.json({ service: 'Ceylon Ledger API', publicSite: process.env.PUBLIC_SITE_URL || null });
  }
  res.set('Cache-Control', 'no-cache, must-revalidate');
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/:publicFile', (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.publicFile)) return next();
  if (!legacyPublicApiEnabled) return next();
  const isLiveFeed = ['news_feed.js', 'news_feed.json'].includes(req.params.publicFile);
  res.set('Cache-Control', isLiveFeed ? 'no-store' : 'no-cache, must-revalidate');
  return res.sendFile(path.join(__dirname, req.params.publicFile));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[+] Proxy Server running on http://localhost:${PORT}`);
  if (!autoSyncState.enabled) {
    console.log('[sync] Automatic publisher refresh is disabled.');
    return;
  }

  console.log(`[sync] Automatic refresh interval: ${syncConfig.intervalMinutes} minute(s).`);
  console.log(`[sync] Failed runs retry after ${syncConfig.retryMinutes} minute(s).`);

  if (syncConfig.runOnStart) {
    setTimeout(() => { void requestNewsPipeline('startup'); }, 1000);
  } else {
    scheduleNextSync(syncConfig.intervalMinutes);
  }
});
