import requests
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup

SOURCES = {
    "Lanka Business Online": "https://www.lankabusinessonline.com/feed/",
    "Daily FT Business":     "https://www.ft.lk/rss/business",
    "EconomyNext":           "https://economynext.com/feed/",
    "Daily Mirror Biz":      "https://www.dailymirror.lk/rss",
    "Ada Derana Biz":        "http://biz.adaderana.lk/feed/",
    "CBSL":                  "https://www.cbsl.gov.lk/en/rss-feeds",
    "Google RSS FT":         "https://news.google.com/rss/search?q=site:ft.lk+business+finance&hl=en-US&gl=US&ceid=US:en",
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

for name, url in SOURCES.items():
    try:
        r = requests.get(url, headers=headers, timeout=15)
        text = r.text[:1000]
        is_rss = any(tag in text.lower() for tag in ['<rss', '<feed', '<item>', '<entry>'])
        
        # Try parsing
        articles = 0
        sample_title = ""
        sample_img = ""
        if is_rss:
            try:
                ns = {'media': 'http://search.yahoo.com/mrss/', 'content': 'http://purl.org/rss/1.0/modules/content/'}
                root = ET.fromstring(r.text)
                items = root.findall('./channel/item') or root.findall('{http://www.w3.org/2005/Atom}entry')
                articles = len(items)
                if items:
                    t = items[0].find('title')
                    sample_title = (t.text or '')[:60] if t is not None else ''
                    # Check for image in enclosure or media:content
                    enc = items[0].find('enclosure')
                    med = items[0].find('media:content', ns)
                    sample_img = (enc.get('url','') if enc is not None else '') or (med.get('url','') if med is not None else '')
            except: pass
        
        print(f"[{'OK ' if is_rss else 'HTML'}] {name}")
        print(f"       Status:{r.status_code} | Articles:{articles} | ImgInFeed:{'YES' if sample_img else 'NO'}")
        if sample_title: print(f"       Sample: {sample_title}")
        if sample_img:   print(f"       Image:  {sample_img[:80]}")
        print()
    except Exception as e:
        print(f"[FAIL] {name}: {e}\n")
