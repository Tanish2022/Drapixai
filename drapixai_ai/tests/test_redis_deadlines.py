"""Exercise the AI Redis transport against a silent loopback peer."""

import ast
import socketserver
import threading
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import redis
from rq import Queue, Worker

from drapixai_ai.queue import redis_queue


class SilentRedis(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(8)
        with self.request.makefile("rb") as stream:
            # Consume one complete RESP command, then withhold its reply.
            count = int(stream.readline()[1:])
            command = []
            for _ in range(count):
                size = int(stream.readline()[1:])
                command.append(stream.read(size))
                stream.read(2)
            self.server.commands.append(command)
            stream.read(1)


class RedisDeadlineTests(unittest.TestCase):
    def test_a_silent_write_times_out_without_replaying_the_command(self):
        with socketserver.ThreadingTCPServer(("127.0.0.1", 0), SilentRedis) as peer:
            peer.daemon_threads = True
            peer.commands = []
            thread = threading.Thread(target=peer.serve_forever, daemon=True)
            thread.start()
            self.addCleanup(thread.join, 2)
            url = (
                f"redis://127.0.0.1:{peer.server_address[1]}/0"
                "?socket_timeout=60&socket_connect_timeout=60&retry_on_timeout=true"
            )
            try:
                settings = replace(redis_queue.settings, redis_url=url, redis_password="")
                with patch.object(redis_queue, "settings", settings), patch.object(redis_queue, "_redis_conn", None):
                    client = redis_queue.get_redis()
                    # Skip client identification so the silent response is for the write.
                    client.connection_pool.connection_kwargs.update(lib_name=None, lib_version=None)
                    self.addCleanup(client.connection_pool.disconnect)
                    self.assertEqual(client.connection_pool.connection_kwargs["socket_connect_timeout"], 2.0)
                    start = time.monotonic()
                    with self.assertRaises(redis.exceptions.TimeoutError):
                        client.incr("synthetic-deadline-counter")
                    self.assertLess(time.monotonic() - start, 6.0)
                    self.assertEqual(peer.commands, [[b"INCRBY", b"synthetic-deadline-counter", b"1"]])
            finally:
                peer.shutdown()

    def test_rq_keeps_its_blocking_dequeue_window_on_a_separate_pool(self):
        settings = replace(redis_queue.settings, redis_url="redis://127.0.0.1:1/0", redis_password="")
        with patch.object(redis_queue, "settings", settings), patch.object(redis_queue, "_redis_conn", None):
            api = redis_queue.get_redis()
            worker_connection = redis_queue.create_worker_redis()
            queue = Queue("synthetic-deadlines", connection=worker_connection)
            worker = Worker([queue], connection=worker_connection, prepare_for_work=False)

        self.assertIsNot(api.connection_pool, worker_connection.connection_pool)
        self.assertEqual(api.connection_pool.connection_kwargs["socket_timeout"], 3.0)
        self.assertEqual(worker_connection.connection_pool.connection_kwargs["socket_connect_timeout"], 2.0)
        self.assertGreater(
            worker_connection.connection_pool.connection_kwargs["socket_timeout"],
            worker.dequeue_timeout,
        )

    def test_readiness_uses_fastapi_sync_dispatch(self):
        path = Path(__file__).resolve().parents[1] / "api" / "ai_server.py"
        tree = ast.parse(path.read_text(encoding="utf-8"))
        handler = next(node for node in tree.body if getattr(node, "name", None) == "ready")
        self.assertIsInstance(handler, ast.FunctionDef)


if __name__ == "__main__":
    unittest.main()
