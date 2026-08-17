import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.google.com/"
}

categories = {
    "financial_services": "https://www.ft.lk/financial-services/42",
    "governance_opinion": "https://www.ft.lk/opinion-and-issues/14",
    "business_news": "https://www.ft.lk/business/13",
    "economy": "https://www.ft.lk/front-page/44"
}

all_articles = []

for cat_name, url in categories.items():
    print(f"\n[*] Fetching direct category '{cat_name}' from {url}...")
    for attempt in range(3):
        try:
            session = requests.Session()
            res = session.get(url, headers=headers, timeout=12)
            if res.status_code == 200:
                soup = BeautifulSoup(res.text, 'html.parser')
                # Find all links with href containing category pattern /42-, /14-, /13-, /44-
                links = soup.find_all('a', href=True)
                cat_count = 0
                for l in links:
                    href = l['href']
                    if re.search(r'/\d+-\d+$', href):
                        title = l.get_text(strip=True)
                        # Clean date if present at end of title text
                        title = re.sub(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\d+.*$', '', title, flags=re.IGNORECASE).strip()
                        
                        if len(title) > 20 and "javascript:" not in href:
                            full_url = href if href.startswith('http') else f"https://www.ft.lk{href}"
                            
                            # Container for image
                            parent = l.find_parent(['div', 'article', 'li', 'td'])
                            img_url = ""
                            summary = ""
                            if parent:
                                img_el = parent.find('img', src=True)
                                if img_el:
                                    src = img_el['src']
                                    img_url = src if src.startswith('http') else f"https://www.ft.lk{src}"
                                p_el = parent.find('p')
                                if p_el:
                                    summary = p_el.get_text(strip=True)
                                    
                            all_articles.append({
                                "raw_title": title,
                                "url": full_url,
                                "image": img_url if img_url else "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=800&q=80",
                                "raw_summary": summary if summary else title,
                                "category": cat_name,
                                "source": "Daily FT (ft.lk)",
                                "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            })
                            cat_count += 1
                print(f"[+] Scraped {cat_count} direct articles for '{cat_name}'")
                break
        except Exception as e:
            print(f"[!] Attempt {attempt+1} failed for {url}: {e}")

print(f"\n[TOTAL] Direct Articles Extracted: {len(all_articles)}")
for a in all_articles[:8]:
    print(f" -> [{a['category']}] {a['raw_title']}")
    print(f"    URL: {a['url']}")

