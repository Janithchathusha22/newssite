/**
 * =============================================================================
 * GEMINI AI NEWS PROCESSING & TRANSLATION ENGINE
 * =============================================================================
 * Ingests raw scraped news from Daily FT (ft.lk), processes them via Gemini AI,
 * rewrites into unique journalism voice, generates executive takeaways, 
 * translates to Sinhala, and categorizes into Business vs. Governance.
 */

const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

// Initialize Gemini API Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "YOUR_GEMINI_API_KEY" });

async function processNewsItem(rawNews) {
    console.log(`[*] Processing with Gemini AI: "${rawNews.raw_title}"...`);

    const prompt = `
You are an expert financial journalist and news editor for a Sri Lanka e-newspaper focusing ONLY on Business and Governance news.

Given the following raw news article scraped from Daily FT (ft.lk):
Title: "${rawNews.raw_title}"
Summary: "${rawNews.raw_summary}"
Original Category: "${rawNews.category}"

Please return a valid JSON object with the following fields:
1. "headline_en": A rewritten, catchy, professional headline in English (to ensure original editorial voice).
2. "headline_si": Accurate, high-quality Sinhala translation of the headline using standard formal financial Sinhala.
3. "summary_en": Concise executive summary (max 3 sentences) in English.
4. "summary_si": Concise executive summary in Sinhala.
5. "key_takeaways": Array of 3 bullet points summarizing critical business/policy impacts.
6. "category": Strictly one of ["Business & Corporate", "Governance & Policy", "Economy & Finance", "ESG & Sustainability"].
7. "tags": Array of 4 relevant tags (e.g. ["CBSL", "Banking", "Inflation"]).

Respond ONLY with raw JSON, no markdown formatting.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: prompt
        });

        const text = response.text.replace(/```json|```/g, '').trim();
        const processedJSON = JSON.parse(text);
        
        return {
            ...rawNews,
            ai_processed: processedJSON,
            processed_at: new Date().toISOString()
        };
    } catch (err) {
        console.error(`[-] AI Processing Error:`, err.message);
        return {
            ...rawNews,
            ai_processed: {
                headline_en: rawNews.raw_title,
                headline_si: rawNews.raw_title,
                category: "Business & Governance",
                key_takeaways: ["Manual review required"]
            }
        };
    }
}

async function runBatchProcessor() {
    if (!fs.existsSync('./scraped_ft_news.json')) {
        console.log("[-] 'scraped_ft_news.json' not found. Run scraper.py first.");
        return;
    }

    const rawData = JSON.parse(fs.readFileSync('./scraped_ft_news.json', 'utf8'));
    console.log(`[+] Loaded ${rawData.length} articles for AI processing...`);

    const processedResults = [];
    // Process first 3 items as demonstration
    for (const item of rawData.slice(0, 3)) {
        const result = await processNewsItem(item);
        processedResults.push(result);
    }

    fs.writeFileSync('./ai_final_news_feed.json', JSON.stringify(processedResults, null, 2));
    console.log(`[+] Complete! Saved AI processed feed to 'ai_final_news_feed.json'`);
}

// Execute if run directly
if (require.main === module) {
    runBatchProcessor();
}
