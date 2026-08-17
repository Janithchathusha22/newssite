import requests
from bs4 import BeautifulSoup
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

url = "https://www.ft.lk/front-page/Hela-Apparel-Board-declares-insolvency-seeks-Court-ordered-winding-up/44-795689"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers, timeout=12)
if r.status_code == 200:
    soup = BeautifulSoup(r.text, 'html.parser')
    
    # Let's find all paragraph tags or main article container
    print("--- PAGE TITLE ---")
    h1 = soup.find('h1') or soup.find('h2', class_=re.compile(r'header|title|main', re.I))
    print(h1.get_text(strip=True) if h1 else "No main heading")

    print("\n--- OG IMAGE ---")
    og = soup.find('meta', property='og:image')
    print(og['content'] if og else "No og:image")

    print("\n--- PARAGRAPHS EXTRACTED ---")
    # In FT.lk, article body is usually inside div class="main-content" or div class="col-md-8" or direct <p> tags
    # Let's find containers with multiple <p> tags
    paragraphs = []
    
    # Try finding container
    container = soup.find('div', class_=re.compile(r'content|article|details|entry|col-md-8', re.I))
    if container:
        for p in container.find_all('p'):
            txt = p.get_text(strip=True)
            if len(txt) > 30 and not txt.startswith('Copyright') and not 'Follow us' in txt:
                paragraphs.append(txt)
    
    if not paragraphs:
        for p in soup.find_all('p'):
            txt = p.get_text(strip=True)
            if len(txt) > 40 and not txt.startswith('Copyright') and not 'Follow us' in txt:
                paragraphs.append(txt)

    print(f"Total Paragraphs: {len(paragraphs)}")
    for idx, p in enumerate(paragraphs[:5], 1):
        print(f"P{idx}: {p}\n")
