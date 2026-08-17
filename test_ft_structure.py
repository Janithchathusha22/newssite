import requests
from bs4 import BeautifulSoup
import json

urls = [
    "https://www.ft.lk/",
    "https://www.ft.lk/front-page/44",
    "https://www.ft.lk/financial-services/42",
    "https://www.ft.lk/opinion-and-issues/14",
    "https://www.ft.lk/business/26"
]

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
}

for url in urls:
    try:
        r = requests.get(url, headers=headers, timeout=10)
        print(f"URL: {url} -> Status: {r.status_code}, Length: {len(r.text)}")
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            # Let's find all links with text longer than 20 chars
            links = soup.find_all('a', href=True)
            found = 0
            for a in links:
                txt = a.get_text(strip=True)
                href = a['href']
                if len(txt) > 20 and ('/4-' in href or '/13-' in href or '/44-' in href or '/42-' in href or '/14-' in href or '/26-' in href or '/article/' in href or '/columns/' in href or '/front-page/' in href or '/financial-services/' in href or '/opinion-and-issues/' in href):
                    img = a.find('img') or (a.parent.find('img') if a.parent else None)
                    img_src = img.get('src') if img else None
                    print(f"  [+] Title: {txt[:60]}")
                    print(f"      Link: {href}")
                    print(f"      Img: {img_src}")
                    found += 1
                    if found >= 3:
                        break
    except Exception as e:
        print(f"Error for {url}: {e}")
