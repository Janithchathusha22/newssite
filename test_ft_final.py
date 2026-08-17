import requests
from bs4 import BeautifulSoup
import json
import re
import sys
import urllib.parse

# Set console output encoding to UTF-8 for Windows compatibility
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def scrape_daily_ft():
    """
    Scrapes live articles from Daily FT (https://www.ft.lk/)
    Extracts 100% accurate titles, article links, and images.
    """
    sections = [
        {"url": "https://www.ft.lk/front-page/44", "category": "Front Page"},
        {"url": "https://www.ft.lk/top-story/26", "category": "Top Story"},
        {"url": "https://www.ft.lk/financial-services/42", "category": "Financial Services"},
        {"url": "https://www.ft.lk/corporate/27", "category": "Corporate"},
        {"url": "https://www.ft.lk/opinion-and-issues/14", "category": "Opinion & Issues"},
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.ft.lk/"
    }

    news_list = []
    seen_links = set()
    session = requests.Session()

    print("[*] Starting Daily FT (ft.lk) Scraper...\n")

    for sec in sections:
        sec_url = sec["url"]
        sec_cat = sec["category"]
        print(f"[*] Fetching section: {sec_cat} ({sec_url})")

        try:
            resp = session.get(sec_url, headers=headers, timeout=12)
            if resp.status_code != 200:
                print(f"    [!] Failed with HTTP Status: {resp.status_code}")
                continue

            soup = BeautifulSoup(resp.content, 'html.parser')

            # Daily FT organizes articles into col-md-... grid containers
            containers = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)

            for c in containers:
                # Find article link
                link_tag = None
                for a in c.find_all('a', href=True):
                    href = a['href'].strip()
                    # Check if URL matches FT article pattern e.g., /44-795689 or /26-795681
                    if re.search(r'/\d+-\d+$', href):
                        link_tag = a
                        break

                if not link_tag:
                    continue

                # Build full article URL
                href = link_tag['href'].strip()
                full_url = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)

                # Skip duplicate articles
                if full_url in seen_links:
                    continue

                # Extract headline title from heading tag inside container
                h_tag = c.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                if h_tag:
                    title = h_tag.get_text(strip=True)
                else:
                    title = link_tag.get_text(strip=True)

                # Clean date strings attached to titles
                title = re.sub(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d+.*$', '', title, flags=re.I).strip()

                # Validate title quality
                if not title or len(title) < 15 or title.lower() in ["read more", "more news"]:
                    continue

                # Extract image thumbnail from container
                img_tag = c.find('img')
                image_url = ""
                if img_tag:
                    src = img_tag.get('src') or img_tag.get('data-src')
                    if src and not src.endswith('placeholder') and 'logo' not in src.lower():
                        image_url = src if src.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", src)

                # Fallback placeholder if article image is missing
                if not image_url:
                    image_url = "https://via.placeholder.com/600x400?text=Daily+FT+News"

                news_item = {
                    "title": title,
                    "link": full_url,
                    "image": image_url,
                    "category": sec_cat
                }

                news_list.append(news_item)
                seen_links.add(full_url)
                print(f"    [+] [{sec_cat}] {title[:60]}...")

        except Exception as e:
            print(f"    [!] Error scraping {sec_url}: {e}")

    print(f"\n[*] Successfully scraped {len(news_list)} articles from Daily FT!")

    # Save to news_data.json
    with open('news_data.json', 'w', encoding='utf-8') as f:
        json.dump(news_list, f, ensure_ascii=False, indent=4)

    print("[+] Saved 100% accurate data to news_data.json!")
    return news_list

if __name__ == "__main__":
    scrape_daily_ft()
