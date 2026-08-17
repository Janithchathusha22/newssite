import json

data = json.load(open('news_feed.json', 'r', encoding='utf-8'))
unsplash = [d for d in data if 'unsplash' in d.get('image', '')]
real = [d for d in data if 'oraclecloud' in d.get('image', '') or 'cdn.ft.lk' in d.get('image', '')]

print(f"Total articles: {len(data)}")
print(f"Unsplash FAKE: {len(unsplash)}")
print(f"Real ft.lk CDN images: {len(real)}")
print(f"Other: {len(data) - len(unsplash) - len(real)}")
print()
print("First 5 articles + images:")
for d in data[:5]:
    print(f"  Title: {d['headline_en'][:50]}")
    print(f"  Image: {d['image'][:70]}")
    print()
