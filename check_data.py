import json

d = json.load(open('news_feed.json', 'r', encoding='utf-8'))
print(f"Articles: {len(d)}")
if d:
    first = d[0]
    print(f"First has url: {bool(first.get('url'))}")
    print(f"First full_text length: {len(first.get('full_text', ''))}")
    print(f"First title: {first.get('headline_en', '')[:60]}")
    print(f"First image: {first.get('image', '')[:60]}")
