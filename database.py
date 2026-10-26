"""
=============================================================================
NEWS DATABASE ENGINE (SQLITE & SUPABASE)
=============================================================================
Manages persistent database storage for scraped and AI-enriched news articles.
Automatically saves every article to local SQLite (news.db) with transactional
upserting, and synchronizes to Supabase when configured.
"""

import sqlite3
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

PROJECT_DIR = Path(__file__).resolve().parent
DB_PATH = PROJECT_DIR / "news.db"

def get_connection() -> sqlite3.Connection:
    """Returns a SQLite connection with row factory enabled."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes SQLite database schema and indexes."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS news_articles (
                id TEXT PRIMARY KEY,
                url TEXT UNIQUE,
                headline_en TEXT NOT NULL,
                headline_si TEXT,
                summary_en TEXT,
                summary_si TEXT,
                content TEXT,
                passive_voice_content TEXT,
                image TEXT,
                source TEXT DEFAULT 'Daily FT (ft.lk)',
                category TEXT DEFAULT 'Business & Governance',
                published_at TEXT,
                scraped_at TEXT,
                tags TEXT,
                key_takeaways TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_url ON news_articles(url)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_category ON news_articles(category)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_articles_published ON news_articles(published_at)")
        conn.commit()

# Initialize schema immediately upon module import
init_db()

def save_articles_to_sqlite(articles: List[Dict[str, Any]]) -> int:
    """
    Saves or updates a batch of articles in SQLite news.db.
    Returns the count of successfully saved records.
    """
    if not articles:
        return 0

    saved_count = 0
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with get_connection() as conn:
        cursor = conn.cursor()
        for art in articles:
            url = art.get("url") or art.get("canonical_url", "")
            if not url:
                continue

            art_id = str(art.get("id") or hash(url))
            headline_en = art.get("headline_en") or art.get("title") or art.get("raw_title", "Untitled")
            headline_si = art.get("headline_si", "")
            summary_en = art.get("summary_en") or art.get("summary") or art.get("raw_summary", "")
            summary_si = art.get("summary_si", "")
            content = art.get("content") or art.get("full_text") or summary_en
            passive_content = art.get("passive_voice_content") or art.get("content_passive") or summary_en
            image = art.get("image") or art.get("image_url", "")
            source = art.get("source", "Daily FT (ft.lk)")
            category = art.get("category", "Business & Governance")
            published_at = art.get("published_at") or art.get("date", now_iso)
            scraped_at = art.get("scraped_at", now_iso)

            tags = art.get("tags", [])
            tags_json = json.dumps(tags if isinstance(tags, list) else [tags], ensure_ascii=False)

            takeaways = art.get("key_takeaways") or art.get("takeaways", [])
            takeaways_json = json.dumps(takeaways if isinstance(takeaways, list) else [takeaways], ensure_ascii=False)

            cursor.execute("""
                INSERT INTO news_articles (
                    id, url, headline_en, headline_si, summary_en, summary_si,
                    content, passive_voice_content, image, source, category,
                    published_at, scraped_at, tags, key_takeaways, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    headline_en = excluded.headline_en,
                    headline_si = excluded.headline_si,
                    summary_en = excluded.summary_en,
                    summary_si = excluded.summary_si,
                    content = CASE WHEN excluded.content != '' THEN excluded.content ELSE news_articles.content END,
                    passive_voice_content = CASE WHEN excluded.passive_voice_content != '' THEN excluded.passive_voice_content ELSE news_articles.passive_voice_content END,
                    image = CASE WHEN excluded.image != '' THEN excluded.image ELSE news_articles.image END,
                    source = excluded.source,
                    category = excluded.category,
                    published_at = excluded.published_at,
                    tags = excluded.tags,
                    key_takeaways = excluded.key_takeaways,
                    updated_at = excluded.updated_at
            """, (
                art_id, url, headline_en, headline_si, summary_en, summary_si,
                content, passive_content, image, source, category,
                published_at, scraped_at, tags_json, takeaways_json, now_iso
            ))
            saved_count += 1

        conn.commit()

    return saved_count


def sync_to_supabase_if_configured(articles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Attempts Supabase synchronization if configured, otherwise returns skipped."""
    try:
        from supabase_sync import sync_news_to_supabase
        return sync_news_to_supabase(articles)
    except Exception as e:
        return {"status": "skipped", "reason": f"Supabase sync module notice: {e}"}


def prune_old_articles(retention_days: int = 7, min_keep: int = 10) -> int:
    """
    Deletes articles older than retention_days from SQLite news.db
    while preserving at least min_keep records.
    """
    from datetime import datetime, timedelta
    cutoff_date = (datetime.now() - timedelta(days=retention_days)).strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) as count FROM news_articles")
        total = cursor.fetchone()["count"]
        if total <= min_keep:
            return 0

        cursor.execute("""
            DELETE FROM news_articles
            WHERE id IN (
                SELECT id FROM news_articles
                WHERE (published_at < ? OR (published_at IS NULL AND created_at < ?))
                AND id NOT IN (
                    SELECT id FROM news_articles ORDER BY published_at DESC, id DESC LIMIT ?
                )
            )
        """, (cutoff_date, cutoff_date, min_keep))
        deleted = cursor.rowcount
        conn.commit()
        if deleted > 0:
            print(f"[+] Pruned {deleted} articles older than {retention_days} days from news.db")
        return deleted


def save_articles_to_database(articles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Unified database save operation.
    Persists articles into SQLite news.db, prunes >7 day old records, and triggers Supabase sync.
    """
    sqlite_saved = save_articles_to_sqlite(articles)
    pruned_count = prune_old_articles(retention_days=7)
    supabase_res = sync_to_supabase_if_configured(articles)

    return {
        "success": True,
        "sqlite_saved_records": sqlite_saved,
        "sqlite_pruned_records": pruned_count,
        "supabase_sync": supabase_res,
        "database_file": str(DB_PATH)
    }


def get_articles_from_db(limit: int = 50, category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieves stored articles from SQLite news.db."""
    with get_connection() as conn:
        cursor = conn.cursor()
        if category:
            cursor.execute("""
                SELECT * FROM news_articles 
                WHERE category LIKE ? 
                ORDER BY published_at DESC, id DESC 
                LIMIT ?
            """, (f"%{category}%", limit))
        else:
            cursor.execute("""
                SELECT * FROM news_articles 
                ORDER BY published_at DESC, id DESC 
                LIMIT ?
            """, (limit,))

        rows = cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            try:
                item["tags"] = json.loads(item["tags"])
            except Exception:
                pass
            try:
                item["key_takeaways"] = json.loads(item["key_takeaways"])
            except Exception:
                pass
            results.append(item)
        return results


def get_db_stats() -> Dict[str, Any]:
    """Returns summary metrics from the news database."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) as total, count(distinct url) as unique_urls FROM news_articles")
        row = cursor.fetchone()
        total = row["total"] if row else 0

        cursor.execute("SELECT category, count(*) as count FROM news_articles GROUP BY category")
        categories = {r["category"]: r["count"] for r in cursor.fetchall()}

        cursor.execute("SELECT count(*) as has_img FROM news_articles WHERE image != '' AND image IS NOT NULL")
        img_row = cursor.fetchone()
        has_img = img_row["has_img"] if img_row else 0

        return {
            "total_articles": total,
            "articles_with_images": has_img,
            "categories": categories,
            "database_path": str(DB_PATH)
        }


if __name__ == "__main__":
    init_db()
    stats = get_db_stats()
    print("Database Initialized successfully.")
    print("Database Stats:", stats)
