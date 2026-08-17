import requests
import json
import urllib.parse

url = "https://www.ft.lk/financial-services/42"
proxy_url = f"https://api.allorigins.win/get?url={urllib.parse.quote(url)}"

try:
    response = requests.get(proxy_url, timeout=15)
    if response.status_code == 200:
        data = response.json()
        print("Success! Content length:", len(data['contents']))
        print(data['contents'][:200])
    else:
        print("Failed:", response.status_code)
except Exception as e:
    print("Error:", e)
