"""Optional, server-side Supabase synchronization for normalized news records.

This module deliberately uses Supabase's REST Data API instead of a browser
client.  Elevated keys are read from ``.env`` and are never written into a web
feed, JavaScript bundle, log message, or return value.

The public entry point is ``sync_news_to_supabase(records)``.  It is safe to
call after every scrape: missing configuration returns a structured ``skipped``
result, and writes use idempotent batch upserts on ``canonical_url``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import requests
from dotenv import load_dotenv

from scraper import is_probable_source_image


PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

DEFAULT_TABLE = "news_articles"
TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
}
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
TABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
FULL_PAYLOAD_KEYS = (
    "source_id",
    "canonical_url",
    "source_url",
    "title",
    "headline_en",
    "headline_si",
    "summary",
    "summary_en",
    "summary_si",
    "content",
    "source",
    "category",
    "author",
    "published_at",
    "scraped_at",
    "image_url",
    "local_image_path",
    "image_alt",
    "image_mime_type",
    "image_width",
    "image_height",
    "image_bytes",
    "image_status",
    "tags",
    "takeaways",
    "content_hash",
)
AI_VERSION_NAMESPACE = uuid.UUID("6745747d-6ae1-4d72-9fd6-479fa75f7b7e")
AI_LINKABLE_WORKFLOW_STATUSES = (
    "scraped",
    "ai_processing",
    "pending_review",
    "failed",
)
LOCAL_IMAGE_ROOTS = (
    "assets/news_images/",
    "ft_images/",
    "news_images/",
    "images/",
    "downloaded_images/",
)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _first(record: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _string_list(value: Any) -> list[str]:
    """Return a small JSON-safe list without trusting arbitrary objects."""
    return _json_string_list(value, separators=(",", "|"))[:100]


def _ai_draft(record: Mapping[str, Any], canonical_url: str) -> dict[str, Any] | None:
    """Extract only an explicitly enriched, explicitly separated AI draft.

    The legacy ``headline_en``/``summary_en`` fields are intentionally ignored:
    older feeds used them for presentation and they cannot prove that Groq
    produced a reviewable editorial version.
    """
    if record.get("ai_enriched") is not True:
        return None

    headline = _text(record.get("editorial_headline"))
    content = _text(record.get("editorial_content"))
    if not headline or not content:
        return None

    summary = _text(record.get("editorial_summary"))
    category = _text(record.get("category"))
    prompt_version = _text(record.get("prompt_version"))
    ai_model = _text(record.get("ai_model"))
    warnings = _string_list(record.get("ai_warnings"))
    validation_errors = _string_list(record.get("validation_errors"))
    tags = _string_list(record.get("tags"))
    rewrite_status = _text(record.get("rewrite_status")).casefold()
    ai_status = (
        "ready_for_review"
        if rewrite_status == "ready_for_review" and not validation_errors
        else "needs_review"
    )

    # The UUID changes only when the actual generated draft or its generation
    # contract changes. Re-running the same feed therefore cannot create a
    # duplicate immutable version.
    identity = json.dumps(
        {
            "canonical_url": canonical_url,
            "headline": headline,
            "summary": summary,
            "content": content,
            "category": category,
            "tags": tags,
            "ai_model": ai_model,
            "prompt_version": prompt_version,
            "ai_warnings": warnings,
            "validation_errors": validation_errors,
            "ai_status": ai_status,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "id": str(uuid.uuid5(AI_VERSION_NAMESPACE, identity)),
        "headline": headline,
        "summary": summary or None,
        "content": content,
        "category": category,
        "tags": tags,
        "ai_model": ai_model or None,
        "prompt_version": prompt_version or None,
        "ai_warnings": warnings,
        "validation_errors": validation_errors,
        "requires_human_review": ai_status == "needs_review",
        "ai_status": ai_status,
    }


def canonicalize_source_url(value: Any) -> str:
    """Return a stable article URL suitable for a unique database key."""
    url = _text(value)
    if not url:
        return ""
    if url.startswith("//"):
        url = f"https:{url}"
    elif "://" not in url and "." in url.split("/", 1)[0]:
        url = f"https://{url}"

    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
        return ""

    query = sorted(
        (key, item_value)
        for key, item_value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_")
        and key.lower() not in TRACKING_QUERY_KEYS
    )
    path = re.sub(r"/{2,}", "/", parts.path).rstrip("/") or "/"
    return urlunsplit(
        (
            parts.scheme.lower(),
            parts.netloc.lower(),
            path,
            urlencode(query),
            "",
        )
    )


def _source_url(value: Any) -> str:
    """Keep the publisher URL while dropping fragments that never reach it."""
    url = _text(value)
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
        return canonicalize_source_url(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def _http_url(value: Any) -> str:
    url = _text(value)
    if not url:
        return ""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    return url if parts.scheme.lower() in {"http", "https"} and parts.netloc else ""


def _local_path(value: Any) -> str:
    path = _text(value).replace("\\", "/").lstrip("/")
    if not path or path.lower().startswith(("http://", "https://", "data:")):
        return ""
    parts = [part for part in path.split("/") if part not in {"", "."}]
    if not parts or ".." in parts or ":" in parts[0]:
        return ""
    normalized = "/".join(parts)
    return normalized if normalized.lower().startswith(LOCAL_IMAGE_ROOTS) else ""


def _json_string_list(value: Any, *, separators: tuple[str, ...]) -> list[str]:
    if value in (None, "", [], {}):
        return []
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        try:
            decoded = json.loads(text)
        except (TypeError, ValueError, json.JSONDecodeError):
            decoded = None
        if isinstance(decoded, list):
            value = decoded
        else:
            split_values = [text]
            for separator in separators:
                if separator in text:
                    split_values = text.split(separator)
                    break
            value = split_values
    elif not isinstance(value, (list, tuple, set)):
        value = [value]

    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        clean = _text(item)
        folded = clean.casefold()
        if clean and folded not in seen:
            seen.add(folded)
            result.append(clean)
    return result


def _timestamp(value: Any) -> str | None:
    text = _text(value)
    if not text or text.casefold() in {"no date", "n/a", "none", "null"}:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def normalize_news_record(
    record: Mapping[str, Any], *, scraped_at: str | None = None
) -> dict[str, Any]:
    """Map the scrapers' different field names to the Supabase SQL schema.

    ``ValueError`` is raised when an article has no valid publisher URL.  The
    caller catches that per record so one malformed result cannot stop a batch.
    """
    if not isinstance(record, Mapping):
        raise ValueError("record is not an object")

    raw_url = _first(
        record, "source_url", "url", "link", "article_url", "canonical_url"
    )
    canonical_url = canonicalize_source_url(raw_url)
    if not canonical_url:
        raise ValueError("record has no valid http(s) source URL")

    source_url = _source_url(raw_url) or canonical_url
    # ``raw_*``/``full_text`` are the immutable publisher snapshot emitted by
    # groq_ai_processor.  Prefer them over legacy presentation fields, which an
    # enriched record also carries for backwards-compatible local rendering.
    title = _text(
        _first(record, "raw_title", "title", "headline", "headline_en", "name")
    )
    headline_en = title
    headline_si = _text(_first(record, "headline_si", "title_si", "sinhala_headline"))
    summary = _text(
        _first(record, "raw_summary", "summary", "description", "summary_en")
    )
    summary_en = summary
    summary_si = _text(_first(record, "summary_si", "sinhala_summary"))
    content = _text(_first(record, "full_text", "content", "article_text", "body"))

    image_url = ""
    declared_remote_image = False
    for key in (
        "source_image",
        "main_image_url",
        "og_image",
        "image_url",
    ):
        candidate = _http_url(record.get(key))
        declared_remote_image = declared_remote_image or bool(candidate)
        if candidate and is_probable_source_image(candidate, source_url):
            image_url = candidate
            break
    # Old import formats sometimes stored the source URL only in ``image``.
    # Do not trust that ambiguous field when a modern scraper explicitly
    # checked the article and reported that it had no source image.
    if not image_url and record.get("source_image_checked") is not True:
        candidate = _http_url(record.get("image"))
        declared_remote_image = declared_remote_image or bool(candidate)
        if candidate and is_probable_source_image(candidate, source_url):
            image_url = candidate

    local_image_path = ""
    for key in (
        "local_image_path",
        "cached_image",
        "image_local",
        "main_image_local",
        "downloaded_image_path",
        "image",
    ):
        local_image_path = _local_path(record.get(key))
        if local_image_path:
            break
    if declared_remote_image and not image_url:
        local_image_path = ""

    details = record.get("image_details")
    if not isinstance(details, Mapping):
        details = record.get("image_metadata")
    if not isinstance(details, Mapping):
        details = {}

    source_id = _text(_first(record, "source_id", "article_id", "id"))
    stable_id = str(uuid.uuid5(uuid.NAMESPACE_URL, canonical_url))
    normalized_scraped_at = _timestamp(
        _first(record, "scraped_at", "scraped_date", "fetched_at")
    )
    if not normalized_scraped_at:
        normalized_scraped_at = _timestamp(scraped_at)
    if not normalized_scraped_at:
        normalized_scraped_at = datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        )

    image_status = _text(_first(record, "image_status"))
    if not image_url and not local_image_path:
        image_status = "missing"
    elif not image_status:
        image_status = "available"

    normalized = {
        "id": stable_id,
        "source_id": source_id or None,
        "canonical_url": canonical_url,
        "source_url": source_url,
        "title": title,
        "headline_en": headline_en or title or None,
        "headline_si": headline_si or None,
        "summary": summary or None,
        "summary_en": summary_en or summary or None,
        "summary_si": summary_si or None,
        "content": content or None,
        "source": _text(_first(record, "source", "publisher")) or "Unknown",
        "category": _text(
            _first(record, "source_category", "category", "section")
        )
        or None,
        "author": _text(_first(record, "author", "byline")) or None,
        "published_at": _timestamp(
            _first(
                record,
                "published_at",
                "published_date",
                "published",
                "pub_date",
                "date",
            )
        ),
        "scraped_at": normalized_scraped_at,
        "image_url": image_url or None,
        "local_image_path": local_image_path or None,
        "image_alt": _text(
            _first(record, "image_alt", "alt_text") or details.get("alt")
        )
        or title
        or None,
        "image_mime_type": _text(
            _first(record, "image_mime_type", "image_content_type")
            or details.get("mime_type")
            or details.get("content_type")
        )
        or None,
        "image_width": _positive_int(
            _first(record, "image_width") or details.get("width")
        ),
        "image_height": _positive_int(
            _first(record, "image_height") or details.get("height")
        ),
        "image_bytes": _positive_int(
            _first(record, "image_bytes", "image_size")
            or details.get("bytes")
            or details.get("size")
        ),
        "image_status": image_status,
        # AI-generated taxonomy belongs to the immutable AI version below,
        # never to the source snapshot row.
        "tags": _json_string_list(
            record.get("source_tags")
            if record.get("ai_enriched") is True
            else record.get("tags"),
            separators=(",", "|"),
        ),
        "takeaways": _json_string_list(
            record.get("source_takeaways")
            if record.get("ai_enriched") is True
            else _first(record, "takeaways", "key_takeaways"),
            separators=("|",),
        ),
    }
    # Supply the immutable source hash explicitly.  Apart from making the
    # scraper/editorial contract deterministic, this keeps inserts independent
    # of where a Supabase project installed the optional pgcrypto extension.
    # The database trigger uses the same title/summary/content byte sequence as
    # a fallback for non-sync writers.
    source_snapshot = "\n".join((title, summary, content))
    normalized["content_hash"] = hashlib.sha256(
        source_snapshot.encode("utf-8")
    ).hexdigest()
    normalized["_ai_draft"] = _ai_draft(record, canonical_url)
    return normalized


def _has_value(value: Any) -> bool:
    return value not in (None, "", [], {})


def _merge_normalized(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Combine duplicate scraper results without discarding richer fields."""
    merged = dict(existing)
    for key, value in incoming.items():
        if not _has_value(value):
            continue
        if key in {"content", "summary", "summary_en", "summary_si"}:
            if len(_text(value)) < len(_text(merged.get(key))):
                continue
        if key in {"tags", "takeaways"}:
            merged[key] = _json_string_list(
                list(merged.get(key) or []) + list(value or []), separators=("|",)
            )
            continue
        merged[key] = value
    merged["image_status"] = (
        "available"
        if merged.get("image_url") or merged.get("local_image_path")
        else "missing"
    )
    return merged


def _legacy_slug(record: Mapping[str, Any]) -> str:
    """Use the canonical publisher URL, matching the project's old sync code."""
    return _text(record.get("canonical_url"))


def _payload_for_mode(record: Mapping[str, Any], mode: str) -> dict[str, Any]:
    if mode == "legacy":
        # The pre-migration project table has only these columns. IDs/default
        # view counts stay database-owned and are never reset during an update.
        return {
            "slug": _legacy_slug(record),
            "title": record.get("headline_en") or record.get("title") or "",
            "summary": record.get("summary_en") or record.get("summary"),
            "content": record.get("content"),
            "author": record.get("author"),
            "category": record.get("category"),
            "image_url": record.get("image_url"),
            "created_at": record.get("published_at") or record.get("scraped_at"),
            "updated_at": record.get("scraped_at"),
        }
    # IDs are database-generated. source_id retains the publisher's identifier,
    # while canonical_url is the actual idempotency key.
    return {key: record.get(key) for key in FULL_PAYLOAD_KEYS}


def _base_result(status: str, reason: str = "") -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "configured": False,
        "input_records": 0,
        "prepared_records": 0,
        "duplicate_records": 0,
        "skipped_records": 0,
        "attempted_records": 0,
        "upserted_records": 0,
        "failed_records": 0,
        "batches": 0,
        "retries": 0,
        "errors": [],
        "schema_mode": None,
        "editorial_status": "skipped",
        "editorial_reason": "No AI editorial drafts were available.",
        "ai_candidates": 0,
        "ai_versions_attempted": 0,
        "ai_versions_synced": 0,
        "ai_versions_linked": 0,
        "ai_versions_protected": 0,
        "ai_versions_failed": 0,
    }


def _redact(value: Any, *secrets: str) -> str:
    text = _text(value)[:500]
    for secret in secrets:
        if secret:
            text = text.replace(secret, "[redacted]")
    text = re.sub(
        r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;]+",
        r"\1[redacted]",
        text,
    )
    text = re.sub(
        r"(?i)(apikey\s*[:=]\s*)[^\s,;]+",
        r"\1[redacted]",
        text,
    )
    return text


def _redacted_error(response: Any, api_key: str) -> str:
    status = getattr(response, "status_code", "unknown")
    body = _redact(
        getattr(response, "text", ""),
        api_key,
        _text(os.getenv("SUPABASE_SECRET_KEY")),
        _text(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
    )
    return f"Supabase HTTP {status}" + (f": {body}" if body else "")


def _response_payload(response: Any) -> Any:
    try:
        decoder = getattr(response, "json")
    except AttributeError:
        decoder = None
    if callable(decoder):
        try:
            return decoder()
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    text = _text(getattr(response, "text", ""))
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _rest_call(
    session: Any,
    method: str,
    endpoint: str,
    *,
    headers: Mapping[str, str],
    timeout: float,
    api_key: str,
    params: Mapping[str, str] | None = None,
    body: Mapping[str, Any] | list[Mapping[str, Any]] | None = None,
) -> tuple[bool, Any, str]:
    """Make one non-throwing PostgREST call suitable for mock sessions."""
    try:
        sender = getattr(session, method.lower())
        kwargs: dict[str, Any] = {
            "headers": dict(headers),
            "timeout": timeout,
        }
        if params:
            kwargs["params"] = dict(params)
        if body is not None:
            kwargs["json"] = body
        response = sender(endpoint, **kwargs)
    except Exception as exc:  # Network adapters and test doubles vary.
        return False, None, f"Supabase network error: {type(exc).__name__}"
    status_code = int(getattr(response, "status_code", 0))
    if 200 <= status_code < 300:
        return True, _response_payload(response), ""
    return False, None, _redacted_error(response, api_key)


def _sync_ai_versions(
    prepared: list[dict[str, Any]],
    successfully_upserted_urls: set[str],
    *,
    session: Any,
    rest_root: str,
    news_endpoint: str,
    headers: Mapping[str, str],
    timeout: float,
    api_key: str,
    result: dict[str, Any],
) -> None:
    """Create idempotent AI versions and conditionally make them current."""
    candidates = [
        record
        for record in prepared
        if record.get("_ai_draft")
        and record.get("canonical_url") in successfully_upserted_urls
    ]
    if not candidates:
        if result["ai_candidates"]:
            result["editorial_reason"] = (
                "AI drafts were not synchronized because their source rows "
                "were not upserted."
            )
        return

    result["editorial_status"] = "success"
    result["editorial_reason"] = "AI editorial versions synchronized for review."
    version_endpoint = f"{rest_root}/article_versions"

    for record in candidates:
        draft = dict(record["_ai_draft"])
        result["ai_versions_attempted"] += 1

        lookup_headers = dict(headers)
        lookup_headers["Prefer"] = "return=representation"
        ok, payload, error = _rest_call(
            session,
            "get",
            news_endpoint,
            headers=lookup_headers,
            timeout=timeout,
            api_key=api_key,
            params={
                "select": "id,canonical_url,current_version_id,workflow_status,category_id",
                "canonical_url": f"eq.{record['canonical_url']}",
                "limit": "1",
            },
        )
        rows = (
            [row for row in payload if isinstance(row, Mapping)]
            if isinstance(payload, list)
            else []
        )
        if not ok or not rows or not _text(rows[0].get("id")):
            result["ai_versions_failed"] += 1
            if len(result["errors"]) < 20:
                result["errors"].append(error or "AI version article lookup returned no row.")
            continue

        article = rows[0]
        article_id = _text(article.get("id"))
        version_id = draft.pop("id")
        version_payload: dict[str, Any] = {
            "id": version_id,
            "article_id": article_id,
            "origin": "ai",
            "headline": draft["headline"],
            "summary": draft["summary"],
            "content": draft["content"],
            "tags": draft["tags"],
            "language": "en",
            "ai_model": draft["ai_model"],
            "prompt_version": draft["prompt_version"],
            "ai_warnings": draft["ai_warnings"],
            "validation_errors": draft["validation_errors"],
            "requires_human_review": draft["requires_human_review"],
            "change_note": "Automated Groq draft; publication requires editor approval.",
        }
        category_id = _text(article.get("category_id"))
        if category_id:
            version_payload["category_id"] = category_id

        version_headers = dict(headers)
        version_headers["Prefer"] = "resolution=ignore-duplicates,return=minimal"
        ok, _, error = _rest_call(
            session,
            "post",
            version_endpoint,
            headers=version_headers,
            timeout=timeout,
            api_key=api_key,
            params={"on_conflict": "id"},
            body=version_payload,
        )
        if not ok:
            result["ai_versions_failed"] += 1
            if len(result["errors"]) < 20:
                result["errors"].append(error or "AI version synchronization failed.")
            continue
        result["ai_versions_synced"] += 1

        current_version_id = _text(article.get("current_version_id"))
        workflow_status = _text(article.get("workflow_status")) or "scraped"
        if (
            current_version_id not in {"", version_id}
            or workflow_status not in AI_LINKABLE_WORKFLOW_STATUSES
        ):
            result["ai_versions_protected"] += 1
            continue

        # Repeat the guard in the PATCH itself. If an editor saves or approves
        # between the lookup and this write, PostgREST matches zero rows.
        link_headers = dict(headers)
        link_headers["Prefer"] = "return=representation"
        ok, payload, error = _rest_call(
            session,
            "patch",
            news_endpoint,
            headers=link_headers,
            timeout=timeout,
            api_key=api_key,
            params={
                "id": f"eq.{article_id}",
                "or": (
                    "(current_version_id.is.null,"
                    f"current_version_id.eq.{version_id})"
                ),
                "workflow_status": (
                    "in.(" + ",".join(AI_LINKABLE_WORKFLOW_STATUSES) + ")"
                ),
                "select": "id,current_version_id",
            },
            body={
                "current_version_id": version_id,
                "ai_status": draft["ai_status"],
                "workflow_status": "pending_review",
            },
        )
        linked_rows = payload if isinstance(payload, list) else []
        if ok and linked_rows:
            result["ai_versions_linked"] += 1
        elif ok:
            result["ai_versions_protected"] += 1
        else:
            result["ai_versions_failed"] += 1
            if len(result["errors"]) < 20:
                result["errors"].append(error or "AI version link failed.")

    if result["ai_versions_failed"]:
        result["editorial_status"] = (
            "partial" if result["ai_versions_synced"] else "failed"
        )
        result["editorial_reason"] = "Some AI editorial versions could not be synchronized."


def _retry_delay(response: Any, attempt: int, base_delay: float) -> float:
    retry_after = _text(getattr(response, "headers", {}).get("Retry-After"))
    if retry_after:
        try:
            return min(60.0, max(0.0, float(retry_after)))
        except ValueError:
            pass
    return min(60.0, base_delay * (2**attempt))


def _post_batch(
    session: Any,
    endpoint: str,
    headers: Mapping[str, str],
    batch: list[dict[str, Any]],
    *,
    timeout: float,
    max_retries: int,
    retry_base_delay: float,
    sleep_fn: Callable[[float], None],
    api_key: str,
    conflict_column: str,
) -> tuple[bool, int, str]:
    retries_used = 0
    for attempt in range(max_retries + 1):
        try:
            response = session.post(
                endpoint,
                params={"on_conflict": conflict_column},
                headers=dict(headers),
                json=batch,
                timeout=timeout,
            )
        except Exception as exc:
            if attempt >= max_retries:
                return False, retries_used, f"Supabase network error: {type(exc).__name__}"
            retries_used += 1
            sleep_fn(min(60.0, retry_base_delay * (2**attempt)))
            continue

        status_code = int(getattr(response, "status_code", 0))
        if 200 <= status_code < 300:
            return True, retries_used, ""
        if status_code not in RETRYABLE_STATUS_CODES or attempt >= max_retries:
            return False, retries_used, _redacted_error(response, api_key)
        retries_used += 1
        sleep_fn(_retry_delay(response, attempt, retry_base_delay))

    return False, retries_used, "Supabase request failed"


def _detect_schema_mode(
    session: Any,
    endpoint: str,
    headers: Mapping[str, str],
    timeout: float,
) -> str:
    """Choose rich/full schema when available, otherwise the legacy columns.

    PostgREST returns HTTP 400 when a selected column is absent. No row data is
    downloaded (``limit=1``), and no mutation occurs during this check.
    """
    requested = _text(os.getenv("SUPABASE_SCHEMA_MODE")).lower() or "auto"
    if requested in {"full", "legacy"}:
        return requested
    try:
        response = session.get(
            endpoint,
            params={"select": "canonical_url,source_url,takeaways", "limit": "1"},
            headers=dict(headers),
            timeout=timeout,
        )
    except Exception:
        # A connectivity/auth failure will be handled by the normal retrying
        # write path. Full is the least lossy default for a migrated project.
        return "full"
    try:
        status_code = int(getattr(response, "status_code", 0))
    except (TypeError, ValueError):
        return "full"
    return "full" if 200 <= status_code < 300 else "legacy"


def sync_news_to_supabase(
    records: Iterable[Mapping[str, Any]] | None,
    *,
    session: Any | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """Normalize and batch-upsert news, returning a non-throwing status object.

    Credentials are loaded only from environment variables populated by the
    project's ``.env`` file.  ``SUPABASE_SECRET_KEY`` (new key format) is
    preferred; ``SUPABASE_SERVICE_ROLE_KEY`` is supported for legacy projects.
    Supplying ``session`` and ``sleep_fn`` exists for offline/mock testing.
    """
    result = _base_result("skipped")
    if not _env_bool("SUPABASE_SYNC_ENABLED", True):
        result["reason"] = "Supabase synchronization is disabled."
        return result

    supabase_url = _text(
        os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    ).rstrip("/")
    secret_key = _text(os.getenv("SUPABASE_SECRET_KEY"))
    service_role_key = _text(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    api_key = secret_key or service_role_key
    missing = []
    if not supabase_url:
        missing.append("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
    if not api_key:
        missing.append("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        result["reason"] = "Supabase is not configured; missing " + ", ".join(missing) + "."
        return result

    try:
        parsed_url = urlsplit(supabase_url)
    except ValueError:
        parsed_url = None
    if (
        parsed_url is None
        or parsed_url.scheme.lower() not in {"http", "https"}
        or not parsed_url.netloc
    ):
        result["reason"] = "SUPABASE_URL is not a valid http(s) URL."
        return result

    table = _text(os.getenv("SUPABASE_NEWS_TABLE")) or DEFAULT_TABLE
    schema = _text(os.getenv("SUPABASE_SCHEMA")) or "public"
    if not TABLE_NAME_PATTERN.fullmatch(table) or not TABLE_NAME_PATTERN.fullmatch(schema):
        result["reason"] = "SUPABASE_NEWS_TABLE or SUPABASE_SCHEMA is invalid."
        return result

    try:
        raw_records = list(records or [])
    except TypeError:
        result.update(status="failed", reason="records must be an iterable of objects")
        return result
    result["input_records"] = len(raw_records)
    result["configured"] = True

    prepared_by_url: dict[str, dict[str, Any]] = {}
    for index, record in enumerate(raw_records):
        try:
            normalized = normalize_news_record(record)
        except (TypeError, ValueError) as exc:
            result["skipped_records"] += 1
            if len(result["errors"]) < 20:
                result["errors"].append(f"Record {index + 1} skipped: {exc}")
            continue
        canonical_url = normalized["canonical_url"]
        if canonical_url in prepared_by_url:
            result["duplicate_records"] += 1
            prepared_by_url[canonical_url] = _merge_normalized(
                prepared_by_url[canonical_url], normalized
            )
        else:
            prepared_by_url[canonical_url] = normalized

    prepared = list(prepared_by_url.values())
    result["prepared_records"] = len(prepared)
    result["ai_candidates"] = sum(
        bool(record.get("_ai_draft")) for record in prepared
    )
    if not prepared:
        result["reason"] = "No valid news records were available to synchronize."
        return result

    batch_size = _env_int("SUPABASE_BATCH_SIZE", 100, 1, 1000)
    max_retries = _env_int("SUPABASE_MAX_RETRIES", 3, 0, 8)
    timeout = _env_float("SUPABASE_TIMEOUT_SECONDS", 30.0, 1.0, 120.0)
    retry_base_delay = _env_float("SUPABASE_RETRY_DELAY_SECONDS", 1.0, 0.0, 30.0)

    endpoint = f"{supabase_url}/rest/v1/{quote(table, safe='')}"
    headers = {
        "apikey": api_key,
        # Supabase secret keys intentionally reject browser-like clients.  An
        # explicit backend identity also prevents host-shell HTTP defaults
        # (for example PowerShell's browser UA) from being misclassified.
        "User-Agent": "DailyBizGov-Backend/1.0",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal,missing=default",
        "Accept-Profile": schema,
        "Content-Profile": schema,
    }
    # New sb_secret keys authenticate through `apikey`.  The legacy
    # service_role JWT additionally supplies the PostgREST bearer identity.
    if not secret_key and service_role_key:
        headers["Authorization"] = f"Bearer {service_role_key}"

    own_session = session is None
    request_session = session or requests.Session()
    successfully_upserted_urls: set[str] = set()
    try:
        schema_mode = _detect_schema_mode(
            request_session, endpoint, headers, timeout
        )
        result["schema_mode"] = schema_mode
        conflict_column = "canonical_url" if schema_mode == "full" else "slug"
        for start in range(0, len(prepared), batch_size):
            record_batch = prepared[start : start + batch_size]
            batch = [_payload_for_mode(record, schema_mode) for record in record_batch]
            result["batches"] += 1
            result["attempted_records"] += len(batch)
            ok, retries_used, error = _post_batch(
                request_session,
                endpoint,
                headers,
                batch,
                timeout=timeout,
                max_retries=max_retries,
                retry_base_delay=retry_base_delay,
                sleep_fn=sleep_fn,
                api_key=api_key,
                conflict_column=conflict_column,
            )
            result["retries"] += retries_used
            if ok:
                result["upserted_records"] += len(batch)
                successfully_upserted_urls.update(
                    record["canonical_url"] for record in record_batch
                )
            else:
                result["failed_records"] += len(batch)
                result["errors"].append(error)

        if schema_mode == "full":
            _sync_ai_versions(
                prepared,
                successfully_upserted_urls,
                session=request_session,
                rest_root=f"{supabase_url}/rest/v1",
                news_endpoint=endpoint,
                headers=headers,
                timeout=timeout,
                api_key=api_key,
                result=result,
            )
        elif result["ai_candidates"]:
            result["editorial_reason"] = (
                "The legacy schema has no immutable article_versions table."
            )
    finally:
        if own_session:
            try:
                request_session.close()
            except Exception:
                # Closing a transport must not turn a completed synchronization
                # into an application-level failure.
                pass

    if result["failed_records"] == 0 and result["ai_versions_failed"] == 0:
        result.update(status="success", reason="Supabase upsert completed.")
    elif result["upserted_records"] or result["ai_versions_synced"]:
        result.update(status="partial", reason="Some Supabase batches failed.")
    else:
        result.update(status="failed", reason="Supabase upsert failed.")
    return result


def sync_news_file(path: str | os.PathLike[str] | None = None) -> dict[str, Any]:
    """Load a JSON array and synchronize it; useful for one-off backfills."""
    source_path = Path(path) if path else PROJECT_DIR / "news_feed.json"
    if not source_path.is_absolute():
        source_path = PROJECT_DIR / source_path
    try:
        with source_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        result = _base_result("failed", f"Could not read {source_path.name}: {exc}")
        return result
    if not isinstance(payload, list):
        return _base_result("failed", f"{source_path.name} must contain a JSON array.")
    return sync_news_to_supabase(payload)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Batch-upsert a local news JSON feed into Supabase."
    )
    parser.add_argument(
        "json_file",
        nargs="?",
        default=str(PROJECT_DIR / "news_feed.json"),
        help="JSON array to sync (default: news_feed.json)",
    )
    arguments = parser.parse_args()
    print(json.dumps(sync_news_file(arguments.json_file), indent=2, ensure_ascii=False))
