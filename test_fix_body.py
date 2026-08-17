import cloudscraper
from bs4 import BeautifulSoup
import re

url = "https://www.ft.lk/front-page/Hemas-sustains-1Q-revenue-but-earnings-dip/44-795686"
scraper = cloudscraper.create_scraper()
resp = scraper.get(url, timeout=15)
soup = BeautifulSoup(resp.content, 'html.parser')

print("--- TESTING BODY EXTRACTION ---")
# 1. Check all div elements that contain article body text
divs = soup.find_all('div', class_=re.compile(r'col-md-8|content|article|details', re.I))
print(f"Found {len(divs)} candidate divs")

all_p = []
for div in divs:
    for p in div.find_all(['p', 'span', 'div']):
        txt = p.get_text(strip=True)
        if len(txt) > 80 and not txt.startswith(('Copyright', 'Daily FT', 'Follow us', '+94')) and txt not in all_p:
            all_p.append(txt)

print(f"Extracted {len(all_p)} text blocks!")
for idx, txt in enumerate(all_p[:3], 1):
    print(f"  [{idx}] {txt[:150]}...\n")
