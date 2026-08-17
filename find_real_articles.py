import requests
from bs4 import BeautifulSoup
import re

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.google.com/"
}

session = requests.Session()

urls = [
    "https://www.ft.lk/",
    "https://www.ft.lk/front-page/44",
    "https://www.ft.lk/business/13",
    "https://www.ft.lk/financial-services/42"
]

target_keywords = ["probe", "Treasury", "Physio", "ExpoScaleUp", "Asia Asset", "South Asia"]

for url in urls:
    print(f"\n--- Checking {url} ---")
    try:
        res = session.get(url, headers=headers, timeout=20)
        print("Status:", res.status_code)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            # Search for any tag containing target keywords or newschs
            links = soup.find_all('a', href=True)
            for l in links:
                t = l.get_text(strip=True)
                if any(k.lower() in t.lower() for k in target_keywords) or len(t) > 25:
                    if "/44-" in l['href'] or "/13-" in l['href'] or "/42-" in l['href'] or "/34-" in l['href'] or "/14-" in l['href']:
                        print(f" MATCH: {t}")
                        print(f"   URL: {l['href']}")
    except Exception as e:
        print("Fetch Error:", e)

