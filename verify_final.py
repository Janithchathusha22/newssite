import json

data = json.load(open('news_feed.json', 'r', encoding='utf-8'))
print(f"Total articles: {len(data)}")

has_real_img = [d for d in data if 'oraclecloud' in d.get('image', '') or 'cdn' in d.get('image', '')]
print(f"Articles with 100% Real Oracle CDN photos: {len(has_real_img)}/{len(data)}")

print("\nFirst 5 articles + Images:")
for d in data[:5]:
    print(f"  [{d['category']}] {d['headline_en'][:45]}")
    print(f"   Image: {d['image'][:75]}")
    print(f"   URL: {d['url'][:70]}")
    print()
