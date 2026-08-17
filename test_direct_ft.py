import requests
from bs4 import BeautifulSoup
import cloudscraper

print("=== Test 1: Requests with Chrome 125 headers ===")
headers1 = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/"
}

urls = [
    "https://www.ft.lk/",
    "https://www.ft.lk/business/13",
    "https://www.ft.lk/front-page/44"
]

for url in urls:
    print(f"\nFetching {url}...")
    try:
        session = requests.Session()
        res = session.get(url, headers=headers1, timeout=10)
        print("Status:", res.status_code, "Length:", len(res.text))
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            # Extract headlines
            links = soup.find_all('a', href=True)
            titles = []
            for l in links:
                t_el = l.find(['h1','h2','h3','h4','h5','span','p']) or l
                t = t_el.get_text(strip=True)
                if len(t) > 20 and len(t) < 150 and not t.startswith("Home") and not "javascript" in l['href']:
                    if t not in titles:
                        titles.append(t)
            print(f"Scraped {len(titles)} titles!")
            for t in titles[:5]:
                print(" ->", t)
    except Exception as e:
        print("Error:", e)

