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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
});

// Force IPv4
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosClient = axios.create({ httpAgent, httpsAgent, timeout: 15000 });

// ---- Supabase (Optional) ----
let supabase = null;
try {
    const { createClient } = require('@supabase/supabase-js');
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
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
// 1. RSS FEED SOURCES (NO BLOCKING! 100% SAFE!)
// =========================================================================
const RSS_FEEDS = [
    // Daily FT - All Sections
    { source: 'Daily FT', category: 'Front Page', url: 'https://www.ft.lk/rss/front-page/44' },
    { source: 'Daily FT', category: 'Top Story', url: 'https://www.ft.lk/rss/top-story/26' },
    { source: 'Daily FT', category: 'Financial Services', url: 'https://www.ft.lk/rss/financial-services/42' },
    { source: 'Daily FT', category: 'Corporate', url: 'https://www.ft.lk/rss/corporate/27' },
    { source: 'Daily FT', category: 'Opinion & Issues', url: 'https://www.ft.lk/rss/opinion-and-issues/14' },

    // Other Sri Lankan Business News
    { source: 'EconomyNext', category: 'Business', url: 'https://economynext.com/feed/' },
    { source: 'LBO', category: 'Business', url: 'https://www.lankabusinessonline.com/feed/' },
];

// =========================================================================
// 2. FETCH ALL NEWS FROM RSS (Block-Free!)
// =========================================================================
async function fetchAllRssNews() {
    console.log('\n======================================================================');
    console.log('[*] RSS NEWS AGGREGATOR - FETCHING ALL SRI LANKA BUSINESS NEWS');
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

                // Clean summary
                let summary = item.contentSnippet || item.content || '';
                if (summary.length > 500) summary = summary.substring(0, 500) + '...';
                // Strip HTML tags
                summary = summary.replace(/<[^>]*>/g, '').trim();

                const article = {
                    title: (item.title || '').trim(),
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

    console.log(`\n[*] Total RSS Articles: ${allArticles.length}`);
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

    // news_feed.json (for frontend app.js)
    const feedData = articles.map((art, idx) => ({
        id: String(Math.abs(hashCode(art.link))),
        url: art.link,
        image: art.image || '',
        source: art.source,
        scraped_at: now,
        headline_en: art.title,
        headline_si: art.title,
        summary_en: art.summary,
        summary_si: art.summary,
        full_text: art.full_text,
        key_takeaways: [art.title],
        category: art.category,
        tags: art.tags
    }));

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
