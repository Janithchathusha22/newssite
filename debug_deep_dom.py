"""
Deep inspect: understand exact DOM relationship between article link, title, and image on ft.lk
Uses retry + multiple section URLs for reliability
"""
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
import sys
import re

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

session = requests.Session()
retry = Retry(total=3, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])
session.mount("https://", HTTPAdapter(max_retries=retry))

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# Try multiple URLs
for url in ["https://www.ft.lk/financial-services/42", "https://www.ft.lk/corporate/27", "https://www.ft.lk/front-page/44"]:
    try:
        r = session.get(url, headers=headers, timeout=20)
        if r.status_code == 200:
            print(f"SUCCESS: Got {url} ({len(r.text)} bytes)\n")
            soup = BeautifulSoup(r.text, 'html.parser')
            break
    except Exception as e:
        print(f"TIMEOUT on {url}: {e}")
        continue
else:
    print("ALL URLs timed out!")
    sys.exit(1)

# ANALYSIS 1: Find all anchor tags that wrap images AND point to articles
print("="*80)
print("ANALYSIS 1: <a> tags wrapping <img> that point to articles")
print("="*80)
all_anchors = soup.find_all('a', href=True)
for a in all_anchors:
    href = a['href']
    if not re.search(r'/\d+-\d+$', href):
        continue
    img = a.find('img', recursive=True)
    if img:
        src = img.get('src', 'N/A')
        print(f"  LINK+IMG: ...{href[-60:]}")
        print(f"    img src: ...{src[-60:]}")
        print()

# ANALYSIS 2: Examine the col-md grid structure
print("\n" + "="*80)
print("ANALYSIS 2: Row-by-row col-md grid structure")
print("="*80)

rows = soup.find_all('div', class_='row')
examined = 0
for row in rows:
    links = [a for a in row.find_all('a', href=True, recursive=True) if re.search(r'/\d+-\d+$', a['href'])]
    if not links:
        continue
        
    cols = row.find_all('div', class_=lambda c: c and 'col-md-' in c, recursive=False)
    
    print(f"\n--- ROW (id={row.get('id')}, class={row.get('class')}) ---")
    print(f"    Direct col-md children: {len(cols)}")
    
    for i, col in enumerate(cols):
        col_cls = ' '.join(col.get('class', []))
        col_links = [a for a in col.find_all('a', href=True) if re.search(r'/\d+-\d+$', a['href'])]
        col_imgs = col.find_all('img')
        col_h = col.find_all(['h1','h2','h3','h4','h5','h6'])
        
        if not col_links and not col_imgs:
            continue
            
        print(f"\n    COL[{i}] class='{col_cls}'")
        for img in col_imgs:
            parent_a = img.find_parent('a')
            pa_href = parent_a['href'][-50:] if parent_a and parent_a.get('href') else 'NO parent <a>'
            print(f"      IMG: ...{img.get('src','?')[-50:]}  (parent_a: ...{pa_href})")
        for h in col_h:
            print(f"      {h.name}.{h.get('class')}: '{h.get_text(strip=True)[:50]}'")
        for a in col_links[:2]:
            print(f"      LINK: ...{a['href'][-50:]}")
    
    examined += 1
    if examined >= 5:
        break

# ANALYSIS 3: Check if img and heading are PAIRED inside same container
print("\n\n" + "="*80)
print("ANALYSIS 3: Each col-md-6 container - does it have BOTH link+img?")
print("="*80)

all_cols = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)
has_both = 0
has_link_only = 0
has_img_only = 0
for col in all_cols:
    col_links = [a for a in col.find_all('a', href=True) if re.search(r'/\d+-\d+$', a['href'])]
    col_imgs = [img for img in col.find_all('img') if img.get('src') and ('uploads' in img['src'] or 'cdn' in img['src'])]
    
    if col_links and col_imgs:
        has_both += 1
        # Check if the image's parent <a> points to same article as the heading link
        for img in col_imgs[:1]:
            pa = img.find_parent('a')
            for cl in col_links[:1]:
                same = pa and pa.get('href') == cl.get('href')
                print(f"  BOTH: link=...{cl['href'][-40:]}  img=...{img['src'][-40:]}  SAME_LINK={same}")
    elif col_links and not col_imgs:
        has_link_only += 1
    elif col_imgs and not col_links:
        has_img_only += 1

print(f"\nSummary: has_both={has_both}, link_only={has_link_only}, img_only={has_img_only}")

# ANALYSIS 4: Try og:image approach - fetch actual article page for image
print("\n\n" + "="*80)
print("ANALYSIS 4: Fetching og:image from individual article pages")
print("="*80)

article_urls = []
for a in soup.find_all('a', href=True):
    href = a['href']
    if re.search(r'/\d+-\d+$', href) and href.startswith('http'):
        if href not in article_urls:
            article_urls.append(href)
    if len(article_urls) >= 3:
        break

for art_url in article_urls:
    try:
        ar = session.get(art_url, headers=headers, timeout=10)
        if ar.status_code == 200:
            art_soup = BeautifulSoup(ar.text, 'html.parser')
            og_img = art_soup.find('meta', property='og:image')
            og_content = og_img['content'] if og_img and og_img.get('content') else 'NOT FOUND'
            print(f"  Article: ...{art_url[-50:]}")
            print(f"  og:image: {og_content}")
            print()
    except Exception as e:
        print(f"  TIMEOUT fetching {art_url[-40:]}: {e}")
