import requests
from bs4 import BeautifulSoup
import xml.etree.ElementTree as ET
import cloudscraper

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

print("--- Test 1: Direct FT.lk Home Page with CloudScraper ---")
try:
    scraper = cloudscraper.create_scraper()
    res = scraper.get("https://www.ft.lk/", headers=headers, timeout=15)
    print("Status:", res.status_code, "Length:", len(res.text))
    if res.status_code == 200:
        soup = BeautifulSoup(res.content, 'html.parser')
        # Look for <h3 class="newschs"> or <a> tags with href containing /business/ or /opinion/
        links = soup.find_all('a', href=True)
        count = 0
        for l in links:
            h3 = l.find('h3') or l.find('h2') or l.find('h4')
            title = h3.get_text(strip=True) if h3 else l.get_text(strip=True)
            if len(title) > 20 and ('/business/' in l['href'] or '/front-page/' in l['href'] or '/financial-services/' in l['href'] or '/opinion-and-issues/' in l['href']):
                print(f"Found: {title} -> {l['href']}")
                count += 1
                if count >= 5:
                    break
except Exception as e:
    print("Test 1 Failed:", e)

print("\n--- Test 2: Google News RSS for site:ft.lk ---")
try:
    rss_url = "https://news.google.com/rss/search?q=site:ft.lk&hl=en-US&gl=US&ceid=US:en"
    r = requests.get(rss_url, headers=headers, timeout=15)
    print("Google News RSS Status:", r.status_code)
    if r.status_code == 200:
        root = ET.fromstring(r.text)
        items = root.findall('./channel/item')
        print(f"Found {len(items)} items in Google News RSS for Daily FT!")
        for item in items[:5]:
            t = item.find('title').text
            l = item.find('link').text
            pub = item.find('pubDate').text
            print(f"RSS Item: {t} | Date: {pub}")
except Exception as e:
    print("Test 2 Failed:", e)
