import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
import re
import sys
import random
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# List of Realistic User-Agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0"
]

def make_smart_session(proxy_url=None):
    """Creates a robust session with retry, proxy support, and user-agent rotation."""
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        raise_on_status=False
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    if proxy_url:
        session.proxies = {
            "http": proxy_url,
            "https": proxy_url
        }
    return session

def fetch_full_article(article_url, session=None, proxy_url=None):
    if not session:
        session = make_smart_session(proxy_url)

    headers = {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.ft.lk/"
    }

    try:
        resp = session.get(article_url, headers=headers, timeout=15)
        if resp.status_code != 200:
            return {"error": f"HTTP {resp.status_code}", "summary": "", "full_text": ""}

        soup = BeautifulSoup(resp.content, 'html.parser')

        # Extract og:image
        og_img = soup.find('meta', property='og:image')
        image_url = og_img['content'].strip() if (og_img and og_img.get('content')) else ""

        # Extract Paragraphs
        paragraphs = []
        # FT.lk article body container search
        body_container = soup.find('div', class_=re.compile(r'content|article|details|entry|col-md-8', re.I))
        if body_container:
            p_tags = body_container.find_all('p')
        else:
            p_tags = soup.find_all('p')

        for p in p_tags:
            txt = p.get_text(strip=True)
            # Filter out non-article boilerplate
            if len(txt) > 35 and not txt.startswith(('Copyright', 'Follow us', 'FT.LK', 'Daily FT')):
                paragraphs.append(txt)

        full_text = "\n\n".join(paragraphs)
        summary = paragraphs[0] if paragraphs else ""

        return {
            "image": image_url,
            "summary": summary,
            "full_text": full_text,
            "paragraph_count": len(paragraphs)
        }

    except Exception as e:
        return {"error": str(e), "summary": "", "full_text": ""}

if __name__ == "__main__":
    test_url = "https://www.ft.lk/front-page/Hela-Apparel-Board-declares-insolvency-seeks-Court-ordered-winding-up/44-795689"
    print(f"Fetching full article details from:\n{test_url}\n")
    res = fetch_full_article(test_url)
    
    print("--- SCRAPING RESULT ---")
    print(f"Image: {res.get('image')}")
    print(f"Paragraph Count: {res.get('paragraph_count')}")
    print(f"\nSummary:\n{res.get('summary')}\n")
    print(f"Full Text Snippet (First 400 chars):\n{res.get('full_text', '')[:400]}...")
