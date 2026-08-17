import cloudscraper
from bs4 import BeautifulSoup
import re

url = "https://www.ft.lk/front-page/Hemas-sustains-1Q-revenue-but-earnings-dip/44-795686"
scraper = cloudscraper.create_scraper()
r = scraper.get(url, timeout=15)
soup = BeautifulSoup(r.text, 'html.parser')

print("--- ALL P TAGS IN PAGE ---")
p_tags = soup.find_all('p')
print(f"Total <p> tags: {len(p_tags)}")

paragraphs = []
for idx, p in enumerate(p_tags, 1):
    txt = p.get_text(strip=True)
    if len(txt) > 50 and not txt.startswith(('Copyright', 'Daily FT', 'Follow us', '+94')):
        paragraphs.append(txt)
        print(f"  P[{idx}]: {txt[:120]}...\n")

print(f"Clean Body Paragraphs: {len(paragraphs)}")
