"""
Sanitizes persistent database and state files on VPS to ensure 100% English business content.
"""
import json
import re
import os

def sanitize():
    for path in ['editorial/editorial_state.json', 'news_feed.json', 'news_data.json']:
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            continue
        try:
            with open(path, 'r', encoding='utf-8') as f:
                d = json.load(f)
            if isinstance(d, dict) and 'articles' in d:
                for a in d['articles']:
                    h = a.get('draft', {}).get('headline') or a.get('headline') or ''
                    s = a.get('draft', {}).get('summary') or a.get('summary') or ''
                    if re.search(r'[\u0D80-\u0DFF]', h) or re.search(r'[\u0D80-\u0DFF]', s):
                        a['status'] = 'rejected'
                        a['topRank'] = None
                        a['category'] = 'rejected'
                        a['rejectionReason'] = 'Sinhala content cannot be published on English portal'
                valid = [a for a in d['articles'] if a.get('status') == 'published' and not re.search(r'[\u0D80-\u0DFF]', a.get('draft', {}).get('headline', ''))]
                for a in d['articles']:
                    a['topRank'] = None
                for idx, a in enumerate(valid[:10]):
                    a['topRank'] = idx + 1
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(d, f, indent=2, ensure_ascii=False)
                print(f"[+] Sanitized {path}")
            elif isinstance(d, list):
                cleaned = []
                rank = 1
                for a in d:
                    h = a.get('headline_en') or a.get('title') or a.get('raw_title') or ''
                    s = a.get('summary_en') or a.get('summary') or a.get('raw_summary') or ''
                    if re.search(r'[\u0D80-\u0DFF]', h) or re.search(r'[\u0D80-\u0DFF]', s):
                        continue
                    if a.get('status') == 'published':
                        a['topRank'] = rank if rank <= 10 else None
                        rank += 1
                    cleaned.append(a)
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump(cleaned, f, indent=2, ensure_ascii=False)
                print(f"[+] Purged Sinhala items from {path}")
        except Exception as e:
            print(f"[!] Sanitization notice for {path}: {e}")

if __name__ == '__main__':
    sanitize()
