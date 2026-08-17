import asyncio
import zendriver as zd
from bs4 import BeautifulSoup
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

async def main():
    print("[*] Launching ZenDriver Browser...")
    browser = await zd.start(headless=True)
    try:
        url = "https://www.ft.lk/front-page/44"
        print(f"[*] Navigating to {url}...")
        page = await browser.get(url)
        await asyncio.sleep(4) # Allow page and cloudflare/JS to load completely
        
        content = await page.get_content()
        soup = BeautifulSoup(content, 'html.parser')
        
        print(f"[+] Page title: {soup.title.string if soup.title else 'N/A'}")
        
        # Check articles and images
        articles = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            if '/44-' in href or '/26-' in href or '/42-' in href or '/27-' in href:
                img = a.find('img')
                img_src = img['src'] if img and img.get('src') else ''
                txt = a.get_text(strip=True)
                if len(txt) > 20:
                    articles.append({"title": txt, "url": href, "img": img_src})
                    
        print(f"[+] Found {len(articles)} articles!")
        for idx, art in enumerate(articles[:5], 1):
            print(f"  [{idx}] {art['title'][:40]} | Img: {art['img'][:50]}")
            
    finally:
        await browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
