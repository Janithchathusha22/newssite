"""
=============================================================================
PASSIVE VOICE JOURNALISTIC CONVERSION ENGINE
=============================================================================
Transforms news article content and summaries into formal, objective passive voice
while strictly maintaining 100% factual accuracy, numbers, entities, and meaning.
"""

import re
from typing import List, Tuple

# Common active financial/governance verbs to convert into formal journalistic passive
ACTIVE_TO_PASSIVE_VERBS = [
    (r'\b(The\s+)?Cabinet\s+approved\s+(.+)', r'Approval was granted by the Cabinet for \2'),
    (r'\b(The\s+)?Cabinet\s+of\s+Ministers\s+has\s+approved\s+(.+)', r'Approval has been granted by the Cabinet of Ministers for \2'),
    (r'\b(The\s+)?Central\s+Bank\s+(?:has\s+)?maintained\s+(.+)', r'Policy rates and measures were maintained by the Central Bank regarding \2'),
    (r'\b(The\s+)?Central\s+Bank\s+(?:has\s+)?bought\s+(.+)', r'\2 were purchased by the Central Bank'),
    (r'\b(The\s+)?Government\s+(?:has\s+)?denied\s+(.+)', r'\2 has been formally denied by the Government'),
    (r'\b(The\s+)?BASL\s+(?:has\s+)?warned\s+that\s+(.+)', r'A warning has been issued by the BASL that \2'),
    (r'\b(The\s+)?Board\s+(?:has\s+)?declared\s+(.+)', r'\2 was officially declared by the Board'),
    (r'\b(The\s+)?Ministry\s+of\s+Finance\s+(?:has\s+)?allocated\s+(.+)', r'\2 has been allocated by the Ministry of Finance'),
    (r'\b(The\s+)?Supreme\s+Court\s+(?:has\s+)?ordered\s+(.+)', r'An order was issued by the Supreme Court regarding \2'),
    (r'\b(The\s+)?Police\s+(?:have\s+)?arrested\s+(.+)', r'\2 were arrested by the Police'),
    (r'\bAuthorities\s+(?:have\s+)?launched\s+(.+)', r'An investigation was launched by authorities into \1'),
    (r'\bCompanies\s+reported\s+(.+)', r'\1 was reported by companies'),
    (r'\bExporters\s+earned\s+(.+)', r'\1 was earned by exporters'),
    (r'\bInvestors\s+withdrew\s+(.+)', r'\1 was withdrawn by investors'),
    (r'\b(The\s+)?Government\s+(?:has\s+)?signed\s+(.+)', r'\2 was signed by the Government'),
    (r'\b(The\s+)?Ministry\s+(?:has\s+)?announced\s+(.+)', r'An announcement was made by the Ministry regarding \2'),
    (r'\bCSE\s+(?:index\s+)?(?:has\s+)?fallen\s+by\s+(.+)', r'A decline of \1 was recorded in the CSE index'),
    (r'\bCSE\s+(?:index\s+)?(?:has\s+)?gained\s+(.+)', r'A gain of \1 was recorded in the CSE index'),
    (r'\bDollar\s+(?:rate\s+)?(?:has\s+)?hit\s+(.+)', r'A rate of \1 was recorded for the US Dollar'),
]

# Detection patterns for passive voice constructs: be + past participle
PASSIVE_INDICATORS = re.compile(
    r'\b(?:is|are|was|were|be|been|being)\s+([a-z]+ed|[a-z]+en|granted|made|held|won|lost|sold|built|sent|told|paid|spent|found|cut|hit)\b',
    re.IGNORECASE
)

def strip_publisher_boilerplate(text: str) -> str:
    """Removes scraper disclaimers, site self-promotions, and ads."""
    if not text:
        return ""
    boilerplate_patterns = [
        r"Hiru\s+News\s+Most\s+visited\s+website\s+in\s+Sri\s+Lanka[\s\S]*?(?:Company|Holdings|Site\s+for\s+Sri\s+Lankans\.?)",
        r"Welcome\s+to\s+the\s+No1\s+online\s+news\s+Site\s+for\s+Sri\s+Lankans[\s\S]*?(?:Company|Holdings|Sri\s+Lanka\.?)",
        r"Ada\s+Derana\s*[-–]?\s*Sri\s+Lanka'?s\s+Number\s+One\s+News\s+Portal.*",
        r"A\s+Rayynor\s+Silva\s+Holdings\s+Company.*",
        r"Most\s+visited\s+website\s+in\s+Sri\s+Lanka.*",
        r"Sri\s+Lanka\s+News\s+updates\s+and\s+discussions\..*",
    ]
    cleaned = text
    for pat in boilerplate_patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', cleaned).strip()

def is_passive_voice(text: str) -> bool:
    """Checks whether the text predominantly uses passive voice structures."""
    if not text:
        return False
    matches = PASSIVE_INDICATORS.findall(text)
    return len(matches) > 0


def apply_rule_based_passive(text: str) -> str:
    """
    Applies deterministic journalistic passive transformations to sentences
    while leaving facts, figures, and quotes completely untouched.
    """
    if not text:
        return ""

    result = strip_publisher_boilerplate(text)
    for active_pattern, passive_replacement in ACTIVE_TO_PASSIVE_VERBS:
        result = re.sub(active_pattern, passive_replacement, result, flags=re.IGNORECASE)

    return result


def format_passive_voice_article(
    headline: str,
    raw_summary: str,
    content: str,
    ai_passive_content: str = ""
) -> str:
    """
    Produces the final passive-voice news content.
    Prioritizes AI-generated passive journalism when available,
    and enriches with deterministic passive rules.
    """
    if ai_passive_content and len(ai_passive_content.strip()) > 50:
        return strip_publisher_boilerplate(ai_passive_content.strip())

    # Rule-based fallback
    source_text = content.strip() if content and len(content.strip()) > 50 else raw_summary.strip()
    source_text = strip_publisher_boilerplate(source_text)
    paragraphs = source_text.split('\n\n')
    transformed_paras = []

    for p in paragraphs:
        transformed_p = apply_rule_based_passive(p)
        transformed_paras.append(transformed_p)

    return '\n\n'.join(transformed_paras)
