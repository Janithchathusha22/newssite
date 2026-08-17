import asyncio
import zendriver as zd
from bs4 import BeautifulSoup
import json
import re
import urllib.parse
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DEFAULT_LOGO = "https://bmkltsly13vb.compat.objectstorage.ap-mumbai-1.oraclecloud.com/cdn.ft.lk/ftlk_logo_og.png"

async def main():
    print("[*] Starting ZenDriver Full Scraper Test...")
    browser = await zd.start(headless=True)
    try:
        # Step 1: Open section page
        page = await browser.get("https://www.ft.lk/financial-services/42")
        await asyncio.sleep(4)
        soup = BeautifulSoup(await page.get_content(), 'html.parser')
        
        # Step 2: Map grid thumbnail images to article links
        grid_map = {}
        for col in soup.find_all('div', class_=re.compile(r'col-md-', re.I)):
            a_tag = col.find('a', href=True)
            if not a_tag:
                continue
            href = a_tag['href'].strip()
            if not re.search(r'/\d+-\d+$', href):
                continue
                
            full_url = href if href.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", href)
            img_tag = col.find('img')
            if img_tag:
                src = img_tag.get('src') or img_tag.get('data-src') or ''
                if src and ('uploads' in src or 'cdn' in src or 'oraclecloud' in src or src.endswith(('.jpg', '.jpeg', '.png', '.webp'))):
                    img_url = src if src.startswith('http') else urllib.parse.urljoin("https://www.ft.lk", src)
                    grid_map[full_url] = img_url

        print(f"[+] Found {len(grid_map)} thumbnail images on Financial Services section page!\n")
        for url, img in list(grid_map.items())[:5]:
            print(f"  URL: {url[:70]}")
            print(f"  IMG: {img[:80]}\n")

    finally:
        await browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
