from __future__ import annotations

import json
import logging
import sys

from drapixai_ai.services.logger import JsonFormatter


def main() -> int:
    bearer = "Bearer launch-token-that-must-never-appear"
    api_keys = (
        "dpx_this_is_a_private_server_key",
        "dpxst_this_is_a_private_shopify_key",
        "dpxsf_this_is_a_private_storefront_key",
        "dpxpv_this_is_a_private_preview_key",
        "dpxapi_this_is_a_private_public_api_key",
    )
    email = "shopper.private@example.com"
    database_url = "postgresql://private_user:private_password@db.internal:5432/private"
    image_payload = "A" * 512

    try:
        raise RuntimeError(f"upstream failed with {bearer} for {email}")
    except RuntimeError:
        exc_info = sys.exc_info()

    record = logging.LogRecord(
        name="drapixai_ai.privacy_test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=f"request failed: {bearer}; keys={','.join(api_keys)}; db={database_url}; email={email}",
        args=(),
        exc_info=exc_info,
    )
    record.authorization = bearer
    record.api_keys = api_keys
    record.person_image_base64 = image_payload
    record.context = {
        "cookie": "session=private-cookie",
        "nested": [email, f"data:image/jpeg;base64,{image_payload}"],
    }

    rendered = JsonFormatter().format(record)
    parsed = json.loads(rendered)
    forbidden = (bearer, *api_keys, email, database_url, image_payload, "private-cookie")
    leaked = [label for label, value in (
        ("bearer", bearer),
        *(("api_key", api_key) for api_key in api_keys),
        ("email", email),
        ("database_url", database_url),
        ("image_payload", image_payload),
        ("cookie", "private-cookie"),
    ) if value in rendered]
    if leaked:
        raise AssertionError(f"AI log privacy validation failed for: {', '.join(leaked)}")
    if not isinstance(parsed, dict) or "[redacted" not in rendered:
        raise AssertionError("AI log privacy validation did not produce structured redaction markers")
    if any(value in rendered for value in forbidden):
        raise AssertionError("AI log privacy validation found sensitive data")

    print("AI log privacy validation PASSED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
