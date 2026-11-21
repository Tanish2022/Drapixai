"""Set DRAPIXAI_TEST_DISPOSABLE_REDIS=1 only in a fixture with loopback Redis."""
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import redis
from drapixai_ai.limits import usage_limiter


@unittest.skipUnless(os.getenv("DRAPIXAI_TEST_DISPOSABLE_REDIS") == "1", "requires disposable loopback Redis")
class DemoSettlementTests(unittest.TestCase):
    def test_only_accepted_receipts_debit_and_concurrent_replays_debit_once(self):
        client = redis.Redis(host="127.0.0.1", port=6379, db=15, socket_timeout=2, socket_connect_timeout=2)
        self.addCleanup(client.close)
        with patch.object(usage_limiter, "get_redis", return_value=client), patch.object(
            usage_limiter, "settings", replace(usage_limiter.settings, monthly_basic_limit=2)
        ):
            limiter = usage_limiter.UsageLimiter()
            user = "synthetic-demo-" + uuid4().hex
            month = limiter._month_key(user, datetime.now(timezone.utc))
            self.addCleanup(client.delete, month)
            rejected, accepted, parallel = (limiter.issue_demo_receipt() for _ in range(3))
            for receipt in (rejected, accepted, parallel):
                self.addCleanup(client.delete, "drapixai:tryon:public-demo:receipt:" + receipt)
            # The API discarded the first output for quality, so it never acknowledges that receipt.
            self.assertIsNone(client.get(month))
            with ThreadPoolExecutor(8) as pool:
                results = list(pool.map(lambda _: limiter.check_and_increment(user, demo_receipt=accepted), range(16)))
            self.assertEqual(results, [True] * 16)
            self.assertEqual(client.get(month), b"1")
            self.assertTrue(limiter.check_and_increment(user, demo_receipt=parallel))
            self.assertFalse(limiter.has_capacity(user))
            self.assertTrue(limiter.check_and_increment(user, demo_receipt=accepted))
            self.assertFalse(limiter.check_and_increment(user, demo_receipt=rejected))
            self.assertEqual(client.get(month), b"2")
            self.assertGreater(client.ttl(month), 0)
            with self.assertRaisesRegex(ValueError, "DEMO_RECEIPT_EXPIRED"):
                limiter.check_and_increment(user, demo_receipt=str(uuid4()))
            self.assertEqual(client.get(month), b"2")
