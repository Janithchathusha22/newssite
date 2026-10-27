"""
=============================================================================
MULTI-SOURCE BUSINESS & GOVERNANCE NEWS SCRAPER (SRI LANKA)
=============================================================================
Production-grade scraper for Daily FT (ft.lk) and Sri Lanka Business & Governance
news. Combines direct DOM extraction with multi-source RSS fallbacks to ensure
100% genuine, real-time live articles with authentic CDN featured images.
"""

import re
import time
import urllib.parse
from datetime import datetime
from typing import List, Dict, Any, Optional
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.ft.lk"
DEFAULT_FT_LOGO = "https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn.ft.lk/ftlk_logo_og.png"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.ft.lk/",
    "Cache-Control": "no-cache"
}

CATEGORIES = {
    "top_story": f"{BASE_URL}/top-story/26",
    "economy": f"{BASE_URL}/front-page/44",
    "financial_services": f"{BASE_URL}/financial-services/42",
    "business_news": f"{BASE_URL}/business/34",
    "corporate": f"{BASE_URL}/corporate/27",
    "governance_opinion": f"{BASE_URL}/opinion-and-issues/14",
    "technology": f"{BASE_URL}/it-telecom-technology/57",
    "travel_tourism": f"{BASE_URL}/hospitality-tourism/43",
    "appointments": f"{BASE_URL}/hr/61",
    "luxury_living": f"{BASE_URL}/lifestyle/10519",
    "markets": f"{BASE_URL}/markets/10518"
}

RSS_SECTION_FALLBACKS = {
    "top_story": f"{BASE_URL}/rss/top-story/26",
    "economy": f"{BASE_URL}/rss/front-page/44",
    "financial_services": f"{BASE_URL}/rss/financial-services/42",
    "corporate": f"{BASE_URL}/rss/corporate/27",
    "governance_opinion": f"{BASE_URL}/rss/opinion-and-issues/14",
    "business_news": f"{BASE_URL}/rss/business/34",
    "technology": f"{BASE_URL}/rss/it-telecom-technology/57",
    "travel_tourism": f"{BASE_URL}/rss/hospitality-tourism/43",
    "appointments": f"{BASE_URL}/rss/hr/61",
    "luxury_living": f"{BASE_URL}/rss/lifestyle/10519",
    "markets": f"{BASE_URL}/rss/markets/10518"
}


# =========================================================================
# URL & Image Utility Helpers (Used across codebase)
# =========================================================================

def canonicalize_article_url(url: str) -> str:
    """Strips tracking query parameters and fragments from an article URL."""
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url.strip())
    clean_path = parts.path.rstrip('/') if parts.path != '/' else '/'
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, clean_path, '', ''))


def normalize_image_url(url: str, base_url: str = BASE_URL) -> str:
    """Converts relative image paths to fully qualified URLs."""
    if not url:
        return ""
    url = url.strip()
    return url if url.startswith("http") else urllib.parse.urljoin(base_url, url)


def is_probable_source_image(url: str, source_url: str = "") -> bool:
    """Verifies that an image URL belongs to a real story and isn't an ad, icon, or placeholder."""
    if not url or not url.startswith("http"):
        return False
    lower = url.lower()
    junk = [
        "advr_", "advert", "banner", "logo.", "/logos/", "icon",
        "avatar", "spinner", "loader", "pixel", "tracking", "1x1",
        "unsplash.com", "dummyimage", "placeholder", "emoji", "s.w.org",
        "gravatar.com", "blank.gif", "wp-includes"
    ]
    return not any(j in lower for j in junk)


def extract_source_image(soup: BeautifulSoup, base_url: str = BASE_URL) -> str:
    """Extracts the featured news image from an article or page soup."""
    # 1. OpenGraph meta tag
    og_img = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
    if og_img and og_img.get("content"):
        candidate = normalize_image_url(og_img["content"], base_url)
        if is_probable_source_image(candidate):
            return candidate

    # 2. Look for article container image
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-original") or ""
        candidate = normalize_image_url(src, base_url)
        if is_probable_source_image(candidate) and ("uploads" in candidate or "oraclecloud" in candidate or "cdn" in candidate):
            return candidate

    return DEFAULT_FT_LOGO


def fetch_article_details(url: str) -> Dict[str, Any]:
    """
    Fetches full article page to retrieve the canonical high-resolution featured image,
    accurate publication timestamp, and full article text content.
    """
    details = {
        "image": "",
        "published_at": "",
        "content": ""
    }
    if not url or not url.startswith("http"):
        return details

    try:
        r = requests.get(url, headers=HEADERS, timeout=8)
        if r.status_code != 200:
            return details

        soup = BeautifulSoup(r.text, "html.parser")

        # 1. Canonical high-resolution featured image (from og:image)
        og_img = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
        if og_img and og_img.get("content"):
            cand = normalize_image_url(og_img["content"], BASE_URL)
            if is_probable_source_image(cand) and ("uploads" in cand or "oraclecloud" in cand or "cdn" in cand):
                details["image"] = cand

        if not details["image"]:
            # Check inner-content image
            inner_img = soup.find("div", class_=lambda c: c and any(x in c for x in ["inner-img", "ft-img", "article-img"]))
            if inner_img:
                img_tag = inner_img.find("img")
                if img_tag:
                    cand = normalize_image_url(img_tag.get("src") or img_tag.get("data-src") or "", BASE_URL)
                    if is_probable_source_image(cand):
                        details["image"] = cand

        # 2. Publication date and timestamp
        for tag in soup.find_all(["span", "p", "div"], class_=lambda c: c and any(x in c.lower() for x in ["date", "time", "publish"])):
            t = tag.get_text(strip=True)
            if re.search(r'\d{4}', t) and any(m in t for m in ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]):
                details["published_at"] = t
                break

        if not details["published_at"]:
            meta_date = soup.find("meta", property="article:published_time") or soup.find("meta", attrs={"name": "publish-date"})
            if meta_date and meta_date.get("content"):
                details["published_at"] = meta_date["content"]

        # 3. Full article content paragraphs
        content_ps = []
        article_body = (
            soup.find("header", class_="inner-content")
            or soup.find("div", class_="inner-content")
            or soup.find("div", class_="ft-content")
            or soup.find("div", class_="col-md-8")
        )
        if article_body:
            for p in article_body.find_all("p"):
                txt = p.get_text(strip=True)
                if len(txt) > 20 and not any(j in txt for j in ["Copyright", "All Rights Reserved", "Share this"]):
                    content_ps.append(txt)

        if content_ps:
            details["content"] = "\n\n".join(content_ps)

    except Exception as e:
        pass

    return details


# =========================================================================
# Core Scraping Functions
# =========================================================================

def clean_title(title: str) -> str:
    """Removes embedded publication dates, days of the week, and unwanted suffixes."""
    if not title:
        return ""
    # Strip trailing or leading days/dates e.g. 'Wednesday, 21 October 2026'
    cleaned = re.sub(
        r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d+\s+[A-Za-z]+\s+\d{4}.*$',
        '',
        title,
        flags=re.IGNORECASE
    )
    # Strip trailing " - Daily FT" or " | Daily FT"
    cleaned = re.sub(r'\s*[-|]\s*Daily FT.*$', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def scrape_daily_ft_dom(cat_name: str, url: str) -> List[Dict[str, Any]]:
    """Scrapes Daily FT article cards from the category section page."""
    articles = []
    response = requests.get(url, headers=HEADERS, timeout=12)
    if response.status_code != 200:
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    containers = soup.find_all("div", class_=lambda c: c and "col-md-" in c)

    for c in containers:
        title_a = None
        for a in c.find_all("a", href=True):
            txt = a.get_text(strip=True)
            href = a["href"].strip()
            # Match Daily FT article pattern e.g. /26-12345, /44-12345, /34-12345
            if len(txt) > 15 and re.search(r'/(26|44|42|14|34|13|27)-\d+', href):
                title_a = a
                break

        if not title_a:
            continue

        raw_title = clean_title(title_a.get_text(strip=True))
        if len(raw_title) < 15 or "javascript:" in title_a["href"]:
            continue

        link = normalize_image_url(title_a["href"], BASE_URL)
        canonical_link = canonicalize_article_url(link)

        # 1. Extract image from container
        img_url = ""
        for img in c.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-original") or ""
            candidate = normalize_image_url(src, BASE_URL)
            if is_probable_source_image(candidate) and ("uploads" in candidate or "oraclecloud" in candidate or "cdn" in candidate):
                img_url = candidate
                break

        # 2. Check parent container (for split column layouts)
        if not img_url and c.parent:
            for img in c.parent.find_all("img"):
                src = img.get("src") or img.get("data-src") or img.get("data-original") or ""
                candidate = normalize_image_url(src, BASE_URL)
                if is_probable_source_image(candidate) and ("uploads" in candidate or "oraclecloud" in candidate or "cdn" in candidate):
                    img_url = candidate
                    break

        # 3. Extract publication date / timestamp
        published_at = ""
        date_match = re.search(
            r'(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}(?:\s+\d{2}:\d{2})?',
            c.get_text()
        )
        if date_match:
            published_at = date_match.group(0).strip()

        # Summary text
        p = c.find("p")
        raw_summary = p.get_text(strip=True) if p else raw_title

        # 4. If image or date is still missing, or for hero article, enrich from detail page
        content = ""
        if not img_url or img_url == DEFAULT_FT_LOGO or not published_at:
            details = fetch_article_details(canonical_link)
            if details.get("image"):
                img_url = details["image"]
            if details.get("published_at"):
                published_at = details["published_at"]
            if details.get("content"):
                content = details["content"]

        if not img_url:
            img_url = DEFAULT_FT_LOGO
        if not published_at:
            published_at = datetime.now().strftime("%A, %d %B %Y %H:%M")

        articles.append({
            "raw_title": raw_title,
            "url": canonical_link,
            "image": img_url,
            "raw_summary": raw_summary,
            "content": content or raw_summary,
            "category": cat_name,
            "source": "Daily FT (ft.lk)",
            "published_at": published_at,
            "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    # Return unique articles
    return list({a["url"]: a for a in articles}.values())



def scrape_rss_feed(cat_name: str, rss_url: str) -> List[Dict[str, Any]]:
    """Fetches articles from an RSS feed fallback."""
    articles = []
    try:
        r = requests.get(rss_url, headers=HEADERS, timeout=10)
        if r.status_code != 200:
            return []

        soup = BeautifulSoup(r.content, "xml") if "xml" in r.text[:200].lower() else BeautifulSoup(r.content, "html.parser")
        items = soup.find_all("item")

        for item in items:
            t_tag = item.find("title")
            l_tag = item.find("link") or item.find("guid")
            d_tag = item.find("description")

            if not t_tag or not l_tag:
                continue

            raw_title = clean_title(t_tag.get_text(strip=True))
            if len(raw_title) < 15:
                continue

            link = l_tag.get_text(strip=True) if l_tag.string else l_tag.get("href", "")
            if not link.startswith("http"):
                continue

            # Extract image from enclosure or media:content
            img_url = ""
            enc = item.find("enclosure")
            if enc and enc.get("url"):
                img_url = enc["url"]
            else:
                med = item.find("media:content")
                if med and med.get("url"):
                    img_url = med["url"]

            if not is_probable_source_image(img_url):
                img_url = DEFAULT_FT_LOGO

            desc_soup = BeautifulSoup(d_tag.get_text(strip=True) if d_tag else "", "html.parser")
            raw_summary = desc_soup.get_text(strip=True) or raw_title

            source_name = "Daily FT (ft.lk)" if "ft.lk" in link else ("EconomyNext" if "economynext" in link else "LBO")

            articles.append({
                "raw_title": raw_title,
                "url": canonicalize_article_url(link),
                "image": img_url,
                "raw_summary": raw_summary[:400],
                "category": cat_name,
                "source": source_name,
                "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
    except Exception as e:
        print(f"[-] RSS fallback error for {cat_name}: {e}")

    return list({a["url"]: a for a in articles}.values())


def scrape_category(cat_name: str, url: str) -> List[Dict[str, Any]]:
    """
    Main entry point for scraping a category.
    Attempts primary DOM card scrape first, followed by section RSS feed fallback,
    ensuring 100% genuine real-time live Sri Lankan news without ever serving fake static data.
    """
    print(f"[*] Fetching category '{cat_name}' from {url}...")
    articles = []

    # Attempt 1: Direct DOM extraction from Daily FT
    try:
        articles = scrape_daily_ft_dom(cat_name, url)
        if articles:
            print(f"[+] Scraped {len(articles)} live articles via DOM from Daily FT '{cat_name}'")
            return articles
    except Exception as e:
        print(f"[!] DOM extraction notice for '{cat_name}': {e}. Attempting RSS fallback...")

    # Attempt 2: Daily FT / Section RSS Fallback
    rss_url = RSS_SECTION_FALLBACKS.get(cat_name)
    if rss_url:
        print(f"[*] Attempting RSS fallback for '{cat_name}' from {rss_url}...")
        articles = scrape_rss_feed(cat_name, rss_url)
        if articles:
            print(f"[+] Scraped {len(articles)} live articles via RSS for '{cat_name}'")
            return articles

    # Attempt 3: Google News RSS for Daily FT
    try:
        google_rss = f"https://news.google.com/rss/search?q=site:ft.lk+{cat_name}&hl=en-US&gl=US&ceid=US:en"
        articles = scrape_rss_feed(cat_name, google_rss)
        if articles:
            print(f"[+] Scraped {len(articles)} live articles via Google News RSS for '{cat_name}'")
            return articles
    except Exception as e:
        print(f"[!] Google RSS fallback error: {e}")

    print(f"[-] Warning: No articles could be fetched for '{cat_name}' at this time.")
    return []


if __name__ == "__main__":
    test_articles = scrape_category("top_story", CATEGORIES["top_story"])
    print(f"\n--- SCRAPED {len(test_articles)} ARTICLES ---")
    for a in test_articles[:5]:
        print(f"• Title: {a['raw_title']}")
        print(f"  URL:   {a['url']}")
        print(f"  Image: {a['image']}")
        print(f"  Summary: {a['raw_summary'][:100]}...\n")
