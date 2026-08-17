import requests
from bs4 import BeautifulSoup
import json

data = json.load(open('newssite/news_feed.json', 'r', encoding='utf-8'))
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

for item in data[:3]:
    url = item['url']
    print(f"Testing URL: {url}")
    r = requests.get(url, headers=headers, timeout=10)
    print("Status:", r.status_code)
    if r.status_code == 200:
        soup = BeautifulSoup(r.text, 'html.parser')
        # Print all tags that contain text longer than 50 chars
        paragraphs = [p.get_text(strip=True) for p in soup.find_all(['p', 'div', 'span']) if len(p.get_text(strip=True)) > 80]
        print(f"Found {len(paragraphs)} text blocks > 80 chars!")
        for idx, p in enumerate(paragraphs[:3], 1):
            print(f"  [{idx}] {p[:120]}...")
    print("-" * 60)
