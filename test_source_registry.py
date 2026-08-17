"""Offline tests for authoritative scraper source controls."""

import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from source_registry import (
    SourceRegistry,
    SourceRegistryError,
    load_source_registry,
    normalize_domain,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    def __init__(self, response=None, error=None):
        self.response = response or FakeResponse(200, [])
        self.error = error
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return self.response


class SourceRegistryTests(unittest.TestCase):
    def test_domain_normalization_and_boundary_matching(self):
        registry = SourceRegistry.from_rows(
            [{"domain": "dailymirror.lk", "adapter_key": "daily-mirror-html", "enabled": True}]
        )
        self.assertEqual(normalize_domain("https://WWW.DailyMirror.lk/news"), "dailymirror.lk")
        self.assertTrue(registry.allows(domain="www.dailymirror.lk"))
        self.assertTrue(registry.allows(domain="images.dailymirror.lk"))
        self.assertFalse(registry.allows(domain="notdailymirror.lk"))

    def test_disabled_domain_disables_all_of_its_feeds(self):
        registry = SourceRegistry.from_rows(
            [{"domain": "ft.lk", "adapter_key": "daily-ft-rss", "enabled": False}]
        )
        self.assertFalse(registry.allows(domain="www.ft.lk", source_key="ft-front"))
        self.assertFalse(registry.allows(domain="ft.lk", source_key="ft-finance"))

    def test_disabled_domain_cannot_be_overridden_by_an_enabled_key_alias(self):
        registry = SourceRegistry.from_rows(
            [
                {"domain": "ft.lk", "adapter_key": "daily-ft-rss", "enabled": False},
                {"domain": "other.example", "adapter_key": "ft-front", "enabled": True},
            ]
        )
        self.assertFalse(
            registry.allows(
                domain="ft.lk", adapter_key="daily-ft-rss", source_key="ft-front"
            )
        )

    def test_adapter_key_can_match_when_domain_alias_differs(self):
        registry = SourceRegistry.from_rows(
            [{"domain": "adaderana.lk", "adapter_key": "ada-derana-rss", "enabled": True}]
        )
        self.assertTrue(
            registry.allows(
                domain="feeds.publisher-cdn.example",
                adapter_key="ada-derana-rss",
                source_key="ada-derana",
            )
        )

    def test_authoritative_registry_denies_unknown_source(self):
        registry = SourceRegistry.from_rows([])
        self.assertFalse(registry.allows(domain="new-source.example", source_key="new"))
        self.assertTrue(SourceRegistry.allow_defaults().allows(domain="new-source.example"))

    def test_unified_scraper_filters_each_adapter_before_task_creation(self):
        from unified_scraper import FEED_SOURCES, WP_REST_SOURCES, _enabled_sources

        registry = SourceRegistry.from_rows(
            [
                {"domain": "economynext.com", "adapter_key": "economynext-wp", "enabled": True},
                {"domain": "lankabusinessonline.com", "adapter_key": "lbo-wp", "enabled": False},
                {"domain": "adaderana.lk", "adapter_key": "ada-derana-rss", "enabled": True},
                {"domain": "ft.lk", "adapter_key": "daily-ft-rss", "enabled": False},
            ]
        )
        wp_keys = {source.key for source in _enabled_sources(WP_REST_SOURCES, registry)}
        feed_keys = {source.key for source in _enabled_sources(FEED_SOURCES, registry)}
        self.assertIn("economynext", wp_keys)
        self.assertNotIn("lbo", wp_keys)
        self.assertIn("ada-derana", feed_keys)
        self.assertIn("ada-si", feed_keys)  # controlled by the parent domain
        self.assertFalse(any(key.startswith("ft-") for key in feed_keys))

    def test_supabase_mode_failure_is_fatal(self):
        session = FakeSession(response=FakeResponse(503, {"message": "unavailable"}))
        environment = {
            "EDITORIAL_BACKEND": "supabase",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test",
        }
        with patch.dict(os.environ, environment, clear=True):
            with self.assertRaisesRegex(SourceRegistryError, "HTTP 503"):
                load_source_registry(session=session)

    def test_supabase_mode_missing_credentials_is_fatal(self):
        with patch.dict(os.environ, {"EDITORIAL_BACKEND": "supabase"}, clear=True):
            with self.assertRaisesRegex(SourceRegistryError, "credentials are missing"):
                load_source_registry(session=FakeSession())

    def test_auto_development_failure_uses_local_defaults(self):
        session = FakeSession(response=FakeResponse(404, {"message": "missing table"}))
        environment = {
            "EDITORIAL_BACKEND": "auto",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test",
        }
        with patch.dict(os.environ, environment, clear=True):
            registry = load_source_registry(session=session)
        self.assertFalse(registry.authoritative)
        self.assertTrue(registry.allows(domain="anything.example"))

    def test_successful_load_uses_server_secret_without_bearer_for_new_key(self):
        session = FakeSession(
            response=FakeResponse(
                200,
                [{"domain": "economynext.com", "adapter_key": "economynext-wp", "enabled": True}],
            )
        )
        environment = {
            "EDITORIAL_BACKEND": "supabase",
            "SUPABASE_URL": "https://project.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_test",
        }
        with patch.dict(os.environ, environment, clear=True):
            registry = load_source_registry(session=session)
        self.assertTrue(registry.authoritative)
        self.assertTrue(registry.allows(domain="economynext.com"))
        headers = session.calls[0][1]["headers"]
        self.assertEqual(headers["apikey"], "sb_secret_test")
        self.assertNotIn("Authorization", headers)

    def test_daily_pipeline_stops_before_scraping_when_required_registry_fails(self):
        # Import lazily so the registry unit tests remain focused and offline.
        import daily_runner

        with patch.object(
            daily_runner,
            "load_source_registry",
            side_effect=SourceRegistryError("registry unavailable"),
        ), patch.object(daily_runner, "scrape_all_sources") as scrape, redirect_stdout(
            io.StringIO()
        ), redirect_stderr(io.StringIO()):
            self.assertFalse(daily_runner.run_daily_pipeline())
            scrape.assert_not_called()

    def test_migration_records_source_health_from_newer_article_scrapes(self):
        sql = (Path(__file__).parent / "supabase" / "editorial_workflow.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("record_news_source_collection_success", sql)
        self.assertIn("new.scraped_at > source.last_scraped_at", sql)
        self.assertIn("'the-morning-next-data'", sql)


if __name__ == "__main__":
    unittest.main()
