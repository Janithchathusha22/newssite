import requests
from bs4 import BeautifulSoup
import json

url = "https://www.ft.lk/top-story/26"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')

# Find article containers. On FT.lk, each article card is in a div with col-md-...
containers = soup.find_all('div', class_=lambda c: c and 'col-md-' in c)
print(f"Found {len(containers)} col-md containers")

extracted = []
for c in containers:
    # Check if this container has a headline link
    title_a = None
    for a in c.find_all('a', href=True):
        txt = a.get_text(strip=True)
        # Check if text length is reasonable and URL has article format
        if len(txt) > 20 and ('/26-' in a['href'] or '/44-' in a['href'] or '/42-' in a['href'] or '/14-' in a['href'] or '/4-' in a['href'] or '/13-' in a['href']):
            title_a = a
            break
    
    if title_a:
        title = title_a.get_text(strip=True)
        href = title_a['href']
        if not href.startswith('http'):
            href = "https://www.ft.lk" + href
            
        # Find image in the container (or sub-container/parent container)
        img = c.find('img')
        img_url = ""
        if img:
            src = img.get('src') or img.get('data-src')
            if src:
                img_url = src if src.startswith('http') else "https://www.ft.lk" + src

        extracted.append({
            "title": title,
            "link": href,
            "image": img_url
        })

print(f"Extracted {len(extracted)} articles with images!")
for item in extracted[:8]:
    print(f"Title: {item['title'][:50]}")
    print(f"Link:  {item['link']}")
    print(f"Image: {item['image']}")
    print("-" * 50)
