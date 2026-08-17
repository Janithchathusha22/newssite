"""Quick test: Scrape 3 articles to verify fit_lk.py works."""
import sys
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from fit_lk import FTScraper

print("=" * 60)
print("  TEST: fit_lk.py Scraper — 3 article test run")
print("=" * 60)

scraper = FTScraper(
    download_images=False,
    delay=2.0,
    use_playwright=True,
)

try:
    articles = scraper.scrape_all(max_articles=3)

    if articles:
        print(f"\n✅ SUCCESS: {len(articles)} articles scraped\n")
        for i, art in enumerate(articles, 1):
            print(f"  {i}. {art.get('title', '?')[:60]}")
            print(f"     Image  : {art.get('image', 'NONE')[:70]}")
            print(f"     Content: {art.get('content_length', 0):,} chars")
            print(f"     Category: {art.get('category', '?')}")
            print()

        # Verify image stats
        with_images = sum(1 for a in articles if a.get('main_image_url'))
        print(f"  📷 Articles with images: {with_images}/{len(articles)}")

        # Save test output
        scraper.save_json("test_ft_output.json")
        print(f"  💾 Test output saved to test_ft_output.json")
    else:
        print("❌ FAILED: No articles scraped")

finally:
    scraper.close()
