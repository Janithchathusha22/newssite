/* ==========================================================================
   DAILY BIZ & GOV - FRONTEND LOGIC & EXCEL INGESTION ENGINE
   ========================================================================== */

// Default Fallback Database of Business & Governance News
let newsDatabase = [];

// App State
let currentLang = 'en';
let activeCategory = 'all';
const INITIAL_ARTICLE_COUNT = 24;
const ARTICLES_PER_PAGE = 12;
const TOP_STORY_CARD_COUNT = 4;
const FEED_REFRESH_INTERVAL_MS = 60 * 1000;
const FEED_REFRESH_MIN_GAP_MS = 15 * 1000;
const FEED_REQUEST_TIMEOUT_MS = 15 * 1000;
let visibleArticleCount = INITIAL_ARTICLE_COUNT;
let feedRefreshTimer = null;
let feedRefreshInFlight = null;
let feedFingerprint = '';
let feedAssetVersion = 'initial';
let lastFeedRefreshAt = null;
let eventListenersBound = false;

// DOM Elements
const heroArticleContainer = document.getElementById('heroArticle');
const secondaryArticlesContainer = document.getElementById('secondaryArticles');
const govFeedContainer = document.getElementById('govFeedList');
const pipelineSection = document.getElementById('pipelineSection');
const pipelineToggleBtn = document.getElementById('pipelineToggleBtn');
const runScraperBtn = document.getElementById('runScraperBtn');
const viewCodeBtn = document.getElementById('viewCodeBtn');
const scraperConsoleLog = document.getElementById('logOutput');
const pipelineStatusBadge = document.getElementById('pipelineStatusBadge');
const searchInput = document.getElementById('searchInput');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const articleCountStatus = document.getElementById('articleCountStatus');
const feedStats = document.getElementById('feedStats');
const feedRefreshStatus = document.getElementById('feedRefreshStatus');
const latestUpdatesSection = document.getElementById('latestUpdatesSection');
const latestUpdatesContainer = document.getElementById('latestUpdates');
const latestUpdatesTitle = document.getElementById('latestUpdatesTitle');
const latestUpdatesCount = document.getElementById('latestUpdatesCount');
const sourceCoverageList = document.getElementById('sourceCoverageList');
const footerSources = document.getElementById('footerSources');
const footerFeedSummary = document.getElementById('footerFeedSummary');

// Modal Elements
const articleModal = document.getElementById('articleModal');
const modalBody = document.getElementById('modalBody');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const codeModal = document.getElementById('codeModal');
const codeModalCloseBtn = document.getElementById('codeModalCloseBtn');

const ARTICLE_IMAGE_FIELDS = [
    'main_image_local',
    'image_local',
    'local_image_path',
    'local_image',
    'downloaded_image',
    'downloaded_image_path',
    'cached_image',
    'cached_image_path',
    'image_path',
    'main_image_url',
    'main_image',
    'source_image',
    'image_url',
    'imageUrl',
    'og_image',
    'featured_image',
    'thumbnail',
    'image'
];

const DISALLOWED_IMAGE_MARKERS = [
    'placeholder.com',
    'placehold.co',
    'unsplash.com',
    'pexels.com',
    'pixabay.com',
    'ftlk_logo_og',
    '/ft-logo.',
    'loading.gif',
    'spacer.gif',
    'image-not-found',
    'no-image',
    'no_image'
];

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[character]));
}

function getApiUrl(pathname) {
    const configuredBase = String(window.NEWS_API_BASE_URL || '').replace(/\/+$/, '');
    if (configuredBase) return `${configuredBase}${pathname}`;

    const isLocalAlternateServer = ['localhost', '127.0.0.1'].includes(window.location.hostname)
        && window.location.port
        && window.location.port !== '5000';

    if (window.location.protocol === 'file:' || isLocalAlternateServer) {
        return `http://localhost:5000${pathname}`;
    }
    return pathname;
}

function safeExternalUrl(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || ''));
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
    } catch (_) {
        return '#';
    }
}

function normalizeLocalImagePath(rawPath) {
    const normalized = String(rawPath || '').trim().replace(/\\/g, '/');
    const localMatch = normalized.match(/(?:^|\/)(assets|ft_images|news_images|images|downloaded_images)\/(.+)$/i);
    if (!localMatch) return '';

    const root = localMatch[1].toLowerCase();
    const relativePath = localMatch[2]
        .split('/')
        .filter(segment => segment && segment !== '.' && segment !== '..')
        .map(segment => encodeURIComponent(segment))
        .join('/');

    if (!relativePath) return '';
    return window.location.protocol === 'file:' ? `${root}/${relativePath}` : `/${root}/${relativePath}`;
}

function withAssetVersion(url) {
    if (!url) return '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${encodeURIComponent(feedAssetVersion)}`;
}

function normalizeArticleImages(article) {
    const candidates = [];
    for (const field of ARTICLE_IMAGE_FIELDS) {
        const rawValue = article && article[field];
        if (typeof rawValue !== 'string' || !rawValue.trim()) continue;

        const value = rawValue.trim().startsWith('//') ? `https:${rawValue.trim()}` : rawValue.trim();
        const lowerValue = value.toLowerCase();
        if (DISALLOWED_IMAGE_MARKERS.some(marker => lowerValue.includes(marker))) continue;

        if (/^https?:\/\//i.test(value)) {
            try {
                const parsed = new URL(value);
                const localUrlPath = normalizeLocalImagePath(parsed.pathname);
                const isCurrentOrigin = window.location.protocol !== 'file:' && parsed.origin === window.location.origin;
                const isLocalServer = ['localhost', '127.0.0.1'].includes(parsed.hostname);
                if (localUrlPath && (isCurrentOrigin || isLocalServer)) {
                    candidates.push(withAssetVersion(localUrlPath));
                    continue;
                }
            } catch (_) {
                continue;
            }
            candidates.push(getApiUrl(`/api/image-proxy?url=${encodeURIComponent(value)}&v=${encodeURIComponent(feedAssetVersion)}`));
            // The server proxy handles publisher hot-link rules. The original URL is
            // a final fallback for newly added publishers not yet in its allowlist.
            candidates.push(value);
            continue;
        }

        const localPath = normalizeLocalImagePath(value);
        if (localPath) candidates.push(withAssetVersion(localPath));
    }
    return [...new Set(candidates)];
}

function normalizeArticleImage(article) {
    return normalizeArticleImages(article)[0] || '';
}

function hasArticleImageCandidate(article) {
    return normalizeArticleImages(article).length > 0;
}

function articleTimestamp(article) {
    const value = article && (article.published_at || article.date || article.scraped_at);
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function renderArticleImage(article, altText, frameClass, options = {}) {
    const imageCandidates = normalizeArticleImages(article);
    const imageUrl = imageCandidates[0] || '';
    const unavailableClass = imageUrl ? '' : ' is-unavailable';
    const priority = options.priority === 'high' ? ' fetchpriority="high"' : '';
    const loading = options.priority === 'high' ? 'eager' : 'lazy';
    const fallbacks = imageCandidates.length > 1
        ? ` data-image-fallbacks="${escapeHtml(JSON.stringify(imageCandidates.slice(1)))}"`
        : '';
    const imageMarkup = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(altText)}" loading="${loading}" decoding="async" data-article-image${fallbacks}${priority}>`
        : '';

    return `
        <div class="${frameClass} image-frame${unavailableClass}">
            ${imageMarkup}
            <div class="image-unavailable" role="img" aria-label="Image unavailable">
                <i class="fa-regular fa-image" aria-hidden="true"></i>
                <span>Image unavailable</span>
            </div>
            ${options.category ? `<span class="category-tag">${escapeHtml(options.category)}</span>` : ''}
        </div>
    `;
}

function wireArticleImageFallbacks(root = document) {
    root.querySelectorAll('img[data-article-image]').forEach(image => {
        if (image.dataset.imageWired === 'true') return;
        image.dataset.imageWired = 'true';

        let fallbackUrls = [];
        try {
            fallbackUrls = JSON.parse(image.dataset.imageFallbacks || '[]');
        } catch (_) {
            fallbackUrls = [];
        }

        const frame = image.closest('.image-frame');
        const showLoadedImage = () => {
            if (!image.isConnected || image.naturalWidth <= 0) return;
            if (frame) {
                frame.classList.remove('is-unavailable');
                frame.classList.add('is-loaded');
            }
        };

        const tryFallbackOrShowUnavailable = () => {
            if (frame) frame.classList.remove('is-loaded');

            let nextUrl = fallbackUrls.shift();
            while (nextUrl && nextUrl === image.getAttribute('src')) {
                nextUrl = fallbackUrls.shift();
            }
            if (nextUrl) {
                image.src = nextUrl;
                return;
            }

            if (frame) frame.classList.add('is-unavailable');
            // Removing the failed element guarantees that no browser can paint its
            // broken-image glyph or alt text over the neutral placeholder.
            image.remove();
        };

        image.addEventListener('load', showLoadedImage);
        image.addEventListener('error', tryFallbackOrShowUnavailable);
        if (image.complete) {
            if (image.naturalWidth > 0) showLoadedImage();
            else tryFallbackOrShowUnavailable();
        }
    });
}

function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function formatRefreshTime(date) {
    if (!(date instanceof Date)) return 'waiting';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setFeedRefreshStatus(message, isError = false) {
    if (!feedRefreshStatus) return;
    feedRefreshStatus.textContent = message;
    feedRefreshStatus.classList.toggle('is-error', isError);
}

function updateFeedStats() {
    if (!feedStats) return;
    const sourceCount = new Set(newsDatabase.map(article => String(article.source || '').trim()).filter(Boolean)).size;
    const imageCount = newsDatabase.filter(article => normalizeArticleImages(article).length > 0).length;
    feedStats.textContent = `${newsDatabase.length} total · ${sourceCount} sources · ${imageCount} with publisher images`;
    renderPublicationMetadata();
}

function formatArticleDate(rawDate) {
    const value = String(rawDate || '').trim();
    if (!value) return 'Latest update';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

function articleIdentity(article) {
    return String(article && (article.id || article.url || article.headline_en) || '').trim().toLowerCase();
}

function interleaveArticlesBySource(articles) {
    const sourceQueues = new Map();
    articles.forEach(article => {
        const source = String(article.source || 'Unknown publisher').trim().toLowerCase();
        if (!sourceQueues.has(source)) sourceQueues.set(source, []);
        sourceQueues.get(source).push(article);
    });

    const queues = [...sourceQueues.values()];
    const balanced = [];
    for (let index = 0; balanced.length < articles.length; index += 1) {
        queues.forEach(queue => {
            if (index < queue.length) balanced.push(queue[index]);
        });
    }
    return balanced;
}

function renderPublicationMetadata() {
    const counts = new Map();
    newsDatabase.forEach(article => {
        const source = String(article.source || 'Unknown publisher').trim();
        counts.set(source, (counts.get(source) || 0) + 1);
    });
    const rankedSources = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    if (sourceCoverageList) {
        sourceCoverageList.innerHTML = rankedSources.map(([source, count]) => `
            <li>
                <span>${escapeHtml(source)}</span>
                <strong>${count}</strong>
            </li>
        `).join('');
    }
    if (footerSources) {
        footerSources.innerHTML = rankedSources.map(([source, count]) =>
            `<span>${escapeHtml(source)} <strong>${count}</strong></span>`
        ).join('');
    }
    if (footerFeedSummary) {
        footerFeedSummary.textContent = `${newsDatabase.length} live stories across ${rankedSources.length} publishers · refreshed automatically`;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    const currentDateElement = document.getElementById('currentDate');
    const currentYearElement = document.getElementById('currentYear');
    if (currentDateElement) {
        currentDateElement.textContent = now.toLocaleDateString([], {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
    }
    if (currentYearElement) currentYearElement.textContent = String(now.getFullYear());
    fetchCSEData(); // Start fetching CSE data in background
    await fetchLiveNewsFeed({ initial: true });
    renderNews();
    setupEventListeners();
    startFeedAutoRefresh();
});

// Fetch Live News generated by Python daily_runner.py & excel_sync.py
async function fetchLiveNewsFeed(options = {}) {
    if (feedRefreshInFlight) return feedRefreshInFlight;

    feedRefreshInFlight = (async () => {
        let liveData = null;
        let nextFingerprint = '';
        let nextAssetVersion = '';
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), FEED_REQUEST_TIMEOUT_MS);

        setFeedRefreshStatus('Checking for news updates…');
        try {
            const response = await fetch(`news_feed.json?t=${Date.now()}`, {
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`Feed request failed (${response.status})`);

            const rawPayload = (await response.text()).replace(/^\uFEFF/, '');
            liveData = JSON.parse(rawPayload);
            nextFingerprint = `${rawPayload.length}-${hashText(rawPayload)}`;
            const serverRevision = response.headers.get('etag')
                || response.headers.get('last-modified')
                || nextFingerprint;
            nextAssetVersion = hashText(`${serverRevision}-${nextFingerprint}`);
        } catch (error) {
            if (options.initial && Array.isArray(window.LIVE_NEWS_FEED)) {
                liveData = window.LIVE_NEWS_FEED;
                const fallbackPayload = JSON.stringify(liveData);
                nextFingerprint = `${fallbackPayload.length}-${hashText(fallbackPayload)}`;
                nextAssetVersion = hashText(nextFingerprint);
                console.log('[-] JSON fetch unavailable. Loaded the bundled news_feed.js fallback.');
            } else {
                console.warn('News feed refresh failed:', error.message);
                setFeedRefreshStatus(`Auto-refresh retrying · ${formatRefreshTime(new Date())}`, true);
                return false;
            }
        } finally {
            window.clearTimeout(timeoutId);
        }

        if (!Array.isArray(liveData) || liveData.length === 0) {
            setFeedRefreshStatus('Feed is empty; keeping the last successful update', true);
            return false;
        }

        const seenArticles = new Set();
        const uniqueLiveData = liveData.filter(item => {
            const urlKey = String(item && (item.url || item.link) || '').trim().toLowerCase();
            const fallbackKey = `${String(item && item.source || '').trim()}|${String(item && (item.headline_en || item.title) || '').trim()}`.toLowerCase();
            const key = urlKey || fallbackKey;
            if (!key || seenArticles.has(key)) return false;
            seenArticles.add(key);
            return true;
        });

        const contentChanged = nextFingerprint !== feedFingerprint;
        const assetRevisionChanged = nextAssetVersion !== feedAssetVersion;
        if (contentChanged || assetRevisionChanged || newsDatabase.length === 0) {
            newsDatabase = uniqueLiveData.map((item, idx) => ({
                ...item,
                id: item.id || item.url || item.link || idx + 1,
                url: item.url || item.link || '#',
                headline_en: item.headline_en || item.title || 'Sri Lanka Business Update',
                headline_si: item.headline_si || item.title_si || item.headline_en || item.title,
                category: item.category || 'Business & Governance',
                source: item.source || 'Sri Lanka business news',
                date: item.published_at || item.date || item.scraped_at || 'Today',
                readTime: item.readTime || item.read_time || '3 min read',
                image: item.image || '',
                summary_en: item.summary_en || item.summary || '',
                summary_si: item.summary_si || item.summary_en || item.summary || '',
                full_text: item.full_text || '',
                key_takeaways: item.key_takeaways || ['Scraped & AI processed.'],
                isHero: idx === 0
            }));
            feedFingerprint = nextFingerprint;
            feedAssetVersion = nextAssetVersion;
            if (options.initial) visibleArticleCount = INITIAL_ARTICLE_COUNT;
        }

        lastFeedRefreshAt = new Date();
        setFeedRefreshStatus(`Auto-refresh on · checked ${formatRefreshTime(lastFeedRefreshAt)}`);
        updateFeedStats();
        return contentChanged || assetRevisionChanged;
    })();

    try {
        return await feedRefreshInFlight;
    } finally {
        feedRefreshInFlight = null;
    }
}

async function refreshFeedIfDue(force = false) {
    if (!force && lastFeedRefreshAt
        && Date.now() - lastFeedRefreshAt.getTime() < FEED_REFRESH_MIN_GAP_MS) return;

    const changed = await fetchLiveNewsFeed();
    if (changed) renderNews();
}

function startFeedAutoRefresh() {
    if (feedRefreshTimer) window.clearInterval(feedRefreshTimer);
    feedRefreshTimer = window.setInterval(() => {
        if (!document.hidden) void refreshFeedIfDue(true);
    }, FEED_REFRESH_INTERVAL_MS);
}

function renderNews() {
    let filtered = newsDatabase;
    
    // Category Filter
    if (activeCategory !== 'all') {
        const catMap = {
            'business': ['corporate', 'front page', 'top story', 'business'],
            'governance': ['governance', 'policy', 'opinion'],
            'economy': ['financial', 'economy', 'finance', 'stock', 'market'],
            'opinion': ['opinion', 'column', 'editorial'],
            'esg': ['esg', 'leadership', 'sustainability']
        };
        const matchTerms = catMap[activeCategory] || [activeCategory];
        filtered = newsDatabase.filter(item => {
            const catLower = (item.category || '').toLowerCase();
            return matchTerms.some(term => catLower.includes(term));
        });
    }
    
    // Search Filter
    const searchVal = searchInput.value.trim().toLowerCase();
    if (searchVal) {
        filtered = filtered.filter(item => 
            (item.headline_en || '').toLowerCase().includes(searchVal) || 
            (item.summary_en || '').toLowerCase().includes(searchVal)
        );
    } else {
        // Publisher feeds often arrive in source-sized batches. Interleaving the
        // batches keeps the front page timely while avoiding a one-source wall.
        filtered = interleaveArticlesBySource(filtered);
    }

    if (filtered.length === 0) {
        heroArticleContainer.style.display = 'none';
        secondaryArticlesContainer.innerHTML = '<div class="no-articles">No articles found for selected category.</div>';
        if (latestUpdatesSection) latestUpdatesSection.hidden = true;
        if (latestUpdatesContainer) latestUpdatesContainer.innerHTML = '';
        if (articleCountStatus) articleCountStatus.textContent = 'Showing 0 articles';
        updateFeedStats();
        if (loadMoreBtn) loadMoreBtn.hidden = true;
        return;
    }

    // The lead visual dominates the page, so prefer the newest article with a
    // real publisher image. Image-less breaking stories remain immediately
    // below it instead of turning the entire hero panel into a placeholder.
    const designatedHero = filtered.find(article => article.isHero);
    const newestVisualStory = filtered
        .filter(hasArticleImageCandidate)
        .sort((left, right) => articleTimestamp(right) - articleTimestamp(left))[0];
    const hero = (
        designatedHero && hasArticleImageCandidate(designatedHero)
            ? designatedHero
            : newestVisualStory
    ) || designatedHero || filtered[0];
    const heroIndex = filtered.indexOf(hero);
    const secondaries = filtered.filter((_, index) => index !== heroIndex);
    const visibleSecondaryCount = Math.max(0, visibleArticleCount - 1);
    const visibleSecondaries = secondaries.slice(0, visibleSecondaryCount);
    const topStories = visibleSecondaries.slice(0, TOP_STORY_CARD_COUNT);
    const latestArticles = visibleSecondaries.slice(TOP_STORY_CARD_COUNT);
    const totalVisible = Math.min(filtered.length, 1 + visibleSecondaries.length);

    // Render Hero
    heroArticleContainer.style.display = 'grid';
    const titleText = currentLang === 'si' ? (hero.headline_si || hero.headline_en) : hero.headline_en;
    const summaryText = currentLang === 'si' ? (hero.summary_si || hero.summary_en) : hero.summary_en;
    const heroTakeawayCandidate = hero.key_takeaways
        ? (Array.isArray(hero.key_takeaways) ? hero.key_takeaways[0] : hero.key_takeaways)
        : '';
    const heroTakeaway = heroTakeawayCandidate || summaryText || 'Open the full coverage for the complete business context.';

    heroArticleContainer.innerHTML = `
        ${renderArticleImage(hero, titleText, 'hero-img-wrap', { category: hero.category, priority: 'high' })}
        <div class="hero-info">
            <div class="meta-info">
                <span class="meta-source"><i class="fa-regular fa-newspaper"></i> ${escapeHtml(hero.source)}</span> &bull;
                <span><i class="fa-regular fa-clock"></i> ${escapeHtml(formatArticleDate(hero.date))}</span> &bull;
                <span>${escapeHtml(hero.readTime)}</span>
            </div>
            <h1><button class="article-title-button" type="button" data-article-id="${escapeHtml(hero.id)}">${escapeHtml(titleText)}</button></h1>
            <p>${escapeHtml(summaryText)}</p>
            
            <div class="ai-summary-box">
                <i class="fa-solid fa-lightbulb text-primary"></i> <strong>Editorial Takeaway:</strong>
                ${escapeHtml(heroTakeaway)}
            </div>

            <div>
                <button class="btn btn-primary" type="button" data-article-id="${escapeHtml(hero.id)}">
                    Read Full Coverage <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        </div>
    `;

    // Render Secondaries
    secondaryArticlesContainer.innerHTML = topStories.map(art => {
        const artTitle = currentLang === 'si' ? (art.headline_si || art.headline_en) : art.headline_en;
        const artSummary = currentLang === 'si' ? (art.summary_si || art.summary_en) : art.summary_en;
        const shortSummary = String(artSummary || '').length > 140
            ? `${String(artSummary).slice(0, 140)}…`
            : String(artSummary || '');
        return `
            <article class="card article-card">
                <div>
                    ${renderArticleImage(art, artTitle, 'article-thumb')}
                    <div class="meta-info">
                        <span class="category-tag category-tag-inline">${escapeHtml(art.category)}</span>
                        <span class="card-source">${escapeHtml(art.source)}</span>
                        &bull; ${escapeHtml(formatArticleDate(art.date))}
                    </div>
                    <h3><button class="article-title-button" type="button" data-article-id="${escapeHtml(art.id)}">${escapeHtml(artTitle)}</button></h3>
                    <p>${escapeHtml(shortSummary)}</p>
                </div>
                <button class="btn btn-secondary article-read-button" type="button" data-article-id="${escapeHtml(art.id)}">
                    Read Article &rarr;
                </button>
            </article>
        `;
    }).join('');

    // Full-width latest section uses the remaining visible articles only, so it
    // never duplicates the hero or the editorial top-story cards above it.
    if (latestUpdatesSection && latestUpdatesContainer) {
        latestUpdatesSection.hidden = latestArticles.length === 0;
        if (latestUpdatesTitle) {
            latestUpdatesTitle.textContent = searchVal
                ? 'More Search Results'
                : (activeCategory === 'all' ? 'Latest Business Updates' : 'Latest Section Updates');
        }
        if (latestUpdatesCount) {
            latestUpdatesCount.textContent = `${latestArticles.length} additional ${latestArticles.length === 1 ? 'story' : 'stories'}`;
        }
        latestUpdatesContainer.innerHTML = latestArticles.map(art => {
            const artTitle = currentLang === 'si' ? (art.headline_si || art.headline_en) : art.headline_en;
            const artSummary = currentLang === 'si' ? (art.summary_si || art.summary_en) : art.summary_en;
            const shortSummary = String(artSummary || '').length > 155
                ? `${String(artSummary).slice(0, 155)}…`
                : String(artSummary || 'Open the original coverage for the complete report.');
            return `
                <article class="latest-update">
                    ${renderArticleImage(art, artTitle, 'latest-update-thumb')}
                    <div class="latest-update-copy">
                        <div class="latest-update-meta">
                            <span>${escapeHtml(art.source)}</span>
                            <span>${escapeHtml(art.category)}</span>
                            <time>${escapeHtml(formatArticleDate(art.date))}</time>
                        </div>
                        <h3><button class="article-title-button" type="button" data-article-id="${escapeHtml(art.id)}">${escapeHtml(artTitle)}</button></h3>
                        <p>${escapeHtml(shortSummary)}</p>
                        <button class="latest-read-link" type="button" data-article-id="${escapeHtml(art.id)}">
                            Continue reading <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                        </button>
                    </div>
                </article>
            `;
        }).join('');
    }

    // Render Sidebar Governance Feed
    const visibleArticleKeys = new Set([hero, ...visibleSecondaries].map(articleIdentity));
    const governancePool = newsDatabase.filter(article => {
        const category = String(article.category || '').toLowerCase();
        return category.includes('governance') || category.includes('policy');
    });
    const govArticles = interleaveArticlesBySource(governancePool)
        .filter(article => !visibleArticleKeys.has(articleIdentity(article)))
        .slice(0, 5);
    govFeedContainer.innerHTML = govArticles.map(g => {
        const gTitle = currentLang === 'si' ? (g.headline_si || g.headline_en) : g.headline_en;
        return `
            <div class="gov-feed-item">
                <h4><button class="article-title-button" type="button" data-article-id="${escapeHtml(g.id)}">${escapeHtml(gTitle)}</button></h4>
                <div class="time-meta"><i class="fa-regular fa-clock"></i> ${escapeHtml(g.source)} | Live source feed</div>
            </div>
        `;
    }).join('');

    // Dynamic Breaking Ticker Update
    const tickerEl = document.getElementById('tickerText');
    if (tickerEl && newsDatabase.length > 0) {
        tickerEl.innerText = interleaveArticlesBySource(newsDatabase).slice(0, 12).map(n => currentLang === 'si' ? (n.headline_si || n.headline_en) : n.headline_en).join(' | ');
    }

    // Dynamic AI Takeaways Update
    const takeawaysEl = document.getElementById('aiTakeawaysList');
    if (takeawaysEl && newsDatabase.length > 0) {
        takeawaysEl.innerHTML = [hero, ...topStories].slice(0, 3).map(n => {
            const candidate = n.key_takeaways
                ? (Array.isArray(n.key_takeaways) ? n.key_takeaways[0] : n.key_takeaways)
                : '';
            const takeawayText = candidate || n.summary_en || n.headline_en;
            return `
                <li>
                    <i class="fa-solid fa-circle-check text-primary"></i>
                    <strong>${escapeHtml(n.category)}:</strong> ${escapeHtml(takeawayText)}
                </li>
            `;
        }).join('');
    }

    if (articleCountStatus) {
        const filterSuffix = filtered.length === newsDatabase.length
            ? 'articles'
            : `matching articles (${newsDatabase.length} total)`;
        articleCountStatus.textContent = `Showing ${totalVisible} of ${filtered.length} ${filterSuffix}`;
    }
    updateFeedStats();
    if (loadMoreBtn) {
        const remaining = filtered.length - totalVisible;
        loadMoreBtn.hidden = remaining <= 0;
        loadMoreBtn.textContent = remaining > 0
            ? `Load ${Math.min(ARTICLES_PER_PAGE, remaining)} more`
            : 'All articles loaded';
    }

    wireArticleImageFallbacks(heroArticleContainer);
    wireArticleImageFallbacks(secondaryArticlesContainer);
    if (latestUpdatesContainer) wireArticleImageFallbacks(latestUpdatesContainer);
}

function setupEventListeners() {
    if (eventListenersBound) return;
    eventListenersBound = true;

    // Category Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            activeCategory = link.getAttribute('data-category');
            visibleArticleCount = INITIAL_ARTICLE_COUNT;
            renderNews();
        });
    });

    // Language Toggle
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLang = btn.getAttribute('data-lang');
            renderNews();
        });
    });

    // Theme Toggle
    const themeBtn = document.getElementById('themeToggle');
    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const icon = themeBtn.querySelector('i');
        if (document.body.classList.contains('dark-theme')) {
            icon.className = 'fa-solid fa-sun';
        } else {
            icon.className = 'fa-solid fa-moon';
        }
    });

    // Search Input
    searchInput.addEventListener('input', () => {
        visibleArticleCount = INITIAL_ARTICLE_COUNT;
        renderNews();
    });

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            visibleArticleCount += ARTICLES_PER_PAGE;
            renderNews();
        });
    }

    document.querySelectorAll('[data-footer-category]').forEach(button => {
        button.addEventListener('click', () => {
            activeCategory = button.dataset.footerCategory || 'all';
            visibleArticleCount = INITIAL_ARTICLE_COUNT;
            searchInput.value = '';
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.toggle('active', link.dataset.category === activeCategory);
            });
            renderNews();
            document.querySelector('.main-layout')?.scrollIntoView({ behavior: 'smooth' });
        });
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void refreshFeedIfDue();
    });
    window.addEventListener('focus', () => void refreshFeedIfDue());

    document.addEventListener('click', event => {
        const articleTrigger = event.target.closest('[data-article-id]');
        if (!articleTrigger) return;
        event.preventDefault();
        openArticleModal(articleTrigger.dataset.articleId);
    });

    // Pipeline Panel Toggle
    pipelineToggleBtn.addEventListener('click', () => {
        pipelineSection.classList.toggle('hidden');
        if (!pipelineSection.classList.contains('hidden')) {
            pipelineSection.scrollIntoView({ behavior: 'smooth' });
            void refreshPipelineStatus();
        }
    });

    // This public control reports the real backend state. Expensive manual runs
    // remain protected by the server-side SYNC_TRIGGER_TOKEN endpoint.
    runScraperBtn.addEventListener('click', () => void refreshPipelineStatus(true));

    // Code Modal
    viewCodeBtn.addEventListener('click', () => {
        codeModal.classList.add('active');
    });

    codeModalCloseBtn.addEventListener('click', () => {
        codeModal.classList.remove('active');
    });

    modalCloseBtn.addEventListener('click', () => {
        articleModal.classList.remove('active');
    });
}

function formatPipelineTimestamp(value) {
    if (!value) return 'never';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
}

async function refreshPipelineStatus(showLoading = false) {
    if (showLoading) {
        runScraperBtn.disabled = true;
        runScraperBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking server…';
    }
    try {
        const response = await fetch(getApiUrl('/api/sync-status'), { cache: 'no-store' });
        if (!response.ok) throw new Error(`Status request failed (${response.status})`);
        const status = await response.json();
        const feed = status.feed || {};
        let badgeClass = 'healthy';
        let badgeIcon = 'fa-circle-check';
        let badgeText = 'Scheduler healthy';
        if (!status.enabled) {
            badgeClass = 'disabled';
            badgeIcon = 'fa-circle-pause';
            badgeText = 'Scheduler disabled';
        } else if (status.running) {
            badgeClass = 'running';
            badgeIcon = 'fa-spinner fa-spin';
            badgeText = 'Scraper running';
        } else if (status.lastExitCode !== null && status.lastExitCode !== 0) {
            badgeClass = 'error';
            badgeIcon = 'fa-triangle-exclamation';
            badgeText = 'Last run failed';
        } else if (feed.stale) {
            badgeClass = 'warning';
            badgeIcon = 'fa-clock';
            badgeText = 'Feed is stale';
        }
        pipelineStatusBadge.className = `status-badge ${badgeClass}`;
        pipelineStatusBadge.innerHTML = `<i class="fa-solid ${badgeIcon}"></i> ${badgeText}`;

        const lines = [
            `Enabled: ${status.enabled ? 'yes' : 'no'} | Running: ${status.running ? 'yes' : 'no'}`,
            `Last started: ${formatPipelineTimestamp(status.lastStartedAt)}`,
            `Last success: ${formatPipelineTimestamp(status.lastSucceededAt)}`,
            `Next run: ${formatPipelineTimestamp(status.nextRunAt)}`,
            `Feed generated: ${formatPipelineTimestamp(feed.generatedAt)} | Articles: ${feed.articleCount || 0}`,
            `Latest article timestamp: ${formatPipelineTimestamp(feed.latestArticleAt)}`,
            `Interval: ${status.config?.intervalMinutes || '?'} min | Failure retry: ${status.config?.retryMinutes || '?'} min`
        ];
        if (status.lastError) lines.push(`ERROR: ${status.lastError}`);
        if (Array.isArray(status.recentOutput) && status.recentOutput.length) {
            lines.push('', '--- recent scraper output ---', ...status.recentOutput);
        }
        scraperConsoleLog.innerText = lines.join('\n');
        scraperConsoleLog.scrollTop = scraperConsoleLog.scrollHeight;
    } catch (error) {
        pipelineStatusBadge.className = 'status-badge error';
        pipelineStatusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Status unavailable';
        scraperConsoleLog.innerText = `Could not read the hosted scheduler: ${error.message}`;
    } finally {
        runScraperBtn.disabled = false;
        runScraperBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check Live Pipeline Status';
    }
}

// Open Article Modal
async function openArticleModal(id) {
    const article = newsDatabase.find(a => String(a.id) === String(id));
    if (!article) return;

    const title = currentLang === 'si' ? (article.headline_si || article.headline_en) : article.headline_en;
    const summary = currentLang === 'si' ? (article.summary_si || article.summary_en) : article.summary_en;
    const takeaways = (Array.isArray(article.key_takeaways) ? article.key_takeaways : [article.key_takeaways]).filter(Boolean);
    const articleUrl = safeExternalUrl(article.url);
    const bodyMarkup = article.full_text && article.full_text.length > 200
        ? article.full_text
            .split('\n\n')
            .filter(Boolean)
            .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`)
            .join('')
        : '<p><i class="fa-solid fa-spinner fa-spin"></i> Fetching the article from its original source…</p>';

    modalBody.innerHTML = `
        <div class="meta-info">
            <span class="category-tag category-tag-inline">${escapeHtml(article.category)}</span> &bull;
            ${escapeHtml(article.date)} &bull; ${escapeHtml(article.source)}
        </div>
        <h2 class="modal-article-title">${escapeHtml(title)}</h2>
        ${renderArticleImage(article, title, 'modal-article-image')}

        <div class="card modal-takeaways">
            <h4><i class="fa-solid fa-brain"></i> AI Executive Takeaways</h4>
            <ul>
                ${takeaways.map(takeaway => `<li>${escapeHtml(takeaway)}</li>`).join('')}
            </ul>
        </div>

        <div id="modalContentBody" class="modal-article-body">
            ${bodyMarkup}
        </div>

        <div class="modal-source-action">
            <a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Read on original source
            </a>
        </div>
        
        <div class="modal-footer-row">
            <span>Source: ${escapeHtml(article.source)} &bull; Auto-synced news feed</span>
            <a href="daily_news_export.xlsx" download class="btn btn-secondary"><i class="fa-solid fa-file-excel"></i> Download Excel</a>
        </div>
    `;

    articleModal.classList.add('active');
    wireArticleImageFallbacks(modalBody);

    // Fetch full text on demand if missing
    if (!article.full_text || article.full_text.length <= 200) {
        try {
            const res = await fetch(getApiUrl(`/api/scrape-news?url=${encodeURIComponent(article.url)}`));
            if (!res.ok) throw new Error(`Article request failed (${res.status})`);
            const data = await res.json();
            const contentContainer = document.getElementById('modalContentBody');
            if (data.success && data.content && data.content.length > 100) {
                article.full_text = data.content; // cache it
                contentContainer.innerHTML = article.full_text
                    .split('\n\n')
                    .filter(Boolean)
                    .map(paragraph => `<p>${escapeHtml(paragraph)}</p>`)
                    .join('');
            } else {
                contentContainer.innerHTML = `<p>${escapeHtml(summary)}</p>`;
            }
        } catch (e) {
            const contentContainer = document.getElementById('modalContentBody');
            if (contentContainer) contentContainer.innerHTML = `<p>${escapeHtml(summary)}</p>`;
        }
    }
}

// Fetch and Render CSE Data from Local Proxy
async function fetchCSEData() {
    const cseBanner = document.getElementById('cseMarketBanner');
    if (!cseBanner) return;

    try {
        const fetchJson = async endpoint => {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 6000);
            try {
                const response = await fetch(getApiUrl(endpoint), { signal: controller.signal });
                if (!response.ok) throw new Error(`${endpoint} failed (${response.status})`);
                return await response.json();
            } finally {
                window.clearTimeout(timeoutId);
            }
        };

        const symbols = ['JKH.N0000', 'HNB.N0000'];
        const [companyResults, marketResult] = await Promise.all([
            Promise.allSettled(symbols.map(symbol => fetchJson(`/api/company/${encodeURIComponent(symbol)}`))),
            fetchJson('/api/market-summary').catch(() => null)
        ]);

        const renderStock = (data, requestedSymbol) => {
            const symbol = data && data.symbol ? data.symbol : requestedSymbol;
            const initials = symbol.split('.')[0].slice(0, 3).toUpperCase();
            const numericChange = Number(data && data.change);
            const hasChange = Number.isFinite(numericChange);
            const isPositive = hasChange && numericChange >= 0;
            const icon = hasChange
                ? (isPositive ? '<i class="fa-solid fa-caret-up"></i>' : '<i class="fa-solid fa-caret-down"></i>')
                : '';
            const colorClass = hasChange ? (isPositive ? 'positive' : 'negative') : '';
            const price = data && data.price != null ? `Rs. ${escapeHtml(data.price)}` : 'Price unavailable';
            const change = hasChange ? ` ${icon} ${escapeHtml(data.change)}` : '';
            const logoUrl = data && data.logoUrl
                ? normalizeArticleImage({ source_image: data.logoUrl })
                : '';

            return `
                <div class="market-item market-stock-item">
                    <span class="stock-logo${logoUrl ? '' : ' is-unavailable'}" data-stock-logo>
                        <span class="stock-logo-initials" aria-hidden="true">${escapeHtml(initials)}</span>
                        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(symbol)} logo" loading="lazy" decoding="async" data-stock-logo-image>` : ''}
                    </span>
                    <span class="market-stock-copy">
                        <span class="m-label">${escapeHtml(symbol)}</span>
                        <span class="m-val ${colorClass}">${price}${change}</span>
                    </span>
                </div>
            `;
        };

        let html = companyResults.map((result, index) => {
            const data = result.status === 'fulfilled' ? result.value : null;
            return renderStock(data, symbols[index]);
        }).join('');

        if (marketResult && Number.isFinite(Number(marketResult.tradeVolume))) {
            const volumeMillions = (Number(marketResult.tradeVolume) / 1000000).toFixed(1);
            html += `
                <div class="market-item">
                    <span class="m-label">CSE Turnover</span>
                    <span class="m-val market-turnover">Rs. ${escapeHtml(volumeMillions)}M</span>
                </div>
            `;
        }

        cseBanner.innerHTML = html || '<div class="market-item"><span class="m-label">CSE Market Closed</span></div>';
        cseBanner.querySelectorAll('img[data-stock-logo-image]').forEach(image => {
            const showInitials = () => {
                const wrapper = image.closest('[data-stock-logo]');
                if (wrapper) wrapper.classList.add('is-unavailable');
                image.removeAttribute('src');
            };
            image.addEventListener('error', showInitials, { once: true });
            if (image.complete && image.naturalWidth === 0) showInitials();
        });
    } catch (error) {
        console.warn('CSE Data loading warning:', error.message);
        cseBanner.innerHTML = `
            <div class="market-item market-stock-item">
                <span class="stock-logo is-unavailable"><span class="stock-logo-initials">JKH</span></span>
                <span class="market-stock-copy"><span class="m-label">JKH.N0000</span><span class="m-val positive">Rs. 19.9</span></span>
            </div>
            <div class="market-item market-stock-item">
                <span class="stock-logo is-unavailable"><span class="stock-logo-initials">HNB</span></span>
                <span class="market-stock-copy"><span class="m-label">HNB.N0000</span><span class="m-val positive">Rs. 383.0</span></span>
            </div>
        `;
    }
}
