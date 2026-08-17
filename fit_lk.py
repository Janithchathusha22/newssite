"""
=============================================================================
FT.lk PRODUCTION SCRAPER — CloudScraper + Playwright Dual Engine
=============================================================================
Features:
  1. CloudScraper (primary) + Playwright (JS fallback) for anti-bot bypass
  2. Multi-strategy image extraction:
     - og:image meta tag (most reliable for ft.lk Oracle CDN)
     - data-src / data-lazy-src / data-original lazy-load attributes
     - srcset parsing (picks highest resolution)
     - Section listing page img mapping
  3. Section-based scraping: Front Page, Top Story, Financial Services, etc.
  4. Full article content: title, date, author, paragraphs, images, article_id
  5. Output compatible with existing app.js frontend:
     - news_data.json  (raw scraper output)
     - news_feed.json  (frontend-ready format)
     - news_feed.js    (window.LIVE_NEWS_FEED for file:// usage)
  6. Standalone HTML report: ft_articles.html
  7. Retry + delay + rate-limit protection
  8. Boilerplate content filtering (copyright, ads, etc.)

Usage:
  python fit_lk.py                    # Run standalone
  from fit_lk import FTScraper        # Import as module

Requirements:
  pip install cloudscraper beautifulsoup4 lxml requests
  pip install playwright && playwright install chromium
"""

import os
import re
import csv
import sys
import json
import time
import random
import hashlib
import logging
import html as html_lib
import requests
import cloudscraper
from pathlib import Path
from datetime import date as date_type, datetime
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse, urlsplit, urlunsplit
from bs4 import BeautifulSoup

# ── Windows UTF-8 console fix ─────────────────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
# Missing source images intentionally stay blank.  A logo, generated image, or
# unrelated stock photo must never be presented as the article's own image.
DEFAULT_IMAGE = ""

# Known-good sections are a fallback for when the home-page menu cannot be
# loaded.  Runtime discovery adds every current `/section/<numeric-id>` menu
# link, so new Daily FT sections do not require a code release.
SECTIONS = [
    {"url": "https://www.ft.lk/front-page/44", "category": "Front Page"},
    {"url": "https://www.ft.lk/top-story/26", "category": "Top Story"},
    {"url": "https://www.ft.lk/news/56", "category": "News"},
    {"url": "https://www.ft.lk/business/34", "category": "Business"},
    {"url": "https://www.ft.lk/financial-services/42", "category": "Financial Services"},
    {"url": "https://www.ft.lk/corporate/27", "category": "Corporate"},
    {"url": "https://www.ft.lk/opinion/14", "category": "Opinion & Issues"},
    {"url": "https://www.ft.lk/editorial/58", "category": "Editorial"},
    {"url": "https://www.ft.lk/in-depth/48", "category": "In Depth"},
    {"url": "https://www.ft.lk/international/49", "category": "International"},
    {"url": "https://www.ft.lk/it-telecom-tech/50", "category": "IT / Telecom / Tech"},
    {"url": "https://www.ft.lk/agriculture/31", "category": "Agriculture"},
    {"url": "https://www.ft.lk/energy/10509", "category": "Energy"},
    {"url": "https://www.ft.lk/leadership/51", "category": "Leadership"},
    {"url": "https://www.ft.lk/markets/10518", "category": "Markets"},
]

SECTION_PATH_RE = re.compile(r"^/([^/?#]+)/([0-9]+)/?$")
ARTICLE_PATH_RE = re.compile(r"/(?:[^/?#]+/)?([0-9]+-[0-9]+)/?$")
NON_NEWS_SECTION_SLUGS = {
    "cartoon",
    "click",
    "columnists",
    "contact",
    "feedback",
    "ft-click",
    "games",
    "home",
    "mobile-apps",
    "search",
    "special-editions",
    "sports",
}

DATE_RE = re.compile(
    r"(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?"
    r"(\d{1,2}\s+[A-Za-z]+\s+\d{4}(?:\s+\d{1,2}:\d{2})?)",
    re.IGNORECASE,
)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]

# Paragraphs matching these patterns are boilerplate — skip them
BOILERPLATE_PATTERNS = [
    r"^Copyright",
    r"^Daily FT",
    r"^Follow us",
    r"^\+94",
    r"hitsCtrl",
    r"General Manager.*Sales.*Marketing",
    r"All the content on this website is copyright",
    r"Wijeya Newspapers",
    r"^Share this article",
    r"^Leave a comment",
    r"^Subscribe",
]

BOILERPLATE_RE = re.compile("|".join(BOILERPLATE_PATTERNS), re.IGNORECASE)


# ══════════════════════════════════════════════════════════════════════════════
#  FTScraper CLASS
# ══════════════════════════════════════════════════════════════════════════════
class FTScraper:
    """
    Production-grade ft.lk scraper with CloudScraper + Playwright engines.

    Usage::

        scraper = FTScraper(use_playwright=True)
        try:
            articles = scraper.scrape_all(max_articles=None)
            if articles:
                scraper.save_json("ft_articles.json")
                scraper.save_pipeline_output()   # news_data.json, news_feed.json/js
        finally:
            scraper.close()
    """

    BASE_URL = "https://www.ft.lk/"

    # ------------------------------------------------------------------
    #  Init
    # ------------------------------------------------------------------
    def __init__(
        self,
        download_images: bool = False,
        image_folder: str = "ft_images",
        delay: float = 2.5,
        max_retries: int = 2,
        use_playwright: bool = False,
        max_pages_per_section: int = 3,
        page_size: int = 30,
        since_date=None,
        discover_sections: bool = True,
        resume_file: str = ".ft_scraper_state.json",
        resume: bool = True,
        section_exclusions=None,
        request_connect_timeout: float = 8.0,
        request_read_timeout: float = 20.0,
    ):
        self.download_images = download_images
        self.image_folder = Path(image_folder)
        self.delay = max(0.0, float(delay))
        self.max_retries = max(0, int(max_retries))
        self.request_timeout = (
            max(1.0, float(request_connect_timeout)),
            max(2.0, float(request_read_timeout)),
        )
        self.use_playwright = use_playwright
        self.max_pages_per_section = max(0, int(max_pages_per_section or 0))
        self.page_size = max(1, int(page_size or 30))
        self.since_date = self._parse_date(since_date)
        self.discover_sections = bool(discover_sections)
        exclusion_values = (
            NON_NEWS_SECTION_SLUGS if section_exclusions is None else section_exclusions
        )
        self.section_exclusions = {
            str(value).strip().lower()
            for value in exclusion_values
            if str(value).strip()
        }
        self.resume = bool(resume and resume_file)
        self.resume_file = Path(resume_file) if resume_file else None
        self.articles_data: list = []
        self._resume_articles = self._load_resume_state() if self.resume else {}
        self._last_request_at = 0.0

        # Create local image folder if downloading
        if self.download_images:
            self.image_folder.mkdir(parents=True, exist_ok=True)

        # ── Primary: CloudScraper (anti-bot/Cloudflare bypass) ────────
        self.scraper = cloudscraper.create_scraper(
            browser={
                "browser": "chrome",
                "platform": "windows",
                "mobile": False,
            }
        )
        self.scraper.headers.update(
            {
                "User-Agent": random.choice(USER_AGENTS),
                "Accept-Language": "en-US,en;q=0.9",
                # Do not request Brotli explicitly: some cloudscraper/urllib3
                # combinations return a blank decoded body for FT's br reply.
                "Accept-Encoding": "gzip, deflate",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Cache-Control": "max-age=0",
                "Referer": "https://www.ft.lk/",
            }
        )
        # Desktop cookies for ft.lk
        self.scraper.cookies.update({"mobile": "0", "inner": "0", "mobile1": "0"})

        # A plain requests session is a deliberate fallback.  Daily FT can
        # occasionally return an empty HTTP 200 to CloudScraper while serving
        # the full page to a conventional requests client.
        self.session = requests.Session()
        self.session.headers.update(dict(self.scraper.headers))
        self.session.cookies.update({"mobile": "0", "inner": "0", "mobile1": "0"})

        # ── Secondary: Playwright (JS-rendered fallback) ──────────────
        self._pw = None
        self._pw_browser = None
        self._pw_page = None
        if use_playwright:
            self._init_playwright()

    # ------------------------------------------------------------------
    #  Normalisation, dates, throttling, and resume state
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_date(value):
        """Parse FT/ISO dates into a timezone-naive datetime for comparisons."""
        if value is None or value == "":
            return None
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        if isinstance(value, date_type):
            return datetime.combine(value, datetime.min.time())

        text = str(value).strip()
        if not text or text.lower() in {"no date", "none", "null"}:
            return None

        iso_text = text.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(iso_text).replace(tzinfo=None)
        except ValueError:
            pass

        match = DATE_RE.search(text)
        candidate = match.group(1) if match else text
        for fmt in (
            "%d %B %Y %H:%M",
            "%d %b %Y %H:%M",
            "%d %B %Y",
            "%d %b %Y",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(candidate.strip(), fmt)
            except ValueError:
                continue
        try:
            return parsedate_to_datetime(text).replace(tzinfo=None)
        except (TypeError, ValueError, OverflowError):
            return None

    @classmethod
    def _normalize_article_url(cls, value: str, base_url: str = None) -> str:
        """Return one canonical, query-free www.ft.lk URL for deduplication."""
        if not value:
            return ""
        raw = html_lib.unescape(str(value)).strip().strip("\"'")
        absolute = urljoin(base_url or cls.BASE_URL, raw)
        parsed = urlsplit(absolute)
        host = (parsed.hostname or "").lower().rstrip(".")
        if host not in {"ft.lk", "www.ft.lk"}:
            return ""
        path = re.sub(r"/{2,}", "/", parsed.path or "/").rstrip("/") or "/"
        return urlunsplit(("https", "www.ft.lk", path, "", ""))

    @classmethod
    def _is_article_url(cls, value: str) -> bool:
        normalized = cls._normalize_article_url(value)
        return bool(normalized and ARTICLE_PATH_RE.search(urlsplit(normalized).path))

    @staticmethod
    def _normalize_image_url(value: str, base_url: str) -> str:
        """Resolve a source-provided image URL without replacing its asset."""
        if not value:
            return ""
        raw = html_lib.unescape(str(value)).strip().strip("\"'")
        if not raw or raw.lower().startswith(("data:", "blob:", "javascript:")):
            return ""
        if raw.startswith("//"):
            raw = "https:" + raw
        absolute = urljoin(base_url, raw)
        parsed = urlsplit(absolute)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            return ""
        return urlunsplit((parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.query, ""))

    @staticmethod
    def _article_key(url: str, article_id: str = None) -> str:
        return str(article_id or hashlib.sha256(url.encode("utf-8")).hexdigest()[:24])

    def _wait_for_request_slot(self):
        """Enforce a conservative, jittered minimum gap between HTTP requests."""
        if self.delay <= 0:
            self._last_request_at = time.monotonic()
            return
        target_gap = self.delay * random.uniform(0.9, 1.2)
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < target_gap:
            time.sleep(target_gap - elapsed)
        self._last_request_at = time.monotonic()

    @staticmethod
    def _valid_html(html: bytes) -> bool:
        if not html or len(html) < 500:
            return False
        sample = html[:8000].lower()
        challenge_markers = (
            b"cf-browser-verification",
            b"checking your browser",
            b"just a moment...",
            b"enable javascript and cookies to continue",
        )
        return not any(marker in sample for marker in challenge_markers)

    def _load_resume_state(self) -> dict:
        if not self.resume_file or not self.resume_file.exists():
            return {}
        try:
            with self.resume_file.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            raw_articles = payload.get("articles", payload) if isinstance(payload, dict) else {}
            if not isinstance(raw_articles, dict):
                return {}
            loaded = {}
            for raw_url, article in raw_articles.items():
                if not isinstance(article, dict):
                    continue
                url = self._normalize_article_url(article.get("url") or raw_url)
                if url:
                    article["url"] = url
                    loaded[url] = article
            logger.info(f"Resume cache loaded: {len(loaded)} Daily FT articles")
            return loaded
        except (OSError, ValueError, TypeError) as exc:
            logger.warning(f"Could not read resume cache {self.resume_file}: {exc}")
            return {}

    def _write_resume_state(self):
        if not self.resume or not self.resume_file:
            return
        try:
            self.resume_file.parent.mkdir(parents=True, exist_ok=True)
            temp_path = self.resume_file.with_name(self.resume_file.name + ".tmp")
            payload = {
                "version": 1,
                "updated_at": datetime.now().isoformat(),
                "articles": self._resume_articles,
            }
            with temp_path.open("w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            os.replace(temp_path, self.resume_file)
        except OSError as exc:
            logger.warning(f"Could not update resume cache {self.resume_file}: {exc}")

    @staticmethod
    def _cached_article_is_complete(article: dict) -> bool:
        return bool(
            isinstance(article, dict)
            and article.get("title")
            and article.get("title") != "No title"
            and (article.get("source_image_checked") or article.get("image_checked"))
            and (article.get("content") or article.get("paragraphs"))
        )

    # ------------------------------------------------------------------
    #  Playwright init
    # ------------------------------------------------------------------
    def _init_playwright(self):
        """Start Playwright Chromium in headless mode."""
        try:
            from playwright.sync_api import sync_playwright

            self._pw = sync_playwright().start()
            self._pw_browser = self._pw.chromium.launch(headless=True)
            self._pw_page = self._pw_browser.new_page()
            self._pw_page.set_extra_http_headers(
                {
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": random.choice(USER_AGENTS),
                }
            )
            logger.info("✅ Playwright Chromium initialised (JS rendering ON)")
        except ImportError:
            logger.warning(
                "⚠️  Playwright not installed. Run: pip install playwright && playwright install chromium"
            )
            self.use_playwright = False
        except Exception as e:
            logger.warning(f"⚠️  Playwright init failed, using CloudScraper only: {e}")
            self.use_playwright = False

    def _playwright_get_html(self, url: str) -> str:
        """Load page via Playwright and return fully-rendered HTML."""
        try:
            self._pw_page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            # Wait for dynamic content to render
            self._pw_page.wait_for_timeout(4000)
            # Wait for images to be present in DOM
            try:
                self._pw_page.wait_for_selector("img", timeout=5000)
            except Exception:
                pass
            return self._pw_page.content()
        except Exception as e:
            logger.error(f"Playwright page load failed ({url}): {e}")
            return ""

    # ------------------------------------------------------------------
    #  HTTP fetch with retry
    # ------------------------------------------------------------------
    def _get(self, url: str, retry: int = 0) -> BeautifulSoup:
        """
        Fetch URL → BeautifulSoup.
        Strategy:
          1. CloudScraper
          2. Plain requests fallback (FT sometimes sends CloudScraper blank 200s)
          3. Playwright fallback for a real JS/challenge response
          4. Bounded retries with exponential backoff
        """
        first_attempt = max(0, int(retry))
        for attempt in range(first_attempt, self.max_retries + 1):
            rate_limited = False

            for engine_name, client in (
                ("CloudScraper", self.scraper),
                ("requests", self.session),
            ):
                try:
                    self._wait_for_request_slot()
                    client.headers["User-Agent"] = random.choice(USER_AGENTS)
                    response = client.get(url, timeout=self.request_timeout)

                    if response.status_code == 429:
                        try:
                            retry_after = int(response.headers.get("Retry-After", 15))
                        except ValueError:
                            retry_after = 15
                        retry_after = min(max(retry_after, 5), 120)
                        logger.warning(f"Rate limited by Daily FT; waiting {retry_after}s")
                        time.sleep(retry_after)
                        rate_limited = True
                        break

                    if response.status_code == 200:
                        if self._valid_html(response.content):
                            return BeautifulSoup(response.content, "lxml")
                        logger.warning(
                            f"{engine_name} returned an empty/invalid HTTP 200 for {url}"
                        )
                        continue

                    if response.status_code in {403, 502, 503, 504}:
                        logger.warning(
                            f"{engine_name} HTTP {response.status_code} for {url}"
                        )
                        continue

                    response.raise_for_status()
                except requests.RequestException as exc:
                    logger.warning(f"{engine_name} failed for {url}: {exc}")

            if not rate_limited and self.use_playwright and self._pw_page:
                self._wait_for_request_slot()
                rendered = self._playwright_get_html(url)
                rendered_bytes = rendered.encode("utf-8", errors="ignore") if rendered else b""
                if self._valid_html(rendered_bytes):
                    return BeautifulSoup(rendered, "lxml")
                logger.warning(f"Playwright returned empty/challenge HTML for {url}")

            if attempt < self.max_retries:
                backoff = max(self.delay, 1.0) * (2 ** attempt) + random.uniform(0.0, 1.0)
                logger.info(
                    f"Retry {attempt + 1}/{self.max_retries} for {url} in {backoff:.1f}s"
                )
                time.sleep(backoff)

        logger.error(f"Request failed after {self.max_retries + 1} attempts: {url}")
        return BeautifulSoup("", "lxml")

    # ------------------------------------------------------------------
    #  Image extraction helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_image_url(tag, base_url: str) -> str:
        """
        Resolve image URL from an <img> tag.
        Priority: lazy attributes > highest-resolution srcset > src.
        Skips base64 data URIs and tiny placeholder images.
        """
        if tag is None:
            return ""

        # Check attributes in priority order (lazy-load first)
        for attr in (
            "data-src",
            "data-lazy-src",
            "data-original",
            "data-img",
            "data-url",
        ):
            val = (tag.get(attr) or "").strip()
            if val and not val.startswith("data:") and len(val) > 10:
                url = FTScraper._normalize_image_url(val, base_url)
                # Skip tiny tracking pixels and icons
                if any(skip in url.lower() for skip in ("1x1", "pixel", "spacer", "blank")):
                    continue
                return url

        # Fallback: srcset — pick the widest image
        srcset = tag.get("data-srcset", "") or tag.get("srcset", "")
        if srcset:
            candidates = []
            for part in srcset.split(","):
                parts = part.strip().split()
                if parts:
                    img_url = parts[0]
                    width = 0
                    if len(parts) > 1 and parts[1].endswith("w"):
                        try:
                            width = int(parts[1].rstrip("w"))
                        except ValueError:
                            pass
                    candidates.append((width, img_url))
            if candidates:
                candidates.sort(reverse=True)
                return FTScraper._normalize_image_url(candidates[0][1], base_url)

        src = (tag.get("src") or "").strip()
        if src and len(src) > 10:
            return FTScraper._normalize_image_url(src, base_url)

        return ""

    @staticmethod
    def _extract_meta_image(soup: BeautifulSoup, names, base_url: str) -> str:
        for name in names:
            tag = (
                soup.find("meta", property=name)
                or soup.find("meta", attrs={"name": name})
                or soup.find("meta", attrs={"itemprop": name})
            )
            if not tag:
                continue
            candidate = FTScraper._normalize_image_url(tag.get("content", ""), base_url)
            if FTScraper._is_article_image(candidate):
                return candidate
        return ""

    @staticmethod
    def _extract_og_image(soup: BeautifulSoup, base_url: str = "https://www.ft.lk/") -> str:
        """Backward-compatible helper for the source page's OpenGraph image."""
        return FTScraper._extract_meta_image(
            soup, ("og:image", "og:image:secure_url"), base_url
        )

    @staticmethod
    def _extract_json_ld_images(soup: BeautifulSoup, base_url: str) -> list:
        """Extract source-owned image candidates from article JSON-LD."""
        values = []

        def collect(value, image_context=False):
            if isinstance(value, list):
                for item in value:
                    collect(item, image_context=image_context)
                return
            if isinstance(value, str):
                if image_context and value.strip().startswith(("http://", "https://", "//", "/")):
                    values.append(value)
                return
            if not isinstance(value, dict):
                return

            object_type = value.get("@type")
            if isinstance(object_type, list):
                is_image_object = "ImageObject" in object_type
            else:
                is_image_object = str(object_type).lower() == "imageobject"

            for key, child in value.items():
                key_lower = str(key).lower()
                starts_image_context = key_lower in {
                    "image",
                    "thumbnailurl",
                    "primaryimageofpage",
                    "associatedmedia",
                }
                if image_context and key_lower in {"url", "contenturl", "@id"}:
                    starts_image_context = True
                if starts_image_context:
                    collect(child, image_context=True)
                elif not image_context:
                    # Continue searching the document graph for explicit image
                    # properties, but never treat publisher/logo strings as art.
                    collect(child, image_context=False)

        for script in soup.select('script[type="application/ld+json"]'):
            raw = script.string or script.get_text("", strip=True)
            if not raw:
                continue
            try:
                collect(json.loads(raw))
            except (TypeError, ValueError):
                continue

        result = []
        for value in values:
            candidate = FTScraper._normalize_image_url(value, base_url)
            if (
                candidate
                and candidate not in result
                and FTScraper._is_article_image(candidate)
            ):
                result.append(candidate)
        return result

    @classmethod
    def _extract_primary_image(cls, soup: BeautifulSoup, page_url: str) -> str:
        """Extract only an image declared by the source article, in priority order."""
        candidate = cls._extract_og_image(soup, page_url)
        if candidate:
            return candidate

        json_ld_images = cls._extract_json_ld_images(soup, page_url)
        if json_ld_images:
            return json_ld_images[0]

        candidate = cls._extract_meta_image(
            soup,
            ("twitter:image", "twitter:image:src", "thumbnailUrl"),
            page_url,
        )
        if candidate:
            return candidate

        for selector in (
            ".inner-content img",
            ".inner-d img",
            ".article-content img",
            ".article-image img",
            ".featured-image img",
            "article img",
            "main img",
        ):
            for image_tag in soup.select(selector):
                candidate = cls._extract_image_url(image_tag, page_url)
                if cls._is_article_image(candidate):
                    return candidate
        return ""

    def _download_image(
        self,
        img_url: str,
        article_title: str = "",
        referer: str = None,
    ) -> str:
        """Cache a validated source image under a deterministic URL hash."""
        if not img_url or not self.download_images:
            return ""
        img_url = self._normalize_image_url(img_url, referer or self.BASE_URL)
        if not self._is_article_image(img_url):
            return ""
        try:
            digest = hashlib.sha256(img_url.encode("utf-8")).hexdigest()[:24]
            for existing in self.image_folder.glob(f"ft_{digest}.*"):
                if existing.is_file() and existing.stat().st_size > 64:
                    return existing.as_posix()

            self._wait_for_request_slot()
            response = self.session.get(
                img_url,
                headers={
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": referer or self.BASE_URL,
                },
                timeout=self.request_timeout,
            )
            response.raise_for_status()
            content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if not content_type.startswith("image/"):
                raise ValueError(f"unexpected Content-Type {content_type or 'missing'}")
            content = response.content
            if len(content) < 64:
                raise ValueError("image response was empty")
            if len(content) > 25 * 1024 * 1024:
                raise ValueError("image exceeds 25 MB safety limit")

            extensions = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/webp": ".webp",
                "image/gif": ".gif",
                "image/avif": ".avif",
            }
            ext = extensions.get(content_type)
            if not ext:
                url_ext = Path(urlparse(img_url).path).suffix.lower()
                ext = url_ext if url_ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"} else ".img"
            dest = self.image_folder / f"ft_{digest}{ext}"
            dest.write_bytes(content)
            logger.info(f"  📷 Image saved → {dest}")
            return dest.as_posix()
        except (OSError, ValueError, requests.RequestException) as exc:
            logger.warning(f"  Image download failed ({img_url[:60]}): {exc}")
            return ""

    # ------------------------------------------------------------------
    #  Section page scraping (article listing)
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_listing_title(value: str) -> str:
        text = re.sub(r"\s+", " ", value or "").strip()
        text = re.sub(
            r"(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?"
            r"\d{1,2}\s+[A-Za-z]+\s+\d{4}(?:\s+\d{1,2}:\d{2})?.*$",
            "",
            text,
            flags=re.IGNORECASE,
        ).strip(" -|\u00a0")
        return text

    @classmethod
    def _extract_listing_date(cls, node) -> tuple:
        if node is None:
            return "No date", None
        for tag in node.select("time, .gtime, .date, .article-date, [datetime]"):
            raw = (tag.get("datetime") or tag.get("content") or tag.get_text(" ", strip=True)).strip()
            parsed = cls._parse_date(raw)
            if parsed:
                match = DATE_RE.search(raw)
                return (match.group(0).strip() if match else raw), parsed
        text = node.get_text(" ", strip=True)
        match = DATE_RE.search(text)
        if match:
            raw = match.group(0).strip()
            return raw, cls._parse_date(raw)
        return "No date", None

    @staticmethod
    def _nearby_nodes(link_tag, depth: int = 5) -> list:
        nodes = [link_tag]
        parent = link_tag.parent
        while parent is not None and len(nodes) <= depth:
            if getattr(parent, "name", None) in {"body", "html"}:
                break
            nodes.append(parent)
            parent = parent.parent
        return nodes

    def _parse_section_articles(
        self,
        soup: BeautifulSoup,
        section_url: str,
        category: str,
    ) -> list:
        """Parse one already-fetched section page without making requests."""
        records = {}
        for link_tag in soup.find_all("a", href=True):
            full_url = self._normalize_article_url(link_tag.get("href"), section_url)
            if not self._is_article_url(full_url):
                continue

            record = records.setdefault(
                full_url,
                {
                    "url": full_url,
                    "canonical_url": full_url,
                    "title": "",
                    "date": "No date",
                    "published_at": "",
                    "image_url": "",
                    "source_image_checked": True,
                    "article_id": ARTICLE_PATH_RE.search(urlsplit(full_url).path).group(1),
                    "category": category,
                    "_title_is_direct": False,
                },
            )

            nodes = self._nearby_nodes(link_tag)
            safe_nodes = [link_tag]
            for node in nodes[1:]:
                linked_articles = {
                    self._normalize_article_url(item.get("href"), section_url)
                    for item in node.find_all("a", href=True)
                    if self._is_article_url(
                        self._normalize_article_url(item.get("href"), section_url)
                    )
                }
                if linked_articles == {full_url}:
                    safe_nodes.append(node)

            direct_title_candidates = [
                link_tag.get("title", ""),
                link_tag.get("aria-label", ""),
                link_tag.get_text(" ", strip=True),
            ]
            heading = link_tag.find(["h1", "h2", "h3", "h4", "h5", "h6"])
            if heading:
                direct_title_candidates.insert(0, heading.get_text(" ", strip=True))
            cleaned = [
                self._clean_listing_title(item) for item in direct_title_candidates
            ]
            cleaned = [item for item in cleaned if 15 <= len(item) <= 500]
            if not cleaned:
                parent_candidates = []
                for node in safe_nodes[1:]:
                    heading = node.find(["h1", "h2", "h3", "h4", "h5", "h6"])
                    if heading:
                        parent_candidates.append(heading.get_text(" ", strip=True))
                cleaned = [
                    self._clean_listing_title(item) for item in parent_candidates
                ]
                cleaned = [item for item in cleaned if 15 <= len(item) <= 500]
                is_direct_title = False
            else:
                is_direct_title = True
            if cleaned:
                best_title = max(cleaned, key=len)
                if (
                    is_direct_title and not record["_title_is_direct"]
                ) or len(best_title) > len(record["title"]):
                    record["title"] = best_title
                    record["_title_is_direct"] = is_direct_title

            if not record["image_url"]:
                for node in safe_nodes:
                    for image_tag in node.find_all("img") if hasattr(node, "find_all") else []:
                        candidate = self._extract_image_url(image_tag, section_url)
                        if self._is_article_image(candidate):
                            record["image_url"] = candidate
                            break
                    if record["image_url"]:
                        break

            if not record["published_at"]:
                for node in safe_nodes:
                    raw_date, parsed_date = self._extract_listing_date(node)
                    if parsed_date:
                        record["date"] = raw_date
                        record["published_at"] = parsed_date.isoformat()
                        break

        articles = []
        for record in records.values():
            record.pop("_title_is_direct", None)
            if record.get("title"):
                articles.append(record)
        return articles

    def get_section_articles(self, section_url: str, category: str) -> list:
        """Scrape one section page and return normalized article previews."""
        section_url = self._normalize_article_url(section_url, self.BASE_URL)
        logger.info(f"📰 Fetching section: {category} ({section_url})")
        soup = self._get(section_url)
        if not soup or not soup.find():
            return []
        articles = self._parse_section_articles(soup, section_url, category)
        logger.info(f"  → Found {len(articles)} articles in {category}")
        return articles

    @staticmethod
    def _section_name(slug: str) -> str:
        return re.sub(r"[_-]+", " ", slug).strip().title()

    def discover_site_sections(self) -> list:
        """Discover all current Daily FT menu sections, with static fallbacks."""
        discovered = []
        seen = set()

        def add(url, category):
            normalized = self._normalize_article_url(url, self.BASE_URL)
            match = SECTION_PATH_RE.match(urlsplit(normalized).path) if normalized else None
            if not match or match.group(1).lower() in self.section_exclusions:
                return
            if normalized in seen:
                return
            seen.add(normalized)
            discovered.append(
                {
                    "url": normalized,
                    "category": category.strip() or self._section_name(match.group(1)),
                }
            )

        for section in SECTIONS:
            add(section["url"], section["category"])

        soup = self._get(self.BASE_URL)
        if soup and soup.find():
            for link in soup.find_all("a", href=True):
                normalized = self._normalize_article_url(link.get("href"), self.BASE_URL)
                match = SECTION_PATH_RE.match(urlsplit(normalized).path) if normalized else None
                if not match:
                    continue
                label = re.sub(r"\s+", " ", link.get_text(" ", strip=True)).strip()
                if not label or len(label) > 80 or label.lower().startswith("more "):
                    label = self._section_name(match.group(1))
                add(normalized, label)
        logger.info(f"Discovered/configured {len(discovered)} Daily FT sections")
        return discovered

    def _find_next_section_page(
        self,
        soup: BeautifulSoup,
        section_base_url: str,
        current_url: str,
    ) -> str:
        base_path = urlsplit(section_base_url).path.rstrip("/")
        current_path = urlsplit(current_url).path.rstrip("/")
        offset_match = re.search(r"/(\d+)$", current_path[len(base_path):])
        current_offset = int(offset_match.group(1)) if offset_match else 0
        candidates = []

        for link in soup.find_all("a", href=True):
            candidate = self._normalize_article_url(link.get("href"), current_url)
            if not candidate:
                continue
            path = urlsplit(candidate).path.rstrip("/")
            match = re.fullmatch(re.escape(base_path) + r"/(\d+)", path)
            if not match:
                continue
            offset = int(match.group(1))
            if offset > current_offset and offset % self.page_size == 0:
                candidates.append((offset, candidate))

        return min(candidates, default=(0, ""), key=lambda item: item[0])[1]

    def _crawl_section(
        self,
        section_url: str,
        category: str,
        max_pages_per_section: int,
        since_date,
        max_previews: int = None,
    ) -> list:
        base_url = self._normalize_article_url(section_url, self.BASE_URL)
        current_url = base_url
        visited_pages = set()
        previews = []
        seen_urls = set()

        while current_url and current_url not in visited_pages:
            if max_pages_per_section and len(visited_pages) >= max_pages_per_section:
                break
            visited_pages.add(current_url)
            logger.info(
                f"📰 Fetching {category} page {len(visited_pages)} ({current_url})"
            )
            soup = self._get(current_url)
            if not soup or not soup.find():
                break
            page_previews = self._parse_section_articles(soup, current_url, category)
            if not page_previews:
                break

            known_dates = []
            for preview in page_previews:
                published = self._parse_date(preview.get("published_at") or preview.get("date"))
                if published:
                    known_dates.append(published)
                if since_date and published and published < since_date:
                    continue
                if preview["url"] not in seen_urls:
                    previews.append(preview)
                    seen_urls.add(preview["url"])
                    if max_previews and len(previews) >= max_previews:
                        break

            logger.info(
                f"  → Page {len(visited_pages)}: {len(page_previews)} found, "
                f"{len(previews)} kept for {category}"
            )
            if since_date and known_dates and max(known_dates) < since_date:
                logger.info(f"  → Reached date cutoff for {category}")
                break
            if max_previews and len(previews) >= max_previews:
                break

            current_url = self._find_next_section_page(soup, base_url, current_url)

        return previews

    @staticmethod
    def _is_article_image(url: str) -> bool:
        """Check a source-extracted URL is plausibly article media, not UI/ad art."""
        if not url:
            return False
        lower = url.lower()
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return False
        is_junk = any(
            keyword in lower
            for keyword in (
                "logo",
                "icon",
                "avatar",
                "spinner",
                "placeholder",
                "default-image",
                "banner",
                "advertisement",
                "advr_",
                "advert_",
                "/advert/",
                "/ads/",
                "ad_",
                "1x1",
                "pixel",
                "unsplash.com",
                "pexels.com",
                "pixabay.com",
            )
        )
        if is_junk or parsed.path.lower().endswith(".svg"):
            return False
        path_lower = parsed.path.lower()
        return any(
            marker in path_lower
            for marker in (
                ".jpg",
                ".jpeg",
                ".png",
                ".webp",
                ".gif",
                ".avif",
                "/image/",
                "/images/",
                "/uploads/",
                "/cdn.",
            )
        ) or "oraclecloud.com" in parsed.netloc.lower()

    # ------------------------------------------------------------------
    #  Single article scraping (full detail)
    # ------------------------------------------------------------------
    def _extract_canonical_article_url(self, soup: BeautifulSoup, requested_url: str) -> str:
        candidates = []
        canonical = soup.find("link", rel=lambda value: value and "canonical" in value)
        if canonical:
            candidates.append(canonical.get("href", ""))
        og_url = soup.find("meta", property="og:url")
        if og_url:
            candidates.append(og_url.get("content", ""))
        candidates.append(requested_url)
        for value in candidates:
            normalized = self._normalize_article_url(value, requested_url)
            if self._is_article_url(normalized):
                return normalized
        return self._normalize_article_url(requested_url, self.BASE_URL)

    def scrape_article(self, url: str) -> dict:
        """
        Fetch a single ft.lk article page and extract all details:
        title, date, author, content paragraphs, images, article_id, categories.
        """
        requested_url = self._normalize_article_url(url, self.BASE_URL)
        soup = self._get(requested_url)
        if not soup or not soup.find():
            return {}
        canonical_url = self._extract_canonical_article_url(soup, requested_url)

        # ── Title ─────────────────────────────────────────────────────
        title = "No title"
        for sel in ("h1.innerheader", "h1.article-title", "h1", ".innerheader"):
            t = soup.select_one(sel)
            if t:
                title = t.get_text(strip=True)
                break
        if title == "No title":
            title_meta = soup.find("meta", property="og:title")
            if title_meta and title_meta.get("content"):
                title = title_meta["content"].strip()

        # ── Date ──────────────────────────────────────────────────────
        date = "No date"
        for sel in ("span.gtime", ".gtime", "p.date", ".date", "time", ".article-date"):
            t = soup.select_one(sel)
            if t:
                date = (t.get("datetime") or t.get("content") or t.get_text(strip=True)).strip()
                break
        if date == "No date":
            published_meta = (
                soup.find("meta", property="article:published_time")
                or soup.find("meta", attrs={"name": "date"})
                or soup.find("meta", attrs={"itemprop": "datePublished"})
            )
            if published_meta and published_meta.get("content"):
                date = published_meta["content"].strip()

        # ── Author ────────────────────────────────────────────────────
        author = "Unknown"
        for sel in (".author", ".byline", ".article-author", ".reporter"):
            t = soup.select_one(sel)
            if t:
                author = t.get_text(strip=True)
                break
        if author == "Unknown":
            author_meta = soup.find("meta", attrs={"name": "author"})
            if author_meta and author_meta.get("content"):
                author = author_meta["content"].strip()

        # ── Article ID from URL ───────────────────────────────────────
        article_id = None
        id_match = ARTICLE_PATH_RE.search(urlsplit(canonical_url).path)
        if id_match:
            article_id = id_match.group(1)

        # ── Image extraction (multi-strategy) ─────────────────────────
        image_url = self._extract_primary_image(soup, canonical_url)

        # Download image locally if requested
        local_image = ""
        if self.download_images and image_url:
            local_image = self._download_image(image_url, title, referer=canonical_url)

        # ── Body images (all images within article content) ───────────
        body_images = []
        content_area = (
            soup.find("header", class_="inner-content")
            or soup.find("div", class_="inner-d")
            or soup.find("div", class_="article-content")
            or soup.find("article")
        )
        if content_area:
            seen_body_images = set()
            for img in content_area.find_all("img"):
                img_url = self._extract_image_url(img, canonical_url)
                if (
                    img_url
                    and img_url not in seen_body_images
                    and self._is_article_image(img_url)
                ):
                    seen_body_images.add(img_url)
                    local_path = self._download_image(
                        img_url, title, referer=canonical_url
                    )
                    body_images.append(
                        {
                            "url": img_url,
                            "alt": img.get("alt", ""),
                            "local_path": local_path,
                        }
                    )

        # ── Content paragraphs ────────────────────────────────────────
        content = ""
        paragraphs = []

        for sel in (
            "header.inner-content p",
            ".inner-content p",
            ".col-xl-12.inner-d p",
            ".inner-d p",
            ".article-content p",
            "article p",
        ):
            p_tags = soup.select(sel)
            if p_tags:
                for p in p_tags:
                    txt = p.get_text(strip=True)
                    # Filter boilerplate and short fragments
                    if len(txt) > 40 and not BOILERPLATE_RE.search(txt):
                        paragraphs.append(txt)
                if paragraphs:
                    break

        # Deep fallback: all <p> tags
        if not paragraphs:
            for p in soup.find_all("p"):
                txt = p.get_text(strip=True)
                if len(txt) > 40 and not BOILERPLATE_RE.search(txt):
                    paragraphs.append(txt)

        content = "\n\n".join(paragraphs)
        summary = paragraphs[0] if paragraphs else ""

        # ── Categories / Tags ─────────────────────────────────────────
        categories = []
        for sel in (".category", ".categories a", ".tags a", ".breadcrumb a"):
            for t in soup.select(sel):
                text = t.get_text(strip=True)
                if text and text not in categories and text.lower() not in ("home", "ft.lk"):
                    categories.append(text)

        return {
            "url": canonical_url,
            "canonical_url": canonical_url,
            "title": title,
            "date": date,
            "published_at": (
                self._parse_date(date).isoformat() if self._parse_date(date) else ""
            ),
            "author": author,
            "article_id": article_id,
            "categories": categories,
            "summary": summary,
            "content": content.strip(),
            "full_text": content.strip(),
            "content_length": len(content),
            "paragraphs": paragraphs,
            "image": image_url,
            "main_image_url": image_url,
            "main_image_local": local_image,
            "source_image_checked": True,
            "image_checked": True,
            "body_images": body_images,
            "scraped_at": datetime.now().isoformat(),
        }

    # ------------------------------------------------------------------
    #  Main scrape loop (all sections)
    # ------------------------------------------------------------------
    @staticmethod
    def _preview_to_article(preview: dict) -> dict:
        image_url = preview.get("image_url", "")
        return {
            "url": preview.get("url", ""),
            "canonical_url": preview.get("canonical_url") or preview.get("url", ""),
            "title": preview.get("title", ""),
            "date": preview.get("date", "No date"),
            "published_at": preview.get("published_at", ""),
            "author": "Unknown",
            "article_id": preview.get("article_id"),
            "categories": [preview.get("category", "")],
            "category": preview.get("category", ""),
            "summary": preview.get("title", ""),
            "content": "",
            "full_text": "",
            "content_length": 0,
            "paragraphs": [],
            "image": image_url,
            "main_image_url": image_url,
            "main_image_local": "",
            "source_image_checked": True,
            "image_checked": True,
            "body_images": [],
            "scraped_at": datetime.now().isoformat(),
        }

    def scrape_all(
        self,
        max_articles: int = None,
        delay: float = None,
        sections: list = None,
        max_pages_per_section: int = None,
        since_date=None,
        discover_sections: bool = None,
        page_size: int = None,
        fetch_details: bool = True,
    ) -> list:
        """
        Full scraping pipeline:
          1. Iterate over all ft.lk sections
          2. Collect article links from each section
          3. Fetch full content for each article
          4. Apply rate limiting

        Args:
            max_articles: Limit total articles (None = all)
            delay: Seconds between requests (None = use self.delay)
            sections: Override section list (None = default SECTIONS)
            max_pages_per_section: 0 crawls until pagination ends; None uses init value
            since_date: Stop once sorted section pages are older than this date
            discover_sections: Discover all `/section/id` links from the live menu
            page_size: Expected FT pagination offset (currently 30)
            fetch_details: False avoids one article request per preview/archive item
        """
        if delay is not None:
            self.delay = max(0.0, float(delay))
        pages_limit = (
            self.max_pages_per_section
            if max_pages_per_section is None
            else max(0, int(max_pages_per_section or 0))
        )
        cutoff = self.since_date if since_date is None else self._parse_date(since_date)
        discover = self.discover_sections if discover_sections is None else bool(discover_sections)
        if page_size is not None:
            self.page_size = max(1, int(page_size or 30))

        if sections is None:
            sections_to_scrape = self.discover_site_sections() if discover else list(SECTIONS)
        else:
            sections_to_scrape = []
            for section in sections:
                if isinstance(section, str):
                    url = section
                    path = urlsplit(self._normalize_article_url(url, self.BASE_URL)).path
                    match = SECTION_PATH_RE.match(path)
                    category = self._section_name(match.group(1)) if match else "Daily FT"
                else:
                    url = section.get("url", "")
                    category = section.get("category", "Daily FT")
                normalized = self._normalize_article_url(url, self.BASE_URL)
                if normalized:
                    sections_to_scrape.append({"url": normalized, "category": category})

        all_previews = []
        previews_by_key = {}

        print("=" * 70)
        print(
            f"  FT.LK PRODUCTION SCRAPER — "
            f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        print(f"  Engine: {'Playwright + CloudScraper' if self.use_playwright else 'CloudScraper'}")
        print("=" * 70)

        # ── Phase 1: Collect article links from all sections ──────────
        for sec in sections_to_scrape:
            remaining = None
            if max_articles:
                remaining = max_articles - len(all_previews)
                if remaining <= 0:
                    break
            previews = self._crawl_section(
                sec["url"],
                sec["category"],
                pages_limit,
                cutoff,
                max_previews=remaining,
            )
            for p in previews:
                key = self._article_key(p["url"], p.get("article_id"))
                if key not in previews_by_key:
                    all_previews.append(p)
                    previews_by_key[key] = p
                else:
                    existing = previews_by_key[key]
                    categories = existing.setdefault(
                        "section_categories", [existing.get("category", "")]
                    )
                    if p.get("category") and p["category"] not in categories:
                        categories.append(p["category"])
                    if not existing.get("image_url") and p.get("image_url"):
                        existing["image_url"] = p["image_url"]

        if not all_previews:
            logger.error("❌ No articles found. Check internet / selectors.")
            return []

        # Apply a global limit after URL/article-ID deduplication.
        if max_articles:
            all_previews = all_previews[:max_articles]

        logger.info(f"\n📋 Total unique articles to scrape: {len(all_previews)}\n")

        # ── Phase 2: Fetch full content for each article ──────────────
        results = []
        result_keys = set()
        for i, preview in enumerate(all_previews, 1):
            logger.info(f"[{i}/{len(all_previews)}] {preview['title'][:60]}")
            cached = self._resume_articles.get(preview["url"])
            if cached and self._cached_article_is_complete(cached):
                article = dict(cached)
                logger.info("  ↳ resumed from checkpoint cache")
            elif fetch_details:
                article = self.scrape_article(preview["url"])
            else:
                article = self._preview_to_article(preview)

            if article and article.get("title") != "No title":
                # Use section listing image as fallback if article page had none
                if (not article.get("main_image_url")) and preview.get("image_url"):
                    article["main_image_url"] = preview["image_url"]
                    article["image"] = preview["image_url"]
                if (
                    self.download_images
                    and article.get("main_image_url")
                    and not article.get("main_image_local")
                ):
                    article["main_image_local"] = self._download_image(
                        article["main_image_url"],
                        article["title"],
                        referer=article.get("url") or preview["url"],
                    )

                # Preserve category from section listing
                if not article.get("categories"):
                    article["categories"] = [preview["category"]]
                article["category"] = preview["category"]
                article["section_categories"] = preview.get(
                    "section_categories", [preview["category"]]
                )
                article["source_image_checked"] = True
                article["image_checked"] = True
                article["url"] = self._normalize_article_url(
                    article.get("canonical_url") or article.get("url"),
                    preview["url"],
                )
                article["canonical_url"] = article["url"]
                key = self._article_key(article["url"], article.get("article_id"))
                if key in result_keys:
                    logger.info("  ↳ duplicate canonical article skipped")
                    continue
                result_keys.add(key)
                results.append(article)
                logger.info(
                    f"  ✅ {article.get('content_length', 0):,} chars | "
                    f"Image: {'✓' if article.get('main_image_url') else '✗'}"
                )
            else:
                logger.warning(f"  ⚠️  Failed to scrape — using preview data")
                article = self._preview_to_article(preview)
                key = self._article_key(article["url"], article.get("article_id"))
                if key not in result_keys:
                    result_keys.add(key)
                    results.append(article)

            if article and article.get("url"):
                previous = self._resume_articles.get(article["url"])
                if not previous or self._cached_article_is_complete(article):
                    self._resume_articles[article["url"]] = article
                    self._write_resume_state()

        self.articles_data = results
        logger.info(f"\n🏁 Done — {len(results)} articles scraped successfully.")
        return results

    # ------------------------------------------------------------------
    #  Save: Raw JSON (ft_articles.json format)
    # ------------------------------------------------------------------
    def save_json(self, filename: str = "ft_articles.json"):
        """Save raw scraper output to JSON."""
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(self.articles_data, f, ensure_ascii=False, indent=2)
        logger.info(f"💾 JSON saved → {filename}")

    # ------------------------------------------------------------------
    #  Save: Pipeline-compatible output (news_data.json + news_feed.json/js)
    # ------------------------------------------------------------------
    def save_pipeline_output(self):
        """
        Save data in the EXACT format expected by the existing pipeline:
          - news_data.json  (same structure as scrape_ft.py output)
          - news_feed.json  (same structure as app.js expects)
          - news_feed.js    (window.LIVE_NEWS_FEED for file:// loading)
        """
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # ── news_data.json (raw scraper format) ──────────────────────
        news_data = []
        for art in self.articles_data:
            news_data.append(
                {
                    "title": art.get("title", ""),
                    "link": art.get("url", ""),
                    "image": art.get("image", DEFAULT_IMAGE),
                    "category": art.get("category", ""),
                    "summary": art.get("summary", ""),
                    "full_text": art.get("full_text", ""),
                    "content": art.get("content", ""),
                    "paragraphs": art.get("paragraphs", []),
                    "source_image_checked": art.get("source_image_checked", True),
                }
            )

        with open("news_data.json", "w", encoding="utf-8") as f:
            json.dump(news_data, f, ensure_ascii=False, indent=2)
        logger.info("💾 news_data.json saved")

        # ── news_feed.json (app.js frontend format) ──────────────────
        feed_data = []
        for art in self.articles_data:
            stable_id = art.get("article_id") or hashlib.sha256(
                art.get("url", "").encode("utf-8")
            ).hexdigest()[:16]
            feed_data.append(
                {
                    "id": str(stable_id),
                    "url": art.get("url", ""),
                    "image": art.get("image", DEFAULT_IMAGE),
                    "source_image_checked": art.get("source_image_checked", True),
                    "source": "Daily FT (ft.lk)",
                    "scraped_at": now_str,
                    "headline_en": art.get("title", ""),
                    "headline_si": art.get("title", ""),
                    "summary_en": art.get("summary", ""),
                    "summary_si": art.get("summary", ""),
                    "full_text": art.get("full_text", ""),
                    "key_takeaways": [art.get("title", "")],
                    "category": art.get("category", ""),
                    "tags": [
                        art.get("category", ""),
                        "Daily FT",
                        "Sri Lanka",
                    ],
                }
            )

        with open("news_feed.json", "w", encoding="utf-8") as f:
            json.dump(feed_data, f, ensure_ascii=False, indent=2)
        logger.info("💾 news_feed.json saved")

        # ── news_feed.js (window.LIVE_NEWS_FEED) ─────────────────────
        with open("news_feed.js", "w", encoding="utf-8") as f:
            f.write("// Auto-generated by fit_lk.py (FT.lk Production Scraper)\n")
            f.write("window.LIVE_NEWS_FEED = ")
            json.dump(feed_data, f, ensure_ascii=False, indent=2)
            f.write(";\n")
        logger.info("💾 news_feed.js saved")

    # ------------------------------------------------------------------
    #  Save: CSV
    # ------------------------------------------------------------------
    def save_csv(self, filename: str = "ft_articles.csv"):
        """Save articles to CSV."""
        fields = [
            "url", "title", "date", "author", "article_id", "category",
            "content_length", "image", "main_image_url", "scraped_at", "content",
        ]
        with open(filename, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            for art in self.articles_data:
                row = {**art, "categories": ", ".join(art.get("categories", []))}
                w.writerow(row)
        logger.info(f"💾 CSV saved → {filename}")

    # ------------------------------------------------------------------
    #  Save: Standalone HTML report
    # ------------------------------------------------------------------
    def save_html(self, filename: str = "ft_articles.html"):
        """Generate a standalone HTML report with all articles and images."""
        rows = ""
        for art in self.articles_data:
            img_url = art.get("main_image_url") or art.get("image", "")
            img_html = (
                f'<img src="{img_url}" alt="{art.get("title", "")}" '
                f'style="max-width:100%;border-radius:6px;margin-bottom:12px;" '
                f'loading="lazy" onerror="this.style.display=\'none\'">'
                if img_url
                else "<p><em>No image</em></p>"
            )

            body_imgs = "".join(
                f'<img src="{i["url"]}" alt="{i.get("alt", "")}" '
                f'style="max-width:200px;margin:4px;" loading="lazy">'
                for i in art.get("body_images", [])
            )

            cats = " ".join(
                f'<span style="background:#0066cc;color:#fff;padding:2px 8px;'
                f'border-radius:12px;font-size:12px;margin:2px">{c}</span>'
                for c in art.get("categories", [])
            )

            paras = "".join(
                f"<p>{p}</p>"
                for p in art.get("content", "").split("\n\n")
                if p.strip()
            )

            rows += f"""
            <div class="article">
              {img_html}
              <h2><a href="{art.get('url', '#')}" target="_blank">
                {art.get('title', 'No title')}</a></h2>
              <div class="meta">
                📅 {art.get('date', '?')} &nbsp;|&nbsp;
                ✍️ {art.get('author', 'Unknown')} &nbsp;|&nbsp;
                🆔 {art.get('article_id', 'N/A')}
              </div>
              <div>{cats}</div>
              <div class="content">
                {paras or '<em>Content not available</em>'}
              </div>
              {"<div class='body-imgs'>" + body_imgs + "</div>" if body_imgs else ""}
            </div>"""

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FT.lk Articles — {datetime.now().strftime('%Y-%m-%d')}</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f4;color:#333;padding:20px}}
    h1{{color:#c00;margin-bottom:20px;font-size:28px}}
    .summary{{background:#fff3cd;border:1px solid #ffc107;padding:10px 16px;
              border-radius:6px;margin-bottom:24px}}
    .article{{background:#fff;border-radius:10px;padding:24px;margin-bottom:28px;
              box-shadow:0 2px 8px rgba(0,0,0,.08)}}
    .article h2{{font-size:20px;margin:0 0 10px;line-height:1.35}}
    .article h2 a{{color:#0066cc;text-decoration:none}}
    .article h2 a:hover{{text-decoration:underline}}
    .meta{{font-size:13px;color:#888;margin:8px 0 12px}}
    .content{{line-height:1.7;color:#444;margin-top:14px}}
    .content p{{margin-bottom:12px}}
    .body-imgs{{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px}}
  </style>
</head>
<body>
  <h1>🗞️ FT.lk Article Archive</h1>
  <div class="summary">
    📊 Total articles: <strong>{len(self.articles_data)}</strong>
    &nbsp;|&nbsp; Generated: <strong>{datetime.now().strftime('%Y-%m-%d %H:%M')}</strong>
    &nbsp;|&nbsp; Engine: <strong>{'Playwright + CloudScraper' if self.use_playwright else 'CloudScraper'}</strong>
  </div>
  {rows}
</body>
</html>"""

        with open(filename, "w", encoding="utf-8") as f:
            f.write(html)
        logger.info(f"💾 HTML saved → {filename}")

    # ------------------------------------------------------------------
    #  Summary
    # ------------------------------------------------------------------
    def print_summary(self):
        """Print a formatted summary of scraped articles."""
        total = len(self.articles_data)
        with_images = sum(1 for a in self.articles_data if a.get("main_image_url"))
        with_content = sum(1 for a in self.articles_data if a.get("content_length", 0) > 100)

        print("\n" + "=" * 70)
        print(f"  📊 SCRAPING SUMMARY — {total} articles")
        print(f"  📷 With images: {with_images}/{total}")
        print(f"  📝 With content: {with_content}/{total}")
        print("=" * 70)

        for i, art in enumerate(self.articles_data, 1):
            print(f"\n  {i}. {art.get('title', 'No title')[:65]}")
            print(f"     Category : {art.get('category', '?')}")
            print(f"     Date     : {art.get('date', '?')}")
            print(f"     Author   : {art.get('author', 'Unknown')}")
            print(f"     Content  : {art.get('content_length', 0):,} chars")
            img = art.get("main_image_url", "")
            print(f"     Image    : {'✅ ' + img[:60] if img else '❌ None'}")
            print(f"     URL      : {art.get('url', '')}")
        print()

    # ------------------------------------------------------------------
    #  Cleanup
    # ------------------------------------------------------------------
    def close(self):
        """Close Playwright browser and cleanup resources."""
        if self._pw_browser:
            try:
                self._pw_browser.close()
            except Exception:
                pass
        if self._pw:
            try:
                self._pw.stop()
            except Exception:
                pass
        logger.info("🔒 Scraper closed.")


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":

    # ── Configuration ────────────────────────────────────────────────
    MAX_ARTICLES = None         # None = scrape all found across sections
    DELAY = 2.5                 # seconds between article requests
    DOWNLOAD_IMAGES = False     # False = use remote CDN URLs (faster, recommended)
    IMAGE_FOLDER = "ft_images"  # local folder if downloading images
    USE_PLAYWRIGHT = True       # True = Playwright + CloudScraper (recommended)

    # ── Run ──────────────────────────────────────────────────────────
    scraper = FTScraper(
        download_images=DOWNLOAD_IMAGES,
        image_folder=IMAGE_FOLDER,
        delay=DELAY,
        use_playwright=USE_PLAYWRIGHT,
    )

    try:
        articles = scraper.scrape_all(max_articles=MAX_ARTICLES)

        if articles:
            scraper.print_summary()

            # Save standalone outputs
            scraper.save_json("ft_articles.json")
            scraper.save_csv("ft_articles.csv")
            scraper.save_html("ft_articles.html")

            # Save pipeline-compatible outputs (news_data.json, news_feed.json/js)
            scraper.save_pipeline_output()

            print(f"\n{'=' * 70}")
            print(f"  ✅ SUCCESS — All outputs saved:")
            print(f"     • ft_articles.json   (raw scraper output)")
            print(f"     • ft_articles.csv    (spreadsheet format)")
            print(f"     • ft_articles.html   (visual report)")
            print(f"     • news_data.json     (pipeline format)")
            print(f"     • news_feed.json     (app.js frontend)")
            print(f"     • news_feed.js       (window.LIVE_NEWS_FEED)")

            img_count = sum(1 for a in articles if a.get("main_image_url"))
            print(f"\n  📷 Articles with images: {img_count}/{len(articles)}")

            if DOWNLOAD_IMAGES:
                local_count = sum(1 for a in articles if a.get("main_image_local"))
                print(f"  💾 Downloaded locally: {local_count} → '{IMAGE_FOLDER}/'")

            print(f"{'=' * 70}")
        else:
            print("\n❌ No articles scraped.")
            print("   Troubleshooting tips:")
            print("   1. Check your internet connection")
            print("   2. Make sure USE_PLAYWRIGHT = True")
            print("   3. Try: pip install playwright && playwright install chromium")
            print("   4. ft.lk HTML structure may have changed")

    finally:
        scraper.close()
