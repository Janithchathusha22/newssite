"""Async, source-image-only Sri Lankan news aggregation.

WordPress publishers are read through their public REST APIs so each record
uses the publisher's canonical post data and exact featured-media URL. RSS is
kept as a per-source fallback, while Daily FT and Daily Mirror retain their
specialised ingestion paths. Zendriver remains an optional last-resort HTML
renderer; the normal run does not need a browser.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import mimetypes
import os
import random
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import aiofiles
import aiohttp
from bs4 import BeautifulSoup

from scraper import (
    canonicalize_article_url,
    extract_source_image,
    is_probable_source_image,
    normalize_image_url,
)
from source_registry import SourceRegistry, load_source_registry


PROJECT_DIR = Path(__file__).resolve().parent
IMAGE_DIR = PROJECT_DIR / os.getenv("SOURCE_IMAGE_FOLDER", "assets/news_images")
MAX_IMAGE_BYTES = max(1024, int(os.getenv("MAX_IMAGE_BYTES", str(15 * 1024 * 1024))))
SAFE_IMAGE_MIME_TYPES = {
    "image/avif", "image/gif", "image/jpeg", "image/png", "image/webp",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

SYNTHETIC_OR_JUNK_IMAGE_MARKERS = (
    "unsplash.com",
    "pexels.com",
    "pixabay.com",
    "placeholder",
    "dummyimage",
    "ftlk_logo_og",
    "/logo.",
    "/logos/",
    "/icon",
    "avatar",
    "spinner",
    "loader",
    "tracking",
    "pixel",
    "advr_",
    "advert",
    "banner",
    "1x1",
    "s.w.org/images/core/emoji",
    "/emoji/",
)

DAILY_MIRROR_ARTICLE_RE = re.compile(
    r"/(?:breaking-news|top-story|business-news|latest-news|news-features|"
    r"news|opinion|print|world-news|technology)/.+/[0-9]+-[0-9]+/?$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class FeedSource:
    key: str
    name: str
    source: str
    url: str
    category: str
    pages: int = 3
    max_items: int = 50


@dataclass(frozen=True)
class WordPressSource:
    key: str
    name: str
    source: str
    base_url: str
    feed_url: str
    category: str
    max_items: int = 50
    feed_pages: int = 4
    force_https: bool = False

    @property
    def api_url(self) -> str:
        return urljoin(self.base_url.rstrip("/") + "/", "wp-json/wp/v2/posts")

    def fallback_feed(self, maximum: int) -> FeedSource:
        return FeedSource(
            self.key,
            self.name,
            self.source,
            self.feed_url,
            self.category,
            self.feed_pages,
            maximum,
        )


@dataclass(frozen=True)
class ListingSource:
    """Publisher homepage whose canonical article links are parsed from HTML."""

    key: str
    name: str
    source: str
    url: str
    host_suffix: str
    article_path_pattern: str
    category: str = "Governance & Policy"
    max_items: int = 40


WP_REST_SOURCES = (
    WordPressSource(
        "economynext", "EconomyNext", "EconomyNext (economynext.com)",
        "https://economynext.com/", "https://economynext.com/feed/",
        "Economy & Finance", 50,
    ),
    WordPressSource(
        "lbo", "Lanka Business Online", "LBO (lankabusinessonline.com)",
        "https://www.lankabusinessonline.com/",
        "https://www.lankabusinessonline.com/feed/", "Business & Corporate", 50,
    ),
    WordPressSource(
        "srilankabiz", "SriLankaBiz", "SriLankaBiz (srilankabiz.lk)",
        "https://srilankabiz.lk/", "https://srilankabiz.lk/feed/",
        "Business & Corporate", 50,
    ),
    WordPressSource(
        "business-today", "Business Today", "Business Today (businesstoday.lk)",
        "https://businesstoday.lk/", "https://businesstoday.lk/feed/",
        "Business & Corporate", 35, 3,
    ),
    WordPressSource(
        "ada-en", "Ada Derana Biz English",
        "Ada Derana Biz English (bizenglish.adaderana.lk)",
        "https://bizenglish.adaderana.lk/",
        "https://bizenglish.adaderana.lk/feed/", "Business & Corporate", 50, 4, True,
    ),
    WordPressSource(
        "island", "The Island", "The Island (island.lk)",
        "https://island.lk/", "https://island.lk/feed/",
        "Governance & Policy", 35, 3,
    ),
    WordPressSource(
        "daily-news", "Daily News", "Daily News (dailynews.lk)",
        "https://dailynews.lk/", "https://dailynews.lk/feed/",
        "Governance & Policy", 35, 3,
    ),
    WordPressSource(
        "sri-lanka-mirror", "Sri Lanka Mirror",
        "Sri Lanka Mirror (srilankamirror.com)",
        "https://srilankamirror.com/", "https://srilankamirror.com/feed/",
        "Governance & Policy", 35, 3,
    ),
    WordPressSource(
        "sunday-observer", "Sunday Observer",
        "Sunday Observer (sundayobserver.lk)",
        "https://www.sundayobserver.lk/", "https://www.sundayobserver.lk/feed/",
        "Governance & Policy", 35, 3,
    ),
)


LISTING_SOURCES = (
    ListingSource(
        "newsfirst", "News First", "News First (newsfirst.lk)",
        "https://english.newsfirst.lk/", "newsfirst.lk",
        r"/20\d{2}/\d{2}/\d{2}/[^/]+/?$", max_items=45,
    ),
    ListingSource(
        "hiru-news", "Hiru News", "Hiru News (hirunews.lk)",
        "https://www.hirunews.lk/en/", "hirunews.lk",
        r"/(?:en|english)/\d+/[^/]+/?$", max_items=45,
    ),
)


# Daily FT keeps its publisher-specific feeds. The WordPress feeds above are
# invoked only when their corresponding REST API is unavailable.
FEED_SOURCES = (
    # CAASL exposes an official Joomla RSS endpoint containing the canonical
    # article URL, body and publisher image. One request is sufficient; the
    # detail-page pass remains available when metadata is incomplete.
    FeedSource(
        "caa", "Civil Aviation Authority",
        "Civil Aviation Authority (caa.lk)",
        "https://www.caa.lk/en/news?format=feed&type=rss",
        "Governance & Policy", 1, 25,
    ),
    FeedSource(
        "ada-derana", "Ada Derana", "Ada Derana (adaderana.lk)",
        "https://www.adaderana.lk/rss.php", "Governance & Policy", 1, 50,
    ),
    # Sinhala Ada Derana Biz does not expose the same verified REST shape as
    # the English site, so retain its official publisher feed here.
    FeedSource(
        "ada-si", "Ada Derana Biz Sinhala", "Ada Derana Biz (biz.adaderana.lk)",
        "http://biz.adaderana.lk/feed/", "Business & Corporate", 4, 40,
    ),
    # Daily FT's lightweight feeds keep the normal all-site run responsive.
    # fit_lk.py remains available for opt-in deep section/archive crawling.
    FeedSource(
        "ft-front", "Daily FT Front Page", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/front-page/44", "Front Page", 2, 20,
    ),
    FeedSource(
        "ft-top", "Daily FT Top Story", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/top-story/26", "Top Story", 2, 20,
    ),
    FeedSource(
        "ft-finance", "Daily FT Financial Services", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/financial-services/42", "Economy & Finance", 2, 20,
    ),
    FeedSource(
        "ft-corporate", "Daily FT Corporate", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/corporate/27", "Business & Corporate", 2, 20,
    ),
    FeedSource(
        "ft-opinion", "Daily FT Opinion", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/opinion/14", "Opinion & Issues", 2, 20,
    ),
    FeedSource(
        "ft-news", "Daily FT News", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/news/56", "Governance & Policy", 2, 20,
    ),
    FeedSource(
        "ft-markets", "Daily FT Markets", "Daily FT (ft.lk)",
        "https://www.ft.lk/rss/markets/10518", "Economy & Finance", 2, 20,
    ),
)


# These sources need small publisher-specific parsers rather than a broad
# generic crawler. Xinhua is deliberately filtered to headlines that name Sri
# Lanka so this Sri Lankan newsroom does not ingest the whole regional wire.
ARMY_SOURCE = ListingSource(
    "army", "Sri Lanka Army", "Sri Lanka Army (army.lk)",
    "https://www.army.lk/army_moments", "army.lk",
    r"/news/[a-z0-9][a-z0-9-]+/?$", max_items=35,
)
XINHUA_SRI_LANKA_SOURCE = ListingSource(
    "xinhua-sri-lanka", "Xinhua", "Xinhua (english.news.cn)",
    "https://english.news.cn/asiapacific/index.htm", "news.cn",
    r"/(?:asiapacific/)?20\d{6}/[0-9a-f]{32}/c\.html$", max_items=25,
)
THE_MORNING_BASE_URL = "https://www.themorning.lk/"
THE_MORNING_BUILD_PROBE_URL = "https://www.themorning.lk/feed"


# Adapter aliases correspond to the keys exposed by the admin source registry.
# Domain matching remains the primary control and also covers all of Daily FT's
# section feeds and Ada Derana's language/business subdomains.
SOURCE_ADAPTER_KEYS = {
    "economynext": "economynext-wp",
    "lbo": "lbo-wp",
    "srilankabiz": "srilankabiz-wp",
    "business-today": "business-today-wp",
    "ada-en": "ada-derana-rss",
    "island": "island-wp",
    "daily-news": "daily-news-wp",
    "sri-lanka-mirror": "sri-lanka-mirror-wp",
    "sunday-observer": "sunday-observer-wp",
    "caa": "caa-rss",
    "ada-derana": "ada-derana-rss",
    "ada-si": "ada-derana-rss",
    "ft-front": "daily-ft-rss",
    "ft-top": "daily-ft-rss",
    "ft-finance": "daily-ft-rss",
    "ft-corporate": "daily-ft-rss",
    "ft-opinion": "daily-ft-rss",
    "ft-news": "daily-ft-rss",
    "ft-markets": "daily-ft-rss",
    "newsfirst": "newsfirst-html",
    "hiru-news": "hiru-html",
    "army": "army-html",
    "xinhua-sri-lanka": "xinhua-sri-lanka-html",
    "the-morning": "the-morning-next-data",
    "daily-mirror": "daily-mirror-html",
}


def _source_domain(source) -> str:
    return (
        getattr(source, "host_suffix", "")
        or urlsplit(
            getattr(source, "base_url", "")
            or getattr(source, "url", "")
        ).hostname
        or ""
    )


def _source_is_enabled(registry: SourceRegistry, source, *, key: str | None = None) -> bool:
    source_key = key or getattr(source, "key", "")
    return registry.allows(
        domain=_source_domain(source),
        adapter_key=SOURCE_ADAPTER_KEYS.get(source_key, ""),
        source_key=source_key,
    )


def _enabled_sources(sources: Iterable, registry: SourceRegistry) -> tuple:
    """Return sources enabled in this run's immutable registry snapshot."""
    return tuple(source for source in sources if _source_is_enabled(registry, source))


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _feed_page_url(base_url: str, page: int) -> str:
    if page <= 1:
        return base_url
    parts = urlsplit(base_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["paged"] = str(page)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ""))


def _clean_text(value, limit: int | None = None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit].rstrip() if limit and len(text) > limit else text


def _clean_html_text(value, limit: int | None = None) -> str:
    if not value:
        return ""
    soup = BeautifulSoup(str(value), "html.parser")
    return _clean_text(soup.get_text(" ", strip=True), limit)


from dateutil import parser as date_parser


def _normalize_date(value) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    parsed = None
    try:
        parsed = parsedate_to_datetime(text)
    except (TypeError, ValueError, OverflowError):
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = date_parser.parse(text)
            except (TypeError, ValueError, OverflowError):
                return text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")



def _stable_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:20]


def _is_source_image(url: str, article_url: str = "") -> bool:
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        return False
    lowered = url.lower()
    return (
        not any(marker in lowered for marker in SYNTHETIC_OR_JUNK_IMAGE_MARKERS)
        and is_probable_source_image(url, article_url)
    )


def _largest_srcset(value: str) -> str:
    candidates = []
    for entry in str(value or "").split(","):
        parts = entry.strip().split()
        if not parts:
            continue
        score = 0.0
        if len(parts) > 1:
            match = re.search(r"([0-9.]+)(w|x)$", parts[-1])
            if match:
                score = float(match.group(1)) * (1000 if match.group(2) == "x" else 1)
        candidates.append((score, parts[0]))
    return max(candidates, default=(0, ""), key=lambda item: item[0])[1]


def _image_from_tag(tag, page_url: str) -> str:
    if not tag:
        return ""
    for attr in (
        "data-src", "data-lazy-src", "data-original", "data-image", "data-url",
    ):
        candidate = normalize_image_url(tag.get(attr), page_url)
        if _is_source_image(candidate, page_url):
            return candidate
    for attr in ("data-srcset", "srcset"):
        candidate = normalize_image_url(_largest_srcset(tag.get(attr)), page_url)
        if _is_source_image(candidate, page_url):
            return candidate
    candidate = normalize_image_url(tag.get("src"), page_url)
    return candidate if _is_source_image(candidate, page_url) else ""


def _declared_item_image(item, page_url: str) -> str:
    """Return only RSS media explicitly attached to this feed item."""
    for tag in item.find_all(True):
        name = str(tag.name or "").lower().split(":")[-1]
        if name not in {"enclosure", "content", "thumbnail"}:
            continue
        candidate = normalize_image_url(tag.get("url") or tag.get("href"), page_url)
        media_type = str(tag.get("type") or tag.get("medium") or "").lower()
        if candidate and _is_source_image(candidate, page_url) and (
            not media_type or "image" in media_type or name == "thumbnail"
        ):
            return candidate
    return ""


def _item_image(item, page_url: str, html_fragments: Iterable[str]) -> str:
    declared = _declared_item_image(item, page_url)
    if declared:
        return declared
    for fragment in html_fragments:
        fragment_soup = BeautifulSoup(fragment or "", "html.parser")
        for image in fragment_soup.find_all("img"):
            candidate = _image_from_tag(image, page_url)
            if candidate:
                return candidate
    return ""


def _normalized_category(raw_category: str, default: str) -> str:
    value = _clean_text(raw_category).lower()
    if any(word in value for word in ("opinion", "column", "editorial")):
        return "Opinion & Issues"
    if any(word in value for word in ("government", "governance", "policy", "politic", "law", "news")):
        return "Governance & Policy"
    if any(word in value for word in ("econom", "financ", "bank", "market", "stock", "forex", "bond")):
        return "Economy & Finance"
    if any(word in value for word in ("sustain", "environment", "leadership", "esg", "climate")):
        return "ESG & Leadership"
    if default in {
        "Business & Corporate", "Governance & Policy", "Economy & Finance",
        "ESG & Leadership", "Opinion & Issues", "Front Page", "Top Story",
    }:
        return default
    return "Business & Corporate"


def _rss_records(payload: bytes, source: FeedSource, response_url: str) -> list[dict]:
    soup = BeautifulSoup(payload, "xml")
    records = []
    for item in soup.find_all("item"):
        title_tag = item.find("title")
        link_tag = item.find("link")
        title = _clean_text(title_tag.get_text(" ", strip=True) if title_tag else "", 500)
        link = canonicalize_article_url(
            link_tag.get_text(strip=True) if link_tag else ""
        )
        if len(title) < 12 or not link.startswith(("http://", "https://")):
            continue

        description_tag = item.find("description") or item.find("summary")
        encoded_tag = item.find("content:encoded") or item.find("encoded")
        description_html = description_tag.get_text() if description_tag else ""
        content_html = encoded_tag.get_text() if encoded_tag else ""
        raw_summary = _clean_html_text(description_html, 1200)
        full_text = _clean_html_text(content_html, 20000)

        categories = [
            _clean_text(tag.get_text(" ", strip=True))
            for tag in item.find_all("category")
            if _clean_text(tag.get_text(" ", strip=True))
        ]
        source_category = categories[0] if categories else source.category
        published_tag = (
            item.find("pubDate") or item.find("published") or item.find("updated")
            or item.find("dc:date") or item.find("date")
        )
        published_at = _normalize_date(
            published_tag.get_text(" ", strip=True) if published_tag else ""
        )
        image_page_url = link or response_url
        declared_image = _declared_item_image(item, image_page_url)
        source_image = declared_image or _item_image(
            item, image_page_url, (description_html, content_html)
        )
        records.append(
            {
                "id": _stable_id(link),
                "raw_title": title,
                "title": title,
                "url": link,
                "link": link,
                "raw_summary": raw_summary or title,
                "summary": raw_summary or title,
                "full_text": full_text,
                "content": full_text,
                "source": source.source,
                "source_name": source.name,
                "source_category": source_category,
                "category": _normalized_category(source_category, source.category),
                "published_at": published_at,
                "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "source_image": source_image,
                "image": source_image,
                "image_local": "",
                "local_image_path": "",
                # An enclosure/media element is explicitly tied to this item.
                # A generic <img> found in feed HTML is provisional and must be
                # replaced by canonical article-page metadata before caching.
                "source_image_checked": bool(declared_image),
                "tags": categories[:6],
            }
        )
    return records


def _publisher_url(value, source: WordPressSource, *, image: bool = False) -> str:
    """Resolve a publisher URL and upgrade Ada Derana's legacy HTTP URLs."""
    raw = _clean_text(value)
    if not raw:
        return ""
    absolute = urljoin(source.base_url, raw)
    parts = urlsplit(absolute)
    hostname = (parts.hostname or "").lower()
    if source.force_https and hostname in {
        "bizenglish.adaderana.lk",
        "www.bizenglish.adaderana.lk",
        "s3.amazonaws.com",
    }:
        absolute = urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))
    if image:
        return normalize_image_url(absolute, source.base_url)
    return canonicalize_article_url(absolute)


def _wp_rendered(post: dict, field: str, limit: int) -> str:
    value = post.get(field) or {}
    if isinstance(value, dict):
        value = value.get("rendered") or value.get("raw") or ""
    return _clean_html_text(value, limit)


def _wp_embedded_terms(post: dict) -> tuple[list[str], list[str]]:
    embedded = post.get("_embedded") or {}
    term_groups = embedded.get("wp:term") or []
    if isinstance(term_groups, dict):
        term_groups = [term_groups]
    categories = []
    tags = []
    for group in term_groups:
        terms = group if isinstance(group, list) else [group]
        for term in terms:
            if not isinstance(term, dict):
                continue
            name = _clean_text(term.get("name"), 160)
            if not name:
                continue
            taxonomy = str(term.get("taxonomy") or "").lower()
            target = categories if taxonomy == "category" else tags
            if name not in target:
                target.append(name)
    return categories, tags


def _wp_featured_image(post: dict, source: WordPressSource) -> str:
    embedded = post.get("_embedded") or {}
    media_items = embedded.get("wp:featuredmedia") or []
    if isinstance(media_items, dict):
        media_items = [media_items]
    for media in media_items:
        if not isinstance(media, dict):
            continue
        # source_url is the publisher's original uploaded asset. Do not replace
        # it with a generated, stock, logo, or unrelated listing image.
        candidate = _publisher_url(media.get("source_url"), source, image=True)
        if _is_source_image(candidate, source.base_url):
            return candidate
        full_size = (
            ((media.get("media_details") or {}).get("sizes") or {}).get("full") or {}
        )
        candidate = _publisher_url(full_size.get("source_url"), source, image=True)
        if _is_source_image(candidate, source.base_url):
            return candidate
    return ""


def _wp_rest_records(payload, source: WordPressSource) -> list[dict]:
    """Convert a WordPress posts response into the common article shape."""
    if isinstance(payload, (bytes, bytearray)):
        try:
            payload = json.loads(payload.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError, TypeError):
            return []
    elif isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (ValueError, TypeError):
            return []
    if not isinstance(payload, list):
        return []

    scraped_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    records = []
    for post in payload:
        if not isinstance(post, dict):
            continue
        title = _wp_rendered(post, "title", 500)
        link = _publisher_url(post.get("link"), source)
        if len(title) < 12 or not link.startswith(("http://", "https://")):
            continue

        excerpt = _wp_rendered(post, "excerpt", 1200)
        content = _wp_rendered(post, "content", 30000)
        categories, post_tags = _wp_embedded_terms(post)
        source_category = categories[0] if categories else source.category
        source_image = _wp_featured_image(post, source)
        published_at = _normalize_date(
            post.get("date_gmt") or post.get("date") or post.get("modified_gmt")
            or post.get("modified") or ""
        )
        records.append(
            {
                "id": _stable_id(link),
                "source_id": str(post.get("id") or ""),
                "raw_title": title,
                "title": title,
                "url": link,
                "link": link,
                "raw_summary": excerpt or content[:1200] or title,
                "summary": excerpt or content[:1200] or title,
                "full_text": content,
                "content": content,
                "source": source.source,
                "source_name": source.name,
                "source_category": source_category,
                "category": _normalized_category(source_category, source.category),
                "published_at": published_at,
                "scraped_at": scraped_at,
                "source_image": source_image,
                "image": source_image,
                "image_local": "",
                "local_image_path": "",
                # If featured media is absent, the article-detail pass may still
                # find an explicit og:image or a real inline article image.
                "source_image_checked": bool(source_image),
                "tags": (categories + post_tags)[:6],
            }
        )
    return records


async def _request_bytes(
    session: aiohttp.ClientSession,
    url: str,
    *,
    referer: str = "",
    accept: str = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    retries: int = 2,
) -> tuple[bytes, str, str]:
    headers = {"Accept": accept}
    if referer:
        headers["Referer"] = referer
    for attempt in range(retries + 1):
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as response:
                if response.status == 429:
                    try:
                        retry_after = int(response.headers.get("Retry-After", "3"))
                    except (TypeError, ValueError):
                        retry_after = 3
                    retry_after = min(max(retry_after, 1), 30)
                    await asyncio.sleep(retry_after)
                    continue
                if response.status >= 400:
                    if response.status in {403, 500, 502, 503, 504} and attempt < retries:
                        await asyncio.sleep((attempt + 1) * 1.5 + random.random())
                        continue
                    return b"", str(response.url), response.headers.get("Content-Type", "")
                return (
                    await response.read(),
                    str(response.url),
                    response.headers.get("Content-Type", ""),
                )
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            if attempt < retries:
                await asyncio.sleep((attempt + 1) * 1.5 + random.random())
    return b"", url, ""


async def _fetch_feed_page(
    session: aiohttp.ClientSession,
    source: FeedSource,
    page: int,
) -> tuple[FeedSource, int, list[dict]]:
    page_url = _feed_page_url(source.url, page)
    payload, response_url, _ = await _request_bytes(
        session, page_url, accept="application/rss+xml,application/xml,text/xml,*/*;q=0.8"
    )
    return source, page, _rss_records(payload, source, response_url) if payload else []


def _wp_api_page_url(source: WordPressSource, page: int, per_page: int) -> str:
    query = urlencode(
        {
            "page": max(1, page),
            "per_page": min(100, max(1, per_page)),
            "orderby": "date",
            "order": "desc",
            "_embed": "wp:featuredmedia,wp:term",
            "_fields": (
                "id,date,date_gmt,modified,modified_gmt,link,slug,title,excerpt,"
                "content,categories,tags,featured_media,_links,_embedded"
            ),
        }
    )
    return f"{source.api_url}?{query}"


async def _fetch_wp_rss_fallback(
    session: aiohttp.ClientSession,
    source: WordPressSource,
    maximum: int,
) -> list[dict]:
    feed = source.fallback_feed(maximum)
    records = []
    for page in range(1, feed.pages + 1):
        _, _, page_records = await _fetch_feed_page(session, feed, page)
        if not page_records:
            break
        records.extend(page_records)
        records = _dedupe(records)
        if len(records) >= maximum:
            break
    return records[:maximum]


async def _fetch_wp_source(
    session: aiohttp.ClientSession,
    source: WordPressSource,
    *,
    per_page: int,
    maximum: int,
) -> tuple[WordPressSource, list[dict], str]:
    """Fetch one WP source via REST, filling a failed run from RSS."""
    records = []
    api_failed = False
    page = 1
    while len(records) < maximum:
        request_size = min(per_page, maximum - len(records), 100)
        api_url = _wp_api_page_url(source, page, request_size)
        payload, _, content_type = await _request_bytes(
            session,
            api_url,
            referer=source.base_url,
            accept="application/json,*/*;q=0.8",
            retries=2,
        )
        if not payload or "json" not in content_type.lower():
            api_failed = True
            break
        page_records = _wp_rest_records(payload, source)
        if not page_records:
            api_failed = True
            break
        records.extend(page_records)
        records = _dedupe(records)
        if len(page_records) < request_size:
            break
        page += 1

    mode = "rest"
    if api_failed:
        fallback = await _fetch_wp_rss_fallback(session, source, maximum)
        if fallback:
            records = _dedupe([*records, *fallback])
            mode = "rest+rss" if records and len(records) > len(fallback) else "rss"
        elif not records:
            mode = "unavailable"
    return source, records[:maximum], mode


def _daily_mirror_records(payload: bytes, response_url: str) -> list[dict]:
    soup = BeautifulSoup(payload, "lxml")
    records = {}
    title_scores = {}
    for anchor in soup.find_all("a", href=True):
        link = canonicalize_article_url(urljoin(response_url, anchor.get("href", "")))
        parts = urlsplit(link)
        if not parts.netloc.lower().endswith("dailymirror.lk"):
            continue
        if not DAILY_MIRROR_ARTICLE_RE.search(parts.path):
            continue

        candidates = [
            anchor.get("title", ""),
            anchor.get("aria-label", ""),
            anchor.get_text(" ", strip=True),
        ]
        heading_parent = anchor.find_parent(["h1", "h2", "h3", "h4", "h5", "h6"])
        if heading_parent:
            candidates.insert(0, heading_parent.get_text(" ", strip=True))
        candidates = [_clean_text(value, 500) for value in candidates]
        candidates = [
            value for value in candidates
            if 12 <= len(value) <= 300 and value.lower() not in {"read more", "image"}
        ]
        if not candidates:
            continue
        title = candidates[0]
        score = (1000 if heading_parent else 0) + (300 - abs(len(title) - 75))
        if link in records and title_scores[link] >= score:
            continue

        path_lower = parts.path.lower()
        source_category = "Business" if "business-news" in path_lower else (
            "Opinion" if "/opinion/" in path_lower else "Breaking News"
        )
        records[link] = {
            "id": _stable_id(link),
            "raw_title": title,
            "title": title,
            "url": link,
            "link": link,
            "raw_summary": title,
            "summary": title,
            "full_text": "",
            "content": "",
            "source": "Daily Mirror (dailymirror.lk)",
            "source_name": "Daily Mirror",
            "source_category": source_category,
            "category": _normalized_category(source_category, "Governance & Policy"),
            "published_at": "",
            "scraped_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            # Always take Daily Mirror's definitive image from the article page;
            # broad homepage containers can associate the wrong thumbnail.
            "source_image": "",
            "image": "",
            "image_local": "",
            "local_image_path": "",
            "source_image_checked": False,
            "tags": [source_category, "Daily Mirror"],
        }
        title_scores[link] = score
    return list(records.values())


def _listing_title(anchor) -> str:
    heading = anchor.find(["h1", "h2", "h3", "h4", "h5", "h6"])
    candidates = [
        heading.get_text(" ", strip=True) if heading else "",
        anchor.get("title", ""),
        anchor.get("aria-label", ""),
        anchor.get_text(" ", strip=True),
    ]
    for candidate in candidates:
        title = _clean_text(candidate, 500)
        if not title:
            continue
        title = re.sub(r"\s*Read\s+more\s*$", "", title, flags=re.IGNORECASE)
        title = re.split(r"\s+COLOMBO\s*\(", title, maxsplit=1, flags=re.IGNORECASE)[0]
        title = re.sub(
            r"\s+(?:General|International|Business|Sports|Entertainment)\s+"
            r"\d{1,2}\s+[A-Za-z]+\s+20\d{2}.*$",
            "",
            title,
            flags=re.IGNORECASE,
        )
        title = re.sub(r"^\d{2}-\d{2}-20\d{2}\s*\|\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*", "", title)
        title = _clean_text(title, 300)
        if len(title) >= 12:
            return title
    return ""


def _listing_records(payload: bytes, response_url: str, source: ListingSource) -> list[dict]:
    """Extract only canonical, publisher-owned article links from a listing."""
    if not payload:
        return []
    soup = BeautifulSoup(payload, "lxml")
    article_pattern = re.compile(source.article_path_pattern, re.IGNORECASE)
    scraped_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    records = {}
    for anchor in soup.find_all("a", href=True):
        link = canonicalize_article_url(urljoin(response_url or source.url, anchor.get("href", "")))
        parts = urlsplit(link)
        hostname = (parts.hostname or "").lower()
        if not (hostname == source.host_suffix or hostname.endswith(f".{source.host_suffix}")):
            continue
        if not article_pattern.search(parts.path):
            continue
        title = _listing_title(anchor)
        if not title:
            continue
        published_at = ""
        dated_path = re.search(r"/(20\d{2})/(\d{2})/(\d{2})/", parts.path)
        if dated_path:
            published_at = f"{dated_path.group(1)}-{dated_path.group(2)}-{dated_path.group(3)}T00:00:00Z"
        else:
            # Some official listings (notably army.lk) put an ISO date beside
            # the headline instead of in the URL. Restrict the lookup to the
            # article card so a neighbouring story's date cannot leak in.
            card = anchor.find_parent("article")
            card_text = _clean_text(card.get_text(" ", strip=True) if card else "")
            listed_date = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", card_text)
            if listed_date:
                published_at = f"{listed_date.group(1)}T00:00:00Z"
        records.setdefault(link, {
            "id": _stable_id(link),
            "raw_title": title,
            "title": title,
            "url": link,
            "link": link,
            "raw_summary": title,
            "summary": title,
            "full_text": "",
            "content": "",
            "source": source.source,
            "source_name": source.name,
            "source_category": source.category,
            "category": _normalized_category(source.category, source.category),
            "published_at": published_at,
            "scraped_at": scraped_at,
            "source_image": "",
            "image": "",
            "image_local": "",
            "local_image_path": "",
            "source_image_checked": False,
            "tags": [source.name],
        })
        if len(records) >= source.max_items:
            break
    return list(records.values())


def _xinhua_sri_lanka_records(payload: bytes, response_url: str) -> list[dict]:
    """Read Xinhua's regional listing without importing unrelated countries."""
    if not payload:
        return []
    source = XINHUA_SRI_LANKA_SOURCE
    soup = BeautifulSoup(payload, "lxml")
    article_pattern = re.compile(source.article_path_pattern, re.IGNORECASE)
    headline_pattern = re.compile(r"\bsri\s+lanka(?:n|'s|’s)?\b", re.IGNORECASE)
    scraped_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    records = {}
    for anchor in soup.find_all("a", href=True):
        title = _listing_title(anchor)
        if not title or not headline_pattern.search(title):
            continue
        raw_link = _clean_text(anchor.get("href"))
        # The Asia-Pacific index uses paths relative to its directory even
        # though Xinhua serves the article at the site root.
        link = canonicalize_article_url(urljoin("https://english.news.cn/", raw_link))
        parts = urlsplit(link)
        hostname = (parts.hostname or "").lower()
        if not (hostname == source.host_suffix or hostname.endswith(f".{source.host_suffix}")):
            continue
        if not article_pattern.search(parts.path):
            continue
        dated_path = re.search(r"/(20\d{2})(\d{2})(\d{2})/", parts.path)
        published_at = (
            f"{dated_path.group(1)}-{dated_path.group(2)}-{dated_path.group(3)}T00:00:00Z"
            if dated_path else ""
        )
        records.setdefault(link, {
            "id": _stable_id(link),
            "raw_title": title,
            "title": title,
            "url": link,
            "link": link,
            "raw_summary": title,
            "summary": title,
            "full_text": "",
            "content": "",
            "source": source.source,
            "source_name": source.name,
            "source_category": source.category,
            "category": _normalized_category(source.category, source.category),
            "published_at": published_at,
            "scraped_at": scraped_at,
            "source_image": "",
            "image": "",
            "image_local": "",
            "local_image_path": "",
            "source_image_checked": False,
            "tags": ["Sri Lanka", "Xinhua"],
        })
        if len(records) >= source.max_items:
            break
    return list(records.values())


def _morning_build_id(payload: bytes) -> str:
    if not payload:
        return ""
    soup = BeautifulSoup(payload, "lxml")
    next_data = soup.find("script", id="__NEXT_DATA__")
    if next_data:
        try:
            value = json.loads(next_data.string or next_data.get_text() or "{}")
            build_id = _clean_text(value.get("buildId")) if isinstance(value, dict) else ""
            if re.fullmatch(r"[A-Za-z0-9_-]{6,100}", build_id):
                return build_id
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    match = re.search(rb"/_next/static/([A-Za-z0-9_-]{6,100})/_buildManifest\.js", payload)
    return match.group(1).decode("ascii") if match else ""


def _morning_records(payload) -> list[dict]:
    """Convert The Morning's public Next.js homepage data to source records."""
    if isinstance(payload, (bytes, bytearray)):
        try:
            payload = json.loads(payload.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError, TypeError):
            return []
    if not isinstance(payload, dict):
        return []
    page_props = payload.get("pageProps") or {}
    posts = page_props.get("latestNews") if isinstance(page_props, dict) else []
    if not isinstance(posts, list):
        return []

    scraped_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    records = []
    for post in posts:
        if not isinstance(post, dict):
            continue
        source_id = _clean_text(post.get("id"), 100)
        title = _clean_html_text(post.get("title"), 500)
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,100}", source_id) or len(title) < 12:
            continue
        link = canonicalize_article_url(urljoin(THE_MORNING_BASE_URL, f"articles/{source_id}"))
        meta = post.get("meta") if isinstance(post.get("meta"), dict) else {}
        content = _clean_html_text(post.get("content"), 30000)
        summary = _clean_html_text(meta.get("excerpt"), 1200) or content[:1200] or title
        source_category = _clean_text(post.get("category"), 160) or "News"
        source_image = normalize_image_url(post.get("media"), link)
        if not _is_source_image(source_image, link):
            source_image = ""
        raw_tags = meta.get("tags") if isinstance(meta.get("tags"), list) else []
        tags = [_clean_text(tag, 160) for tag in raw_tags]
        tags = [tag for tag in tags if tag]
        records.append({
            "id": _stable_id(link),
            "source_id": source_id,
            "raw_title": title,
            "title": title,
            "url": link,
            "link": link,
            "raw_summary": summary,
            "summary": summary,
            "full_text": content,
            "content": content,
            "source": "The Morning (themorning.lk)",
            "source_name": "The Morning",
            "source_category": source_category,
            "category": _normalized_category(source_category, "Governance & Policy"),
            "published_at": _normalize_date(meta.get("createdAt")),
            "scraped_at": scraped_at,
            "source_image": source_image,
            "image": source_image,
            "image_local": "",
            "local_image_path": "",
            "source_image_checked": bool(source_image),
            "tags": ([source_category] + tags)[:6],
            "author": _clean_text(post.get("author"), 240),
        })
    return _dedupe(records)


async def _fetch_morning_source(
    session: aiohttp.ClientSession,
    maximum: int,
) -> tuple[list[dict], str]:
    """Resolve the current Next.js build and fetch one public homepage payload."""
    cache_key = int(datetime.now(timezone.utc).timestamp())
    headers = {
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
    }
    try:
        # The homepage is protected by a JavaScript interstitial. Its public
        # Next.js 404 shell still exposes only the non-secret current build ID.
        probe_url = f"{THE_MORNING_BUILD_PROBE_URL}?newsroom_probe={cache_key}"
        async with session.get(probe_url, headers=headers, allow_redirects=True) as response:
            if response.status not in {200, 404}:
                return [], "unavailable"
            build_id = _morning_build_id(await response.read())
    except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
        return [], "unavailable"
    if not build_id:
        return [], "unavailable"

    data_url = urljoin(
        THE_MORNING_BASE_URL,
        f"_next/data/{build_id}/index.json?newsroom={cache_key}",
    )
    payload, _, content_type = await _request_bytes(
        session,
        data_url,
        referer=THE_MORNING_BASE_URL,
        accept="application/json,*/*;q=0.8",
        retries=1,
    )
    if not payload or "json" not in content_type.lower():
        return [], "unavailable"
    records = _morning_records(payload)
    return records[:maximum], "next-data" if records else "unavailable"


def _article_json_ld(soup: BeautifulSoup) -> dict:
    queue = []
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            queue.append(json.loads(script.string or script.get_text()))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    while queue:
        value = queue.pop(0)
        if isinstance(value, list):
            queue.extend(value)
            continue
        if not isinstance(value, dict):
            continue
        object_type = value.get("@type", "")
        types = object_type if isinstance(object_type, list) else [object_type]
        if any(str(item).lower() in {"newsarticle", "article", "reportagenewsarticle"} for item in types):
            return value
        graph = value.get("@graph")
        if graph:
            queue.extend(graph if isinstance(graph, list) else [graph])
    return {}


def _enrich_from_article_html(article: dict, payload: bytes, response_url: str) -> dict:
    if not payload:
        article["source_image_checked"] = True
        return article
    soup = BeautifulSoup(payload, "lxml")
    json_ld = _article_json_ld(soup)

    headline = _clean_html_text(json_ld.get("headline"), 500)
    if not headline:
        headline_tag = soup.select_one('meta[property="og:title"], meta[name="twitter:title"]')
        headline = _clean_text(headline_tag.get("content", "") if headline_tag else "", 500)
    if headline:
        article["raw_title"] = headline
        article["title"] = headline

    source_image = extract_source_image(soup, response_url)
    if _is_source_image(source_image, response_url):
        article["source_image"] = source_image

    if not article.get("published_at"):
        published = json_ld.get("datePublished") or json_ld.get("dateCreated") or ""
        if not published:
            tag = (
                soup.select_one('meta[property="article:published_time"]')
                or soup.select_one('meta[itemprop="datePublished"]')
                or soup.select_one('meta[name="pubdate"]')
                or soup.select_one('meta[name="date"]')
                or soup.select_one('meta[property="og:published_time"]')
                or soup.select_one("time[datetime]")
                or soup.select_one(".ctc_date")
                or soup.select_one(".timesss")
            )
            if tag:
                published = tag.get("content") or tag.get("datetime") or tag.get_text(strip=True) or ""
        article["published_at"] = _normalize_date(published)


    if not article.get("full_text"):
        body = _clean_text(json_ld.get("articleBody"), 30000)
        if not body:
            paragraphs = []
            for selector in (
                "article p", ".article-content p", ".entry-content p", ".post-content p", ".inner-content p",
            ):
                paragraphs = [
                    _clean_text(node.get_text(" ", strip=True))
                    for node in soup.select(selector)
                ]
                paragraphs = [value for value in paragraphs if len(value) > 40]
                if paragraphs:
                    break
            body = "\n\n".join(paragraphs)[:30000]
        article["full_text"] = body
        article["content"] = body

    if article.get("raw_summary") in {"", article.get("raw_title")}:
        description = json_ld.get("description") or ""
        if not description:
            tag = soup.select_one('meta[name="description"], meta[property="og:description"]')
            description = tag.get("content", "") if tag else ""
        summary = _clean_html_text(description, 1200)
        if summary:
            article["raw_summary"] = summary
            article["summary"] = summary

    article["source_image_checked"] = True
    article["url"] = canonicalize_article_url(response_url or article.get("url"))
    article["link"] = article["url"]
    return article


def _extension_for_image(content_type: str, url: str) -> str:
    media_type = str(content_type or "").split(";", 1)[0].strip().lower()
    extension = mimetypes.guess_extension(media_type) or Path(urlsplit(url).path).suffix.lower()
    if extension == ".jpe":
        extension = ".jpg"
    return extension if re.fullmatch(r"\.[a-z0-9]{2,5}", extension or "") else ".img"


async def _download_original_image(
    session: aiohttp.ClientSession,
    image_url: str,
    article_url: str,
) -> str:
    if not _is_source_image(image_url, article_url):
        return ""
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(image_url.encode("utf-8")).hexdigest()[:24]
    for existing in IMAGE_DIR.glob(f"{digest}.*"):
        if existing.suffix.lower() == ".part" or not existing.is_file():
            continue
        try:
            if existing.stat().st_size > 64:
                return existing.relative_to(PROJECT_DIR).as_posix()
        except OSError:
            continue

    headers = {
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": article_url or image_url,
    }
    try:
        async with session.get(image_url, headers=headers, allow_redirects=True) as response:
            if response.status != 200:
                return ""
            if not _is_source_image(str(response.url), article_url):
                return ""
            content_type = response.headers.get("Content-Type", "")
            media_type = content_type.split(";", 1)[0].strip().lower()
            if media_type not in SAFE_IMAGE_MIME_TYPES:
                return ""
            content_length = int(response.headers.get("Content-Length") or 0)
            if content_length > MAX_IMAGE_BYTES:
                return ""
            extension = _extension_for_image(content_type, str(response.url))
            destination = IMAGE_DIR / f"{digest}{extension}"
            temporary = destination.with_suffix(destination.suffix + ".part")
            written = 0
            async with aiofiles.open(temporary, "wb") as handle:
                async for chunk in response.content.iter_chunked(64 * 1024):
                    written += len(chunk)
                    if written > MAX_IMAGE_BYTES:
                        raise ValueError("image exceeds MAX_IMAGE_BYTES")
                    await handle.write(chunk)
            if written < 64:
                raise ValueError("image response is empty")
            os.replace(temporary, destination)
            return destination.relative_to(PROJECT_DIR).as_posix()
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError):
        temporary = locals().get("temporary")
        if isinstance(temporary, Path):
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        return ""


async def _enrich_and_cache_article(
    session: aiohttp.ClientSession,
    article: dict,
    semaphore: asyncio.Semaphore,
) -> dict:
    async with semaphore:
        original_candidate = article.get("source_image") or ""
        article_payload = b""
        response_url = article.get("url", "")

        if not original_candidate or not article.get("source_image_checked"):
            # Feed-description images are only provisional; never preserve one
            # when the canonical article page cannot confirm it.
            if not article.get("source_image_checked"):
                article["source_image"] = ""
            article_payload, response_url, _ = await _request_bytes(
                session, article["url"], referer=article["url"], retries=1
            )
            _enrich_from_article_html(article, article_payload, response_url)
            original_candidate = article.get("source_image") or ""

        local_path = await _download_original_image(
            session, original_candidate, article.get("url", "")
        )

        # A feed thumbnail can expire or point at a blocked derivative. Resolve
        # the definitive article image once and retry before declaring it absent.
        if original_candidate and not local_path and not article_payload:
            article_payload, response_url, _ = await _request_bytes(
                session, article["url"], referer=article["url"], retries=1
            )
            previous = original_candidate
            _enrich_from_article_html(article, article_payload, response_url)
            original_candidate = article.get("source_image") or ""
            if original_candidate and original_candidate != previous:
                local_path = await _download_original_image(
                    session, original_candidate, article.get("url", "")
                )

        article["source_image"] = (
            original_candidate
            if _is_source_image(original_candidate, article.get("url", ""))
            else ""
        )
        article["image_local"] = local_path
        article["local_image_path"] = local_path
        article["image"] = local_path or article["source_image"]
        article["source_image_checked"] = True
        return article


async def _zendriver_html(url: str) -> bytes:
    """Optional correct Zendriver API fallback for JS-only listing pages."""
    if not _env_bool("UNIFIED_JS_FALLBACK", False):
        return b""
    try:
        import zendriver

        browser = await zendriver.start(headless=True)
        try:
            tab = await browser.get(url)
            await tab.sleep(2)
            for _ in range(3):
                await tab.scroll_down(700)
                await tab.sleep(1)
            return (await tab.get_content()).encode("utf-8", errors="ignore")
        finally:
            await browser.stop()
    except Exception as exc:
        print(f"   [!] Zendriver fallback failed for {url}: {type(exc).__name__}")
        return b""


def _dedupe(records: Iterable[dict]) -> list[dict]:
    unique = {}
    for record in records:
        url = canonicalize_article_url(record.get("url") or record.get("link"))
        title = _clean_text(record.get("raw_title") or record.get("title"), 500)
        if not url or len(title) < 12:
            continue
        record["url"] = url
        record["link"] = url
        record["id"] = record.get("id") or _stable_id(url)
        existing = unique.get(url)
        if not existing:
            unique[url] = record
            continue
        for key, value in record.items():
            if value not in (None, "", [], {}) and existing.get(key) in (None, "", [], {}):
                existing[key] = value
        if len(str(record.get("full_text") or "")) > len(str(existing.get("full_text") or "")):
            existing["full_text"] = record["full_text"]
            existing["content"] = record["full_text"]
    return list(unique.values())


VERIFIED_ARTICLE_HOST_SUFFIXES = (
    "ft.lk",
    "dailymirror.lk",
    "lankabusinessonline.com",
    "economynext.com",
    "adaderana.lk",
    "srilankabiz.lk",
    "businesstoday.lk",
)


def _is_verified_article_url(value: str) -> bool:
    try:
        parts = urlsplit(str(value or ""))
    except ValueError:
        return False
    host = parts.netloc.lower().split(":", 1)[0]
    return (
        parts.scheme.lower() in {"http", "https"}
        and any(host == suffix or host.endswith(f".{suffix}") for suffix in VERIFIED_ARTICLE_HOST_SUFFIXES)
    )


def _recently_image_checked(record: dict, recheck_hours: float) -> bool:
    value = record.get("source_image_checked_at") or ""
    if not value:
        return False
    try:
        checked = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - checked).total_seconds()
        return age_seconds < max(0.0, recheck_hours) * 3600
    except (TypeError, ValueError):
        return False


async def hydrate_missing_article_images_async(
    records: Iterable[dict],
    *,
    max_articles: int | None = None,
    force: bool = False,
) -> list[dict]:
    """Retry verified article pages for image-less historical feed records.

    Listing/RSS previews occasionally omit a photo even when the detail page
    has one.  This targeted pass only opens records still lacking an image and
    caches the exact publisher asset.  A timestamp prevents hammering a source
    that genuinely published no image; those records are eligible again after
    ``MISSING_IMAGE_RECHECK_HOURS``.
    """
    hydrated = [dict(record) for record in records if isinstance(record, dict)]
    configured_limit = max(
        0, int(os.getenv("MISSING_IMAGE_HYDRATION_LIMIT", "80"))
    )
    limit = configured_limit if max_articles is None else max(0, int(max_articles))
    recheck_hours = max(
        0.0, float(os.getenv("MISSING_IMAGE_RECHECK_HOURS", "24"))
    )
    pending: list[tuple[int, dict]] = []
    for index, record in enumerate(hydrated):
        if record.get("image") or record.get("source_image"):
            continue
        url = canonicalize_article_url(record.get("url") or record.get("link"))
        if not _is_verified_article_url(url):
            continue
        if not force and _recently_image_checked(record, recheck_hours):
            continue
        candidate = dict(record)
        candidate["url"] = url
        candidate["link"] = url
        # Older scraper versions set this flag before performing a detail-page
        # check.  Force this targeted pass to perform the definitive request.
        candidate["source_image_checked"] = False
        pending.append((index, candidate))
        if limit and len(pending) >= limit:
            break

    if not pending:
        return hydrated

    concurrency = max(1, int(os.getenv("SCRAPER_CONCURRENCY", "8")))
    timeout = aiohttp.ClientTimeout(total=40, connect=10, sock_read=30)
    connector = aiohttp.TCPConnector(
        limit=concurrency,
        limit_per_host=max(2, min(4, concurrency)),
        ssl=False,
        ttl_dns_cache=300,
    )
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    async with aiohttp.ClientSession(
        timeout=timeout, connector=connector, headers=headers
    ) as session:
        semaphore = asyncio.Semaphore(concurrency)
        results = await asyncio.gather(
            *(
                _enrich_and_cache_article(session, record, semaphore)
                for _, record in pending
            ),
            return_exceptions=True,
        )

    found = 0
    for (index, original), result in zip(pending, results):
        updated = result if isinstance(result, dict) else original
        updated["source_image_checked"] = True
        updated["source_image_checked_at"] = checked_at
        updated["image_status"] = "available" if updated.get("image") else "missing"
        hydrated[index] = updated
        if updated.get("image"):
            found += 1
    print(
        f"[+] MISSING-IMAGE HYDRATION: checked {len(pending)} detail pages; "
        f"recovered {found} publisher images."
    )
    return hydrated


def hydrate_missing_article_images(
    records: Iterable[dict],
    *,
    max_articles: int | None = None,
    force: bool = False,
) -> list[dict]:
    """Synchronous entry point for the export pipeline."""
    return asyncio.run(
        hydrate_missing_article_images_async(
            records, max_articles=max_articles, force=force
        )
    )


def _sort_timestamp(record: dict) -> float:
    value = record.get("published_at") or record.get("scraped_at") or ""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except (TypeError, ValueError):
        return 0.0


def _balanced_limit(records: list[dict], maximum: int, per_source: int) -> list[dict]:
    groups = defaultdict(list)
    for record in sorted(records, key=_sort_timestamp, reverse=True):
        groups[record.get("source") or "Unknown"].append(record)
    source_names = sorted(groups)
    result = []
    index = 0
    while len(result) < maximum:
        added = False
        for source_name in source_names:
            group = groups[source_name]
            if index < min(len(group), per_source):
                result.append(group[index])
                added = True
                if len(result) >= maximum:
                    break
        if not added:
            break
        index += 1
    return sorted(result, key=_sort_timestamp, reverse=True)


async def scrape_all_sources_async(
    source_registry: SourceRegistry | None = None,
) -> list[dict]:
    """Scrape all verified sources and return normalized, source-image records."""
    source_registry = source_registry or load_source_registry()
    target = max(1, int(os.getenv("MULTI_SITE_TARGET", "150")))
    maximum = max(target, int(os.getenv("MULTI_SITE_MAX_ARTICLES", "240")))
    per_source = max(1, int(os.getenv("MULTI_SITE_MAX_PER_SOURCE", "70")))
    rest_per_page = min(100, max(1, int(os.getenv("WP_REST_PER_PAGE", "40"))))
    rest_max_per_source = max(1, int(os.getenv("WP_REST_MAX_PER_SOURCE", "40")))
    concurrency = max(1, int(os.getenv("SCRAPER_CONCURRENCY", "8")))
    timeout = aiohttp.ClientTimeout(total=40, connect=10, sock_read=30)
    connector = aiohttp.TCPConnector(
        limit=concurrency,
        limit_per_host=max(2, min(4, concurrency)),
        ssl=False,
        ttl_dns_cache=300,
    )
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}

    wp_sources = _enabled_sources(WP_REST_SOURCES, source_registry)
    feed_sources = _enabled_sources(FEED_SOURCES, source_registry)
    listing_sources = _enabled_sources(LISTING_SOURCES, source_registry)
    army_enabled = _source_is_enabled(source_registry, ARMY_SOURCE)
    xinhua_enabled = _source_is_enabled(source_registry, XINHUA_SRI_LANKA_SOURCE)
    morning_enabled = source_registry.allows(
        domain="themorning.lk",
        adapter_key=SOURCE_ADAPTER_KEYS["the-morning"],
        source_key="the-morning",
    )
    mirror_enabled = source_registry.allows(
        domain="dailymirror.lk",
        adapter_key=SOURCE_ADAPTER_KEYS["daily-mirror"],
        source_key="daily-mirror",
    )
    configured_count = (
        len(WP_REST_SOURCES) + len(FEED_SOURCES) + len(LISTING_SOURCES) + 4
    )
    enabled_count = (
        len(wp_sources) + len(feed_sources) + len(listing_sources)
        + sum((army_enabled, xinhua_enabled, morning_enabled, mirror_enabled))
    )
    print(f"   [i] Source registry enabled {enabled_count}/{configured_count} adapters.")

    async with aiohttp.ClientSession(
        timeout=timeout, connector=connector, headers=headers
    ) as session:
        wp_tasks = [
            _fetch_wp_source(
                session,
                source,
                per_page=rest_per_page,
                maximum=min(source.max_items, rest_max_per_source, per_source),
            )
            for source in wp_sources
        ]
        feed_tasks = [
            _fetch_feed_page(session, source, page)
            for source in feed_sources
            for page in range(1, source.pages + 1)
        ]
        listing_tasks = [
            _request_bytes(session, source.url, retries=2)
            for source in listing_sources
        ]
        army_task = (
            _request_bytes(session, ARMY_SOURCE.url, retries=2)
            if army_enabled
            else asyncio.sleep(0, result=(b"", ARMY_SOURCE.url, {}))
        )
        xinhua_task = (
            _request_bytes(session, XINHUA_SRI_LANKA_SOURCE.url, retries=2)
            if xinhua_enabled
            else asyncio.sleep(0, result=(b"", XINHUA_SRI_LANKA_SOURCE.url, {}))
        )
        morning_task = (
            _fetch_morning_source(session, min(per_source, 40))
            if morning_enabled
            else asyncio.sleep(0, result=([], "paused"))
        )
        mirror_task = (
            _request_bytes(session, "https://www.dailymirror.lk/", retries=2)
            if mirror_enabled
            else asyncio.sleep(0, result=(b"", "https://www.dailymirror.lk/", {}))
        )
        (
            wp_results,
            feed_results,
            listing_results,
            army_result,
            xinhua_result,
            morning_result,
            mirror_result,
        ) = await asyncio.gather(
            asyncio.gather(*wp_tasks, return_exceptions=True),
            asyncio.gather(*feed_tasks, return_exceptions=True),
            asyncio.gather(*listing_tasks, return_exceptions=True),
            army_task,
            xinhua_task,
            morning_task,
            mirror_task,
        )

        records = []
        source_totals = defaultdict(int)
        per_key_totals = defaultdict(int)
        for result in wp_results:
            if isinstance(result, Exception):
                print(f"   [!] WordPress source failed: {type(result).__name__}")
                continue
            source, source_records, mode = result
            records.extend(source_records)
            source_totals[source.source] += len(source_records)
            marker = "+" if source_records else "!"
            print(
                f"   [{marker}] {source.name} {mode}: "
                f"{len(source_records)} items"
            )

        for result in feed_results:
            if isinstance(result, Exception):
                continue
            source, page, page_records = result
            remaining = max(0, source.max_items - per_key_totals[source.key])
            accepted = page_records[:remaining]
            records.extend(accepted)
            per_key_totals[source.key] += len(accepted)
            source_totals[source.source] += len(accepted)
            status = f"{len(accepted)} items" if accepted else "unavailable/empty"
            print(f"   [{'+' if accepted else '!'}] {source.name} feed page {page}: {status}")

        for source, result in zip(listing_sources, listing_results):
            if isinstance(result, Exception):
                print(f"   [!] {source.name} listing failed: {type(result).__name__}")
                continue
            payload, response_url, _ = result
            source_records = _listing_records(payload, response_url, source)
            records.extend(source_records)
            source_totals[source.source] += len(source_records)
            print(
                f"   [{'+' if source_records else '!'}] {source.name} homepage: "
                f"{len(source_records)} items"
            )

        army_payload, army_url, _ = army_result
        army_records = (
            _listing_records(army_payload, army_url, ARMY_SOURCE)
            if army_enabled
            else []
        )
        records.extend(army_records)
        source_totals[ARMY_SOURCE.source] += len(army_records)
        if army_enabled:
            print(
                f"   [{'+' if army_records else '!'}] {ARMY_SOURCE.name} listing: "
                f"{len(army_records)} items"
            )

        xinhua_payload, xinhua_url, _ = xinhua_result
        xinhua_records = (
            _xinhua_sri_lanka_records(xinhua_payload, xinhua_url)
            if xinhua_enabled
            else []
        )
        records.extend(xinhua_records)
        source_totals[XINHUA_SRI_LANKA_SOURCE.source] += len(xinhua_records)
        if xinhua_enabled:
            print(
                f"   [{'+' if xinhua_records else '!'}] Xinhua Sri Lanka filter: "
                f"{len(xinhua_records)} items"
            )

        morning_records, morning_mode = morning_result
        records.extend(morning_records)
        source_totals["The Morning (themorning.lk)"] += len(morning_records)
        if morning_enabled:
            print(
                f"   [{'+' if morning_records else '!'}] The Morning {morning_mode}: "
                f"{len(morning_records)} items"
            )

        mirror_payload, mirror_url, _ = mirror_result
        if mirror_enabled and not mirror_payload:
            mirror_payload = await _zendriver_html("https://www.dailymirror.lk/")
        mirror_records = (
            _daily_mirror_records(mirror_payload, mirror_url)
            if mirror_enabled
            else []
        )
        mirror_limit = max(1, int(os.getenv("DAILY_MIRROR_MAX_ITEMS", "50")))
        mirror_records = mirror_records[:mirror_limit]
        records.extend(mirror_records)
        source_totals["Daily Mirror (dailymirror.lk)"] += len(mirror_records)
        if mirror_enabled:
            print(f"   [{'+' if mirror_records else '!'}] Daily Mirror homepage: {len(mirror_records)} items")

        records = _dedupe(records)
        records = _balanced_limit(records, maximum, per_source)
        semaphore = asyncio.Semaphore(concurrency)
        enriched = await asyncio.gather(
            *(
                _enrich_and_cache_article(session, dict(record), semaphore)
                for record in records
            ),
            return_exceptions=True,
        )

    final_records = [record for record in enriched if isinstance(record, dict)]
    final_records = _dedupe(final_records)
    final_records.sort(key=_sort_timestamp, reverse=True)
    with_images = sum(bool(record.get("image")) for record in final_records)
    local_images = sum(bool(record.get("image_local")) for record in final_records)
    print(
        f"[+] UNIFIED SCRAPER: {len(final_records)} unique articles; "
        f"{with_images} publisher images ({local_images} cached locally)."
    )
    if len(final_records) < target:
        print(
            f"[!] Target was {target}; sources returned {len(final_records)} this run. "
            "Existing feed history will still be merged."
        )
    return final_records


def scrape_all_sources(source_registry: SourceRegistry | None = None) -> list[dict]:
    """Synchronous entry point used by daily_runner.py."""
    return asyncio.run(scrape_all_sources_async(source_registry=source_registry))


if __name__ == "__main__":
    rows = scrape_all_sources()
    preview_path = PROJECT_DIR / "unified_scrape_preview.json"
    preview_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[+] Preview saved to {preview_path}")
