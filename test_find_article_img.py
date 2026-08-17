import asyncio
import zendriver as zd
from bs4 import BeautifulSoup
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

async def main():
    browser = await zd.start(headless=True)
    try:
        url = "https://www.ft.lk/front-page/Hela-Apparel-Board-declares-insolvency-seeks-Court-ordered-winding-up/44-795689"
        page = await browser.get(url)
        await asyncio.sleep(3)
        soup = BeautifulSoup(await page.get_content(), 'html.parser')
        
        print("--- ALL IMAGES IN ARTICLE PAGE ---")
        imgs = soup.find_all('img')
        for idx, img in enumerate(imgs, 1):
            src = img.get('src') or img.get('data-src') or ''
            print(f"  [{idx}] {src}")
            
        print("\n--- ALL META TAGS ---")
        for meta in soup.find_all('meta'):
            if 'image' in str(meta).lower() or 'og:' in str(meta).lower():
                print(f"  META: {meta}")

    finally:
        await browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
