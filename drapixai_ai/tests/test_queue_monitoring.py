import json
import os
import unittest
from dataclasses import replace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import HTTPException
from redis import Redis
from redis.exceptions import ConnectionError

from drapixai_ai.api import monitoring
from drapixai_ai.queue import redis_queue


class QueueMonitoringTests(unittest.TestCase):
    @unittest.skipUnless(os.getenv("DRAPIXAI_TEST_DISPOSABLE_REDIS") == "1", "requires disposable loopback Redis")
    def test_serves_the_real_upper_and_lower_queue_backlog(self):
        redis = Redis(host="127.0.0.1", port=6379, db=15, socket_timeout=2, socket_connect_timeout=2)
        self.addCleanup(redis.close)
        prefix = "fixture-" + uuid4().hex
        upper, lower = prefix + "-upper", prefix + "-lower"
        upper_key, lower_key = "rq:queue:" + upper, "rq:queue:" + lower
        self.addCleanup(redis.delete, upper_key, lower_key)
        redis.rpush(upper_key, *(["job"] * 28))
        redis.rpush(lower_key, *(["job"] * 3))
        config = replace(redis_queue.settings, queue_name=upper, lower_body_queue_name=lower, ai_service_token="fixture")
        with patch.object(redis_queue, "get_redis", return_value=redis), patch.object(redis_queue, "_queues", {}), \
                patch.object(redis_queue, "settings", config), patch.object(monitoring, "settings", config):
            self.assertEqual(json.loads(monitoring.queue_depth("fixture").body), {"depth": 31})

    def test_counts_the_real_configured_rq_keys_once(self):
        for lower, expected in (("lower-stage", 31), ("upper-stage", 28)):
            config = replace(redis_queue.settings, queue_name="upper-stage", lower_body_queue_name=lower)
            redis = MagicMock()
            pipeline = redis.pipeline.return_value.__enter__.return_value
            totals = {"rq:queue:upper-stage": 28, "rq:queue:lower-stage": 3}
            pipeline.execute.side_effect = lambda: [totals[call.args[0]] for call in pipeline.llen.call_args_list]
            with self.subTest(lower=lower), patch.object(redis_queue, "settings", config), \
                    patch.object(redis_queue, "_queues", {}), patch.object(redis_queue, "get_redis", return_value=redis):
                self.assertEqual(redis_queue.tryon_queue_depth(), expected)

    def test_authentication_and_backend_failure(self):
        config = replace(monitoring.settings, ai_service_token="fixture")
        with patch.object(monitoring, "settings", config), patch.object(monitoring, "tryon_queue_depth") as read:
            for token in (None, "incorrect"):
                with self.assertRaises(HTTPException) as denied:
                    monitoring.queue_depth(token)
                self.assertEqual(denied.exception.status_code, 404)
            read.assert_not_called()
            read.return_value = 31
            self.assertEqual(json.loads(monitoring.queue_depth("fixture").body), {"depth": 31})
            read.side_effect = ConnectionError()
            with self.assertRaises(HTTPException) as unavailable:
                monitoring.queue_depth("fixture")
            self.assertEqual(unavailable.exception.status_code, 503)
