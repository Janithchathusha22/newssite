"""
=============================================================================
EXCEL & GOOGLE SHEETS AUTOMATED SYNC ENGINE
=============================================================================
Takes AI-processed news records, formats them cleanly, and exports them into:
1. `daily_news_export.xlsx` (Excel Workbook with custom styling & tabs)
2. `news_feed.csv` (UTF-8-SIG CSV for Excel compatibility)
3. `news_feed.json` & `news_feed.js` (Direct frontend live payload)
4. Google Sheets (Live Sync via OAuth2 credentials.json)
"""

import os
import json
import pandas as pd
import hashlib
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from dotenv import load_dotenv
from scraper import is_probable_source_image

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

def _project_path(env_name, default):
    configured = Path(os.getenv(env_name, default)).expanduser()
    return configured if configured.is_absolute() else PROJECT_DIR / configured


EXCEL_FILE = _project_path("EXCEL_OUTPUT_PATH", "daily_news_export.xlsx")
CSV_FILE = _project_path("CSV_OUTPUT_PATH", "news_feed.csv")
JSON_FILE = _project_path("JSON_OUTPUT_PATH", "news_feed.json")
JS_FILE = _project_path("JS_OUTPUT_PATH", "news_feed.js")
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "1HUuHHk_Wy8U4xT5cvz-yuMqFGesNouG19yRzGbdGiSk")

SYNTHETIC_IMAGE_MARKERS = (
    "images.unsplash.com",
    "source.unsplash.com",
    "picsum.photos",
    "placeholder.com",
    "placehold.co",
    "dummyimage.com",
    "ftlk_logo_og.png",
    "s.w.org/images/core/emoji",
    "/emoji/",
)
LOCAL_IMAGE_ROOTS = (
    "assets/news_images/",
    "ft_images/",
    "news_images/",
    "images/",
    "downloaded_images/",
)
TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
}
AI_FIELDS = {
    "headline_en",
    "headline_si",
    "summary_en",
    "summary_si",
    "key_takeaways",
    "category",
    "tags",
    "editorial_headline",
    "editorial_summary",
    "editorial_content",
    "ai_model",
    "ai_source_hash",
    "prompt_version",
    "rewrite_status",
    "workflow_status",
    "ai_warnings",
    "validation_errors",
    "protected_facts",
}


def canonicalize_url(url):
    value = url.strip() if isinstance(url, str) else ""
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        if not parts.scheme or not parts.netloc:
            return value.rstrip("/")
        query = sorted([
            (key, val)
            for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in TRACKING_QUERY_KEYS
        ])
        path = re.sub(r"/{2,}", "/", parts.path).rstrip("/") or "/"
        return urlunsplit(
            (parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), "")
        )
    except ValueError:
        return value.split("#", 1)[0].rstrip("/")


def _is_real_source_image(value, article_url=""):
    if not isinstance(value, str) or not value.strip().lower().startswith(("http://", "https://")):
        return False
    lowered = value.strip().lower()
    return (
        not any(marker in lowered for marker in SYNTHETIC_IMAGE_MARKERS)
        and is_probable_source_image(value.strip(), article_url)
    )


def _is_local_image(value):
    if not isinstance(value, str) or not value.strip():
        return False
    return not value.strip().lower().startswith(("http://", "https://", "data:"))


def _local_image_path(value):
    if not _is_local_image(value):
        return ""
    path = Path(value.strip())
    if path.is_absolute():
        try:
            path = path.resolve().relative_to(PROJECT_DIR)
        except ValueError:
            return ""
    normalized = path.as_posix().lstrip("/")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if not parts or ".." in parts or ":" in parts[0]:
        return ""
    normalized = "/".join(parts)
    return normalized if normalized.lower().startswith(LOCAL_IMAGE_ROOTS) else ""


def _sanitize_article(item):
    """Normalize identity/image fields and remove synthetic image fallbacks."""
    clean = dict(item) if isinstance(item, dict) else {}
    clean["url"] = canonicalize_url(clean.get("url") or clean.get("link"))

    article_id = clean.get("id") or clean.get("article_id")
    if article_id in (None, ""):
        seed = clean["url"] or str(
            clean.get("raw_title") or clean.get("headline_en") or clean.get("title") or ""
        ).strip().lower()
        article_id = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:20]
    clean["id"] = str(article_id)

    source_image = ""
    declared_remote_image = False
    for key in ("source_image", "main_image_url", "image_url", "image"):
        candidate = clean.get(key)
        if isinstance(candidate, str) and candidate.strip().lower().startswith(("http://", "https://")):
            declared_remote_image = True
        if _is_real_source_image(candidate, clean["url"]):
            source_image = clean[key].strip()
            break

    local_image = ""
    for key in (
        "local_image_path", "cached_image", "image_local", "main_image_local", "image"
    ):
        candidate = _local_image_path(clean.get(key))
        if candidate:
            local_image = candidate
            break
    if declared_remote_image and not source_image:
        # A cache produced from a rejected remote candidate has the same bad
        # provenance (for example WordPress emoji cached as a story photo).
        local_image = ""

    clean["source_image"] = source_image
    clean["local_image_path"] = local_image
    clean["image_local"] = local_image
    clean["image"] = local_image or source_image
    return clean


def _identity_keys(item):
    keys = []
    url = canonicalize_url(item.get("url") or item.get("link"))
    if url:
        # Treat http and https representations of the same canonical URL alike.
        scheme_free = url.split("://", 1)[-1]
        keys.append(f"url:{scheme_free}")
    article_id = item.get("id") or item.get("article_id")
    if article_id not in (None, ""):
        keys.append(f"id:{str(article_id).strip()}")
    return keys


def _has_value(value):
    return value not in (None, "", [], {})


def _looks_ai_enriched(item):
    # A fresh raw/fallback record may still carry presentation aliases such as
    # editorial_headline.  An explicit false flag is authoritative; infer from
    # legacy fields only when older records do not contain the flag at all.
    if "ai_enriched" in item:
        return item.get("ai_enriched") is True
    return bool(
        item.get("editorial_headline")
        or item.get("editorial_content")
        or item.get("headline_si")
        or item.get("summary_si")
        or item.get("key_takeaways")
    )


def _merge_article(existing, incoming):
    """Upsert a fresher scrape while retaining richer historical fields."""
    old = _sanitize_article(existing)
    new = _sanitize_article(incoming)
    merged = dict(old)
    preserve_old_ai = _looks_ai_enriched(old) and not _looks_ai_enriched(new)

    for key, value in new.items():
        if not _has_value(value):
            continue
        if preserve_old_ai and key in AI_FIELDS:
            continue
        if key in {"full_text", "content"} and len(str(value)) < len(str(merged.get(key, ""))):
            continue
        merged[key] = value

    if incoming.get("source_image_checked") is True:
        # A fresh canonical article-page check is authoritative even when it
        # reports no image. This prevents an older wrong thumbnail/cache from
        # surviving forever simply because the new value is blank.
        for key in (
            "source_image", "image", "local_image_path", "image_local",
            "cached_image", "main_image_local", "main_image_url", "image_url",
        ):
            merged[key] = new.get(key, "")

    if old.get("ai_enriched") or new.get("ai_enriched"):
        merged["ai_enriched"] = True
        merged.pop("ai_error", None)
    return _sanitize_article(merged)


def _date_timestamp(item):
    for key in (
        "published_at",
        "published_date",
        "published",
        "pub_date",
        "date",
        "scraped_at",
    ):
        value = item.get(key)
        if not isinstance(value, str) or not value.strip() or value.strip().lower() == "no date":
            continue
        text = value.strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = parsedate_to_datetime(text)
            except (TypeError, ValueError, OverflowError):
                continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    return 0.0


def load_existing_news(path=None):
    path = Path(path or JSON_FILE)
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        print(f"[!] Existing JSON feed is not an array; rebuilding {path.name}.")
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[!] Could not read existing JSON feed: {exc}. Rebuilding it.")
    return []


def merge_news_records(existing_news, incoming_news):
    """Merge/dedupe records by canonical URL and/or source article ID."""
    records = []
    key_to_index = {}

    for raw_item in list(existing_news or []) + list(incoming_news or []):
        if not isinstance(raw_item, dict):
            continue
        item = _sanitize_article(raw_item)
        keys = _identity_keys(item)
        matching = {key_to_index[key] for key in keys if key in key_to_index}

        if matching:
            index = min(matching)
            records[index] = _merge_article(records[index], item)
            # Collapse any pre-existing duplicates connected by URL versus ID.
            for duplicate_index in sorted(matching - {index}):
                records[index] = _merge_article(records[index], records[duplicate_index])
                records[duplicate_index] = None
                for known_key, known_index in list(key_to_index.items()):
                    if known_index == duplicate_index:
                        key_to_index[known_key] = index
        else:
            index = len(records)
            records.append(item)

        for key in set(keys + _identity_keys(records[index])):
            key_to_index[key] = index

    merged = [item for item in records if item is not None]
    return sorted(merged, key=_date_timestamp, reverse=True)


def _atomic_write_text(path, content, encoding="utf-8"):
    """Replace a feed only after its complete payload has been written."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp")
    temporary_path.write_text(content, encoding=encoding)
    os.replace(temporary_path, path)

def sync_to_google_sheets(df):
    """
    Syncs dataframe records directly to Google Sheet via gspread and OAuth2.
    Uses credentials.json (installed app client ID / secret) and saves token.json.
    """
    if os.getenv("GOOGLE_SHEETS_SYNC_ENABLED", "false").strip().lower() not in {
        "1",
        "true",
        "yes",
        "on",
    }:
        print("[i] Google Sheets sync disabled (set GOOGLE_SHEETS_SYNC_ENABLED=true to enable).")
        return False

    cred_file = PROJECT_DIR / "credentials.json"
    if not os.path.exists(cred_file):
        print("[!] Google Sheets credentials.json not found. Skipping Google Sheets sync.")
        return False

    if not GOOGLE_SHEET_ID:
        print("[!] GOOGLE_SHEET_ID is not configured. Skipping Google Sheets sync.")
        return False

    print(f"[*] Syncing data to Google Sheet (ID: {GOOGLE_SHEET_ID})...")

    try:
        import gspread
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request

        SCOPES = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]

        creds = None
        token_path = PROJECT_DIR / "token.json"

        if os.path.exists(token_path):
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(cred_file, SCOPES)
                creds = flow.run_local_server(port=0)

            with open(token_path, 'w') as token:
                token.write(creds.to_json())

        gc = gspread.authorize(creds)
        sh = gc.open_by_key(GOOGLE_SHEET_ID)
        worksheet = sh.get_worksheet(0) or sh.sheet1

        # Format rows
        header = df.columns.tolist()
        values = [header] + df.astype(str).values.tolist()

        # Update sheet content
        worksheet.clear()
        worksheet.update(values, 'A1')
        print(f"[+] SUCCESS: Google Sheet updated successfully! ({len(df)} rows)")
        return True

    except Exception as e:
        print(f"[!] Google Sheets Sync Notice/Error: {e}")
        print("    (Note: First run requires interactive browser authorization to grant access.)")
        return False

def export_to_excel_and_csv(news_list, merge_existing=True):
    """
    Exports news array to Excel (.xlsx), CSV (.csv with UTF-8-SIG for Sinhala), 
    JSON (.json) format, and Google Sheets.
    """
    existing_news = load_existing_news() if merge_existing else []
    merged_news = merge_news_records(existing_news, news_list)
    if not merged_news:
        print("[!] No existing or newly scraped news items to export.")
        return False

    # Newly scraped articles already resolve their publisher image. Historical
    # repair is an opt-in maintenance task because retrying old detail pages on
    # every hosted refresh can make the scheduled process unnecessarily long.
    if os.getenv("HYDRATE_MISSING_IMAGES", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }:
        try:
            from unified_scraper import hydrate_missing_article_images

            merged_news = hydrate_missing_article_images(merged_news)
        except Exception as exc:
            # Local export remains available even if a publisher blocks a
            # detail-page retry during this particular run.
            print(f"[!] Missing-image hydration skipped: {type(exc).__name__}")

    print(
        f"[*] Formatting & Exporting {len(merged_news)} news records "
        f"({len(existing_news)} existing + {len(news_list or [])} scraped, deduplicated)..."
    )

    rows = []
    for item in merged_news:
        takeaways_str = " | ".join(item.get("key_takeaways", [])) if isinstance(item.get("key_takeaways"), list) else str(item.get("key_takeaways", ""))
        tags_str = ", ".join(item.get("tags", [])) if isinstance(item.get("tags"), list) else str(item.get("tags", ""))

        rows.append({
            "Article ID": item.get("id", ""),
            "Published Date": item.get("published_at") or item.get("published_date") or item.get("date", ""),
            "Scraped Date": item.get("scraped_at") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "Category": item.get("category", "Business & Governance"),
            "Headline (English)": item.get("headline_en", ""),
            "Headline (Sinhala)": item.get("headline_si", ""),
            "Executive Summary (English)": item.get("summary_en", ""),
            "Executive Summary (Sinhala)": item.get("summary_si", ""),
            "Full Text": item.get("full_text", ""),
            "AI Key Takeaways": takeaways_str,
            "Tags": tags_str,
            "Display Image": item.get("image", ""),
            "Source Image URL": item.get("source_image", ""),
            "Source URL": item.get("url", ""),
            "Source": item.get("source", "Daily Biz & Gov")
        })

    df = pd.DataFrame(rows)

    # Write the merged web feeds first and atomically. A locked spreadsheet must
    # never prevent new articles from reaching the site or damage feed history.
    json_payload = json.dumps(merged_news, indent=2, ensure_ascii=False)
    _atomic_write_text(JSON_FILE, json_payload)
    print(f"[+] Saved JSON feed: {JSON_FILE}")

    js_payload = "window.LIVE_NEWS_FEED = " + json_payload + ";\n"
    _atomic_write_text(JS_FILE, js_payload)
    print(f"[+] Saved JS feed for file:// compatibility: {JS_FILE}")

    # 1. Export CSV (UTF-8-SIG ensures Sinhala fonts display correctly in Excel)
    try:
        CSV_FILE.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
        print(f"[+] Saved UTF-8 CSV: {CSV_FILE}")
    except Exception as exc:
        print(f"[!] CSV export skipped: {exc}")

    # 2. Export Excel (.xlsx) with formatting
    try:
        EXCEL_FILE.parent.mkdir(parents=True, exist_ok=True)
        with pd.ExcelWriter(EXCEL_FILE, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Today_News', index=False)
            
            # Format columns width in OpenPyXL
            workbook = writer.book
            worksheet = writer.sheets['Today_News']
            for col in worksheet.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = col[0].column_letter
                worksheet.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 50)
                
        print(f"[+] Saved Excel Workbook: {EXCEL_FILE}")
    except Exception as e:
        print(f"[!] Excel export fallback to pandas default: {e}")
        try:
            df.to_excel(EXCEL_FILE, index=False)
        except Exception as fallback_error:
            print(f"[!] Excel export skipped: {fallback_error}")

    # 4. Sync to Google Sheets
    sync_to_google_sheets(df)

    return True

if __name__ == "__main__":
    sample_data = [{
        "id": "101",
        "category": "Governance & Policy",
        "headline_en": "Cabinet approves Fiscal Transparency Bill 2026",
        "headline_si": "2026 මුදල් විනිවිදභාවය පිළිබඳ පනතට කැබිනට් අනුමැතිය",
        "summary_en": "Sri Lanka Cabinet approves mandatory digital procurement publishing.",
        "summary_si": "රාජ්‍ය ප්‍රසම්පාදන විනිවිදභාවය සඳහ පනතට කැබිනට් අනුමැතිය හිමිවේ.",
        "key_takeaways": ["LKR 50M+ tenders online", "SOE auditing framework"],
        "tags": ["Cabinet", "Fiscal Policy"],
        "image": "",
        "source_image": "",
        "url": "https://economynext.com/",
        "source": "EconomyNext"
    }]
    export_to_excel_and_csv(sample_data)
