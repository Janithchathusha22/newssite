"""Deterministic guardrails for AI-assisted editorial rewrites.

The model is useful for prose, but it is not the authority for facts.  This
module extracts high-risk factual tokens from the publisher copy and compares
them with the proposed editorial version before the article enters review.
It intentionally returns warnings instead of mutating source material.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Mapping


ALLOWED_CATEGORIES = {
    "business-news",
    "interviews-appointments",
    "money",
    "technology",
    "travel-tourism",
    "luxury-living",
}

INJECTION_MARKERS = (
    "ignore previous instructions",
    "ignore all previous",
    "system prompt",
    "developer message",
    "reveal your prompt",
    "reveal the api key",
    "follow these instructions",
    "do not follow the instructions above",
)

NEGATIVE_FACT_TERMS = {
    "decline": ("decline", "declined", "decrease", "decreased", "drop", "dropped", "fell", "fall"),
    "loss": ("loss", "losses", "lost"),
    "delay": ("delay", "delayed", "postponed"),
    "criticism": ("criticism", "criticised", "criticized", "concern", "concerns"),
    "failure": ("failed", "failure", "unable"),
}

POSITIVE_REVERSAL_TERMS = (
    "growth",
    "grew",
    "increase",
    "increased",
    "surge",
    "surged",
    "gain",
    "gained",
    "success",
    "successful",
)

QUALIFIERS = (
    "alleged",
    "allegedly",
    "expected",
    "proposed",
    "plans to",
    "planned",
    "may",
    "might",
    "could",
    "according to",
    "reportedly",
)

FACT_PATTERN = re.compile(
    r"(?<![\w])(?:"
    r"(?:rs\.?|lkr|usd|us\$|\$|€|£)\s*\d[\d,.]*(?:\s*(?:million|billion|trillion|mn|bn))?"
    r"|\d+(?:\.\d+)?\s*%"
    r"|\d[\d,.]*(?:\s*(?:million|billion|trillion|mn|bn))"
    r"|(?:19|20)\d{2}"
    r"|\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(?:19|20)\d{2})?"
    r"|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+(?:19|20)\d{2})?"
    r")",
    re.IGNORECASE,
)


def _normalise_fact(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower().replace(",", ""))


def extract_protected_facts(text: str) -> list[str]:
    """Return unique money, percentage, magnitude and date tokens."""
    facts: list[str] = []
    seen: set[str] = set()
    for match in FACT_PATTERN.finditer(str(text or "")):
        fact = match.group(0).strip()
        key = _normalise_fact(fact)
        if key and key not in seen:
            seen.add(key)
            facts.append(fact)
    return facts


def detect_prompt_injection(text: str) -> list[str]:
    lowered = str(text or "").casefold()
    return [marker for marker in INJECTION_MARKERS if marker in lowered]


@dataclass
class ValidationResult:
    status: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    protected_facts: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "errors": self.errors,
            "warnings": self.warnings,
            "protected_facts": self.protected_facts,
        }


def validate_editorial_rewrite(
    source_title: str,
    source_content: str,
    proposed: Mapping[str, Any],
) -> ValidationResult:
    """Validate a structured rewrite without assuming the model is truthful."""
    errors: list[str] = []
    warnings: list[str] = []
    source_text = f"{source_title or ''}\n{source_content or ''}".strip()
    output_text = "\n".join(
        str(proposed.get(key) or "") for key in ("headline", "summary", "content")
    )

    for key in ("headline", "summary", "content"):
        if not isinstance(proposed.get(key), str) or not proposed.get(key, "").strip():
            errors.append(f"Missing required editorial field: {key}")

    category = str(proposed.get("category") or "").strip()
    if category not in ALLOWED_CATEGORIES:
        errors.append(f"Unsupported category: {category or 'empty'}")

    tags = proposed.get("tags")
    if not isinstance(tags, list) or not 3 <= len(tags) <= 8:
        errors.append("Tags must contain between 3 and 8 items")

    source_facts = extract_protected_facts(source_text)
    output_facts = {_normalise_fact(value) for value in extract_protected_facts(output_text)}
    missing_facts = [fact for fact in source_facts if _normalise_fact(fact) not in output_facts]
    if missing_facts:
        errors.append("Protected facts missing from rewrite: " + ", ".join(missing_facts[:12]))

    source_lower = source_text.casefold()
    output_lower = output_text.casefold()
    for label, variants in NEGATIVE_FACT_TERMS.items():
        source_has_negative = any(term in source_lower for term in variants)
        output_keeps_negative = any(term in output_lower for term in variants)
        output_adds_positive = any(term in output_lower for term in POSITIVE_REVERSAL_TERMS)
        if source_has_negative and not output_keeps_negative and output_adds_positive:
            errors.append(f"Possible meaning reversal: source {label} was reframed as a positive result")

    for qualifier in QUALIFIERS:
        if qualifier in source_lower and qualifier not in output_lower:
            warnings.append(f"Source qualifier may have been removed: {qualifier}")

    injection_markers = detect_prompt_injection(source_text)
    if injection_markers:
        warnings.append(
            "Source contained instruction-like text and requires close human review: "
            + ", ".join(injection_markers[:4])
        )

    requested_status = str(proposed.get("rewrite_status") or "").strip()
    if requested_status == "needs_review":
        warnings.append("The AI explicitly requested human review")

    status = "needs_review" if errors or warnings else "ready_for_review"
    return ValidationResult(status, errors, warnings, source_facts)

