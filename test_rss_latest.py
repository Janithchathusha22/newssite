import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import re
from datetime import datetime

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
}

url = "https://news.google.com/rss/search?q=site:ft.lk+when:7d&hl=en-US&gl=US&ceid=US:en"
r = requests.get(url, headers=headers, timeout=15)
print("Status:", r.status_code)
if r.status_code == 200:
    root = ET.fromstring(r.text)
    items = root.findall('./channel/item')
    print(f"Found {len(items)} recent Daily FT news items from past 7 days!")
    
    scraped_articles = []
    for item in items[:15]:
        title = item.find('title').text
        # Clean title (removes ' - Daily FT')
        clean_title = re.sub(r'\s*-\s*Daily FT.*$', '', title, flags=re.IGNORECASE)
        link = item.find('link').text
        pub_date = item.find('pubDate').text
        desc_html = item.find('description').text if item.find('description') is not None else ""
        
        desc_soup = BeautifulSoup(desc_html, 'html.parser')
        summary = desc_soup.get_text(strip=True)
        
        scraped_articles.append({
            "raw_title": clean_title,
            "url": link,
            "image": "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=800&q=80",
            "raw_summary": summary,
            "category": "business_news",
            "source": "Daily FT (ft.lk)",
            "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        print(f"-> Title: {clean_title}")
        print(f"   Date: {pub_date}")

