'use strict';

require('dotenv').config();
const { SupabaseEditorialStore } = require('./editorial/supabase_store');

function classifyArticle(title = '', sourceCat = '', content = '') {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  const supplied = String(sourceCat || '').trim().toLowerCase().replace('&', 'and');

  const explicitMap = {
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
    'banking': 'money',
    'technology': 'technology',
    'tech': 'technology',
    'it': 'technology',
    'digital': 'technology',
    'travel-tourism': 'travel-tourism',
    'travel and tourism': 'travel-tourism',
    'tourism': 'travel-tourism',
    'travel': 'travel-tourism',
    'hospitality': 'travel-tourism',
    'luxury-living': 'luxury-living',
    'luxury living': 'luxury-living',
    'luxury': 'luxury-living',
    'lifestyle': 'luxury-living',
    'property': 'luxury-living',
    'real estate': 'luxury-living'
  };

  if (explicitMap[supplied] && ['interviews-appointments', 'money', 'technology', 'travel-tourism', 'luxury-living'].includes(explicitMap[supplied])) {
    return explicitMap[supplied];
  }

  const headline = cleanTitle.toLowerCase();
  const lead = `${cleanTitle} ${cleanContent.slice(0, 1000)}`.toLowerCase();

  // 1. Interviews & Appointments
  if (['appointed', 'appointment', 'assumes duties', 'new chairman', 'new director', 'new ceo', 'new managing director', 'sworn in', 'promoted', 'board of directors', 'executive officer', 'interview', 'speaks on', 'in conversation with', 'q&a', 'takes office', 'head of', 'secretary to the ministry', 'commander', 'director general'].some(t => headline.includes(t) || lead.slice(0, 300).includes(t))) {
    return 'interviews-appointments';
  }

  // 2. Travel & Tourism
  if (['tourism', 'tourist', 'travel', 'hotel', 'resort', 'hospitality', 'airline', 'flight', 'srilankan airlines', 'destination', 'visitor arrivals', 'passenger', 'airport', 'aviation', 'leisure', 'beach'].some(t => lead.includes(t))) {
    return 'travel-tourism';
  }

  // 3. Technology
  if (['technology', 'tech', 'artificial intelligence', ' ai ', ' digital ', 'digitalization', 'digital transformation', 'cybersecurity', 'software', 'app ', 'apps', 'telecom', 'dialog', 'mobitel', 'slt', 'cloud', 'fintech', 'robot', 'data center', 'internet'].some(t => lead.includes(t))) {
    return 'technology';
  }

  // 4. Luxury Living & Real Estate
  if (['luxury', 'lifestyle', 'premium', 'residences', 'apartment', 'real estate', 'villa', 'waterfront', 'mercedes', 'bmw', 'porsche', 'range rover', 'vehicle', 'car', 'fashion', 'jewellery', 'watches', 'fine dining', 'art'].some(t => lead.includes(t))) {
    return 'luxury-living';
  }

  // 5. Money & Banking
  if (['central bank', 'cbsl', 'monetary policy', 'interest rate', 'inflation', 'treasury bill', 'treasury bond', 'stock market', 'colombo stock exchange', 'cse', 'banking sector', 'commercial bank', 'hatton national bank', 'sampath bank', 'seyban', 'bank of ceylon', 'tax revenue', 'imf', 'debt restructuring', 'financial performance', 'net profit', 'gross profit', 'dividend', 'earnings per share', 'market capitalization', 'bond market'].some(t => lead.includes(t))) {
    return 'money';
  }

  return 'business-news';
}

async function run() {
  const store = new SupabaseEditorialStore();
  const available = await store.available();
  if (!available) {
    console.error('Supabase is not available');
    process.exit(1);
  }

  console.log('Fetching articles from Supabase...');
  const articles = await store.listArticles({ status: 'all' });
  console.log(`Total articles found: ${articles.length}`);

  const countsBefore = {};
  const countsAfter = {};
  let updatedCount = 0;

  for (const article of articles) {
    const currentCategory = article.category || 'business-news';
    countsBefore[currentCategory] = (countsBefore[currentCategory] || 0) + 1;

    const newCategory = classifyArticle(article.title, article.sourceCategory, article.draft?.body || article.original?.body);
    countsAfter[newCategory] = (countsAfter[newCategory] || 0) + 1;

    if (newCategory !== currentCategory) {
      try {
        await store.updateArticle(article.id, { category: newCategory }, 'system-reclassifier');
        updatedCount++;
      } catch (err) {
        console.error(`Failed to update article ${article.id}:`, err.message);
      }
    }
  }

  console.log('\n--- Category Distribution Before ---');
  console.log(countsBefore);

  console.log('\n--- Category Distribution After ---');
  console.log(countsAfter);

  console.log(`\nRe-classification complete! ${updatedCount} articles updated.`);
}

run().catch(console.error);
