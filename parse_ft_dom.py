import requests
from bs4 import BeautifulSoup
import json

url = "https://www.ft.lk/business/13"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Referer": "https://www.google.com/"
}

session = requests.Session()
res = session.get(url, headers=headers, timeout=12)
print("Status:", res.status_code)

if res.status_code == 200:
    soup = BeautifulSoup(res.text, 'html.parser')
    
    # Let's inspect all h3, h2, h1 with links
    articles = []
    
    # 1. Look for h3.newschs or any h1,h2,h3 with <a> inside or parent <a>
    headers_tags = soup.find_all(['h1', 'h2', 'h3', 'h4'], class_=lambda c: c and 'newschs' in c) if soup.find_all(['h1', 'h2', 'h3', 'h4'], class_=lambda c: c and 'newschs' in c) else soup.find_all(['h1', 'h2', 'h3', 'h4'])
    
    print(f"Found {len(headers_tags)} header tags!")
    
    for tag in headers_tags:
        title = tag.get_text(strip=True)
        # find link
        link_tag = tag.find('a', href=True) or tag.find_parent('a', href=True)
        if not link_tag and tag.parent:
            link_tag = tag.parent.find('a', href=True)
            
        if link_tag and len(title) > 20:
            href = link_tag['href']
            full_url = href if href.startswith('http') else f"https://www.ft.lk{href}"
            
            # Find closest parent container to find img and paragraph
            parent_container = tag.find_parent(['div', 'article'])
            img_url = ""
            summary = ""
            if parent_container:
                img_tag = parent_container.find('img', src=True)
                if img_tag:
                    src = img_tag['src']
                    img_url = src if src.startswith('http') else f"https://www.ft.lk{src}"
                p_tag = parent_container.find('p')
                if p_tag:
                    summary = p_tag.get_text(strip=True)
                    
            articles.append({
                "title": title,
                "url": full_url,
                "image": img_url,
                "summary": summary
            })
            
    print(f"Extracted {len(articles)} articles from ft.lk/business/13:")
    for a in articles[:10]:
        print(f"\nTitle: {a['title']}")
        print(f"URL: {a['url']}")
        print(f"Img: {a['image']}")
        print(f"Summary: {a['summary'][:80]}...")
