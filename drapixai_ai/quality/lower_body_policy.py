from __future__ import annotations

import math


MINIMUM_RESULT_SCORE = 0.95
MINIMUM_CASES_PER_CATEGORY = 12
MINIMUM_AUTOMATED_PASS_RATE = 0.90
MINIMUM_ADMIN_PASS_RATE = 0.95
MINIMUM_RELEASE_RUNS = 2


def is_unit_score(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0.0 <= value <= 1.0
    )


def lower_body_blocking_warnings(warnings: object, category: str) -> list[str]:
    if not isinstance(warnings, (list, tuple)):
        return ["INVALID_WARNING_EVIDENCE"]
    informational = {
        "LOWER_BODY_V1_REVIEW_REQUIRED",
        f"LOWER_BODY_PROFILE:{category.upper()}",
    }
    return sorted({
        warning if isinstance(warning, str) else "INVALID_WARNING_EVIDENCE"
        for warning in warnings
        if not isinstance(warning, str) or warning not in informational
    })
