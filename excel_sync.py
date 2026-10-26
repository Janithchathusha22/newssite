"""
=============================================================================
EXCEL & GOOGLE SHEETS AUTOMATED SYNC ENGINE
=============================================================================
Takes AI-processed news records, formats them cleanly, and exports them into:
1. `daily_news_export.xlsx` (Excel Workbook with custom styling & tabs)
2. `news_feed.csv` (UTF-8-SIG CSV for Excel compatibility)
3. `news_feed.json` (Direct frontend live payload)
"""

import os
import json
import csv
import pandas as pd
from datetime import datetime

EXCEL_FILE = os.getenv("EXCEL_OUTPUT_PATH", "daily_news_export.xlsx")
CSV_FILE = os.getenv("CSV_OUTPUT_PATH", "news_feed.csv")
JSON_FILE = os.getenv("JSON_OUTPUT_PATH", "news_feed.json")

def merge_news_records(old_records, incoming_records):
    """
    Merges fresh incoming scrape records with historical records:
    - Preserves existing AI drafts, review statuses, and enriched fields.
    - If incoming has source_image_checked=True, clears poisoned historical images.
    - Updates summaries and raw content with newer scraped versions.
    """
    old_by_url = {
        (r.get("url") or r.get("id")): dict(r) for r in (old_records or []) if r.get("url") or r.get("id")
    }
    
    merged = []
    seen = set()

    for inc in (incoming_records or []):
        key = inc.get("url") or inc.get("id")
        if not key:
            continue
        seen.add(key)
        old = old_by_url.get(key)
        if not old:
            merged.append(dict(inc))
            continue

        item = dict(old)
        for k, v in inc.items():
            if k in ("editorial_headline", "editorial_summary", "editorial_content", "workflow_status", "ai_enriched", "prompt_version", "rewrite_status"):
                if old.get("ai_enriched") and not inc.get("ai_enriched"):
                    continue
            item[k] = v

        if inc.get("source_image_checked") is True and not inc.get("source_image"):
            item["source_image"] = ""
            item["image"] = ""
            item["local_image_path"] = ""

        merged.append(item)

    for k, old in old_by_url.items():
        if k not in seen:
            merged.append(old)

    return merged

def export_to_excel_and_csv(news_list):
    """
    Exports news array to Excel (.xlsx), CSV (.csv with UTF-8-SIG for Sinhala), 
    and JSON (.json) format.
    """
    if not news_list:
        print("[!] No news items to export.")
        return False

    print(f"[*] Formatting & Exporting {len(news_list)} news records to Excel and CSV...")

    rows = []
    for item in news_list:
        takeaways_str = " | ".join(item.get("key_takeaways", [])) if isinstance(item.get("key_takeaways"), list) else str(item.get("key_takeaways", ""))
        tags_str = ", ".join(item.get("tags", [])) if isinstance(item.get("tags"), list) else str(item.get("tags", ""))

        rows.append({
            "Article ID": item.get("id", ""),
            "Scraped Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "Category": item.get("category", "Business & Governance"),
            "Headline (English)": item.get("headline_en", ""),
            "Headline (Sinhala)": item.get("headline_si", ""),
            "Executive Summary (English)": item.get("summary_en", ""),
            "Executive Summary (Sinhala)": item.get("summary_si", ""),
            "AI Key Takeaways": takeaways_str,
            "Tags": tags_str,
            "Image URL": item.get("image", ""),
            "Source URL": item.get("url", ""),
            "Source": item.get("source", "Daily FT (ft.lk)")
        })

    df = pd.DataFrame(rows)

    # 1. Export CSV (UTF-8-SIG ensures Sinhala fonts display correctly in Excel)
    df.to_csv(CSV_FILE, index=False, encoding="utf-8-sig")
    print(f"[+] Saved UTF-8 CSV: {CSV_FILE}")

    # 2. Export Excel (.xlsx) with formatting
    try:
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
        df.to_excel(EXCEL_FILE, index=False)

    # 3. Export JSON for Web Frontend Ingestion
    with open(JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(news_list, f, indent=2, ensure_ascii=False)
    print(f"[+] Saved JSON feed: {JSON_FILE}")

    # 4. Export news_feed.js for browser script tags
    js_file = "news_feed.js"
    try:
        with open(js_file, "w", encoding="utf-8") as f:
            f.write("// Auto-generated by excel_sync.py\nwindow.LIVE_NEWS_FEED = ")
            json.dump(news_list, f, indent=2, ensure_ascii=False)
            f.write(";\n")
        print(f"[+] Saved JavaScript feed: {js_file}")
    except Exception as e:
        print(f"[-] Could not write {js_file}: {e}")

    # 5. Export raw news_data.json
    try:
        with open("news_data.json", "w", encoding="utf-8") as f:
            json.dump(news_list, f, indent=2, ensure_ascii=False)
        print("[+] Saved raw news_data.json")
    except Exception as e:
        print(f"[-] Could not write news_data.json: {e}")

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
        "image": "https://images.unsplash.com/photo-1541872703-74c5e44368f9",
        "url": "https://www.ft.lk/front-page/44",
        "source": "Daily FT"
    }]
    export_to_excel_and_csv(sample_data)
