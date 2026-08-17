"""
=============================================================================
MULTI-SOURCE SRI LANKA BUSINESS & GOVERNANCE NEWS SCRAPER
=============================================================================
Scrapes 100% genuine, live news from premier Sri Lankan business outlets:
1. Lanka Business Online (LBO)
2. EconomyNext
3. Ada Derana Biz

Daily FT is scraped separately by fit_lk.py so every section and pagination
page can be traversed instead of relying on a limited search feed.

Features:
- Real article thumbnail extraction (og:image & RSS enclosure)
- Quality article filtering & deduplication
- Automatic UTF-8 encoding fix for Sinhala/special characters
"""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import json
import os
import time
import re
import sys
import random
import hashlib
import html
import mimetypes
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin, urlparse

# Set console output encoding to UTF-8 for Windows compatibility
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Multi-source RSS configurations. Daily FT is deliberately handled by
# ``fit_lk.FTScraper`` in daily_runner.py, because its section pages expose
# substantially more articles (and better source-image metadata) than the
# Google News search feed did.
RSS_SOURCES = [
    {
        "name": "Lanka Business Online",
        "url": "https://www.lankabusinessonline.com/feed/",
        "category": "Business & Corporate",
        "source_tag": "LBO (lankabusinessonline.com)",
        "max": 0
    },
    {
        "name": "EconomyNext",
        "url": "https://economynext.com/feed/",
        "category": "Economy & Finance",
        "source_tag": "EconomyNext (economynext.com)",
        "max": 0
    },
    {
        "name": "Ada Derana Biz",
        "url": "http://biz.adaderana.lk/feed/",
        "category": "Business & Corporate",
        "source_tag": "Ada Derana Biz (biz.adaderana.lk)",
        "max": 0
    }
]

RESOLVE_RSS_IMAGES = os.getenv("RESOLVE_RSS_IMAGES", "true").lower() not in {
    "0", "false", "no", "off"
}
CACHE_SOURCE_IMAGES = os.getenv("CACHE_SOURCE_IMAGES", "true").lower() not in {
    "0", "false", "no", "off"
}
PROJECT_DIR = Path(__file__).resolve().parent
_configured_image_folder = Path(os.getenv("SOURCE_IMAGE_FOLDER", "assets/news_images"))
SOURCE_IMAGE_FOLDER = (
    _configured_image_folder
    if _configured_image_folder.is_absolute()
    else PROJECT_DIR / _configured_image_folder
)
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(15 * 1024 * 1024)))
SAFE_IMAGE_MIME_TYPES = {
    "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
}

IMAGE_JUNK_PATTERNS = (
    "/logo.", "/logos/", "/site-logo", "ftlk_logo_og", "/icon.",
    "/icons/", "favicon", "avatar", "spinner", "loader", "pixel", "tracking",
    "advert", "advr_", "banner", "placeholder", "blank.", "1x1",
    "unsplash.com", "pexels.com", "pixabay.com", "dummyimage",
    "s.w.org/images/core/emoji", "/emoji/",
)

# Publisher-owned CDN associations observed in the publishers' canonical
# article metadata.  Cross-publisher hosts are deliberately not interchangeable:
# an EconomyNext story, for example, may not borrow a Daily Mirror image merely
# because both domains are generally supported by the application.
PUBLISHER_HOST_SUFFIXES = (
    "ft.lk",
    "lankabusinessonline.com",
    "economynext.com",
    "adaderana.lk",
    "dailymirror.lk",
    "srilankabiz.lk",
    "businesstoday.lk",
    "newsfirst.lk",
    "hirunews.lk",
    "news.lk",
    "caa.lk",
    "themorning.lk",
    "army.lk",
    "island.lk",
    "dailynews.lk",
    "srilankamirror.com",
    "news.cn",
    "sundayobserver.lk",
)
PUBLISHER_ORACLE_IMAGE_HOSTS = {
    "ft.lk": {
        "bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com",
    },
    "dailymirror.lk": {
        "bmkltsly13vb.compat.objectstorage.ap-singapore-1.oraclecloud.com",
    },
}
ADA_DERANA_S3_HOST = "ada-derana-prod-english-news-temp.s3.amazonaws.com"
ADA_DERANA_S3_PATH_RE = re.compile(
    r"^/(?:bizenglish|bizsinhala)/wp-content/uploads/", re.IGNORECASE
)
THE_MORNING_FIREBASE_HOST = "firebasestorage.googleapis.com"
THE_MORNING_FIREBASE_PATH_RE = re.compile(
    r"^/v0/b/the-morning-39270\.appspot\.com/o/articles%2f", re.IGNORECASE
)

# Standard User-Agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]

# Titles/Patterns to reject (Junk or homepage titles)
JUNK_TITLE_PATTERNS = [
    r"sri lanka's premier business",
    r"sri lanka's only national business newspaper",
    r"daily ft",
    r"home\s*-\s*",
    r"lanka business online",
    r"economynext",
    r"ada derana",
    r"subscribe",
]

def get_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "application/rss+xml, application/xml, text/xml, text/html, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.google.com/",
    }

def make_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def normalize_image_url(candidate, page_url=""):
    """Return an absolute HTTP(S) source image URL, or an empty string."""
    if not candidate:
        return ""
    candidate = html.unescape(str(candidate)).strip().strip("'\"")
    if not candidate or candidate.startswith(("data:", "blob:", "javascript:")):
        return ""
    if candidate.startswith("//"):
        candidate = "https:" + candidate
    elif page_url:
        candidate = urljoin(page_url, candidate)
    parsed = urlparse(candidate)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return candidate


def canonicalize_article_url(url):
    """Normalize URL variants so the same publisher article is stored once."""
    if not url:
        return ""
    parsed = urlparse(html.unescape(str(url)).strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return str(url).strip()
    path = re.sub(r"/{2,}", "/", parsed.path).rstrip("/") or "/"
    return parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        path=path,
        params="",
        query="",
        fragment="",
    ).geturl()


def _host_matches(hostname, suffix):
    hostname = str(hostname or "").lower().rstrip(".")
    suffix = str(suffix or "").lower().rstrip(".")
    return bool(hostname and suffix) and (
        hostname == suffix or hostname.endswith(f".{suffix}")
    )


def _publisher_suffix(hostname):
    return next(
        (suffix for suffix in PUBLISHER_HOST_SUFFIXES if _host_matches(hostname, suffix)),
        "",
    )


def _is_publisher_owned_image(image_url, article_url):
    """Tie an image host to the publisher of the canonical article URL."""
    if not article_url:
        return True
    try:
        image = urlparse(image_url)
        article = urlparse(article_url)
    except ValueError:
        return False
    image_host = (image.hostname or "").lower()
    article_host = (article.hostname or "").lower()
    if not image_host or not article_host:
        return False

    publisher = _publisher_suffix(article_host)
    if publisher and _host_matches(image_host, publisher):
        return True
    if not publisher:
        # This keeps the helper useful for additional publisher adapters while
        # still requiring the asset to be on the article host or its CDN
        # subdomain. Known shared CDNs must use the explicit rules below.
        if image_host == article_host or image_host.endswith(f".{article_host}"):
            return True
        article_parts = article_host.split(".")
        if len(article_parts) >= 2:
            inferred_suffix = ".".join(article_parts[-2:])
            if _host_matches(image_host, inferred_suffix):
                return True

    if image_host in PUBLISHER_ORACLE_IMAGE_HOSTS.get(publisher, set()):
        return True
    if publisher == "adaderana.lk":
        if image_host == ADA_DERANA_S3_HOST:
            return True
        if image_host == "s3.amazonaws.com" and ADA_DERANA_S3_PATH_RE.match(image.path):
            return True
    if (
        publisher == "themorning.lk"
        and image_host == THE_MORNING_FIREBASE_HOST
        and THE_MORNING_FIREBASE_PATH_RE.match(image.path)
    ):
        return True
    return False


def is_probable_source_image(url, article_url=""):
    """Accept only plausible media owned by the article's publisher."""
    if not url:
        return False
    try:
        parsed = urlparse(str(url))
    except ValueError:
        return False
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        return False
    lower = str(url).lower()
    if parsed.path.lower().endswith(".svg"):
        return False
    return (
        not any(pattern in lower for pattern in IMAGE_JUNK_PATTERNS)
        and _is_publisher_owned_image(str(url), article_url)
    )


def _is_probable_article_image(url, article_url=""):
    """Backward-compatible internal name for source-image validation."""
    return is_probable_source_image(url, article_url)


def _image_from_tag(tag, page_url):
    if not tag:
        return ""
    width_match = re.search(r"\d+", str(tag.get("width") or ""))
    height_match = re.search(r"\d+", str(tag.get("height") or ""))
    width = int(width_match.group()) if width_match else 0
    height = int(height_match.group()) if height_match else 0
    if (0 < width < 160) or (0 < height < 120):
        return ""
    for attr in ("data-src", "data-lazy-src", "data-original", "data-img", "src"):
        candidate = normalize_image_url(tag.get(attr), page_url)
        if candidate and _is_probable_article_image(candidate, page_url):
            return candidate

    srcset = tag.get("srcset") or tag.get("data-srcset") or ""
    candidates = []
    for item in srcset.split(","):
        parts = item.strip().split()
        if not parts:
            continue
        width = 0
        if len(parts) > 1:
            match = re.search(r"(\d+)(?:w|x)?$", parts[-1])
            width = int(match.group(1)) if match else 0
        candidate = normalize_image_url(parts[0], page_url)
        if candidate and _is_probable_article_image(candidate, page_url):
            candidates.append((width, candidate))
    return max(candidates, default=(0, ""), key=lambda value: value[0])[1]


def _json_ld_image(value, page_url):
    """Recursively find the first image field in JSON-LD data."""
    if isinstance(value, list):
        for child in value:
            found = _json_ld_image(child, page_url)
            if found:
                return found
        return ""
    if not isinstance(value, dict):
        return ""

    if "image" in value:
        image_value = value["image"]
        if isinstance(image_value, str):
            candidate = normalize_image_url(image_value, page_url)
            if candidate and _is_probable_article_image(candidate, page_url):
                return candidate
        elif isinstance(image_value, dict):
            for key in ("url", "contentUrl"):
                candidate = normalize_image_url(image_value.get(key), page_url)
                if candidate and _is_probable_article_image(candidate, page_url):
                    return candidate
        elif isinstance(image_value, list):
            found = _json_ld_image([{"image": child} for child in image_value], page_url)
            if found:
                return found

    for key in ("@graph", "mainEntity", "itemListElement"):
        if key in value:
            found = _json_ld_image(value[key], page_url)
            if found:
                return found
    return ""


def extract_source_image(soup, page_url):
    """Extract an image published by the article's own source page."""
    meta_selectors = (
        'meta[property="og:image:secure_url"]',
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
        'link[rel="image_src"]',
    )
    for selector in meta_selectors:
        tag = soup.select_one(selector)
        candidate = normalize_image_url(
            tag.get("content") if tag and tag.name == "meta" else tag.get("href") if tag else "",
            page_url,
        )
        if candidate and _is_probable_article_image(candidate, page_url):
            return candidate

    for script in soup.select('script[type="application/ld+json"]'):
        try:
            candidate = _json_ld_image(json.loads(script.string or script.get_text()), page_url)
            if candidate:
                return candidate
        except (TypeError, ValueError, json.JSONDecodeError):
            continue

    selectors = (
        "article img",
        ".article-content img",
        ".entry-content img",
        ".post-content img",
        ".single-post img",
        ".featured-image img",
        ".main-img img",
        ".inner-content img",
        "header.inner-content img",
        "main img",
    )
    for selector in selectors:
        for tag in soup.select(selector):
            candidate = _image_from_tag(tag, page_url)
            if candidate:
                return candidate
    return ""


def fetch_og_image(article_url):
    """Compatibility wrapper that resolves the article's real source image."""
    if not article_url or not article_url.startswith(("http://", "https://")):
        return ""
    if "news.google.com" in article_url:
        return ""

    try:
        session = make_session()
        headers = get_headers()
        headers["Accept"] = "text/html,application/xhtml+xml"
        headers["Referer"] = article_url
        response = session.get(
            article_url,
            headers=headers,
            timeout=(8, 20),
            allow_redirects=True,
        )
        response.raise_for_status()
        return extract_source_image(
            BeautifulSoup(response.text, "html.parser"),
            response.url,
        )
    except requests.RequestException:
        return ""


def _web_cache_path(path):
    path = Path(path)
    try:
        return path.resolve().relative_to(PROJECT_DIR).as_posix()
    except ValueError:
        return path.as_posix()


def cache_source_image(image_url, article_url="", folder=None):
    """
    Download an original publisher image into the web-accessible local cache.

    Returns a POSIX-style relative path suitable for ``<img src>``. No stock
    or generated fallback is ever substituted when the source has no image.
    """
    image_url = normalize_image_url(image_url, article_url)
    if not image_url or not _is_probable_article_image(image_url, article_url):
        return ""

    target_dir = Path(folder or SOURCE_IMAGE_FOLDER)
    digest = hashlib.sha256(image_url.encode("utf-8")).hexdigest()[:24]
    existing = list(target_dir.glob(f"{digest}.*")) if target_dir.exists() else []
    for candidate in existing:
        # Interrupted downloads use a .part suffix.  Returning one of those as
        # an image URL created a permanently broken card in the browser.
        if candidate.suffix.lower() == ".part" or not candidate.is_file():
            continue
        try:
            if candidate.stat().st_size > 64:
                return _web_cache_path(candidate)
        except OSError:
            continue

    try:
        headers = get_headers()
        headers["Accept"] = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
        headers["Referer"] = article_url or image_url
        with make_session().get(
            image_url,
            headers=headers,
            timeout=(8, 30),
            allow_redirects=True,
            stream=True,
        ) as response:
            response.raise_for_status()
            if not _is_probable_article_image(response.url, article_url):
                return ""
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if content_type not in SAFE_IMAGE_MIME_TYPES:
                return ""
            extension = mimetypes.guess_extension(content_type) or Path(urlparse(response.url).path).suffix
            if extension == ".jpe":
                extension = ".jpg"
            if not re.fullmatch(r"\.[a-zA-Z0-9]{2,5}", extension or ""):
                extension = ".img"

            target_dir.mkdir(parents=True, exist_ok=True)
            destination = target_dir / f"{digest}{extension.lower()}"
            temporary = destination.with_suffix(destination.suffix + ".part")
            written = 0
            with open(temporary, "wb") as handle:
                for chunk in response.iter_content(64 * 1024):
                    if not chunk:
                        continue
                    written += len(chunk)
                    if written > MAX_IMAGE_BYTES:
                        raise ValueError("source image exceeds MAX_IMAGE_BYTES")
                    handle.write(chunk)
            if written < 64:
                raise ValueError("source image response is empty")
            temporary.replace(destination)
            return _web_cache_path(destination)
    except (OSError, ValueError, requests.RequestException):
        try:
            if "temporary" in locals() and temporary.exists():
                temporary.unlink()
        except OSError:
            pass
        return ""

def is_valid_article(title, url):
    """Filters out non-article entries, short titles, and junk descriptions."""
    if not title or len(title.strip()) < 22:
        return False
    
    t_lower = title.lower().strip()
    for pattern in JUNK_TITLE_PATTERNS:
        if re.search(pattern, t_lower):
            return False
            
    if url in ["https://www.ft.lk", "https://www.ft.lk/", "https://economynext.com", "https://www.lankabusinessonline.com"]:
        return False
        
    return True

def scrape_rss_feed(source_info):
    name = source_info["name"]
    url = source_info["url"]
    cat = source_info["category"]
    source_tag = source_info["source_tag"]
    max_items = int(os.getenv("RSS_MAX_ITEMS", str(source_info.get("max", 0))))

    print(f"[*] Fetching RSS feed for '{name}'...")
    session = make_session()
    
    try:
        resp = session.get(url, headers=get_headers(), timeout=15)
        if resp.status_code != 200:
            print(f"[!] HTTP {resp.status_code} for {name}")
            return []

        # Robust RSS Parsing with BeautifulSoup html.parser fallback
        try:
            soup = BeautifulSoup(resp.content, "xml")
        except Exception:
            soup = BeautifulSoup(resp.content, "html.parser")
            
        items = soup.find_all("item") or soup.find_all("entry")
        if not items:
            soup = BeautifulSoup(resp.content, "html.parser")
            items = soup.find_all("item") or soup.find_all("entry")

        if not items:
            print(f"[!] No items found in RSS feed for {name}")
            return []

        articles = []

        selected_items = items[:max_items] if max_items > 0 else items
        for item in selected_items:
            title_tag = item.find("title")
            link_tag = item.find("link")
            desc_tag = item.find("description") or item.find("summary")

            if not title_tag or not title_tag.text:
                continue

            raw_title = title_tag.text.strip()
            raw_title = re.sub(r"\s*[-–|]\s*(Daily FT|Lanka Business Online|EconomyNext|Ada Derana Biz).*$", "", raw_title, flags=re.IGNORECASE).strip()
            
            link = ""
            if link_tag:
                link = link_tag.text.strip() if link_tag.text else (link_tag.get("href", "") or "")
            link = canonicalize_article_url(link)

            if not is_valid_article(raw_title, link):
                continue

            # Extract an original publisher image from RSS, then the article
            # page itself when the feed omits it.
            image_url = ""
            enclosure = item.find("enclosure")
            if enclosure and enclosure.get("url") and str(enclosure.get("type", "")).startswith("image"):
                image_url = enclosure.get("url")

            if not image_url:
                media_cnt = item.find("media:content") or item.find("thumbnail") or item.find("media:thumbnail")
                if media_cnt and media_cnt.get("url"):
                    image_url = media_cnt.get("url")

            raw_summary = ""
            if desc_tag and desc_tag.text:
                desc_soup = BeautifulSoup(desc_tag.text, "html.parser")
                if not image_url:
                    img_el = desc_soup.find("img")
                    if img_el:
                        image_url = _image_from_tag(img_el, link)
                raw_summary = desc_soup.get_text(strip=True)
                raw_summary = raw_summary.replace(raw_title, "").strip()

            image_url = normalize_image_url(image_url, link)
            if image_url and not _is_probable_article_image(image_url, link):
                image_url = ""
            if not image_url and RESOLVE_RSS_IMAGES:
                image_url = fetch_og_image(link)

            local_image = ""
            if image_url and CACHE_SOURCE_IMAGES:
                local_image = cache_source_image(image_url, link)

            published_tag = (
                item.find("pubDate") or item.find("published")
                or item.find("updated") or item.find("dc:date")
            )
            published_at = published_tag.get_text(strip=True) if published_tag else ""

            articles.append({
                "raw_title": raw_title,
                "url": link,
                "image": local_image or image_url,
                "source_image": image_url,
                "image_local": local_image,
                "source_image_checked": True,
                "raw_summary": raw_summary if len(raw_summary) > 20 else raw_title,
                "category": cat,
                "source": source_tag,
                "published_at": published_at,
                "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })

        print(f"[+] Scraped {len(articles)} quality articles from '{name}'")
        return articles

    except Exception as e:
        print(f"[!] RSS Scrape error for '{name}': {e}")
        return []

def scrape_all_sources():
    """Aggregates news from all defined RSS feeds."""
    all_articles = []
    for source in RSS_SOURCES:
        arts = scrape_rss_feed(source)
        all_articles.extend(arts)
        time.sleep(1)

    # Deduplicate by URL and title similarity
    unique_articles = []
    seen_urls = set()
    seen_titles = set()

    for a in all_articles:
        url = canonicalize_article_url(a["url"])
        a["url"] = url
        t_key = a["raw_title"].lower()[:40]
        if url not in seen_urls and t_key not in seen_titles:
            seen_urls.add(url)
            seen_titles.add(t_key)
            unique_articles.append(a)

    print(f"\n[+] TOTAL AGGREGATED UNIQUE ARTICLES: {len(unique_articles)}")
    return unique_articles

if __name__ == "__main__":
    results = scrape_all_sources()
    print(f"\nSample output (first 3):")
    for r in results[:3]:
        print(f" - [{r['category']}] ({r['source']}) {r['raw_title']}")
        print(f"   URL: {r['url']}")
        print(f"   IMG: {r['image']}\n")
