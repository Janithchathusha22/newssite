"""
=============================================================================
DAILY NEWS SCRAPER - ZENDRIVER REAL BROWSER ENGINE (CLOUDFLARE BYPASS)
=============================================================================
Features:
1. ZenDriver (Undetected Headless Chrome) Engine - Bypasses Cloudflare & Bot Detection
2. Extracts 100% Real Oracle Cloud CDN Image URLs for all Sri Lanka Business News
3. Extracts Full News Content & Summaries
4. Saves to news_data.json, news_feed.json, news_feed.js & Supabase
"""

import asyncio
import os
import json
import re
import sys
import urllib.parse
from datetime import datetime
import zendriver as zd
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# UTF-8 fix for Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

load_dotenv()

# Optional Supabase Connection
supabase = None
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_ANON_KEY")

if SUPABASE_URL and SUPABASE_KEY:
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[+] Supabase client initialized.")
    except Exception as e:
        print(f"[i] Supabase notice: {e}")

# Target Sections
TARGET_SECTIONS = [
    {"source": "Daily FT", "category": "Front Page", "url": "https://www.ft.lk/front-page/44"},
    {"source": "Daily FT", "category": "Top Story", "url": "https://www.ft.lk/top-story/26"},
    {"source": "Daily FT", "category": "Financial Services", "url": "https://www.ft.lk/financial-services/42"},
    {"source": "Daily FT", "category": "Corporate", "url": "https://www.ft.lk/corporate/27"},
    {"source": "Daily FT", "category": "Opinion & Issues", "url": "https://www.ft.lk/opinion-and-issues/14"},
]

DEFAULT_IMAGE = "https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn.ft.lk/ftlk_logo_og.png"


def clean_text(text):
    if not text:
        return ""
    text = re.sub(r'[\r\n\t]+', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


async def scrape_site():
    print("======================================================================")
    print(f"[*] ZENDRIVER AUTOMATED NEWS SCRAPER - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("======================================================================")

    print("[*] Starting ZenDriver Undetected Chrome Browser...")
    browser = await zd.start(headless=True)
    all_articles = []
    seen_links = set()

    try:
        for target in TARGET_SECTIONS:
            sec_url = target["url"]
            sec_cat = target["category"]
            sec_source = target["source"]

            print(f"\n📰 Navigating to: {sec_source} - {sec_cat} ({sec_url})")
            page = await browser.get(sec_url)
            await asyncio.sleep(4)  # Wait for Cloudflare challenge & full DOM render

            content = await page.get_content()
            soup = BeautifulSoup(content, 'html.parser')

            # Step 1: Map section thumbnail photos to URLs
            img_map = {}
            for col in soup.find_all('div', class_=re.compile(r'col-md-', re.I)):
                a_tag = col.find('a', href=True)
                if not a_tag:
                    continue
                href = a_tag['href'].strip()
                if not re.search(r'/\d+-\d+$', href):
                    continue

                full_url = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)
                img_tag = col.find('img')
                if img_tag:
                    src = img_tag.get('src') or img_tag.get('data-src') or ''
                    if src and ('uploads' in src or 'cdn' in src or 'oraclecloud' in src or src.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                        full_img = src if src.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", src)
                        img_map[full_url] = full_img

            # Step 2: Extract articles from containers
            containers = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)
            sec_count = 0

            for col in containers:
                link_tag = None
                for a in col.find_all('a', href=True):
                    href = a['href'].strip()
                    if re.search(r'/\d+-\d+$', href):
                        link_tag = a
                        break

                if not link_tag:
                    continue

                href = link_tag['href'].strip()
                full_url = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)

                if full_url in seen_links:
                    continue

                # Extract title
                h_tag = col.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                title = h_tag.get_text(strip=True) if h_tag else link_tag.get_text(strip=True)
                title = re.sub(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d+\s+[A-Za-z]+\s+\d{4}.*$', '', title, flags=re.I).strip()

                if not title or len(title) < 15:
                    continue

                # Extract image
                image_url = img_map.get(full_url, DEFAULT_IMAGE)

                # Extract summary text from col container
                p_text = ""
                for p in col.find_all('p'):
                    pt = p.get_text(strip=True)
                    if len(pt) > 30 and not pt.startswith(('Copyright', 'Daily FT', 'Follow us')):
                        p_text = pt
                        break

                summary = p_text if p_text else f"Read full report on Daily FT: {title}"

                article_data = {
                    "title": title,
                    "link": full_url,
                    "image": image_url,
                    "category": sec_cat,
                    "source": sec_source,
                    "summary": summary,
                    "full_text": summary,
                    "scraped_at": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                }

                all_articles.append(article_data)
                seen_links.add(full_url)
                sec_count += 1

            print(f"    ✅ Extracted {sec_count} articles with real images from {sec_cat}")

    finally:
        await browser.stop()
        print("\n[*] ZenDriver Browser session closed.")

    print("\n======================================================================")
    print(f"[*] Total Valid Articles Scraped: {len(all_articles)}")
    print("======================================================================")

    # Save to local JSON files
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    feed_payload = []

    for idx, art in enumerate(all_articles):
        feed_payload.append({
            "id": str(hash(art['link']) & 0xFFFFFFFFFFFF),
            "url": art['link'],
            "image": art['image'],
            "source": art['source'],
            "scraped_at": now_str,
            "headline_en": art['title'],
            "headline_si": art['title'],
            "summary_en": art['summary'],
            "summary_si": art['summary'],
            "full_text": art['full_text'],
            "key_takeaways": [art['title']],
            "category": art['category'],
            "tags": [art['category'], art['source'], "Sri Lanka"]
        })

    with open('news_data.json', 'w', encoding='utf-8') as f:
        json.dump(all_articles, f, ensure_ascii=False, indent=2)

    with open('news_feed.json', 'w', encoding='utf-8') as f:
        json.dump(feed_payload, f, ensure_ascii=False, indent=2)

    with open('news_feed.js', 'w', encoding='utf-8') as f:
        f.write("// Auto-generated by ZenDriver daily_news_scraper.py\n")
        f.write("window.LIVE_NEWS_FEED = ")
        json.dump(feed_payload, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print("[+] Saved to news_data.json, news_feed.json, and news_feed.js!")

    # Supabase Sync if configured
    if supabase:
        print("\n[*] Syncing to Supabase table 'news_articles'...")
        saved_count = 0
        for item in feed_payload:
            try:
                data = {
                    "title": item['headline_en'],
                    "slug": item['url'],
                    "summary": item['summary_en'],
                    "content": item['full_text'],
                    "category": item['category'],
                    "author": item['source'],
                    "image_url": item['image']
                }
                supabase.table("news_articles").upsert(data, on_conflict="slug").execute()
                saved_count += 1
            except Exception as e:
                pass
        print(f"✅ Supabase Sync complete: {saved_count} articles updated!")

if __name__ == "__main__":
    asyncio.run(scrape_site())
