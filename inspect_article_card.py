import requests
from bs4 import BeautifulSoup

url = "https://www.ft.lk/front-page/44"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers)
soup = BeautifulSoup(r.text, 'html.parser')

# Find an article link and print its container HTML
links = soup.find_all('a', href=True)
for a in links:
    href = a['href']
    if '/44-' in href or '/42-' in href or '/14-' in href:
        print("FOUND LINK:", href)
        # Parent container
        parent = a.parent
        for idx in range(3):
            if parent:
                print(f"--- Parent Level {idx+1} ({parent.name}, class={parent.get('class')}) ---")
                print("HTML:", str(parent)[:500])
                imgs = parent.find_all('img')
                if imgs:
                    for img in imgs:
                        print("  IMG tag:", img.attrs)
                parent = parent.parent
        break
