"""
=============================================================================
AUTOMATED ALL-IN-ONE DAILY NEWS SCRAPER, GROQ AI & EXCEL RUNNER
=============================================================================
Executes the complete multi-website scraping & AI processing pipeline:
1. Multi-Source Scraping:
   - Daily Mirror
   - Lanka Business Online (LBO)
   - EconomyNext
   - Ada Derana Biz Sinhala and English
   - SriLankaBiz and Business Today
   - Daily FT official feeds
   - Ada Derana, News First and Hiru News
   - CAASL, Sri Lanka Army and The Morning
   - Xinhua Asia-Pacific headlines explicitly about Sri Lanka
   - The Island, Daily News, Sri Lanka Mirror and Sunday Observer
   - Optional Daily FT archive crawl (fit_lk.py)
2. Optional Groq fact-preserving draft generation for human review
3. Real Article Photo Resolution (og:image & Oracle CDN)
4. Export to Excel (daily_news_export.xlsx), CSV (news_feed.csv), 
   Web JSON Feed (news_feed.json & news_feed.js), and Google Sheets

Useful .env controls (defaults do not cap collected articles):
  FT_MAX_ARTICLES=all          # optional emergency cap; all/0 = unlimited
  FT_MAX_PAGES_PER_SECTION=3   # 0=crawl until exhausted/date cutoff
  FT_PAGE_SIZE=30
  FT_SINCE_DATE=               # optional YYYY-MM-DD backfill cutoff
  FT_DISCOVER_SECTIONS=true
  FT_FETCH_DETAILS=false       # false scales; article body loads on demand
  FT_REQUEST_DELAY_SECONDS=2
  FT_USE_PLAYWRIGHT=false
  AI_ENABLED=false
  AI_MAX_ARTICLES=all          # limits enrichment only, never feed inclusion
  AI_REQUEST_DELAY_SECONDS=0.3
"""

import sys
import time
import os
import re
import inspect
import json
import secrets
import socket
import hashlib
from pathlib import Path
from datetime import datetime

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")
PIPELINE_LOCK_PATH = PROJECT_DIR / ".daily-runner.lock"

# Set console output encoding to UTF-8 for Windows compatibility
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def _env_bool(name, default):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name, default, minimum=0.0):
    try:
        return max(minimum, float(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        print(f"[!] Invalid {name}; using {default}.")
        return default


def _env_optional_positive_int(name):
    """Read an optional limit. Empty/0/all/none means unlimited."""
    value = os.getenv(name, "").strip().lower()
    if value in {"", "0", "all", "none", "unlimited"}:
        return None
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except ValueError:
        print(f"[!] Invalid {name}; using unlimited.")
        return None


def _env_positive_int(name, default):
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        print(f"[!] Invalid {name}; using {default}.")
        return default


def _env_nonnegative_int(name, default):
    try:
        default_value = max(0, int(default))
    except (TypeError, ValueError):
        default_value = 3
    try:
        return max(0, int(os.getenv(name, str(default_value))))
    except (TypeError, ValueError):
        print(f"[!] Invalid {name}; using {default_value}.")
        return default_value


def _process_is_running(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except PermissionError:
        return True
    except (OSError, TypeError, ValueError):
        return False


def _acquire_pipeline_lock():
    """Prevent server, cron, and manual commands from running concurrently."""
    stale_minutes = _env_positive_int("PIPELINE_LOCK_STALE_MINUTES", 130)
    hostname = socket.gethostname()
    token = secrets.token_hex(16)
    metadata = {
        "pid": os.getpid(),
        "hostname": hostname,
        "started_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "token": token,
    }

    for _ in range(2):
        try:
            descriptor = os.open(
                PIPELINE_LOCK_PATH,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            )
            try:
                os.write(descriptor, json.dumps(metadata).encode("utf-8"))
            finally:
                os.close(descriptor)
            return token
        except FileExistsError:
            try:
                existing = json.loads(PIPELINE_LOCK_PATH.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, TypeError):
                existing = {}

            same_host = existing.get("hostname") == hostname
            active_pid = same_host and _process_is_running(existing.get("pid"))
            try:
                age_seconds = time.time() - PIPELINE_LOCK_PATH.stat().st_mtime
            except OSError:
                age_seconds = 0
            stale = age_seconds > stale_minutes * 60
            well_formed = bool(existing.get("hostname") and existing.get("pid"))
            lock_is_active = active_pid or (well_formed and not same_host and not stale)
            if lock_is_active:
                owner = existing.get("pid") or "unknown"
                print(
                    f"[-] Another news pipeline is already active (PID {owner}). "
                    "Skipping this overlapping run.",
                    file=sys.stderr,
                )
                return None
            try:
                PIPELINE_LOCK_PATH.unlink()
                print("[!] Removed a stale news-pipeline lock; retrying.")
            except OSError as exc:
                print(f"[-] Could not remove stale pipeline lock: {exc}", file=sys.stderr)
                return None
    return None


def _release_pipeline_lock(token):
    if not token:
        return
    try:
        existing = json.loads(PIPELINE_LOCK_PATH.read_text(encoding="utf-8"))
        if existing.get("token") == token:
            PIPELINE_LOCK_PATH.unlink(missing_ok=True)
    except (OSError, json.JSONDecodeError, TypeError):
        pass


# Reject overlapping cron/manual/server runs before importing browser, parser,
# workbook, and HTTP libraries. This keeps even a rejected duplicate lightweight.
EARLY_PIPELINE_LOCK_TOKEN = None
if __name__ == "__main__":
    EARLY_PIPELINE_LOCK_TOKEN = _acquire_pipeline_lock()
    if not EARLY_PIPELINE_LOCK_TOKEN:
        raise SystemExit(75)

from unified_scraper import scrape_all_sources
from fit_lk import FTScraper, SECTIONS
from groq_ai_processor import (
    EDITORIAL_PROMPT_VERSION,
    GROQ_MODEL,
    canonicalize_url,
    generate_fallback_ai_data,
    process_article_with_groq,
)
from excel_sync import export_to_excel_and_csv, load_existing_news
from supabase_sync import sync_news_file
from source_registry import SourceRegistryError, load_source_registry


def _ft_sections_for_backfill(page_count, page_size):
    """Compatibility fallback for older FTScraper versions."""
    expanded = []
    for section in SECTIONS:
        base_url = re.sub(r"/\d+$", "", section["url"].rstrip("/"))
        section_id = section["url"].rstrip("/").rsplit("/", 1)[-1]
        current_url = f"{base_url}/{section_id}"
        for page_index in range(page_count):
            url = current_url if page_index == 0 else f"{current_url}/{page_index * page_size}"
            expanded.append({"url": url, "category": section["category"]})
    return expanded


def _article_url(article):
    return canonicalize_url(article.get("url") or article.get("link"))


def _source_material_hash(article):
    """Identify the publisher text an AI draft was based on."""
    material = {
        "title": str(
            article.get("raw_title") or article.get("title") or ""
        ).strip(),
        "summary": str(
            article.get("raw_summary") or article.get("summary") or ""
        ).strip(),
        "content": str(
            article.get("full_text") or article.get("content") or ""
        ).strip(),
    }
    serialized = json.dumps(material, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _has_current_ai_draft(existing, source_hash):
    """Reuse a draft only when model, prompt, and exact source text match."""
    return bool(
        existing.get("ai_enriched") is True
        and existing.get("prompt_version") == EDITORIAL_PROMPT_VERSION
        and existing.get("ai_model") == GROQ_MODEL
        and existing.get("ai_source_hash") == source_hash
    )


def _pipeline_delivery_succeeded(local_export_ok, sync_result, sync_required):
    """A strict live run succeeds only after its database delivery succeeds."""
    return bool(
        local_export_ok
        and (
            not sync_required
            or sync_result.get("status") == "success"
        )
    )


def _append_unique(target, seen_urls, seen_ids, article):
    """Append an article once, using canonical URL first and source ID second."""
    url = _article_url(article)
    article_id = article.get("id") or article.get("article_id")
    article_id = str(article_id).strip() if article_id not in (None, "") else ""
    if (url and url in seen_urls) or (article_id and article_id in seen_ids):
        return False
    if not url and not article_id:
        return False
    if url:
        article["url"] = url
        seen_urls.add(url)
    if article_id:
        seen_ids.add(article_id)
    target.append(article)
    return True


def run_daily_pipeline():
    # Keep relative scraper caches/outputs inside the served project even when
    # launched as `python newssite/daily_runner.py` from the parent directory.
    os.chdir(PROJECT_DIR)
    start_time = time.time()
    print("=====================================================================")
    print(f"[*] STARTING ALL-IN-ONE MULTI-WEBSITE NEWS PIPELINE - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=====================================================================")

    all_gathered_articles = []
    seen_urls = set()
    seen_ids = set()

    scrape_rss = _env_bool("SCRAPE_RSS_ENABLED", True)
    # Daily FT is already included through its lightweight official feeds in
    # the unified run.  The heavier archive crawler stays opt-in for backfills.
    scrape_ft = _env_bool("SCRAPE_FT_ENABLED", False)
    ft_max_articles = _env_optional_positive_int("FT_MAX_ARTICLES")
    ft_delay = _env_float("FT_REQUEST_DELAY_SECONDS", 2.0)
    ft_use_playwright = _env_bool("FT_USE_PLAYWRIGHT", True)
    legacy_pages = os.getenv("FT_BACKFILL_PAGES")
    native_pages_default = legacy_pages if legacy_pages is not None else "3"
    ft_backfill_pages = _env_nonnegative_int(
        "FT_MAX_PAGES_PER_SECTION", native_pages_default
    )
    ft_page_size = _env_positive_int("FT_PAGE_SIZE", 30)
    ft_since_date = os.getenv("FT_SINCE_DATE", "").strip() or None
    ft_discover_sections = _env_bool("FT_DISCOVER_SECTIONS", True)
    ft_fetch_details = _env_bool("FT_FETCH_DETAILS", False)
    # Scraping/export never depends on a paid or rate-limited AI service.
    ai_enabled = _env_bool("AI_ENABLED", False)
    ai_max_articles = _env_optional_positive_int("AI_MAX_ARTICLES")
    ai_delay = _env_float("AI_REQUEST_DELAY_SECONDS", 0.3)

    # Snapshot the administrator-controlled source registry before contacting
    # any publisher. In required Supabase mode an unavailable registry aborts
    # the run, because silently using code defaults could scrape a source that
    # an editor explicitly paused.
    try:
        source_registry = load_source_registry()
    except SourceRegistryError as exc:
        print(f"[-] Source controls unavailable: {exc}", file=sys.stderr)
        return False
    registry_mode = (
        "Supabase controls"
        if source_registry.authoritative
        else "local/demo defaults"
    )
    print(f"   [i] Source selection: {registry_mode}.")

    # ── Step 1A: verified feeds + Daily Mirror article pages ─────────────────
    print("\n[STEP 1A/3] Scrape all verified publisher websites and original images...")
    if scrape_rss:
        try:
            rss_articles = scrape_all_sources(source_registry=source_registry)
            added = sum(
                _append_unique(all_gathered_articles, seen_urls, seen_ids, art)
                for art in rss_articles
            )
            print(f"   [+] Unified sources gathered: {len(rss_articles)} ({added} unique)")
        except Exception as e:
            print(f"   [!] Error scraping RSS feeds: {e}")
    else:
        print("   [i] Unified scraping disabled by SCRAPE_RSS_ENABLED.")

    # ── Step 1B: Scrape Daily FT (ft.lk) via fit_lk.py (Playwright + CloudScraper) ──
    print("\n[STEP 1B/3] Scrape Daily FT (ft.lk) via Playwright Engine (fit_lk.py)...")
    ft_source_enabled = source_registry.allows(
        domain="ft.lk", adapter_key="daily-ft-rss", source_key="ft-deep"
    )
    if scrape_ft and ft_source_enabled:
        ft_scraper = None
        try:
            ft_scraper = FTScraper(
                download_images=False,
                delay=ft_delay,
                use_playwright=ft_use_playwright,
            )
            scrape_parameters = inspect.signature(ft_scraper.scrape_all).parameters
            scrape_kwargs = {
                "max_articles": ft_max_articles,
                # Native discovery only runs when sections is omitted/None.
                "sections": None if ft_discover_sections else SECTIONS,
            }
            if "max_pages_per_section" in scrape_parameters:
                scrape_kwargs.update(
                    {
                        "max_pages_per_section": ft_backfill_pages,
                        "since_date": ft_since_date,
                        "discover_sections": ft_discover_sections,
                        "page_size": ft_page_size,
                    }
                )
                if "fetch_details" in scrape_parameters:
                    scrape_kwargs["fetch_details"] = ft_fetch_details
            else:
                # Compatibility for older fit_lk.py versions. Current versions
                # use native pagination and never expand these URLs here.
                fallback_pages = ft_backfill_pages or 3
                scrape_kwargs["sections"] = _ft_sections_for_backfill(
                    fallback_pages, ft_page_size
                )
                print(
                    "   [i] Legacy FT scraper detected; using explicit "
                    f"pagination for {fallback_pages} page(s)/section."
                )
            ft_articles = ft_scraper.scrape_all(**scrape_kwargs)

            added = 0
            for art in ft_articles:
                source_image = (
                    art.get("source_image")
                    or art.get("main_image_url")
                    or art.get("image")
                    or ""
                )
                local_image = art.get("cached_image") or art.get("main_image_local") or ""
                published_at = (
                    art.get("published_at")
                    or art.get("published_date")
                    or art.get("date")
                    or ""
                )

                # Start with the complete source record so full text, date,
                # author, body images, and source identifiers are never lost.
                unified_art = dict(art)
                unified_art.update(
                    {
                        "id": art.get("id") or art.get("article_id"),
                        "raw_title": art.get("raw_title") or art.get("title", ""),
                        "url": _article_url(art),
                        "image": local_image or source_image,
                        "source_image": source_image,
                        "raw_summary": art.get("raw_summary")
                        or art.get("summary")
                        or art.get("title", ""),
                        "full_text": art.get("full_text") or art.get("content", ""),
                        "published_at": published_at
                        if str(published_at).lower() != "no date"
                        else "",
                        "category": art.get("category", "Business & Corporate"),
                        "source": art.get("source") or "Daily FT (ft.lk)",
                        "scraped_at": art.get("scraped_at")
                        or datetime.now().isoformat(timespec="seconds"),
                    }
                )
                if _append_unique(
                    all_gathered_articles, seen_urls, seen_ids, unified_art
                ):
                    added += 1
            print(
                f"   [+] Daily FT scraper gathered: {len(ft_articles)} "
                f"({added} unique; "
                f"{'all available' if ft_backfill_pages == 0 else ft_backfill_pages} "
                "page(s)/section)"
            )
        except Exception as e:
            print(f"   [!] Error running FT scraper: {e}")
        finally:
            if ft_scraper is not None:
                ft_scraper.close()
    elif scrape_ft:
        print("   [i] Daily FT deep scraping paused in the admin source registry.")
    else:
        print("   [i] Daily FT scraping disabled by SCRAPE_FT_ENABLED.")

    print(f"\n[+] TOTAL UNIQUE ARTICLES GATHERED ACROSS ALL WEBSITES: {len(all_gathered_articles)}")
    if not all_gathered_articles:
        print("[-] No articles gathered from any source. Aborting run.")
        return False

    # ── Step 2: Groq AI Processing & Real Image Resolution ───────────────────
    print("\n[STEP 2/3] Creating review-only Groq drafts & resolving publisher photos...")
    processed_articles = []

    existing_by_url = {
        _article_url(article): article
        for article in load_existing_news()
        if _article_url(article)
    }
    total_count = len(all_gathered_articles)
    enrichment_attempts = 0
    for idx, raw_art in enumerate(all_gathered_articles, 1):
        src = raw_art.get('source', 'News')
        title_snippet = (raw_art.get('raw_title') or raw_art.get('title', ''))[:50]
        source_hash = _source_material_hash(raw_art)
        existing = existing_by_url.get(_article_url(raw_art), {})
        cached_ai_is_current = _has_current_ai_draft(existing, source_hash)
        under_ai_limit = (
            ai_max_articles is None or enrichment_attempts < ai_max_articles
        )
        should_enrich = ai_enabled and not cached_ai_is_current and under_ai_limit
        if should_enrich:
            enrichment_attempts += 1
        mode = (
            "cached AI draft"
            if cached_ai_is_current
            else "AI enrichment"
            if should_enrich
            else "raw export"
        )
        print(f"\n -> [{idx}/{total_count}] {mode} ({src}): {title_snippet}...")
        try:
            result = (
                process_article_with_groq(raw_art)
                if should_enrich
                else generate_fallback_ai_data(raw_art)
            )
        except Exception as e:
            print(f"    [!] Groq AI processing warning: {e}")
            # AI/image enrichment must never decide whether an article exists.
            result = dict(raw_art)
            result.setdefault("headline_en", raw_art.get("raw_title") or raw_art.get("title", ""))
            result.setdefault("summary_en", raw_art.get("raw_summary") or raw_art.get("summary", ""))
            result.setdefault("full_text", raw_art.get("full_text") or raw_art.get("content", ""))
            result["ai_enriched"] = False
        if result.get("ai_enriched") is True:
            result["ai_source_hash"] = source_hash
        processed_articles.append(result)
        if should_enrich and ai_delay:
            time.sleep(ai_delay)

    # ── Step 3: Export to Excel, CSV, Web JSON Feed & Google Sheets ──────────
    print("\n[STEP 3/3] Exporting Data to Excel, CSV, Web Payload & Google Sheets...")
    success = export_to_excel_and_csv(processed_articles)

    # Synchronize the final merged JSON, not merely this run's delta.  This
    # makes a first Supabase backfill and every later update use the same data
    # that the website displays.  Missing configuration is a safe no-op.
    supabase_result = sync_news_file() if success else {
        "status": "skipped",
        "reason": "Local export failed.",
        "upserted_records": 0,
    }
    print(
        "   [Supabase] "
        f"{supabase_result.get('status', 'unknown')}: "
        f"{supabase_result.get('upserted_records', 0)} upserted. "
        f"{supabase_result.get('reason', '')}"
    )

    elapsed = round(time.time() - start_time, 2)
    print("\n=====================================================================")
    sync_required_default = (
        os.getenv("EDITORIAL_BACKEND", "").strip().lower() == "supabase"
        or os.getenv("NODE_ENV", "").strip().lower() == "production"
    )
    sync_required = _env_bool("SUPABASE_SYNC_REQUIRED", sync_required_default)
    pipeline_succeeded = _pipeline_delivery_succeeded(
        success, supabase_result, sync_required
    )

    if pipeline_succeeded:
        print(f"[SUCCESS] ALL-IN-ONE PIPELINE COMPLETED IN {elapsed} SECONDS!")
        print("  - Excel File Generated : daily_news_export.xlsx")
        print("  - CSV File Generated   : news_feed.csv")
        print("  - Web Feed Generated   : news_feed.json & news_feed.js")
        print("  - Google Sheets Status : Sync Triggered")
        print("  - Supabase Status      : " + str(supabase_result.get("status", "unknown")))
        print("  - Websites Scraped     : Daily Mirror, Ada Derana, News First, Hiru News, Daily FT, EconomyNext, SriLankaBiz, LBO, Business Today, CAASL, Sri Lanka Army, The Morning, The Island, Daily News, Sri Lanka Mirror, Sunday Observer, Xinhua (Sri Lanka headlines)")
    elif success and sync_required:
        print(
            "[-] Local export completed, but the required Supabase editorial "
            "synchronization did not complete successfully."
        )
    else:
        print("[-] Pipeline encountered errors during export.")
    print("=====================================================================")
    return pipeline_succeeded

if __name__ == "__main__":
    try:
        try:
            pipeline_succeeded = run_daily_pipeline()
        except Exception as exc:
            print(f"[-] Unhandled pipeline failure: {exc}", file=sys.stderr)
            pipeline_succeeded = False
    finally:
        _release_pipeline_lock(EARLY_PIPELINE_LOCK_TOKEN)
    raise SystemExit(0 if pipeline_succeeded else 1)
