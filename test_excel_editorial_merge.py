import unittest

from excel_sync import merge_news_records


class EditorialMergeTests(unittest.TestCase):
    def test_fresh_scrape_does_not_erase_existing_ai_draft(self):
        old = {
            "id": "story-1",
            "url": "https://example.com/story-1",
            "title": "Original title",
            "summary": "Earlier source summary",
            "ai_enriched": True,
            "editorial_headline": "Reviewed AI draft headline",
            "editorial_summary": "Reviewed AI summary",
            "editorial_content": "Reviewed AI content",
            "prompt_version": "fact-preserving-editorial-v1",
            "rewrite_status": "ready_for_review",
            "workflow_status": "pending_review",
        }
        incoming = {
            "id": "story-1",
            "url": "https://example.com/story-1",
            "title": "Original title",
            "summary": "A longer and fresher publisher summary",
            "ai_enriched": False,
            "editorial_headline": "Raw fallback should not replace the draft",
            "workflow_status": "scraped",
        }

        merged = merge_news_records([old], [incoming])[0]

        self.assertEqual(merged["summary"], "A longer and fresher publisher summary")
        self.assertEqual(merged["editorial_headline"], "Reviewed AI draft headline")
        self.assertEqual(merged["workflow_status"], "pending_review")
        self.assertTrue(merged["ai_enriched"])

    def test_fresh_canonical_check_clears_poisoned_historical_image(self):
        old = {
            "id": "island-story",
            "url": "https://island.lk/example-story",
            "source_image": "https://s.w.org/images/core/emoji/15.0.3/72x72/270d.png",
            "image": "assets/news_images/emoji.png",
            "local_image_path": "assets/news_images/emoji.png",
        }
        incoming = {
            "id": "island-story",
            "url": "https://island.lk/example-story",
            "source_image": "",
            "image": "",
            "local_image_path": "",
            "source_image_checked": True,
        }

        merged = merge_news_records([old], [incoming])[0]

        self.assertEqual(merged["source_image"], "")
        self.assertEqual(merged["image"], "")
        self.assertEqual(merged["local_image_path"], "")


if __name__ == "__main__":
    unittest.main()
