import cloudscraper
from bs4 import BeautifulSoup
import json
import re

url = "https://www.ft.lk/front-page/Hemas-sustains-1Q-revenue-but-earnings-dip/44-795686"
print(f"Testing CloudScraper for: {url}")

scraper = cloudscraper.create_scraper(
    browser={
        'browser': 'chrome',
        'platform': 'windows',
        'desktop': True
    }
)

try:
    resp = scraper.get(url, timeout=15)
    print("Status:", resp.status_code, "Length:", len(resp.text))
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.content, 'html.parser')
        
        # Extract title
        title = soup.find('h1') or soup.find('h2')
        print("\n[TITLE]:", title.get_text(strip=True) if title else "N/A")
        
        # Extract paragraphs
        paragraphs = []
        for p in soup.find_all('p'):
            t = p.get_text(strip=True)
            if len(t) > 30 and not t.startswith(('Copyright', 'Daily FT', 'Follow us')):
                paragraphs.append(t)
                
        print(f"\n[PARAGRAPHS FOUND]: {len(paragraphs)}")
        for idx, p in enumerate(paragraphs[:4], 1):
            print(f"  P{idx}: {p}\n")
except Exception as e:
        print("CloudScraper Error:", e)
