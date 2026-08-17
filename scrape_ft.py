"""
=============================================================================
DAILY FT (ft.lk) FULL NEWS SCRAPER & PROXY / ANTI-BLOCK ENGINE
=============================================================================
Features:
1. Anti-Blocking Engine: CloudScraper + Proxy Support + User-Agent Rotation
2. Playwright fallback for Cloudflare/JS-rendered pages
3. Full Article Scraping: Extracts 100% full article paragraphs and body text from ft.lk
4. Real Oracle CDN Article Image resolution (og:image / listing img mapping)
5. Multi-strategy image extraction: og:image, data-src, data-lazy-src, srcset
6. Boilerplate content filtering (copyright, ads, footer text)
7. Saves to news_data.json, news_feed.json, and news_feed.js
"""

import cloudscraper
from bs4 import BeautifulSoup
import json
import re
import sys
import time
import os
import random
import logging
import urllib.parse
from datetime import datetime

# Windows console UTF-8 fix
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# ---- CONFIG ----
SECTIONS = [
    {"url": "https://www.ft.lk/front-page/44", "category": "Front Page"},
    {"url": "https://www.ft.lk/top-story/26", "category": "Top Story"},
    {"url": "https://www.ft.lk/financial-services/42", "category": "Financial Services"},
    {"url": "https://www.ft.lk/corporate/27", "category": "Corporate"},
    {"url": "https://www.ft.lk/opinion-and-issues/14", "category": "Opinion & Issues"},
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

DEFAULT_IMAGE = "https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn.ft.lk/ftlk_logo_og.png"

# Boilerplate content patterns to filter out
BOILERPLATE_PATTERNS = [
    r"^Copyright", r"^Daily FT", r"^Follow us", r"^\+94",
    r"hitsCtrl", r"General Manager.*Sales.*Marketing",
    r"All the content on this website is copyright",
    r"Wijeya Newspapers", r"^Share this article",
]
BOILERPLATE_RE = re.compile("|".join(BOILERPLATE_PATTERNS), re.IGNORECASE)

# Playwright browser instance (lazy init)
_pw_instance = None
_pw_browser = None
_pw_page = None


def init_playwright():
    """Lazy-init Playwright Chromium for JS-rendered fallback."""
    global _pw_instance, _pw_browser, _pw_page
    if _pw_page is not None:
        return True
    try:
        from playwright.sync_api import sync_playwright
        _pw_instance = sync_playwright().start()
        _pw_browser = _pw_instance.chromium.launch(headless=True)
        _pw_page = _pw_browser.new_page()
        _pw_page.set_extra_http_headers({"Accept-Language": "en-US,en;q=0.9"})
        print("[PLAYWRIGHT] ✅ Chromium initialised (JS fallback ready)")
        return True
    except ImportError:
        print("[PLAYWRIGHT] ⚠️  Not installed. Run: pip install playwright && playwright install chromium")
        return False
    except Exception as e:
        print(f"[PLAYWRIGHT] ⚠️  Init failed: {e}")
        return False


def close_playwright():
    """Cleanup Playwright resources."""
    global _pw_instance, _pw_browser, _pw_page
    if _pw_browser:
        try:
            _pw_browser.close()
        except Exception:
            pass
    if _pw_instance:
        try:
            _pw_instance.stop()
        except Exception:
            pass
    _pw_instance = _pw_browser = _pw_page = None


def playwright_fetch(url):
    """Fetch page HTML using Playwright (JS-rendered)."""
    global _pw_page
    if not _pw_page and not init_playwright():
        return None
    try:
        _pw_page.goto(url, wait_until="domcontentloaded", timeout=45000)
        _pw_page.wait_for_timeout(4000)
        return _pw_page.content()
    except Exception as e:
        print(f"[PLAYWRIGHT] Error fetching {url}: {e}")
        return None


def create_anti_block_scraper(proxy_url=None):
    """
    Creates a CloudScraper instance with optional Proxy support.
    Proxy format: "http://user:pass@proxy.example.com:8080" or "http://127.0.0.1:8080"
    """
    scraper = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
    )
    
    # Check environment variables for proxy if not passed explicitly
    if not proxy_url:
        proxy_url = os.getenv("PROXY_URL") or os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY")

    if proxy_url:
        print(f"[PROXIES] Routing requests via Proxy: {proxy_url}")
        scraper.proxies = {
            "http": proxy_url,
            "https": proxy_url
        }

    return scraper


def fetch_full_article_details(article_url, scraper):
    """
    Fetches full article webpage from ft.lk to extract:
    - 100% full news body text / paragraphs
    - og:image photo (with lazy-load fallback)
    - Summary
    Uses Playwright fallback if CloudScraper gets blocked.
    """
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.ft.lk/"
    }

    soup = None
    try:
        resp = scraper.get(article_url, headers=headers, timeout=12)
        if resp.status_code == 403 or resp.status_code == 503:
            # Cloudflare challenge — try Playwright fallback
            print(f"      [!] HTTP {resp.status_code} — trying Playwright fallback…")
            html = playwright_fetch(article_url)
            if html:
                soup = BeautifulSoup(html, 'html.parser')
        elif resp.status_code != 200:
            return {"image": "", "summary": "", "full_text": "", "paragraphs": []}
        else:
            soup = BeautifulSoup(resp.content, 'html.parser')
    except Exception as e:
        print(f"      [!] CloudScraper failed: {e} — trying Playwright…")
        html = playwright_fetch(article_url)
        if html:
            soup = BeautifulSoup(html, 'html.parser')

    if not soup:
        return {"image": "", "summary": "", "full_text": "", "paragraphs": []}

    # 1. Multi-strategy image extraction
    image_url = ""

    # Strategy A: og:image meta tag (most reliable for ft.lk)
    og_img = soup.find('meta', property='og:image') or soup.find('meta', attrs={'name': 'og:image'})
    if og_img and og_img.get('content', '').strip().startswith('http'):
        image_url = og_img['content'].strip()

    # Strategy B: twitter:image fallback
    if not image_url:
        tw_img = soup.find('meta', property='twitter:image') or soup.find('meta', attrs={'name': 'twitter:image'})
        if tw_img and tw_img.get('content', '').strip().startswith('http'):
            image_url = tw_img['content'].strip()

    # Strategy C: Article content area img (with lazy-load attribute support)
    if not image_url:
        for img_sel in ('.inner-content img', '.inner-d img', 'article img', '.col-xl-12 img'):
            img_tag = soup.select_one(img_sel)
            if img_tag:
                for attr in ('data-src', 'data-lazy-src', 'data-original', 'src'):
                    val = (img_tag.get(attr) or '').strip()
                    if val and val.startswith('http') and not val.startswith('data:'):
                        # Check it's an actual article image
                        if any(kw in val.lower() for kw in ('uploads', 'cdn', 'oraclecloud', '.jpg', '.jpeg', '.png', '.webp')):
                            image_url = val
                            break
                if image_url:
                    break

    # 2. Extract full paragraphs with improved boilerplate filtering
    paragraphs = []
    p_tags = soup.find_all('p')

    for p in p_tags:
        txt = p.get_text(strip=True)
        # Filter boilerplate and short fragments
        if len(txt) > 40 and not BOILERPLATE_RE.search(txt):
            paragraphs.append(txt)

    full_text = "\n\n".join(paragraphs) if paragraphs else ""
    summary = paragraphs[0] if paragraphs else ""

    return {
        "image": image_url,
        "summary": summary,
        "full_text": full_text,
        "paragraphs": paragraphs
    }


def extract_articles_from_section(soup, category, scraper, seen_links, max_full_fetches=15):
    """
    Extracts article links from section page and fetches full article details.
    """
    articles = []

    # Map image thumbnails on section grid page
    img_map = {}
    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href'].strip()
        if not re.search(r'/\d+-\d+$', href):
            continue
        img = a_tag.find('img')
        if img:
            # Check multiple lazy-load attributes in priority order
            src = None
            for attr in ('data-src', 'data-lazy-src', 'data-original', 'src'):
                val = (img.get(attr) or '').strip()
                if val and not val.startswith('data:'):
                    src = val
                    break
            if src and ('uploads' in src or 'cdn' in src or 'oraclecloud' in src or src.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                full_url = src if src.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", src)
                full_href = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)
                img_map[full_href] = full_url

    containers = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)

    count = 0
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

        grid_image = img_map.get(full_url, "")

        # Fetch full article text & og:image details using CloudScraper
        print(f"   [+] Fetching Full News Body: {title[:50]}...")
        details = fetch_full_article_details(full_url, scraper)

        image_url = grid_image or details.get("image") or DEFAULT_IMAGE
        summary = details.get("summary") or f"Read the full story on Daily FT: {title}"
        full_text = details.get("full_text") or summary

        article_item = {
            "title": title,
            "link": full_url,
            "image": image_url,
            "category": category,
            "summary": summary,
            "full_text": full_text,
            "paragraphs": details.get("paragraphs", [])
        }

        articles.append(article_item)
        seen_links.add(full_url)
        count += 1

        # Rate limit delay to prevent IP bans
        time.sleep(0.3)

        if count >= max_full_fetches:
            break

    return articles


def scrape_daily_ft(proxy_url=None):
    """
    Main Daily FT Scraper.
    Supports proxy_url (e.g. "http://user:pass@proxy.example.com:8080")
    """
    scraper = create_anti_block_scraper(proxy_url)
    all_articles = []
    seen_links = set()

    print("======================================================================")
    print(f"[*] DAILY FT FULL NEWS & PROXY ANTI-BLOCK SCRAPER - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("======================================================================")

    for sec in SECTIONS:
        sec_url = sec["url"]
        sec_cat = sec["category"]
        print(f"\n[*] Fetching section: {sec_cat} ({sec_url})")

        try:
            resp = scraper.get(sec_url, headers={"User-Agent": random.choice(USER_AGENTS)}, timeout=15)
            if resp.status_code != 200:
                print(f"    [!] HTTP {resp.status_code}")
                continue

            soup = BeautifulSoup(resp.content, 'html.parser')
            articles = extract_articles_from_section(soup, sec_cat, scraper, seen_links)
            all_articles.extend(articles)
            print(f"    -> Extracted {len(articles)} full articles from {sec_cat}")

        except Exception as e:
            print(f"    [!] Error scraping {sec_url}: {e}")

    print("\n======================================================================")
    print(f"[*] Total Full Articles Scraped: {len(all_articles)}")
    print("======================================================================")

    # Save news_data.json
    with open('news_data.json', 'w', encoding='utf-8') as f:
        json.dump(all_articles, f, ensure_ascii=False, indent=2)

    # Save news_feed.json (compatible with app.js frontend)
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    feed_data = []
    for idx, art in enumerate(all_articles):
        feed_data.append({
            "id": str(hash(art['link']) & 0xFFFFFFFFFFFF),
            "url": art['link'],
            "image": art['image'],
            "source": "Daily FT (ft.lk)",
            "scraped_at": now_str,
            "headline_en": art['title'],
            "headline_si": art['title'],
            "summary_en": art['summary'],
            "summary_si": art['summary'],
            "full_text": art['full_text'],
            "key_takeaways": [art['title']],
            "category": art['category'],
            "tags": [art['category'], "Daily FT", "Sri Lanka"],
        })

    with open('news_feed.json', 'w', encoding='utf-8') as f:
        json.dump(feed_data, f, ensure_ascii=False, indent=2)

    # Save news_feed.js
    with open('news_feed.js', 'w', encoding='utf-8') as f:
        f.write("// Auto-generated by scrape_ft.py\n")
        f.write("window.LIVE_NEWS_FEED = ")
        json.dump(feed_data, f, ensure_ascii=False, indent=2)
        f.write(";\n")

    print("[+] Saved 100% full news articles to news_data.json, news_feed.json, and news_feed.js!")
    return all_articles


if __name__ == "__main__":
    try:
        scrape_daily_ft()
    finally:
        close_playwright()
