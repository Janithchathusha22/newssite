"""Server-only loading and matching for the newsroom source registry.

The admin application updates ``public.news_sources``.  A collection run reads
that table once before making any publisher requests, then uses the immutable
snapshot below for every adapter in that run.  Secret Supabase credentials are
read only on the server and are never included in errors or exported feeds.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit

import requests
from dotenv import load_dotenv


PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")


class SourceRegistryError(RuntimeError):
    """The authoritative source registry could not be loaded safely."""


def _text(value: Any) -> str:
    return str(value or "").strip()


def normalize_domain(value: Any) -> str:
    """Normalize a URL or hostname without accidentally accepting lookalikes."""
    text = _text(value).casefold()
    if not text:
        return ""
    candidate = text if "://" in text else f"//{text}"
    try:
        hostname = (urlsplit(candidate).hostname or "").casefold().rstrip(".")
    except ValueError:
        return ""
    return hostname[4:] if hostname.startswith("www.") else hostname


def _normalize_key(value: Any) -> str:
    return _text(value).casefold()


def _domain_matches(candidate: str, configured: str) -> bool:
    """Match a publisher and its real subdomains, never suffix lookalikes."""
    return candidate == configured or candidate.endswith(f".{configured}")


@dataclass(frozen=True)
class SourceRegistryEntry:
    domain: str
    adapter_key: str
    enabled: bool


@dataclass(frozen=True)
class SourceRegistry:
    """An authoritative, immutable snapshot of ``news_sources``.

    ``authoritative=False`` is used only for the explicit local/demo backend.
    It deliberately permits the repository defaults so local development does
    not require Supabase.  An authoritative registry denies unknown adapters;
    this prevents a newly added crawler from bypassing the admin controls.
    """

    entries: tuple[SourceRegistryEntry, ...] = ()
    authoritative: bool = True

    @classmethod
    def allow_defaults(cls) -> "SourceRegistry":
        return cls(entries=(), authoritative=False)

    @classmethod
    def from_rows(cls, rows: Iterable[Mapping[str, Any]]) -> "SourceRegistry":
        entries = []
        for row in rows:
            if not isinstance(row, Mapping):
                continue
            domain = normalize_domain(row.get("domain"))
            adapter_key = _normalize_key(row.get("adapter_key"))
            # PostgREST returns a JSON boolean.  Do not treat strings such as
            # "false" as truthy and accidentally re-enable a paused source.
            enabled = row.get("enabled") is True
            if domain or adapter_key:
                entries.append(SourceRegistryEntry(domain, adapter_key, enabled))
        return cls(tuple(entries), authoritative=True)

    def allows(
        self,
        *,
        domain: Any = "",
        adapter_key: Any = "",
        source_key: Any = "",
    ) -> bool:
        if not self.authoritative:
            return True

        candidate_domain = normalize_domain(domain)
        candidate_keys = {
            key
            for key in (_normalize_key(adapter_key), _normalize_key(source_key))
            if key
        }
        domain_matches = []
        key_matches = []
        for entry in self.entries:
            domain_match = bool(
                candidate_domain
                and entry.domain
                and _domain_matches(candidate_domain, entry.domain)
            )
            key_match = bool(entry.adapter_key and entry.adapter_key in candidate_keys)
            if domain_match:
                domain_matches.append(entry)
            elif key_match:
                key_matches.append(entry)

        # No matching registry row means there is no administrator-visible
        # switch for this adapter, so an authoritative run must keep it off.
        # Domain is authoritative when present: an unrelated enabled alias must
        # never override an explicitly paused publisher-domain row.
        matches = domain_matches or key_matches
        return bool(matches) and any(entry.enabled for entry in matches)


def _backend_mode() -> tuple[str, bool]:
    mode = _text(os.getenv("EDITORIAL_BACKEND") or "auto").casefold()
    if mode not in {"auto", "local", "supabase"}:
        raise SourceRegistryError("EDITORIAL_BACKEND must be auto, local, or supabase.")
    strict = mode == "supabase" or _text(os.getenv("NODE_ENV")).casefold() == "production"
    return mode, strict


def _timeout_seconds() -> float:
    try:
        value = float(os.getenv("SOURCE_REGISTRY_TIMEOUT_SECONDS", "20"))
    except (TypeError, ValueError):
        value = 20.0
    return min(120.0, max(1.0, value))


def _is_placeholder(value: str) -> bool:
    lowered = value.casefold()
    return not value or "your-project" in lowered or "replace-with" in lowered


def load_source_registry(*, session: Any = None) -> SourceRegistry:
    """Load enabled controls from Supabase, with an explicit safe policy.

    * ``local``: use every code-defined default and make no network request.
    * ``supabase``/production: any configuration, transport, HTTP, or payload
      error raises ``SourceRegistryError`` before publisher scraping begins.
    * ``auto`` development: use Supabase when configured and healthy; otherwise
      retain local/demo defaults, matching the editorial repository fallback.
    """
    mode, strict = _backend_mode()
    if mode == "local":
        return SourceRegistry.allow_defaults()

    supabase_url = _text(
        os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    ).rstrip("/")
    secret_key = _text(os.getenv("SUPABASE_SECRET_KEY"))
    service_role_key = _text(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    api_key = secret_key or service_role_key

    if _is_placeholder(supabase_url) or _is_placeholder(api_key):
        if strict:
            raise SourceRegistryError(
                "Supabase source controls are required but server credentials are missing."
            )
        return SourceRegistry.allow_defaults()

    try:
        parsed_url = urlsplit(supabase_url)
    except ValueError:
        parsed_url = None
    if not parsed_url or parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        if strict:
            raise SourceRegistryError("The configured Supabase URL is invalid.")
        return SourceRegistry.allow_defaults()

    headers = {
        "apikey": api_key,
        "Accept": "application/json",
        "Accept-Profile": "public",
        "User-Agent": "CeylonLedger-SourceRegistry/1.0",
    }
    # New sb_secret keys authenticate with apikey.  Legacy service-role JWTs
    # additionally use the bearer header, mirroring supabase_sync.py.
    if not secret_key and service_role_key:
        headers["Authorization"] = f"Bearer {service_role_key}"

    request_session = session or requests
    try:
        response = request_session.get(
            f"{supabase_url}/rest/v1/news_sources",
            headers=headers,
            params={"select": "domain,adapter_key,enabled"},
            timeout=_timeout_seconds(),
        )
        if not 200 <= int(response.status_code) < 300:
            raise SourceRegistryError(
                f"Supabase source registry returned HTTP {response.status_code}."
            )
        rows = response.json()
        if not isinstance(rows, list):
            raise SourceRegistryError("Supabase source registry returned an invalid payload.")
        return SourceRegistry.from_rows(rows)
    except SourceRegistryError:
        if strict:
            raise
    except (requests.RequestException, ValueError, TypeError) as exc:
        if strict:
            raise SourceRegistryError(
                f"Supabase source registry could not be loaded ({type(exc).__name__})."
            ) from exc

    # Development auto mode is explicitly the labelled local/demo fallback.
    return SourceRegistry.allow_defaults()
