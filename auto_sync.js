/**
 * =============================================================================
 * MASTER NEWS AGGREGATOR - Sri Lanka Business News + CSE Stock Data
 * =============================================================================
 * RSS Feeds + CSE API -> Supabase + Local JSON
 * 
 * Sources:
 *   - Daily FT (ft.lk) RSS Feeds (NO BLOCKING!)
 *   - EconomyNext RSS
 *   - Lanka Business Online RSS
 *   - Ada Derana Biz RSS
 *   - CSE Stock Market API (cse.lk)
 * =============================================================================
 */

require('dotenv').config();
const Parser = require('rss-parser');
const axios = require('axios');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
    timeout: 15000,
    headers: {
        'User-Agent': 'curl/7.88.1'
    }
});

// Force IPv4
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosClient = axios.create({ httpAgent, httpsAgent, timeout: 15000 });

const REJECT_KEYWORDS = [
    'remand', 'custody', 'bail hearing', 'trial court', 'court appearance', 'attorney general',
    'presidential pardon', 'gnanasara', 'namal rajapaksa', 'slpp', 'unp calls', 'sjb', 'npp', 'slfp',
    'parliamentary debate', 'election campaign', 'arrested by', 'murder', 'police arrest',
    'electric fence', 'wild elephant', 'flood warning', 'cyclonic storm',
    'all schools closed', 'camera equipment stolen', 'ipl auction', 'bugs bunny', 'stolen'
];

function isNonBusiness(text) {
    const lower = String(text || '').toLowerCase();
    return REJECT_KEYWORDS.some(k => lower.includes(k));
}

// ---- Supabase (Optional) ----
let supabase = null;
try {
    const { createClient } = require('@supabase/supabase-js');
    const sbUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (sbUrl && sbKey) {
        supabase = createClient(sbUrl, sbKey);
        console.log('[+] Supabase connected');
    } else {
        console.log('[i] Supabase not configured - saving to local JSON only');
    }
} catch (e) {
    console.log('[i] Supabase not installed - saving to local JSON only');
}

// =========================================================================
// 1. RSS FEED SOURCES (100% BUSINESS NEWS ONLY)
// =========================================================================
const RSS_FEEDS = [
    // Daily FT - Verified Working Categories
    { source: 'Daily FT', category: 'business-news', url: 'https://www.ft.lk/rss/front-page/44' },
    { source: 'Daily FT', category: 'business-news', url: 'https://www.ft.lk/rss/corporate/27' },
    { source: 'Daily FT', category: 'money', url: 'https://www.ft.lk/rss/financial-services/42' },
    { source: 'Daily FT', category: 'money', url: 'https://www.ft.lk/rss/markets/43' },
    { source: 'Daily FT', category: 'interviews-appointments', url: 'https://www.ft.lk/rss/hr/47' },
    { source: 'Daily FT', category: 'technology', url: 'https://www.ft.lk/rss/technology/49' },
    { source: 'Daily FT', category: 'travel-tourism', url: 'https://www.ft.lk/rss/hospitality/54' },
    { source: 'Daily FT', category: 'luxury-living', url: 'https://www.ft.lk/rss/lifestyle/10519' },

    // Other Sri Lankan Pure Business Feeds
    { source: 'LBO', category: 'business-news', url: 'https://www.lankabusinessonline.com/feed/' },
    { source: 'LBO', category: 'travel-tourism', url: 'https://www.lankabusinessonline.com/category/tourism/feed/' },
    { source: 'LBO', category: 'technology', url: 'https://www.lankabusinessonline.com/category/ict/feed/' },
    { source: 'Pulse', category: 'luxury-living', url: 'https://pulse.lk/feed/' },
];

// =========================================================================
// 2. FETCH ALL NEWS FROM RSS & WP REST APIS
// =========================================================================
async function fetchAllRssNews() {
    console.log('\n======================================================================');
    console.log('[*] RSS & REST NEWS AGGREGATOR - FETCHING PURE SRI LANKA BUSINESS NEWS');
    console.log('======================================================================');

    const allArticles = [];
    const seenLinks = new Set();

    for (const feedConfig of RSS_FEEDS) {
        try {
            console.log(`\n[*] Fetching RSS: ${feedConfig.source} - ${feedConfig.category}`);
            const feed = await parser.parseURL(feedConfig.url);
            let count = 0;

            for (const item of feed.items) {
                const link = item.link || item.guid || '';
                if (!link || seenLinks.has(link)) continue;

                const title = (item.title || '').trim();
                let summary = item.contentSnippet || item.content || '';
                if (summary.length > 500) summary = summary.substring(0, 500) + '...';
                summary = summary.replace(/<[^>]*>/g, '').trim();

                if (isNonBusiness(`${title} ${summary}`)) continue;
                seenLinks.add(link);

                // Extract image from RSS content
                let imageUrl = '';
                if (item.enclosure && item.enclosure.url) {
                    imageUrl = item.enclosure.url;
                } else if (item['media:content'] && item['media:content']['$'] && item['media:content']['$'].url) {
                    imageUrl = item['media:content']['$'].url;
                } else if (item.content) {
                    const $ = cheerio.load(item.content);
                    const img = $('img').first();
                    if (img.length) imageUrl = img.attr('src') || '';
                }

                const article = {
                    title: title,
                    link: link,
                    image: imageUrl,
                    category: feedConfig.category,
                    source: feedConfig.source,
                    summary: summary,
                    full_text: (item.content || item.contentSnippet || '').replace(/<[^>]*>/g, '').trim(),
                    published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
                    tags: [feedConfig.category, feedConfig.source, 'Sri Lanka']
                };

                allArticles.push(article);
                count++;
            }
            console.log(`    -> ${count} articles from ${feedConfig.source} (${feedConfig.category})`);
        } catch (err) {
            console.log(`    [!] Error fetching ${feedConfig.source}: ${err.message}`);
        }
    }

    // Fetch Business Today API (Interviews & Appointments)
    try {
        console.log('\n[*] Fetching Business Today WP REST API (Interviews & Leadership)...');
        const btResp = await axiosClient.get('https://businesstoday.lk/wp-json/wp/v2/posts?per_page=15&_embed', {
            headers: { 'User-Agent': 'curl/7.88.1' }
        });
        if (Array.isArray(btResp.data)) {
            let btCount = 0;
            for (const p of btResp.data) {
                const link = p.link || '';
                if (!link || seenLinks.has(link)) continue;

                const $ = cheerio.load(p.title?.rendered || '');
                const title = $.text().trim();
                const $excerpt = cheerio.load(p.excerpt?.rendered || '');
                const summary = $excerpt.text().trim();

                if (isNonBusiness(`${title} ${summary}`)) continue;
                seenLinks.add(link);

                let imageUrl = '';
                try {
                    const media = p._embedded?.['wp:featuredmedia'];
                    if (Array.isArray(media) && media[0]?.source_url) {
                        imageUrl = media[0].source_url;
                    }
                } catch (_) {}

                allArticles.push({
                    title: title,
                    link: link,
                    image: imageUrl,
                    category: 'interviews-appointments',
                    source: 'Business Today',
                    summary: summary,
                    full_text: summary,
                    published_at: p.date_gmt ? new Date(p.date_gmt + 'Z').toISOString() : new Date().toISOString(),
                    tags: ['Interviews & Appointments', 'Business Today', 'Leadership']
                });
                btCount++;
            }
            console.log(`    -> ${btCount} articles from Business Today`);
        }
    } catch (err) {
        console.log(`    [!] Error fetching Business Today: ${err.message}`);
    }

    // Fetch EconomyNext WP REST API (Macroeconomics & Money)
    try {
        console.log('\n[*] Fetching EconomyNext WP REST API (Money & Economy)...');
        const enResp = await axiosClient.get('https://economynext.com/wp-json/wp/v2/posts?per_page=15&_embed', {
            headers: { 'User-Agent': 'curl/7.88.1' }
        });
        if (Array.isArray(enResp.data)) {
            let enCount = 0;
            for (const p of enResp.data) {
                const link = p.link || '';
                if (!link || seenLinks.has(link)) continue;

                const $ = cheerio.load(p.title?.rendered || '');
                const title = $.text().trim();
                const $excerpt = cheerio.load(p.excerpt?.rendered || '');
                const summary = $excerpt.text().trim();

                if (isNonBusiness(`${title} ${summary}`)) continue;
                seenLinks.add(link);

                let imageUrl = '';
                try {
                    const media = p._embedded?.['wp:featuredmedia'];
                    if (Array.isArray(media) && media[0]?.source_url) {
                        imageUrl = media[0].source_url;
                    }
                } catch (_) {}

                allArticles.push({
                    title: title,
                    link: link,
                    image: imageUrl,
                    category: 'money',
                    source: 'EconomyNext',
                    summary: summary,
                    full_text: summary,
                    published_at: p.date_gmt ? new Date(p.date_gmt + 'Z').toISOString() : new Date().toISOString(),
                    tags: ['Money', 'EconomyNext', 'Markets']
                });
                enCount++;
            }
            console.log(`    -> ${enCount} articles from EconomyNext`);
        }
    } catch (err) {
        console.log(`    [!] Error fetching EconomyNext: ${err.message}`);
    }

    // Fetch SriLankaBiz WP REST API (Markets, Bonds & Banking)
    try {
        console.log('\n[*] Fetching SriLankaBiz WP REST API (Markets & Banking)...');
        const slbResp = await axiosClient.get('https://srilankabiz.lk/wp-json/wp/v2/posts?per_page=12&_embed', {
            headers: { 'User-Agent': 'curl/7.88.1' }
        });
        if (Array.isArray(slbResp.data)) {
            let slbCount = 0;
            for (const p of slbResp.data) {
                const link = p.link || '';
                if (!link || seenLinks.has(link)) continue;

                const $ = cheerio.load(p.title?.rendered || '');
                const title = $.text().trim();
                const $excerpt = cheerio.load(p.excerpt?.rendered || '');
                const summary = $excerpt.text().trim();

                if (isNonBusiness(`${title} ${summary}`)) continue;
                seenLinks.add(link);

                let imageUrl = '';
                try {
                    const media = p._embedded?.['wp:featuredmedia'];
                    if (Array.isArray(media) && media[0]?.source_url) {
                        imageUrl = media[0].source_url;
                    }
                } catch (_) {}

                allArticles.push({
                    title: title,
                    link: link,
                    image: imageUrl,
                    category: 'money',
                    source: 'SriLankaBiz',
                    summary: summary,
                    full_text: summary,
                    published_at: p.date_gmt ? new Date(p.date_gmt + 'Z').toISOString() : new Date().toISOString(),
                    tags: ['Money', 'SriLankaBiz', 'Bonds']
                });
                slbCount++;
            }
            console.log(`    -> ${slbCount} articles from SriLankaBiz`);
        }
    } catch (err) {
        console.log(`    [!] Error fetching SriLankaBiz: ${err.message}`);
    }

    console.log(`\n[*] Total Pure Business Articles: ${allArticles.length}`);
    return allArticles;
}

// =========================================================================
// 3. CSE STOCK MARKET DATA
// =========================================================================
async function fetchCseStockData() {
    console.log('\n[*] Fetching CSE Stock Market Data...');
    const stocks = [];
    try {
        const params = new (require('url').URLSearchParams)();
        const resp = await axiosClient.post('https://www.cse.lk/api/todaySharePrice', '', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (Array.isArray(resp.data)) {
            // Sort by trade volume to get top stocks
            const sorted = resp.data.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
            for (const s of sorted.slice(0, 30)) {
                stocks.push({
                    symbol: s.symbol,
                    name: s.name || s.symbol,
                    lastTradedPrice: s.lastTradedPrice,
                    change: s.change,
                    changePercentage: s.changePercentage,
                    high: s.high,
                    low: s.low,
                    open: s.open,
                    quantity: s.quantity
                });
            }
            console.log(`    -> ${stocks.length} top stocks fetched`);
        }
    } catch (err) {
        console.log(`    [!] CSE Error: ${err.message}`);
    }

    // Market Summary
    let marketSummary = null;
    try {
        const mktResp = await axiosClient.post('https://www.cse.lk/api/marketSummery', '', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        marketSummary = mktResp.data;
        console.log(`    -> Market Summary: Trades=${marketSummary.trades}, Volume=Rs.${(marketSummary.tradeVolume / 1e6).toFixed(1)}M`);
    } catch (err) {
        console.log(`    [!] Market Summary Error: ${err.message}`);
    }

    return { stocks, marketSummary };
}

// =========================================================================
// 4. SAVE TO LOCAL JSON FILES
// =========================================================================
function saveToLocalJson(articles, cseData) {
    const now = new Date().toISOString();

    // Balance published articles across categories (6 per category published, rest pending review)
    const catPublishedCount = {};
    const feedData = articles.map((art, idx) => {
        const catSlug = art.category;
        const currentCount = catPublishedCount[catSlug] || 0;
        const isPublished = currentCount < 6;
        if (isPublished) catPublishedCount[catSlug] = currentCount + 1;

        return {
            id: String(Math.abs(hashCode(art.link))),
            url: art.link,
            image: art.image || '',
            source: art.source,
            scraped_at: now,
            published_at: art.published_at || now,
            headline_en: art.title,
            headline_si: art.title,
            summary_en: art.summary,
            summary_si: art.summary,
            full_text: art.full_text,
            key_takeaways: [art.title],
            category: art.category,
            category_slug: art.category,
            tags: art.tags,
            status: isPublished ? 'published' : 'pending_review'
        };
    });

    fs.writeFileSync('news_feed.json', JSON.stringify(feedData, null, 2), 'utf-8');
    fs.writeFileSync('news_feed.js',
        '// Auto-generated by auto_sync.js\nwindow.LIVE_NEWS_FEED = ' +
        JSON.stringify(feedData, null, 2) + ';\n', 'utf-8');

    // cse_data.json
    if (cseData) {
        fs.writeFileSync('cse_data.json', JSON.stringify(cseData, null, 2), 'utf-8');
    }

    // Full raw data
    fs.writeFileSync('news_data.json', JSON.stringify(articles, null, 2), 'utf-8');

    // Also sync editorial_state.json so editorial desk matches
    const editorialPath = path.join(__dirname, 'editorial', 'editorial_state.json');
    if (fs.existsSync(editorialPath)) {
        try {
            const state = JSON.parse(fs.readFileSync(editorialPath, 'utf8'));
            let publishedRank = 0;
            state.articles = feedData.map((a, idx) => {
                const isPub = a.status === 'published';
                let rank = null;
                if (isPub && publishedRank < 10) {
                    publishedRank++;
                    rank = publishedRank;
                }
                return {
                    id: a.id,
                    slug: `art-${idx}-${String(Math.abs(hashCode(a.headline_en))).slice(0, 6)}`,
                    status: a.status,
                    aiStatus: isPub ? 'ready_for_review' : 'not_started',
                    category: a.category,
                    sourceName: a.source,
                    sourceUrl: a.url,
                    publishedAt: a.published_at,
                    sourcePublishedAt: a.published_at,
                    scrapedAt: a.scraped_at,
                    imageUrl: a.image,
                    original: { headline: a.headline_en, summary: a.summary_en, body: a.full_text },
                    draft: { headline: a.headline_en, summary: a.summary_en, body: a.full_text },
                    tags: a.tags,
                    validation: [],
                    topRank: rank,
                    is_top_news: rank !== null,
                    audit: []
                };
            });
            fs.writeFileSync(editorialPath, JSON.stringify(state, null, 2), 'utf8');
            console.log(`[+] Synced ${state.articles.length} verified business articles to editorial_state.json (${publishedRank} in Top News)`);
        } catch (e) {
            console.log(`[!] Notice syncing editorial_state.json: ${e.message}`);
        }
    }

    console.log(`[+] Saved ${feedData.length} articles to news_feed.json, news_feed.js`);
    if (cseData) console.log(`[+] Saved CSE data (${cseData.stocks.length} stocks) to cse_data.json`);
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return hash;
}

// =========================================================================
// 5. SAVE TO SUPABASE (Optional)
// =========================================================================
async function saveToSupabase(articles, cseData) {
    if (!supabase) return;

    console.log('\n[*] Syncing to Supabase...');

    // Upsert news articles
    try {
        for (const art of articles) {
            await supabase.from('news_articles').upsert([{
                title: art.title,
                slug: art.link,
                summary: art.summary,
                content: art.full_text,
                category: art.category,
                author: art.source,
                image_url: art.image,
                created_at: art.published_at
            }], { onConflict: 'slug' });
        }
        console.log(`    -> ${articles.length} articles synced to Supabase`);
    } catch (err) {
        console.log(`    [!] Supabase news sync error: ${err.message}`);
    }

    // Upsert stock prices
    if (cseData && cseData.stocks) {
        try {
            for (const stock of cseData.stocks) {
                await supabase.from('stock_prices').upsert([{
                    symbol: stock.symbol,
                    company_name: stock.name,
                    last_traded_price: stock.lastTradedPrice,
                    change_amount: stock.change,
                    change_percentage: stock.changePercentage
                }], { onConflict: 'symbol' });
            }
            console.log(`    -> ${cseData.stocks.length} stocks synced to Supabase`);
        } catch (err) {
            console.log(`    [!] Supabase stock sync error: ${err.message}`);
        }
    }
}

// =========================================================================
// 6. MASTER SYNC
// =========================================================================
async function runMasterSync() {
    console.log('======================================================================');
    console.log(`[*] MASTER AGGREGATOR - ${new Date().toLocaleString()}`);
    console.log('======================================================================');

    // Fetch all data
    const [articles, cseData] = await Promise.all([
        fetchAllRssNews(),
        fetchCseStockData()
    ]);

    // Save locally
    saveToLocalJson(articles, cseData);

    // Save to Supabase (if configured)
    await saveToSupabase(articles, cseData);

    console.log('\n======================================================================');
    console.log(`[*] DONE! ${articles.length} articles + ${cseData.stocks.length} stocks synced`);
    console.log('======================================================================');
}

runMasterSync();
