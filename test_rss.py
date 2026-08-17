import requests

feeds = [
    'https://www.ft.lk/rss/feed/latest',
    'https://www.ft.lk/rss/feed/financial-services',
    'https://www.ft.lk/rss/feed/business',
    'https://www.ft.lk/rss/feed/front-page',
    'https://www.ft.lk/rss/feed/opinion-and-issues',
]
headers = {'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader/1.0)'}
for f in feeds:
    try:
        r = requests.get(f, headers=headers, timeout=15)
        has_xml = 'rss' in r.text[:500].lower() or 'feed' in r.text[:500].lower() or 'item' in r.text[:500].lower()
        print(f'{r.status_code} | {has_xml} | {len(r.text)} bytes | {f}')
        if has_xml:
            print('  FIRST 200:', r.text[:200])
    except Exception as e:
        print(f'FAIL | {f} | {e}')
