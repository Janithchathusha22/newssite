import json
import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import requests
from bs4 import BeautifulSoup

# Ensure UTF-8 output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from groq_ai_processor import is_political_or_non_business, _editorial_category

FEEDS = [
    # Business News
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/front-page/44", "category": "business-news"},
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/corporate/27", "category": "business-news"},
    {"source": "Ada Derana Biz", "url": "http://biz.adaderana.lk/feed/", "category": "business-news"},
    {"source": "Lanka Business Online", "url": "https://www.lankabusinessonline.com/feed/", "category": "business-news"},

    # Money
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/financial-services/42", "category": "money"},
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/markets/43", "category": "money"},
    {"source": "EconomyNext", "url": "https://economynext.com/feed/", "category": "money"},

    # Interviews & Appointments
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/hr/47", "category": "interviews-appointments"},

    # Technology
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/technology/49", "category": "technology"},
    {"source": "LBO Tech", "url": "https://www.lankabusinessonline.com/category/ict/feed/", "category": "technology"},

    # Travel & Tourism
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/hospitality/54", "category": "travel-tourism"},
    {"source": "LBO Tourism", "url": "https://www.lankabusinessonline.com/category/tourism/feed/", "category": "travel-tourism"},

    # Luxury Living
    {"source": "Daily FT", "url": "https://www.ft.lk/rss/lifestyle/10519", "category": "luxury-living"},
    {"source": "Pulse", "url": "https://pulse.lk/feed/", "category": "luxury-living"},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
}

def fetch_feed_items(feed):
    articles = []
    try:
        r = requests.get(feed["url"], headers=HEADERS, timeout=12)
        if r.status_code != 200:
            return []
        
        soup = BeautifulSoup(r.content, "xml")
        items = soup.find_all("item")
        if not items:
            soup = BeautifulSoup(r.content, "html.parser")
            items = soup.find_all("item")

        for item in items[:20]:
            title_elem = item.find("title")
            link_elem = item.find("link")
            desc_elem = item.find("description") or item.find("content:encoded")

            title = title_elem.get_text(" ", strip=True) if title_elem else ""
            link = ""
            if link_elem:
                link = link_elem.get_text(strip=True) or link_elem.get("href") or ""
            if not link and item.find("guid"):
                link = item.find("guid").get_text(strip=True)

            raw_desc = desc_elem.get_text(" ", strip=True) if desc_elem else ""
            summary = BeautifulSoup(raw_desc, "html.parser").get_text(separator=" ").strip() if raw_desc else ""

            # Extract image
            img_url = ""
            enc = item.find("enclosure")
            if enc and enc.get("url"):
                img_url = enc.get("url")
            elif item.find("media:content") and item.find("media:content").get("url"):
                img_url = item.find("media:content").get("url")
            elif desc_elem:
                img_tag = BeautifulSoup(str(desc_elem), "html.parser").find("img")
                if img_tag and img_tag.get("src"):
                    img_url = img_tag.get("src")

            # Determine published date
            pub_date = item.find("pubDate") or item.find("dc:date")
            published_at = pub_date.get_text(strip=True) if pub_date else datetime.now(timezone.utc).isoformat()

            if title and link and not is_political_or_non_business(title, summary):
                canonical_cat = _editorial_category(title, feed["category"], summary)
                articles.append({
                    "id": f"art-{abs(hash(link))}",
                    "raw_title": title,
                    "title": title,
                    "headline_en": title,
                    "url": link,
                    "link": link,
                    "raw_summary": summary[:300] or title,
                    "summary": summary[:300] or title,
                    "summary_en": summary[:300] or title,
                    "full_text": summary,
                    "content": summary,
                    "source": feed["source"],
                    "source_name": feed["source"],
                    "category": canonical_cat,
                    "published_at": published_at,
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                    "image": img_url,
                    "source_image": img_url,
                    "tags": ["Business", canonical_cat.replace("-", " ").title()],
                    "status": "published"
                })
    except Exception as e:
        print(f"Error fetching {feed['source']} ({feed['url']}): {e}")
    return articles

def fetch_business_today():
    articles = []
    try:
        url = "https://businesstoday.lk/wp-json/wp/v2/posts?per_page=15&_embed"
        r = requests.get(url, headers=HEADERS, timeout=15)
        if r.status_code == 200:
            posts = r.json()
            for p in posts:
                raw_title = p.get("title", {}).get("rendered", "")
                title = BeautifulSoup(raw_title, "html.parser").get_text(strip=True)
                link = p.get("link", "")
                raw_excerpt = p.get("excerpt", {}).get("rendered", "")
                summary = BeautifulSoup(raw_excerpt, "html.parser").get_text(separator=" ").strip()
                img_url = ""
                try:
                    media = p.get("_embedded", {}).get("wp:featuredmedia", [{}])
                    if media and isinstance(media, list) and len(media) > 0:
                        img_url = media[0].get("source_url", "")
                except Exception:
                    pass
                pub_date = p.get("date_gmt") or p.get("date") or datetime.now(timezone.utc).isoformat()
                
                if title and link and not is_political_or_non_business(title, summary):
                    canonical_cat = _editorial_category(title, "interviews-appointments", summary)
                    articles.append({
                        "id": f"art-{abs(hash(link))}",
                        "raw_title": title,
                        "title": title,
                        "headline_en": title,
                        "url": link,
                        "link": link,
                        "raw_summary": summary[:300] or title,
                        "summary": summary[:300] or title,
                        "summary_en": summary[:300] or title,
                        "full_text": summary,
                        "content": summary,
                        "source": "Business Today",
                        "source_name": "Business Today",
                        "category": canonical_cat,
                        "published_at": pub_date,
                        "scraped_at": datetime.now(timezone.utc).isoformat(),
                        "image": img_url,
                        "source_image": img_url,
                        "tags": ["Business", "Leadership", "Interviews"],
                        "status": "published"
                    })
    except Exception as e:
        print(f"Error fetching Business Today: {e}")
    return articles

def run():
    all_articles = []
    seen_urls = set()

    for feed in FEEDS:
        items = fetch_feed_items(feed)
        added = 0
        for it in items:
            if it["url"] not in seen_urls:
                seen_urls.add(it["url"])
                all_articles.append(it)
                added += 1
        print(f"Scraped {added} articles from {feed['source']} - {feed['category']}")

    # Add Business Today
    bt_items = fetch_business_today()
    added_bt = 0
    for it in bt_items:
        if it["url"] not in seen_urls:
            seen_urls.add(it["url"])
            all_articles.append(it)
            added_bt += 1
    print(f"Scraped {added_bt} articles from Business Today (Interviews & Leadership)")

    print(f"\nTotal verified pure business articles: {len(all_articles)}")
    cat_counts = {}
    for a in all_articles:
        c = a["category"]
        cat_counts[c] = cat_counts.get(c, 0) + 1
    print("Category breakdown:", cat_counts)

    # Save to news_feed.json
    with open("news_feed.json", "w", encoding="utf-8") as f:
        json.dump(all_articles, f, indent=2, ensure_ascii=False)
    print("[+] Saved clean business articles to news_feed.json")

    # Save to news_data.json
    with open("news_data.json", "w", encoding="utf-8") as f:
        json.dump(all_articles, f, indent=2, ensure_ascii=False)
    print("[+] Saved clean business articles to news_data.json")

    # Update editorial_state.json if present
    if os.path.exists("editorial/editorial_state.json"):
        with open("editorial/editorial_state.json", "r", encoding="utf-8") as f:
            state = json.load(f)
        
        # Build normalized editorial articles
        editorial_articles = []
        for idx, a in enumerate(all_articles):
            editorial_articles.append({
                "id": a["id"],
                "slug": f"art-{idx}-{abs(hash(a['title'])) % 100000}",
                "status": "published",
                "aiStatus": "ready_for_review",
                "category": a["category"],
                "sourceName": a["source"],
                "sourceUrl": a["url"],
                "publishedAt": a["published_at"],
                "sourcePublishedAt": a["published_at"],
                "scrapedAt": a["scraped_at"],
                "imageUrl": a["image"],
                "original": {
                    "headline": a["title"],
                    "summary": a["summary"],
                    "body": a["content"]
                },
                "draft": {
                    "headline": a["title"],
                    "summary": a["summary"],
                    "body": a["content"]
                },
                "tags": a["tags"],
                "validation": [],
                "topRank": idx + 1 if idx < 10 else None,
                "is_top_news": idx < 10,
                "audit": []
            })
        
        state["articles"] = editorial_articles
        with open("editorial/editorial_state.json", "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2, ensure_ascii=False)
        print("[+] Rebuilt editorial/editorial_state.json with 100% verified business news!")

if __name__ == "__main__":
    run()
