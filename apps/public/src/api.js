import { demoArticles } from './data';

// =========================================================================
// CLIENT DEMO MODE OVERRIDE (FOR VERCEL DEMONSTRATION)
// Enabled by default so the public site is populated with sample news
// stories & images on Vercel when backend API is offline.
// -------------------------------------------------------------------------
// TO REVERT TO STRICT LIVE MODE IN PRODUCTION:
// Change the line below to:
// export const DEMO_ENABLED = String(import.meta.env.VITE_DEMO_MODE || '').trim().toLowerCase() === 'true';
// =========================================================================
export const DEMO_ENABLED = String(import.meta.env.VITE_DEMO_MODE || 'true').trim().toLowerCase() !== 'false';

const LIVE_UNAVAILABLE_MESSAGE = 'The live news service is temporarily unavailable. Please try again shortly.';

const LOCAL_IMAGE_PATTERN = /^\/?(?:assets\/news_images|ft_images|news_images|images|downloaded_images)\/[a-z0-9_./%-]+\.(?:avif|gif|jpe?g|png|webp)$/i;

function cleanImageCandidate(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const clean = value.trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(clean)) return clean;
  if (!LOCAL_IMAGE_PATTERN.test(clean) || clean.split('/').includes('..')) return '';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

export function resolveAssetUrl(value, sourceUrl = '') {
  const clean = cleanImageCandidate(value);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) {
    if (API_BASE && /^https?:\/\//i.test(sourceUrl)) {
      const params = new URLSearchParams({ url: clean, source: sourceUrl });
      return `${API_BASE}/api/image-proxy?${params.toString()}`;
    }
    return clean;
  }
  return `${API_BASE}${clean}`;
}

function unwrap(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.articles)) return payload.articles;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normaliseList(payload) {
  return unwrap(payload).map(normalizeArticle);
}

function isArticlePayload(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value.id || value.slug || value.title || value.headline || value.headline_en)
  );
}

function slugify(text = '') {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function normalizeArticle(article, index = 0) {
  const title = article.title || article.headline || article.headline_en || 'Untitled report';
  const rawCategory = article.category?.name || article.category || 'business-news';
  const categorySlug = article.category_slug || article.categorySlug
    || (['business-news', 'interviews-appointments', 'money', 'technology', 'travel-tourism', 'luxury-living'].includes(rawCategory)
      ? rawCategory
      : slugify(rawCategory));
  const categoryLabels = {
    'business-news': 'Business News',
    'interviews-appointments': 'Interviews & Appointments',
    money: 'Money',
    technology: 'Technology',
    'travel-tourism': 'Travel & Tourism',
    'luxury-living': 'Luxury Living'
  };
  const category = categoryLabels[categorySlug] || rawCategory;
  const content = article.content || article.full_text || article.body || '';
  const body = Array.isArray(content)
    ? content
    : String(content).split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  const sourceUrl = article.source_url || article.sourceUrl || article.original_url || article.url || article.link || '#';
  const image = [
    article.local_image_path,
    article.image_local,
    article.imageUrl,
    article.source_image,
    article.image_url,
    article.image
  ].map(cleanImageCandidate).find(Boolean) || '';

  return {
    ...article,
    id: article.id || `article-${index}`,
    title,
    headline: title,
    slug: article.slug || slugify(title),
    category,
    categorySlug,
    source: article.source?.name || article.source_name || article.sourceName || article.source || 'Editorial Desk',
    sourceUrl,
    publishedAt: article.site_published_at || article.published_at || article.publishedAt || article.date || '',
    excerpt: article.excerpt || article.summary || article.description || body[0] || '',
    summary: article.summary || article.excerpt || body[0] || '',
    image,
    body: body.length ? body : [article.summary || article.excerpt].filter(Boolean),
    isTop: Boolean(article.is_top_news ?? article.isTop),
    topRank: Number(article.top_rank ?? article.topRank ?? 999)
  };
}

function ensureTenTopStories(suppliedTop, articles) {
  const seen = new Set();
  return [...suppliedTop, ...articles]
    .filter((article) => article?.id && !seen.has(article.id) && seen.add(article.id))
    .slice(0, 10);
}

async function request(path) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      const error = new Error(`Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

function requireAllowedPayload(payload) {
  if (!DEMO_ENABLED && payload?.demo === true) {
    const error = new Error('The API returned a demo workspace while live mode is required.');
    error.code = 'DEMO_PAYLOAD_BLOCKED';
    throw error;
  }
  return payload;
}

function demoHome() {
  return {
    articles: demoArticles,
    topNews: demoArticles.filter((article) => article.isTop).slice(0, 10),
    demo: true,
    error: ''
  };
}

function unavailableResult(shape = {}) {
  return { ...shape, demo: false, error: LIVE_UNAVAILABLE_MESSAGE };
}

export async function getHome() {
  let homeRequestFailed = false;
  try {
    const payload = requireAllowedPayload(await request('/api/public/home'));
    const articles = unwrap(payload).length
      ? normaliseList(payload)
      : [
          ...normaliseList(payload?.latest),
          ...Object.values(payload?.sections || {}).flatMap((items) => normaliseList(items))
        ].filter((article, index, all) =>
          all.findIndex((candidate) => candidate.id === article.id) === index
        );
    const suppliedTop = unwrap(payload?.topNews || payload?.top_news).map(normalizeArticle);
    if (!articles.length && !suppliedTop.length) {
      if (DEMO_ENABLED) return demoHome();
      return { articles: [], topNews: [], demo: false, error: '' };
    }
    const combined = articles.length ? articles : suppliedTop;
    const demo = Boolean(payload?.demo);
    const displayArticles = demo
      ? [...combined, ...demoArticles].filter((article, index, all) => (
          all.findIndex((candidate) => candidate.id === article.id || candidate.slug === article.slug) === index
        ))
      : combined;
    return { articles: displayArticles, topNews: ensureTenTopStories(suppliedTop, displayArticles), demo, error: '' };
  } catch {
    homeRequestFailed = true;
    try {
      const payload = requireAllowedPayload(await request('/api/public/top-news?limit=10'));
      const topNews = unwrap(payload).map(normalizeArticle);
      if (topNews.length) return { articles: topNews, topNews, demo: Boolean(payload?.demo), error: '' };
      if (!homeRequestFailed) return { articles: [], topNews: [], demo: false, error: '' };
    } catch { /* explicit demo or unavailable state below */ }
    return DEMO_ENABLED
      ? demoHome()
      : unavailableResult({ articles: [], topNews: [] });
  }
}

export async function getCategory(slug) {
  try {
    const payload = requireAllowedPayload(await request(`/api/public/categories/${encodeURIComponent(slug)}`));
    const articles = unwrap(payload).map(normalizeArticle);
    if (!articles.length && DEMO_ENABLED) {
      return { articles: demoArticles.filter((article) => article.categorySlug === slug), demo: true, error: '' };
    }
    return { articles, demo: Boolean(payload?.demo), error: '' };
  } catch {
    return DEMO_ENABLED
      ? { articles: demoArticles.filter((article) => article.categorySlug === slug), demo: true, error: '' }
      : unavailableResult({ articles: [] });
  }
}

export async function getArticle(slug) {
  try {
    const payload = requireAllowedPayload(await request(`/api/public/articles/${encodeURIComponent(slug)}`));
    const value = payload?.article || payload?.data || payload;
    if (!isArticlePayload(value)) throw new Error('Article missing');
    return {
      article: normalizeArticle(value),
      related: normaliseList(payload?.related),
      demo: Boolean(payload?.demo),
      error: '',
      notFound: false
    };
  } catch (error) {
    if (DEMO_ENABLED) {
      const article = demoArticles.find((item) => item.slug === slug) || null;
      return {
        article,
        related: article
          ? demoArticles.filter((item) => item.categorySlug === article.categorySlug && item.slug !== slug).slice(0, 3)
          : [],
        demo: true,
        error: '',
        notFound: false
      };
    }
    if (error?.status === 404) return { article: null, related: [], demo: false, error: '', notFound: true };
    return unavailableResult({ article: null, related: [], notFound: false });
  }
}

export async function getPreview(token) {
  try {
    const payload = requireAllowedPayload(await request(`/api/preview/${encodeURIComponent(token)}`));
    const value = payload?.article || payload?.data || payload;
    if (!isArticlePayload(value)) throw new Error('Preview missing');
    return { article: normalizeArticle(value), error: '' };
  } catch (error) {
    const invalid = error?.status === 401 || error?.status === 404;
    return {
      article: null,
      error: invalid ? 'This preview link is invalid or has expired.' : LIVE_UNAVAILABLE_MESSAGE
    };
  }
}
