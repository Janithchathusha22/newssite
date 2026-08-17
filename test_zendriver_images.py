import asyncio
import zendriver as zd
from bs4 import BeautifulSoup
import json
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

async def main():
    print("[*] Launching ZenDriver for Full Article + Image extraction...")
    browser = await zd.start(headless=True)
    try:
        # Step 1: Get front page
        page = await browser.get("https://www.ft.lk/front-page/44")
        await asyncio.sleep(3)
        soup = BeautifulSoup(await page.get_content(), 'html.parser')
        
        # Collect article URLs
        urls = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            if re.search(r'/\d+-\d+$', href) and href not in urls:
                urls.append(href if href.startswith('http') else f"https://www.ft.lk{href}")
                
        print(f"[+] Found {len(urls)} article URLs on Front Page!")
        
        # Step 2: Visit top 3 articles using ZenDriver
        for idx, url in enumerate(urls[:3], 1):
            print(f"\n--- [{idx}] Fetching Article: {url} ---")
            article_page = await browser.get(url)
            await asyncio.sleep(2)
            art_soup = BeautifulSoup(await article_page.get_content(), 'html.parser')
            
            # Title
            h1 = art_soup.find('h1') or art_soup.find('h2')
            title = h1.get_text(strip=True) if h1 else "N/A"
            
            # Image (og:image meta tag)
            og_img = art_soup.find('meta', property='og:image')
            img_url = og_img['content'] if og_img and og_img.get('content') else "NO_IMAGE"
            
            # Paragraphs
            paragraphs = [p.get_text(strip=True) for p in art_soup.find_all('p') 
                          if len(p.get_text(strip=True)) > 40 and not p.get_text(strip=True).startswith(('Copyright', 'Daily FT', 'Follow us'))]
            
            print(f"Title: {title}")
            print(f"Image URL: {img_url}")
            print(f"Paragraphs count: {len(paragraphs)}")
            if paragraphs:
                print(f"P1: {paragraphs[0][:120]}...")

    finally:
        await browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
