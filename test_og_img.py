import requests
from bs4 import BeautifulSoup
import re

def fetch_og_image(article_url):
    if not article_url or not article_url.startswith("http"):
        return ""
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    
    try:
        r = requests.get(article_url, headers=headers, timeout=8, allow_redirects=True)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            # Try og:image meta tag
            og_img = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
            if og_img and og_img.get("content"):
                img_url = og_img["content"].strip()
                if img_url.startswith("http"):
                    return img_url
            
            # Try twitter:image
            tw_img = soup.find("meta", property="twitter:image") or soup.find("meta", attrs={"name": "twitter:image"})
            if tw_img and tw_img.get("content"):
                img_url = tw_img["content"].strip()
                if img_url.startswith("http"):
                    return img_url
                    
            # Try main article image tag
            art_img = soup.find("article") or soup.find("div", class_=re.compile(r"content|post|entry|article", re.I))
            if art_img:
                img_tag = art_img.find("img", src=re.compile(r"^http"))
                if img_tag:
                    return img_tag["src"]
    except Exception as e:
        print(f"[!] og:image fetch error for {article_url[:50]}: {e}")
        
    return ""

if __name__ == "__main__":
    test_urls = [
        "https://economynext.com/",
        "https://www.lankabusinessonline.com/",
    ]
    for u in test_urls:
        print(u, "->", fetch_og_image(u))
