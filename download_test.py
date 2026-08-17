import cloudscraper
scraper = cloudscraper.create_scraper()
response = scraper.get("https://www.ft.lk/financial-services/42", timeout=30)
with open("test_page.html", "w", encoding="utf-8") as f:
    f.write(response.text)
print("Saved to test_page.html")
