from __future__ import annotations

import json
import os

from drapixai_ai.services.garment_cache import GarmentCache


def main() -> None:
    limit = int(os.getenv("DRAPIXAI_GARMENT_CACHE_PURGE_LIMIT", "1000"))
    print(json.dumps(GarmentCache().purge_expired(limit), sort_keys=True))


if __name__ == "__main__":
    main()
