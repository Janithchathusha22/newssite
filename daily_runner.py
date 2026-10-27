"""
=============================================================================
AUTOMATED DAILY NEWS SCRAPER, GROQ AI & EXCEL RUNNER
=============================================================================
Executes the full agentic workflow:
Scrape Daily FT & Sri Lanka Feeds -> Groq AI Processing -> Excel & Web Ingestion
"""

import sys
import os
import time
import json
import hashlib
from datetime import datetime

# UTF-8 fix for Windows console to handle Sinhala characters seamlessly
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from scraper import scrape_category, CATEGORIES
from groq_ai_processor import process_article_with_groq, is_political_or_non_business
from excel_sync import export_to_excel_and_csv
from database import save_articles_to_database, get_db_stats
from source_registry import load_source_registry, SourceRegistryError
from unified_scraper import scrape_all_sources

EDITORIAL_PROMPT_VERSION = "fact-preserving-editorial-v1"
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

VALID_CATEGORIES = {
    "business-news",
    "interviews-appointments",
    "money",
    "technology",
    "travel-tourism",
    "luxury-living",
}


def _source_material_hash(article: dict) -> str:
    """Computes SHA-256 hash of article title, summary, and content for caching."""
    title = article.get("title") or article.get("raw_title", "")
    summary = article.get("summary") or article.get("raw_summary", "")
    content = article.get("content") or ""
    raw = f"{title}\n{summary}\n{content}".strip()
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

def _has_current_ai_draft(existing: dict, source_hash: str) -> bool:
    """Checks whether an existing cached draft matches the current prompt, model, and source."""
    if not existing or not existing.get("ai_enriched"):
        return False
    if existing.get("prompt_version") != EDITORIAL_PROMPT_VERSION:
        return False
    if existing.get("ai_model") != GROQ_MODEL:
        return False
    return existing.get("ai_source_hash") == source_hash

def _pipeline_delivery_succeeded(exported_successfully: bool, db_result: dict, require_db: bool) -> bool:
    """Evaluates whether all required pipeline deliverables were satisfied."""
    if not exported_successfully:
        return False
    status = (db_result or {}).get("status")
    if require_db:
        return status in ("success", "partial")
    return status in ("success", "partial", "skipped")

def scrape_additional_rss_feeds() -> list:
    """Scrapes verified business news feeds for all 6 target categories."""
    import xml.etree.ElementTree as ET
    import requests
    from bs4 import BeautifulSoup

    feeds = [
        {"source": "Daily FT", "domain": "ft.lk", "url": "https://www.ft.lk/rss/it-telecom-technology/57", "category": "technology"},
        {"source": "Daily FT", "domain": "ft.lk", "url": "https://www.ft.lk/rss/hospitality-tourism/43", "category": "travel-tourism"},
        {"source": "Daily FT", "domain": "ft.lk", "url": "https://www.ft.lk/rss/lifestyle/10519", "category": "luxury-living"},
        {"source": "Daily FT", "domain": "ft.lk", "url": "https://www.ft.lk/rss/hr/61", "category": "interviews-appointments"},
        {"source": "Daily FT", "domain": "ft.lk", "url": "https://www.ft.lk/rss/markets/10518", "category": "money"},
        {"source": "Lanka Business Online", "domain": "lankabusinessonline.com", "url": "https://www.lankabusinessonline.com/feed/", "category": "business-news"},
        {"source": "LBO Tourism", "domain": "lankabusinessonline.com", "url": "https://www.lankabusinessonline.com/category/tourism/feed/", "category": "travel-tourism"},
        {"source": "LBO Tech", "domain": "lankabusinessonline.com", "url": "https://www.lankabusinessonline.com/category/ict/feed/", "category": "technology"},
        {"source": "EconomyNext", "domain": "economynext.com", "url": "https://economynext.com/feed/", "category": "money"},
        {"source": "Pulse", "domain": "pulse.lk", "url": "https://pulse.lk/feed/", "category": "luxury-living"}
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    }

    articles = []
    for feed in feeds:
        try:
            r = requests.get(feed["url"], headers=headers, timeout=12)
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.content)
            items = root.findall("./channel/item")
            count = 0
            for item in items[:10]:
                title_elem = item.find("title")
                link_elem = item.find("link")
                desc_elem = item.find("description")

                title = title_elem.text.strip() if title_elem is not None and title_elem.text else ""
                link = link_elem.text.strip() if link_elem is not None and link_elem.text else ""
                raw_desc = desc_elem.text.strip() if desc_elem is not None and desc_elem.text else ""

                summary = BeautifulSoup(raw_desc, "html.parser").get_text(separator=" ").strip() if raw_desc else ""

                img_url = ""
                enc = item.find("enclosure")
                if enc is not None and enc.get("url"):
                    img_url = enc.get("url")

                # Filter out political / non-business articles
                if title and link and not is_political_or_non_business(title, summary):
                    articles.append({
                        "raw_title": title,
                        "title": title,
                        "url": link,
                        "raw_summary": summary[:300],
                        "summary": summary[:300],
                        "source": feed["source"],
                        "category": feed["category"],
                        "image": img_url,
                        "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    })
                    count += 1
            print(f"[+] Scraped {count} verified business articles from {feed['source']}")
        except Exception as e:
            print(f"[!] Notice: RSS scrape '{feed['source']}' skipped: {e}")

    return articles

def run_daily_pipeline(max_ai_articles: int = 8):
    start_time = time.time()
    print("=====================================================================")
    print(f"[*] STARTING AGENTIC NEWS PIPELINE - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=====================================================================")

    # Check and load source registry
    try:
        registry = load_source_registry()
    except SourceRegistryError as e:
        print(f"[-] Authoritative source registry error: {e}")
        return False
    except Exception as e:
        print(f"[!] Source registry notice: {e}")
        registry = None

    # Step 1: Web Scraping Multi-Publisher Sri Lankan Feeds
    print("\n[STEP 1/3] Web Scraping Live Sri Lanka Multi-Source Feeds...")
    scraped_articles = []

    # Priority 1: Launch Unified Multi-Source Aggregator (Mirror, Ada Derana, FT, EconomyNext, LBO, etc.)
    try:
        print("[*] Launching Unified Multi-Publisher Engine...")
        unified_records = scrape_all_sources(source_registry=registry)
        if unified_records:
            scraped_articles.extend(unified_records)
            print(f"[+] Unified Engine scraped {len(unified_records)} articles across publishers.")
    except Exception as e:
        print(f"[!] Unified scraper notice: {e}. Utilizing direct feed scrapers.")

    # Priority 2: Direct Category Scraping (Daily FT + Verified RSS Feeds)
    if len(scraped_articles) < 15:
        print("[*] Supplementing feed with direct category and RSS scrapers...")
        for cat_name, cat_url in CATEGORIES.items():
            try:
                items = scrape_category(cat_name, cat_url)
                scraped_articles.extend(items)
                time.sleep(0.3)
            except Exception as e:
                print(f"[!] Warning scraping '{cat_name}': {e}")

        additional = scrape_additional_rss_feeds()
        scraped_articles.extend(additional)

    print(f"[+] Total Raw Articles Scraped: {len(scraped_articles)}")

    # Deduplicate by URL
    unique_articles = list({a['url']: a for a in scraped_articles if a.get('url')}.values())
    print(f"[+] Unique Articles to Process: {len(unique_articles)}")

    if not unique_articles:
        print("[-] No new articles scraped. Keeping existing feed.")
        return False

    # Load existing articles from news_feed.json to merge history
    existing_feed_map = {}
    json_path = os.getenv("JSON_OUTPUT_PATH", "news_feed.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                if isinstance(old_data, list):
                    for item in old_data:
                        if item.get("url"):
                            existing_feed_map[item["url"]] = item
        except Exception as e:
            print(f"[i] Existing feed read notice: {e}")

    # Step 2: Groq AI Processing (Sinhala Translation, Summarization, Categorization)
    print(f"\n[STEP 2/3] Processing Top {min(len(unique_articles), max_ai_articles)} Articles with Groq AI...")
    processed_articles = []

    # Prioritize items not already processed in the existing feed
    unprocessed = [a for a in unique_articles if a['url'] not in existing_feed_map]
    to_process = (unprocessed + unique_articles)[:max_ai_articles]

    for idx, raw_art in enumerate(to_process, 1):
        url = raw_art.get('url', '')
        title = raw_art.get('raw_title') or raw_art.get('title') or ''
        summary = raw_art.get('raw_summary') or raw_art.get('summary') or ''

        # Skip political or non-business items
        if is_political_or_non_business(title, summary):
            print(f" -> Skipping non-business item: {title[:45]}...")
            continue

        # If already processed before with AI, reuse to preserve API rate limits
        cached_art = existing_feed_map.get(url)
        if (
            cached_art
            and cached_art.get('headline_si')
            and cached_art.get('is_allowed', True) is not False
            and cached_art.get('category') in VALID_CATEGORIES
            and not is_political_or_non_business(title, summary)
        ):
            print(f" -> Reusing cached AI draft {idx}/{len(to_process)}: {title[:45]}...")
            processed_articles.append(cached_art)
        else:
            print(f" -> AI Processing {idx}/{len(to_process)}: {title[:50]}...")
            ai_result = process_article_with_groq(raw_art)
            if (
                ai_result
                and ai_result.get("is_allowed") is True
                and ai_result.get("category") in VALID_CATEGORIES
                and ai_result.get("category") != "rejected"
            ):
                processed_articles.append(ai_result)
            else:
                print(f" -> Dropped non-business/rejected result: {title[:45]}...")
            time.sleep(1)  # Respect API pacing

    # Merge: Newly processed at the top, then prior verified business articles
    merged_pool = list(processed_articles)
    for art in existing_feed_map.values():
        title = art.get("raw_title") or art.get("title") or art.get("headline_en") or ""
        summary = art.get("raw_summary") or art.get("summary") or ""
        cat = art.get("category") or ""
        if (
            is_political_or_non_business(title, summary)
            or cat not in VALID_CATEGORIES
            or cat == "rejected"
            or art.get("is_allowed") is False
            or art.get("is_business_news") is False
        ):
            continue
        if not any(p.get("url") == art.get("url") for p in merged_pool):
            merged_pool.append(art)

    # Prune articles older than 7 days from the active feed
    from datetime import timedelta
    cutoff_time = datetime.now() - timedelta(days=7)
    fresh_pool = []
    for art in merged_pool:
        date_raw = art.get("scraped_at") or art.get("published_at") or art.get("date") or ""
        try:
            parsed_dt = None
            if "T" in str(date_raw):
                parsed_dt = datetime.fromisoformat(str(date_raw).replace("Z", "+00:00")).replace(tzinfo=None)
            elif len(str(date_raw)) >= 19:
                parsed_dt = datetime.strptime(str(date_raw)[:19], "%Y-%m-%d %H:%M:%S")
            if parsed_dt and parsed_dt < cutoff_time:
                continue
        except Exception:
            pass
        fresh_pool.append(art)

    if len(fresh_pool) >= 10:
        merged_pool = fresh_pool

    # Auto-publish news directly to public frontend feeds (English business articles only)
    print(f"\n[*] Applying Auto-Publishing Policy: Publishing verified English Stories for Public Feed...")
    now_iso = datetime.now().isoformat()
    published_rank = 1
    for art in merged_pool:
        raw_head = art.get("headline_en") or art.get("title") or art.get("raw_title") or ""
        raw_summ = art.get("summary_en") or art.get("summary") or art.get("raw_summary") or ""
        # Strictly forbid Sinhala characters from entering public feed
        if re.search(r'[\u0D80-\u0DFF]', raw_head) or re.search(r'[\u0D80-\u0DFF]', raw_summ):
            art["status"] = "pending_review"
            art["topRank"] = None
            art["is_allowed"] = False
            continue

        art["title"] = raw_head
        art["headline"] = raw_head
        art["summary"] = raw_summ
        art["status"] = "published"
        art["topRank"] = published_rank if published_rank <= 10 else None
        art["published_at"] = art.get("published_at") or now_iso
        art["editorial_approved"] = True
        if published_rank <= 10:
            print(f"  [✓ Auto-Published Top Story #{published_rank}] {raw_head[:60]}...")
            published_rank += 1

    # Optional auto-dispatch top #1 story to LinkedIn if configured
    try:
        config_path = os.path.join(os.path.dirname(__file__), "linkedin_config.json")
        if os.path.exists(config_path):
            with open(config_path, "r", encoding="utf-8") as f:
                l_cfg = json.load(f)
                if l_cfg.get("autoPublishTopNews") and merged_pool:
                    top_art = merged_pool[0]
                    print(f"\n[LinkedIn] Auto-dispatching Top Story #1 to LinkedIn...")
                    from linkedin_bot import post_to_linkedin
                    post_to_linkedin(top_art, headless=True)
    except Exception as e:
        print(f"[!] LinkedIn auto-dispatch notice: {e}")

    # Step 3: Export to Excel, CSV, and Web JSON/JS Feeds
    print("\n[STEP 3/4] Exporting Data to Excel, CSV, and Web Payload...")
    export_success = export_to_excel_and_csv(merged_pool[:50])

    # Step 4: Persistent Database Storage (SQLite & Supabase)
    print("\n[STEP 4/4] Saving Articles to Database (SQLite news.db & Supabase)...")
    db_result = save_articles_to_database(merged_pool[:50])
    db_stats = get_db_stats()
    print(f"[+] SQLite Database: {db_result.get('sqlite_saved_records', 0)} records stored/updated in news.db")
    print(f"[+] Database Metrics : Total Articles: {db_stats['total_articles']}, Images: {db_stats['articles_with_images']}")

    require_supabase = os.getenv("SUPABASE_SYNC_REQUIRED", "false").lower() == "true"
    delivery_ok = _pipeline_delivery_succeeded(
        export_success, db_result.get("supabase_sync", {}), require_supabase
    )

    elapsed = round(time.time() - start_time, 2)
    print("\n=====================================================================")
    if export_success:
        print(f"[SUCCESS] PIPELINE COMPLETED IN {elapsed} SECONDS!")
        print(f"  - Active Live Articles : {len(merged_pool[:50])}")
        print("  - Excel File Generated : daily_news_export.xlsx")
        print("  - CSV File Generated   : news_feed.csv")
        print("  - Web Feed Generated   : news_feed.json & news_feed.js")
        print("  - SQLite Database Sync : news.db (Active)")
    else:
        print("[-] Pipeline encountered errors during export.")
    print("=====================================================================")
    return delivery_ok

if __name__ == "__main__":
    run_daily_pipeline()

