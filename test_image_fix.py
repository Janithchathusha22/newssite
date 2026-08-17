import requests
from bs4 import BeautifulSoup
import json
import re
import urllib.parse
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

url = "https://www.ft.lk/front-page/44"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')

containers = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)
print(f"Found {len(containers)} containers")

count = 0
for c in containers:
    link_tag = None
    for a in c.find_all('a', href=True):
        href = a['href'].strip()
        if re.search(r'/\d+-\d+$', href):
            link_tag = a
            break
            
    if not link_tag:
        continue
        
    href = link_tag['href'].strip()
    full_url = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)
    
    h_tag = c.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    title = h_tag.get_text(strip=True) if h_tag else link_tag.get_text(strip=True)
    title = re.sub(r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*\d+.*$', '', title, flags=re.I).strip()
    
    # Image search strategy:
    # 1. Search inside container for any img tag
    # 2. Search in parent row/div if not found inside container
    img_tag = None
    for img in c.find_all('img'):
        src = img.get('src') or img.get('data-src')
        if src and ('uploads' in src or 'cdn' in src or 'oraclecloud' in src or src.endswith(('.jpg','.jpeg','.png','.webp'))):
            img_tag = img
            break
            
    if not img_tag and c.parent:
        for img in c.parent.find_all('img'):
            src = img.get('src') or img.get('data-src')
            if src and ('uploads' in src or 'cdn' in src or 'oraclecloud' in src):
                img_tag = img
                break
                
    image_url = ""
    if img_tag:
        src = img_tag.get('src') or img_tag.get('data-src')
        image_url = src if src.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", src)
    else:
        image_url = "https://via.placeholder.com/600x400?text=Daily+FT"
        
    print(f"Title: {title[:50]}")
    print(f"  Img: {image_url[:70]}")
    count += 1
    if count >= 6:
        break
