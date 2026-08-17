import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from unified_scraper import (
    ARMY_SOURCE,
    FEED_SOURCES,
    LISTING_SOURCES,
    WP_REST_SOURCES,
    _daily_mirror_records,
    _enrich_from_article_html,
    _fetch_morning_source,
    _fetch_wp_source,
    _listing_records,
    _morning_build_id,
    _morning_records,
    _rss_records,
    _wp_rest_records,
    _xinhua_sri_lanka_records,
)


class UnifiedScraperParserTests(unittest.TestCase):
    def test_rss_keeps_publisher_image_and_details(self):
        source = FEED_SOURCES[0]
        payload = b"""<?xml version="1.0"?>
        <rss xmlns:media="http://search.yahoo.com/mrss/2.0"><channel><item>
          <title>A sufficiently detailed Sri Lankan business headline</title>
          <link>https://www.lankabusinessonline.com/example/?utm_source=test</link>
          <description><![CDATA[<p>Publisher supplied summary.</p>]]></description>
          <media:content url="https://www.lankabusinessonline.com/uploads/story.jpg" type="image/jpeg" />
          <pubDate>Mon, 10 Aug 2026 08:30:00 +0530</pubDate>
          <category>Markets</category>
        </item></channel></rss>"""

        records = _rss_records(payload, source, source.url)

        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0]["source_image"],
            "https://www.lankabusinessonline.com/uploads/story.jpg",
        )
        self.assertNotIn("utm_source", records[0]["url"])
        self.assertEqual(records[0]["category"], "Economy & Finance")

    def test_daily_mirror_listing_then_article_enrichment(self):
        listing = b"""<html><body><h2><a
          href="/breaking-news/Example-business-policy-headline/108-123456">
          Example business policy headline with enough words
        </a></h2></body></html>"""
        records = _daily_mirror_records(listing, "https://www.dailymirror.lk/")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_image"], "")

        article = b"""<html><head>
          <meta property="og:image" content="https://www.dailymirror.lk/media/story.webp">
          <meta property="article:published_time" content="2026-08-10T10:15:00+05:30">
          <meta name="description" content="The exact publisher description.">
        </head><body><article><p>This is a sufficiently long article paragraph containing factual publisher text for the story body.</p></article></body></html>"""
        result = _enrich_from_article_html(
            records[0], article, records[0]["url"]
        )
        self.assertEqual(
            result["source_image"],
            "https://www.dailymirror.lk/media/story.webp",
        )
        self.assertTrue(result["source_image_checked"])
        self.assertIn("publisher text", result["full_text"])

    def test_html_listing_accepts_only_canonical_publisher_articles(self):
        source = next(item for item in LISTING_SOURCES if item.key == "newsfirst")
        listing = b"""<html><body>
          <a href="/2026/08/13/cpc-seeks-investors-as-gas-is-confirmed">
            <h2>CPC Seeks Investors for Mannar Basin</h2><p>Listing excerpt</p>
          </a>
          <a href="https://example.com/2026/08/13/not-a-publisher-story">
            <h2>This external story must never be imported</h2>
          </a>
        </body></html>"""

        records = _listing_records(listing, source.url, source)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["raw_title"], "CPC Seeks Investors for Mannar Basin")
        self.assertEqual(records[0]["published_at"], "2026-08-13T00:00:00Z")
        self.assertEqual(records[0]["source_name"], "News First")

    def test_article_enrichment_replaces_listing_text_with_canonical_headline(self):
        record = {
            "raw_title": "Long listing title mixed with an excerpt",
            "title": "Long listing title mixed with an excerpt",
            "raw_summary": "",
            "full_text": "",
            "url": "https://english.newsfirst.lk/2026/08/13/example",
        }
        payload = b"""<html><head><script type="application/ld+json">
        {"@type":"NewsArticle","headline":"The canonical publisher headline","articleBody":"A complete factual article body supplied by the publisher.","datePublished":"2026-08-13T08:30:00+05:30"}
        </script></head><body></body></html>"""

        result = _enrich_from_article_html(record, payload, record["url"])

        self.assertEqual(result["raw_title"], "The canonical publisher headline")
        self.assertIn("complete factual article", result["full_text"])

    def test_wp_rest_uses_exact_featured_media_and_embedded_terms(self):
        source = next(item for item in WP_REST_SOURCES if item.key == "ada-en")
        payload = [
            {
                "id": 182820,
                "date_gmt": "2026-08-10T12:38:43",
                "link": "http://bizenglish.adaderana.lk/example-business-story/",
                "title": {"rendered": "Banking &amp; markets record a strong result"},
                "excerpt": {"rendered": "<p>Publisher supplied REST excerpt.</p>"},
                "content": {"rendered": "<p>Publisher supplied full article content.</p>"},
                "featured_media": 182821,
                "_embedded": {
                    "wp:featuredmedia": [
                        {
                            "source_url": (
                                "http://s3.amazonaws.com/bizenglish/wp-content/"
                                "uploads/2026/08/source-photo.jpg"
                            )
                        }
                    ],
                    "wp:term": [
                        [{"name": "Markets", "taxonomy": "category"}],
                        [{"name": "Banking", "taxonomy": "post_tag"}],
                    ],
                },
            }
        ]

        records = _wp_rest_records(json.dumps(payload).encode(), source)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_id"], "182820")
        self.assertTrue(records[0]["url"].startswith("https://"))
        self.assertEqual(
            records[0]["source_image"],
            "https://s3.amazonaws.com/bizenglish/wp-content/uploads/2026/08/source-photo.jpg",
        )
        self.assertEqual(records[0]["category"], "Economy & Finance")
        self.assertEqual(records[0]["tags"], ["Markets", "Banking"])
        self.assertIn("full article content", records[0]["full_text"])
        self.assertEqual(records[0]["published_at"], "2026-08-10T12:38:43Z")

    def test_wp_rest_never_invents_an_image(self):
        source = WP_REST_SOURCES[0]
        payload = [{
            "id": 10,
            "date_gmt": "2026-08-10T08:00:00",
            "link": "https://economynext.com/example-source-story-10/",
            "title": {"rendered": "A valid EconomyNext headline without featured media"},
            "excerpt": {"rendered": "<p>A concise publisher excerpt.</p>"},
            "content": {"rendered": "<p>Publisher article content.</p>"},
            "featured_media": 0,
            "_embedded": {},
        }]

        record = _wp_rest_records(payload, source)[0]

        self.assertEqual(record["source_image"], "")
        self.assertEqual(record["image"], "")
        self.assertFalse(record["source_image_checked"])

    def test_feed_html_emoji_is_not_an_article_image(self):
        source = next(item for item in WP_REST_SOURCES if item.key == "island").fallback_feed(1)
        payload = b"""<?xml version="1.0"?><rss><channel><item>
        <title>A sufficiently detailed Island publisher headline today</title>
        <link>https://island.lk/example-island-story</link>
        <description><![CDATA[
          <p>A publisher summary.</p>
          <img width="72" height="72" src="https://s.w.org/images/core/emoji/15.0.3/72x72/270d.png">
        ]]></description>
        </item></channel></rss>"""

        record = _rss_records(payload, source, source.url)[0]

        self.assertEqual(record["source_image"], "")
        self.assertEqual(record["image"], "")
        self.assertFalse(record["source_image_checked"])

    def test_article_enrichment_rejects_cross_publisher_stock_image(self):
        record = {
            "raw_title": "Publisher headline",
            "title": "Publisher headline",
            "raw_summary": "",
            "full_text": "",
            "url": "https://economynext.com/example-story-123",
        }
        payload = b"""<html><head>
          <meta property="og:image" content="https://images.unsplash.com/photo-123.jpg">
        </head><body><article><p>A complete publisher article paragraph with enough text for extraction.</p></article></body></html>"""

        result = _enrich_from_article_html(record, payload, record["url"])

        self.assertEqual(result.get("source_image", ""), "")
        self.assertTrue(result["source_image_checked"])

    def test_caa_official_feed_is_enabled_and_keeps_source_image(self):
        source = next(item for item in FEED_SOURCES if item.key == "caa")
        payload = b"""<?xml version="1.0"?><rss><channel><item>
        <title>CAASL introduces a significant new aviation safety programme</title>
        <link>https://www.caa.lk/en/news/700-aviation-safety-programme</link>
        <description><![CDATA[
          <p>Official Civil Aviation Authority source copy.</p>
          <img src="https://www.caa.lk/images/news/aviation-programme.jpg">
        ]]></description><pubDate>Thu, 13 Aug 2026 09:00:00 +0530</pubDate>
        </item></channel></rss>"""

        record = _rss_records(payload, source, source.url)[0]

        self.assertEqual(source.url, "https://www.caa.lk/en/news?format=feed&type=rss")
        self.assertEqual(record["source_name"], "Civil Aviation Authority")
        self.assertEqual(record["source_image"], "https://www.caa.lk/images/news/aviation-programme.jpg")

    def test_army_listing_extracts_card_date_without_borrowing_neighbour_date(self):
        payload = b"""<html><body><article>
          <h2><a href="/news/new-director-assumes-duties">New Army director formally assumes duties</a></h2>
          <span>2026-08-08</span><img src="/sites/default/files/story.jpg">
        </article><article><span>2026-08-07</span></article></body></html>"""

        records = _listing_records(payload, ARMY_SOURCE.url, ARMY_SOURCE)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_name"], "Sri Lanka Army")
        self.assertEqual(records[0]["published_at"], "2026-08-08T00:00:00Z")

    def test_xinhua_imports_only_sri_lanka_headlines_and_fixes_relative_path(self):
        payload = b"""<html><body>
          <a href="20260810/c6b19c6234354d39bba7e46dd0761d18/c.html">Sri Lanka holds an international kite festival</a>
          <a href="20260812/71b74237fe734ff68a27b7a3111c2879/c.html">Unrelated regional political story</a>
        </body></html>"""

        records = _xinhua_sri_lanka_records(
            payload, "https://english.news.cn/asiapacific/index.htm"
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0]["url"],
            "https://english.news.cn/20260810/c6b19c6234354d39bba7e46dd0761d18/c.html",
        )
        self.assertEqual(records[0]["published_at"], "2026-08-10T00:00:00Z")

    def test_morning_next_data_preserves_source_copy_date_and_image(self):
        payload = {
            "pageProps": {"latestNews": [{
                "id": "7mlskPQNzw5IVJ6PQ5NP",
                "title": "Prime Minister calls for modern education reforms",
                "category": "news",
                "author": "BY Staff Writer",
                "content": "<p>Publisher supplied full source article.</p>",
                "media": (
                    "https://firebasestorage.googleapis.com/v0/b/"
                    "the-morning-39270.appspot.com/o/articles%2F7mlskPQNzw5IVJ6PQ5NP"
                    "?alt=media&token=publisher-token"
                ),
                "meta": {
                    "excerpt": "Publisher supplied excerpt.",
                    "createdAt": "13 Aug 2026",
                    "tags": ["Education"],
                },
            }]},
        }

        record = _morning_records(payload)[0]

        self.assertEqual(record["source_name"], "The Morning")
        self.assertEqual(record["url"], "https://www.themorning.lk/articles/7mlskPQNzw5IVJ6PQ5NP")
        self.assertEqual(record["published_at"], "2026-08-13T00:00:00Z")
        self.assertIn("the-morning-39270.appspot.com", record["source_image"])

    def test_morning_build_id_reads_next_data_or_manifest(self):
        self.assertEqual(
            _morning_build_id(
                b'<script id="__NEXT_DATA__">{"buildId":"valid-build_123"}</script>'
            ),
            "valid-build_123",
        )
        self.assertEqual(
            _morning_build_id(b'<script src="/_next/static/backup-build/_buildManifest.js"></script>'),
            "backup-build",
        )


class UnifiedScraperFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_morning_fetch_resolves_build_before_public_json(self):
        probe = b'<script id="__NEXT_DATA__">{"buildId":"current-build"}</script>'
        payload = json.dumps({
            "pageProps": {"latestNews": [{
                "id": "article123",
                "title": "A complete Morning publisher headline today",
                "content": "<p>Publisher source body.</p>",
                "meta": {"createdAt": "13 Aug 2026"},
            }]},
        }).encode()

        class Response:
            status = 404

            async def read(self):
                return probe

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

        session = MagicMock()
        session.get.return_value = Response()
        with patch(
            "unified_scraper._request_bytes",
            AsyncMock(return_value=(payload, "https://www.themorning.lk/_next/data/current-build/index.json", "application/json")),
        ) as request:
            records, mode = await _fetch_morning_source(session, 5)

        self.assertEqual(mode, "next-data")
        self.assertEqual(len(records), 1)
        self.assertIn("/_next/data/current-build/index.json?newsroom=", request.await_args.args[1])

    async def test_wp_api_failure_uses_that_publishers_rss(self):
        source = WP_REST_SOURCES[0]
        rss = b"""<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/2.0"><channel><item>
        <title>A sufficiently detailed fallback business headline</title>
        <link>https://economynext.com/fallback-business-headline-123/</link>
        <description><![CDATA[<p>Fallback publisher summary.</p>]]></description>
        <media:content url="https://economynext.com/wp-content/uploads/fallback.jpg" type="image/jpeg" />
        </item></channel></rss>"""
        mocked_request = AsyncMock(
            side_effect=[
                (b"", source.api_url, ""),
                (rss, source.feed_url, "application/rss+xml"),
            ]
        )

        with patch("unified_scraper._request_bytes", mocked_request):
            returned_source, records, mode = await _fetch_wp_source(
                object(), source, per_page=1, maximum=1
            )

        self.assertEqual(returned_source, source)
        self.assertEqual(mode, "rss")
        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0]["source_image"],
            "https://economynext.com/wp-content/uploads/fallback.jpg",
        )


if __name__ == "__main__":
    unittest.main()
