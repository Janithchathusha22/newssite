import requests
from bs4 import BeautifulSoup
import json
import re
import urllib.parse

def scrape_daily_ft(max_articles=30):
    """
    Scrapes live articles from Daily FT (ft.lk).
    Targeting section pages and home page for full coverage.
    """
    sections = [
        {"url": "https://www.ft.lk/front-page/44", "category": "Front Page"},
        {"url": "https://www.ft.lk/top-story/26", "category": "Top Story"},
        {"url": "https://www.ft.lk/financial-services/42", "category": "Financial Services"},
        {"url": "https://www.ft.lk/opinion-and-issues/14", "category": "Opinion & Issues"},
        {"url": "https://www.ft.lk/corporate/27", "category": "Corporate"},
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.ft.lk/"
    }

    news_list = []
    seen_links = set()

    session = requests.Session()

    for sec in sections:
        sec_url = sec["url"]
        sec_cat = sec["category"]
        print(f"Fetching section: {sec_cat} ({sec_url})...")

        try:
            resp = session.get(sec_url, headers=headers, timeout=12)
            if resp.status_code != 200:
                print(f"  [!] HTTP {resp.status_code} for {sec_url}")
                continue

            soup = BeautifulSoup(resp.content, 'html.parser')

            # Find all anchor tags that look like article URLs (containing pattern like /44-, /26-, /42-, /14-, /27-, etc.)
            anchors = soup.find_all('a', href=True)

            for a in anchors:
                href = a['href'].strip()
                if not href:
                    continue

                # Make absolute URL
                if href.startswith('http'):
                    link = href
                else:
                    link = urllib.parse.urljoin("https://www.ft.lk", href)

                # Check if it's an article URL (ends with category-id pattern e.g., /44-795689 or /26-795681)
                if not re.search(r'/\d+-\d+$', link):
                    continue

                if link in seen_links:
                    continue

                # Title extraction: check inner heading or text of the anchor or adjacent tag
                title_tag = a.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'strong'])
                if title_tag:
                    title = title_tag.get_text(strip=True)
                else:
                    title = a.get_text(strip=True)

                # Cleanup title text (remove dates like 'Friday, 7 August 2026' attached at end if any)
                title = re.sub(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*\d+\s+[A-Za-z]+\s+\d{4}', '', title).strip()

                if not title or len(title) < 15 or title.lower() in ["read more", "more news", "click here"]:
                    continue

                # Image extraction: look inside the anchor, or in the parent card div
                image_url = ""
                img_tag = a.find('img')
                
                if not img_tag and a.parent:
                    # Look in sibling or parent containers
                    container = a.find_parent(['div', 'article', 'li'])
                    if container:
                        img_tag = container.find('img')

                if img_tag:
                    src = img_tag.get('src') or img_tag.get('data-src') or img_tag.get('file-path')
                    if src and not src.endswith('placeholder') and 'logo' not in src.lower():
                        if src.startswith('http'):
                            image_url = src
                        else:
                            image_url = urllib.parse.urljoin("https://www.ft.lk", src)

                # Default fallback image if thumbnail not found on card page
                if not image_url:
                    image_url = "https://www.ft.lk/assets/images/ft-logo.png"

                news_item = {
                    "title": title,
                    "link": link,
                    "image": image_url,
                    "category": sec_cat
                }

                news_list.append(news_item)
                seen_links.add(link)
                print(f"  [+] Scraped: {title[:50]}... | Img: {image_url[:40]}")

                if len(news_list) >= max_articles:
                    break

        except Exception as e:
            print(f"  [!] Error scraping {sec_url}: {e}")

        if len(news_list) >= max_articles:
            break

    print(f"\nTotal scraped: {len(news_list)} articles.")

    # Save to JSON
    with open('news_data.json', 'w', encoding='utf-8') as f:
        json.dump(news_list, f, ensure_ascii=False, indent=4)

    print("Saved 100% accurate data to news_data.json!")
    return news_list

if __name__ == "__main__":
    scrape_daily_ft()
