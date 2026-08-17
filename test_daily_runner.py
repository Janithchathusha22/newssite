import unittest

import daily_runner


class DailyRunnerSafetyTests(unittest.TestCase):
    def test_ai_cache_requires_exact_source_prompt_and_model(self):
        article = {
            "title": "Bank reports a 16.3% profit increase",
            "summary": "The bank reported a 16.3% increase.",
            "content": "The result was reported for the June quarter.",
        }
        source_hash = daily_runner._source_material_hash(article)
        existing = {
            "ai_enriched": True,
            "prompt_version": daily_runner.EDITORIAL_PROMPT_VERSION,
            "ai_model": daily_runner.GROQ_MODEL,
            "ai_source_hash": source_hash,
        }
        self.assertTrue(daily_runner._has_current_ai_draft(existing, source_hash))
        self.assertFalse(daily_runner._has_current_ai_draft(existing, "changed-source"))
        self.assertFalse(
            daily_runner._has_current_ai_draft(
                {**existing, "ai_model": "old-model"}, source_hash
            )
        )

    def test_strict_live_run_requires_successful_database_delivery(self):
        self.assertTrue(
            daily_runner._pipeline_delivery_succeeded(
                True, {"status": "success"}, True
            )
        )
        self.assertFalse(
            daily_runner._pipeline_delivery_succeeded(
                True, {"status": "failed"}, True
            )
        )
        self.assertTrue(
            daily_runner._pipeline_delivery_succeeded(
                True, {"status": "skipped"}, False
            )
        )
        self.assertFalse(
            daily_runner._pipeline_delivery_succeeded(
                False, {"status": "success"}, False
            )
        )


if __name__ == "__main__":
    unittest.main()
