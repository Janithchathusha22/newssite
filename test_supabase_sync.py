"""Offline tests for supabase_sync.py (no test may contact real Supabase)."""

import hashlib
import os
import unittest
from unittest.mock import patch

from supabase_sync import normalize_news_record, sync_news_to_supabase


class FakeResponse:
    def __init__(self, status_code, text="", headers=None, payload=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {}
        self.payload = payload

    def json(self):
        if self.payload is None:
            raise ValueError("No JSON payload")
        return self.payload


class FakeSession:
    def __init__(self, *, schema_status=200, post_responses=None):
        self.schema_status = schema_status
        self.post_responses = list(post_responses or [FakeResponse(201)])
        self.get_calls = []
        self.post_calls = []

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        return FakeResponse(self.schema_status)

    def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        if not self.post_responses:
            raise AssertionError("Unexpected extra mocked POST")
        return self.post_responses.pop(0)


class EditorialFakeSession:
    """Route-aware fake covering the post-upsert editorial REST calls."""

    def __init__(self, article_row, *, version_response=None, patch_response=None):
        self.article_row = article_row
        self.version_response = version_response or FakeResponse(201)
        self.patch_response = patch_response or FakeResponse(
            200,
            payload=[
                {
                    "id": article_row["id"],
                    "current_version_id": "linked",
                }
            ],
        )
        self.get_calls = []
        self.post_calls = []
        self.patch_calls = []

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        if len(self.get_calls) == 1:
            return FakeResponse(200)  # full-schema detection
        return FakeResponse(200, payload=[dict(self.article_row)])

    def post(self, url, **kwargs):
        self.post_calls.append((url, kwargs))
        if url.endswith("/news_articles"):
            return FakeResponse(201)
        if url.endswith("/article_versions"):
            return self.version_response
        raise AssertionError(f"Unexpected POST endpoint: {url}")

    def patch(self, url, **kwargs):
        self.patch_calls.append((url, kwargs))
        return self.patch_response


class SupabaseSyncTests(unittest.TestCase):
    def test_normalizes_full_article_and_image_metadata(self):
        article = {
            "id": "publisher-42",
            "link": "HTTPS://Example.com/news/story/?utm_source=x&b=2&a=1#top",
            "title": "A title",
            "headline_si": "ශීර්ෂය",
            "summary": "Summary",
            "full_text": "Long content",
            "source": "Example News",
            "category": "Economy",
            "published_date": "2026-08-10T10:30:00+05:30",
            "source_image": "https://cdn.example.com/photo.jpg",
            "local_image_path": "downloaded_images\\Example\\photo.jpg",
            "image_details": {
                "width": 1200,
                "height": 630,
                "content_type": "image/jpeg",
                "size": 12345,
            },
            "tags": "Sri Lanka, Economy",
            "key_takeaways": ["One", "Two"],
        }

        normalized = normalize_news_record(
            article, scraped_at="2026-08-10T06:00:00Z"
        )

        self.assertEqual(
            normalized["canonical_url"],
            "https://example.com/news/story?a=1&b=2",
        )
        self.assertEqual(normalized["source_id"], "publisher-42")
        self.assertEqual(normalized["headline_si"], "ශීර්ෂය")
        self.assertEqual(normalized["content"], "Long content")
        self.assertEqual(normalized["image_url"], "https://cdn.example.com/photo.jpg")
        self.assertEqual(
            normalized["local_image_path"],
            "downloaded_images/Example/photo.jpg",
        )
        self.assertEqual(normalized["image_mime_type"], "image/jpeg")
        self.assertEqual(normalized["image_width"], 1200)
        self.assertEqual(normalized["image_bytes"], 12345)
        self.assertEqual(normalized["tags"], ["Sri Lanka", "Economy"])
        self.assertEqual(normalized["takeaways"], ["One", "Two"])
        self.assertEqual(normalized["published_at"], "2026-08-10T05:00:00Z")
        self.assertEqual(
            normalized["content_hash"],
            hashlib.sha256(
                "A title\nSummary\nLong content".encode("utf-8")
            ).hexdigest(),
        )

    def test_missing_configuration_is_a_safe_skip(self):
        fake = FakeSession()
        with patch.dict(os.environ, {"SUPABASE_SYNC_ENABLED": "true"}, clear=True):
            result = sync_news_to_supabase([], session=fake)

        self.assertEqual(result["status"], "skipped")
        self.assertFalse(result["configured"])
        self.assertIn("missing", result["reason"])
        self.assertEqual(fake.get_calls, [])
        self.assertEqual(fake.post_calls, [])

    def test_rejected_remote_image_also_invalidates_its_local_cache(self):
        normalized = normalize_news_record({
            "url": "https://island.lk/example-story",
            "title": "Example story",
            "source_image": "https://s.w.org/images/core/emoji/15.0.3/72x72/270d.png",
            "local_image_path": "assets/news_images/emoji.png",
            "source_image_checked": True,
        })

        self.assertIsNone(normalized["image_url"])
        self.assertIsNone(normalized["local_image_path"])
        self.assertEqual(normalized["image_status"], "missing")

    def test_local_image_path_cannot_escape_served_cache_roots(self):
        normalized = normalize_news_record({
            "url": "https://economynext.com/example-story",
            "title": "Example story",
            "local_image_path": "../credentials.json",
        })

        self.assertIsNone(normalized["local_image_path"])
        self.assertEqual(normalized["image_status"], "missing")

    def test_auto_detects_legacy_schema_and_upserts_by_slug_in_batches(self):
        fake = FakeSession(
            schema_status=400,
            post_responses=[FakeResponse(201), FakeResponse(201)],
        )
        records = [
            {
                "url": f"https://news.example.com/article-{index}?utm_source=test",
                "title": f"Article {index}",
                "summary": "Summary",
                "image_url": f"https://cdn.example.com/{index}.jpg",
            }
            for index in range(3)
        ]
        environment = {
            "SUPABASE_SYNC_ENABLED": "true",
            "NEXT_PUBLIC_SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test-only",
            "SUPABASE_BATCH_SIZE": "2",
            "SUPABASE_MAX_RETRIES": "0",
        }
        with patch.dict(os.environ, environment, clear=True):
            result = sync_news_to_supabase(records, session=fake, sleep_fn=lambda _: None)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["schema_mode"], "legacy")
        self.assertEqual(result["upserted_records"], 3)
        self.assertEqual(len(fake.post_calls), 2)
        _, first_call = fake.post_calls[0]
        self.assertEqual(first_call["params"]["on_conflict"], "slug")
        self.assertEqual(len(first_call["json"]), 2)
        self.assertEqual(
            set(first_call["json"][0]),
            {
                "slug",
                "title",
                "summary",
                "content",
                "author",
                "category",
                "image_url",
                "created_at",
                "updated_at",
            },
        )
        self.assertEqual(
            first_call["json"][0]["slug"],
            "https://news.example.com/article-0",
        )
        self.assertEqual(first_call["headers"]["apikey"], "sb_secret_test-only")
        self.assertNotIn("Authorization", first_call["headers"])

    def test_full_schema_retries_transient_error_with_service_role(self):
        fake = FakeSession(
            schema_status=200,
            post_responses=[
                FakeResponse(429, "slow down", {"Retry-After": "0"}),
                FakeResponse(201),
            ],
        )
        sleeps = []
        environment = {
            "SUPABASE_SYNC_ENABLED": "true",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "legacy.jwt.test-only",
            "SUPABASE_MAX_RETRIES": "2",
        }
        with patch.dict(os.environ, environment, clear=True):
            result = sync_news_to_supabase(
                [{"url": "https://example.com/story", "title": "Story"}],
                session=fake,
                sleep_fn=sleeps.append,
            )

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["schema_mode"], "full")
        self.assertEqual(result["retries"], 1)
        self.assertEqual(sleeps, [0.0])
        _, second_call = fake.post_calls[1]
        self.assertEqual(second_call["params"]["on_conflict"], "canonical_url")
        self.assertIn("canonical_url", second_call["json"][0])
        self.assertNotIn("id", second_call["json"][0])
        self.assertEqual(
            second_call["headers"]["Authorization"],
            "Bearer legacy.jwt.test-only",
        )

    def test_errors_never_echo_the_api_key(self):
        secret = "sb_secret_do-not-print"
        fake = FakeSession(
            schema_status=200,
            post_responses=[FakeResponse(400, f"bad request {secret}")],
        )
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": secret,
            "SUPABASE_MAX_RETRIES": "0",
        }
        with patch.dict(os.environ, environment, clear=True):
            result = sync_news_to_supabase(
                [{"url": "https://example.com/story", "title": "Story"}],
                session=fake,
            )

        self.assertEqual(result["status"], "failed")
        self.assertNotIn(secret, str(result))
        self.assertIn("[redacted]", result["errors"][0])

    def test_ai_draft_becomes_deterministic_immutable_version_and_source_stays_raw(self):
        article_id = "10000000-0000-4000-8000-000000000001"
        category_id = "20000000-0000-4000-8000-000000000002"
        record = {
            "url": "https://example.com/business/story?utm_source=feed",
            "raw_title": "Company reports an 8% decline",
            "raw_summary": "Revenue declined 8% in the June quarter.",
            "full_text": "The company said revenue declined 8% in the June quarter.",
            # These legacy display aliases are AI text and must not enter the
            # publisher/source row.
            "headline_en": "Company builds from June-quarter change",
            "summary_en": "The business is adapting after the result.",
            "editorial_headline": "Company responds after 8% revenue decline",
            "editorial_summary": "Management outlined its response to the decline.",
            "editorial_content": (
                "Revenue declined 8% in the June quarter, and management "
                "outlined its response."
            ),
            "source": "Example News",
            "source_category": "Economy",
            "category": "money",
            "tags": ["Finance", "Results"],
            "ai_enriched": True,
            "rewrite_status": "ready_for_review",
            "ai_model": "openai/gpt-oss-20b",
            "prompt_version": "fact-preserving-editorial-v1",
            "ai_warnings": [],
            "validation_errors": [],
        }
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test-only",
            "SUPABASE_MAX_RETRIES": "0",
        }

        version_ids = []
        for _ in range(2):
            fake = EditorialFakeSession(
                {
                    "id": article_id,
                    "canonical_url": "https://example.com/business/story",
                    "current_version_id": None,
                    "workflow_status": "scraped",
                    "category_id": category_id,
                }
            )
            with patch.dict(os.environ, environment, clear=True):
                result = sync_news_to_supabase([record], session=fake)

            self.assertEqual(result["status"], "success")
            self.assertEqual(result["ai_versions_synced"], 1)
            self.assertEqual(result["ai_versions_linked"], 1)
            self.assertEqual(len(fake.post_calls), 2)
            source_payload = fake.post_calls[0][1]["json"][0]
            self.assertEqual(source_payload["title"], record["raw_title"])
            self.assertEqual(source_payload["headline_en"], record["raw_title"])
            self.assertEqual(source_payload["summary_en"], record["raw_summary"])
            self.assertEqual(source_payload["content"], record["full_text"])
            self.assertEqual(source_payload["category"], "Economy")
            self.assertEqual(source_payload["tags"], [])

            version_call = fake.post_calls[1][1]
            version_payload = version_call["json"]
            version_ids.append(version_payload["id"])
            self.assertEqual(version_call["params"], {"on_conflict": "id"})
            self.assertIn("resolution=ignore-duplicates", version_call["headers"]["Prefer"])
            self.assertEqual(version_payload["origin"], "ai")
            self.assertEqual(version_payload["headline"], record["editorial_headline"])
            self.assertEqual(version_payload["content"], record["editorial_content"])
            self.assertNotIn("version_number", version_payload)
            self.assertEqual(version_payload["category_id"], category_id)

            link_call = fake.patch_calls[0][1]
            self.assertEqual(link_call["json"]["workflow_status"], "pending_review")
            self.assertEqual(link_call["json"]["ai_status"], "ready_for_review")
            self.assertIn("current_version_id.is.null", link_call["params"]["or"])

        self.assertEqual(version_ids[0], version_ids[1])

    def test_ai_sync_never_replaces_editor_or_approved_work(self):
        record = {
            "url": "https://example.com/protected",
            "raw_title": "Original",
            "raw_summary": "Original summary",
            "full_text": "Original source content.",
            "editorial_headline": "AI draft",
            "editorial_summary": "AI summary",
            "editorial_content": "AI draft content.",
            "ai_enriched": True,
            "rewrite_status": "needs_review",
        }
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test-only",
            "SUPABASE_MAX_RETRIES": "0",
        }
        protected_rows = [
            {
                "id": "30000000-0000-4000-8000-000000000003",
                "current_version_id": "40000000-0000-4000-8000-000000000004",
                "workflow_status": "pending_review",
                "category_id": None,
            },
            {
                "id": "50000000-0000-4000-8000-000000000005",
                "current_version_id": None,
                "workflow_status": "approved",
                "category_id": None,
            },
            {
                "id": "60000000-0000-4000-8000-000000000006",
                "current_version_id": None,
                "workflow_status": "published",
                "category_id": None,
            },
        ]
        for article_row in protected_rows:
            fake = EditorialFakeSession(article_row)
            with patch.dict(os.environ, environment, clear=True):
                result = sync_news_to_supabase([record], session=fake)

            self.assertEqual(result["ai_versions_synced"], 1)
            self.assertEqual(result["ai_versions_linked"], 0)
            self.assertEqual(result["ai_versions_protected"], 1)
            self.assertEqual(fake.patch_calls, [])

    def test_legacy_ai_aliases_alone_never_create_an_ai_version(self):
        fake = FakeSession(schema_status=200, post_responses=[FakeResponse(201)])
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test-only",
            "SUPABASE_MAX_RETRIES": "0",
        }
        record = {
            "url": "https://example.com/not-explicitly-enriched",
            "title": "Publisher headline",
            "headline_en": "A legacy rewritten headline",
            "summary_en": "A legacy rewritten summary",
        }
        with patch.dict(os.environ, environment, clear=True):
            result = sync_news_to_supabase([record], session=fake)

        self.assertEqual(result["ai_candidates"], 0)
        self.assertEqual(result["ai_versions_attempted"], 0)
        self.assertEqual(len(fake.post_calls), 1)

    def test_ai_version_failure_is_nonthrowing_and_redacted(self):
        secret = "sb_secret_editorial-do-not-print"
        fake = EditorialFakeSession(
            {
                "id": "70000000-0000-4000-8000-000000000007",
                "current_version_id": None,
                "workflow_status": "scraped",
                "category_id": None,
            },
            version_response=FakeResponse(400, f"invalid apikey={secret}"),
        )
        record = {
            "url": "https://example.com/editorial-error",
            "raw_title": "Publisher title",
            "full_text": "Publisher content.",
            "editorial_headline": "AI headline",
            "editorial_content": "AI content.",
            "ai_enriched": True,
            "rewrite_status": "ready_for_review",
        }
        environment = {
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": secret,
            "SUPABASE_MAX_RETRIES": "0",
        }
        with patch.dict(os.environ, environment, clear=True):
            result = sync_news_to_supabase([record], session=fake)

        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["editorial_status"], "failed")
        self.assertEqual(result["ai_versions_failed"], 1)
        self.assertNotIn(secret, str(result))
        self.assertIn("[redacted]", result["errors"][0])


if __name__ == "__main__":
    unittest.main()
