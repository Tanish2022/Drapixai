"""CPU-only execution of actual ingress/queue methods with synthetic adapters."""
from __future__ import annotations

import ast
import asyncio
import base64
import copy
import hmac
import importlib.util
import json
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("admission_protocol", ROOT / "drapixai_ai/services/admission_protocol.py")
protocol = importlib.util.module_from_spec(spec)
spec.loader.exec_module(protocol)


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


class State:
    def __init__(self, data):
        self.__dict__["data"] = data

    def __getattr__(self, name):
        return self.data.get(name)

    def __setattr__(self, name, value):
        self.data[name] = value


class Response:
    def __init__(self, content=b"", media_type=None, headers=None):
        self.content, self.headers = content, headers or {}
        self.status_code = 200


class JsonResponse(Response):
    def __init__(self, status_code, content, headers):
        super().__init__(content=content, headers=headers)
        self.status_code = status_code


async def noop(*args):
    return None


def actual_routes(mode, service_token="", received=None):
    source = ast.parse((ROOT / "drapixai_ai/api/ai_server.py").read_text(encoding="utf-8"))
    functions = [copy.deepcopy(node) for node in source.body if isinstance(node, ast.AsyncFunctionDef)
                 and node.name in {"request_logger", "tryon", "tryon_base64"}]
    for node in functions:
        node.decorator_list = []
    def enqueue(**kwargs):
        if received is not None:
            received.append(kwargs["subscription_quota_reserved"])
        if mode == "quota": raise protocol.TryOnLimitExceeded("TRY_ON_LIMIT_EXCEEDED")
        if mode == "spool-failed": raise protocol.TryOnPreDispatchFailure("TRY_ON_SPOOL_FAILED")
        if mode == "lost-enqueue": raise PermissionError("synthetic I/O ambiguity")
        return object()
    def wait(job):
        if mode == "timeout": raise TimeoutError()
        if mode == "failed": raise protocol.TryOnTerminalFailure("TRY_ON_FAILED")
        if mode == "quota-at-result": raise protocol.TryOnLimitExceeded("TRY_ON_LIMIT_EXCEEDED")
        if mode == "unknown": raise RuntimeError("synthetic unknown")
        return {"image_base64": base64.b64encode(b"synthetic-image").decode(), "format": "png"}
    namespace = dict(asyncio=asyncio, base64=base64, json=json, HTTPException=HttpError, Response=Response,
                     hmac=hmac, time=time, uuid=uuid, JSONResponse=JsonResponse, TRYON_PATHS=protocol.TRYON_PATHS,
                     _request_id=lambda value: value or "synthetic-request", _UPLOAD_READ_CHUNK_BYTES=1024,
                     TryOnLimitExceeded=protocol.TryOnLimitExceeded, TryOnTerminalFailure=protocol.TryOnTerminalFailure,
                     TryOnPreDispatchFailure=protocol.TryOnPreDispatchFailure,
                     Form=lambda *a, **k: None, File=lambda *a, **k: None,
                     settings=SimpleNamespace(request_max_bytes=1024, ai_service_token=service_token),
                     _quality_mode=lambda value: "standard", _normalize_garment_type=lambda value: "upper",
                     _tryon_profile_type=lambda *a: "upper", _validate_person_for_garment_type=noop,
                     _read_upload_limited=lambda *a: asyncio.sleep(0, result=b"image"),
                     _decode_base64_image=lambda *a: b"image", _validate_image_bytes=lambda *a: None,
                     service=SimpleNamespace(enqueue_tryon=enqueue, wait_for_result=wait),
                     logger=SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None))
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *functions], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "actual-ai-route-functions", "exec"), namespace)
    return namespace


class AdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def receipt(self, path, route=None, state=None, forged=False):
        scope = {"type": "http", "path": path, "state": state or {}}
        emitted = []
        async def app(scope, receive, send):
            code = 200
            if route:
                try: await route(State(scope["state"]))
                except HttpError as error: code = error.status_code
                except Exception: code = 500
            headers = [(b"x-drapixai-work-state", b"terminal")] if forged else []
            await send({"type": "http.response.start", "status": code, "headers": headers})
            await send({"type": "http.response.body", "body": b"synthetic"})
        await protocol.AdmissionProtocolMiddleware(app)(scope, noop, lambda message: asyncio.sleep(0, result=emitted.append(message)))
        return emitted[0]

    async def test_actual_route_lifecycle_for_both_payload_formats(self):
        expected = {"success": (200, "terminal"), "quota": (429, "not-dispatched"),
                    "timeout": (504, "uncertain"), "failed": (500, "terminal"),
                    "spool-failed": (503, "not-dispatched"), "quota-at-result": (429, "terminal"),
                    "unknown": (500, "uncertain"), "lost-enqueue": (500, "uncertain")}
        for route_name in ("tryon", "tryon_base64"):
            for mode, (status, work_state) in expected.items():
                with self.subTest(route=route_name, mode=mode):
                    routes = actual_routes(mode)
                    async def invoke(state):
                        request = SimpleNamespace(state=state)
                        if route_name == "tryon":
                            return await routes[route_name](request=request, user_id="synthetic", person_image=object(), cloth_image=object(), quality="standard", garment_type="upper", garment_category=None, cloth_cache_key=None)
                        payload = SimpleNamespace(user_id="synthetic", quality="standard", garment_type="upper", garment_category=None, person_image_base64="eA==", cloth_image_base64="eA==", cloth_cache_key=None)
                        return await routes[route_name](payload, request)
                    response = await self.receipt("/ai/tryon" + ("/base64" if route_name.endswith("base64") else ""), invoke)
                    headers = dict(response["headers"])
                    self.assertEqual(response["status"], status)
                    self.assertEqual(headers[b"x-drapixai-admission-protocol"], b"1")
                    self.assertEqual(headers[b"x-drapixai-work-state"].decode(), work_state)

    async def test_pre_enqueue_refusal_and_header_spoof_removal(self):
        async def rejected(state): raise HttpError(422, "synthetic validation")
        response = await self.receipt("/ai/tryon/base64", rejected, forged=True)
        values = [v for k, v in response["headers"] if k == b"x-drapixai-work-state"]
        self.assertEqual(values, [b"not-dispatched"])
        self.assertNotIn(b"x-drapixai-work-state", dict((await self.receipt("/health"))["headers"]))

    async def test_only_authenticated_reservations_bypass_the_local_quota(self):
        reservation = str(uuid.uuid4())
        token = "synthetic-service-token"
        cases = (
            (token, token, reservation, 200, [True]),
            (token, token, None, 200, [False]),
            (token, "wrong-token", reservation, 401, []),
            ("", "", reservation, 401, []),
            (token, token, "invalid-id", 400, []),
        )
        for path in sorted(protocol.TRYON_PATHS):
            for configured, supplied, claimed, status, expected in cases:
                with self.subTest(path=path, authenticated=configured == supplied and bool(configured),
                                  claim=claimed, status=status):
                    received = []
                    routes = actual_routes("success", service_token=configured, received=received)
                    headers = {"x-drapixai-service-token": supplied}
                    if claimed is not None:
                        headers["x-drapixai-quota-reservation"] = claimed
                    request = SimpleNamespace(url=SimpleNamespace(path=path), method="POST",
                                              headers=headers, state=SimpleNamespace())
                    async def route(req):
                        if path.endswith("/base64"):
                            payload = SimpleNamespace(user_id="synthetic", quality="standard",
                                                      garment_type="upper", garment_category=None,
                                                      person_image_base64="eA==", cloth_image_base64="eA==",
                                                      cloth_cache_key=None)
                            return await routes["tryon_base64"](payload, req)
                        return await routes["tryon"](req, "synthetic", object(), object(), "standard",
                                                     "upper", None, None)
                    result = await routes["request_logger"](request, route)
                    self.assertEqual(getattr(result, "status_code", 200), status)
                    self.assertEqual(received, expected)

    def test_middleware_wraps_existing_auth_body_refusals(self):
        tree = ast.parse((ROOT / "drapixai_ai/api/ai_server.py").read_text(encoding="utf-8"))
        logger = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "request_logger")
        registration = next(n for n in tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                            and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == "add_middleware")
        self.assertGreater(registration.lineno, logger.end_lineno)

    def queue_service(self):
        tree = ast.parse((ROOT / "drapixai_ai/services/tryon_service.py").read_text(encoding="utf-8"))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "TryOnService")
        class RedisTimeout(Exception):
            pass

        deleted_inputs = []
        namespace = dict(base64=base64, time=time, TryOnLimitExceeded=protocol.TryOnLimitExceeded,
                         TryOnTerminalFailure=protocol.TryOnTerminalFailure, settings=SimpleNamespace(max_wait_seconds=0),
                         TryOnPreDispatchFailure=protocol.TryOnPreDispatchFailure,
                         RedisConnectionError=ConnectionError, RedisTimeoutError=RedisTimeout, RedisError=RedisTimeout,
                         JobStatus=SimpleNamespace(FAILED="failed", FINISHED="finished"),
                         delete_transient=deleted_inputs.append)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls], type_ignores=[])), "actual-queue-class", "exec"), namespace)
        service = namespace["TryOnService"].__new__(namespace["TryOnService"])
        return service, namespace, deleted_inputs

    def test_queue_failure_types_do_not_invent_terminal_state(self):
        service, namespace, deleted_inputs = self.queue_service()
        RedisTimeout = namespace["RedisTimeoutError"]
        service.limiter = SimpleNamespace(has_capacity=lambda user: False)
        with self.assertRaises(protocol.TryOnLimitExceeded): service.enqueue_tryon("synthetic", b"a", b"b")
        namespace["settings"] = SimpleNamespace(job_timeout_seconds=900, queue_ttl_seconds=180,
                                                result_ttl_seconds=60, failure_ttl_seconds=60)
        namespace["write_transient_bytes"] = lambda data: data.decode()
        namespace["run_tryon_job"] = noop
        service.limiter = SimpleNamespace(check_and_increment=lambda user: False)
        queued_job = object()
        service.upper_queue = SimpleNamespace(enqueue=lambda *args, **kwargs: queued_job)
        self.assertIs(service.enqueue_tryon("synthetic", b"a", b"b", subscription_quota_reserved=True), queued_job)

        def lost_acknowledgement(*args, **kwargs):
            raise RedisTimeout("synthetic lost acknowledgement")

        service.upper_queue = SimpleNamespace(enqueue=lost_acknowledgement)
        with self.assertRaises(RedisTimeout):
            service.enqueue_tryon("synthetic", b"person-ref", b"cloth-ref", subscription_quota_reserved=True)
        self.assertEqual(deleted_inputs, [])

        charges = []
        service.limiter = SimpleNamespace(has_capacity=lambda user: True,
                                          check_and_increment=lambda user: charges.append(user) or True)

        def write_input(data):
            if data == b"cloth-ref":
                raise OSError("synthetic disk full")
            return data.decode()

        namespace["write_transient_bytes"] = write_input
        with self.assertRaisesRegex(protocol.TryOnPreDispatchFailure, "TRY_ON_SPOOL_FAILED"):
            service.enqueue_tryon("synthetic", b"person-ref", b"cloth-ref")
        self.assertEqual(deleted_inputs, ["person-ref"])
        self.assertEqual(charges, [])

        namespace["settings"].max_wait_seconds = 1
        payload = {"user_id": "synthetic", "count_local_quota_on_result": True}
        job = SimpleNamespace(refresh=lambda: None, get_status=lambda **kwargs: "finished",
                              result=None, args=(payload,), delete=lambda: None)
        with self.assertRaisesRegex(protocol.TryOnTerminalFailure, "TRY_ON_OUTPUT_MISSING"):
            service.wait_for_result(job)
        job.result = {}
        with self.assertRaisesRegex(protocol.TryOnTerminalFailure, "TRY_ON_OUTPUT_MISSING"):
            service.wait_for_result(job)
        job.result = {"output_image_ref": "output-ref"}

        def missing_output(reference):
            raise FileNotFoundError(reference)

        namespace["read_transient_bytes"] = missing_output
        with self.assertRaisesRegex(protocol.TryOnTerminalFailure, "TRY_ON_OUTPUT_MISSING"):
            service.wait_for_result(job)
        self.assertEqual(charges, [])

        namespace["read_transient_bytes"] = lambda reference: b"synthetic-image"
        self.assertEqual(service.wait_for_result(job)["image_base64"], "c3ludGhldGljLWltYWdl")
        self.assertEqual(charges, ["synthetic"])
        payload.pop("count_local_quota_on_result")
        service.wait_for_result(job)
        self.assertEqual(charges, ["synthetic"], "Older jobs must not be charged again")

    def test_deadline_poll_consumes_completed_results_and_preserves_pending_work(self):
        for final_status, score in (("finished", 0.95), ("finished", 0.949999), ("queued", None), ("started", None)):
            with self.subTest(final_status=final_status, score=score):
                service, namespace, deleted_files = self.queue_service()
                namespace["settings"] = SimpleNamespace(max_wait_seconds=1, poll_interval_seconds=2)
                namespace["read_transient_bytes"] = lambda reference: b"synthetic-image"
                now = 0
                poll_times = []
                deleted_jobs = []

                def sleep(seconds):
                    nonlocal now
                    now += seconds

                def refresh():
                    poll_times.append(now)
                    if now >= 1:
                        job.status = final_status
                        if score is not None:
                            job.result = {"output_image_ref": "output-ref", "quality_score": score}

                namespace["time"] = SimpleNamespace(monotonic=lambda: now, sleep=sleep)
                job = SimpleNamespace(
                    status="queued", result=None, args=(), refresh=refresh,
                    get_status=lambda **kwargs: job.status, delete=lambda: deleted_jobs.append(True),
                )
                if score is not None:
                    self.assertEqual(service.wait_for_result(job), {
                        "image_base64": "c3ludGhldGljLWltYWdl",
                        "quality_score": score,
                    })
                    self.assertEqual(deleted_files, ["output-ref"])
                    self.assertEqual(deleted_jobs, [True])
                else:
                    with self.assertRaisesRegex(TimeoutError, "TRY_ON_TIMEOUT"):
                        service.wait_for_result(job)
                    self.assertEqual(deleted_files, [])
                    self.assertEqual(deleted_jobs, [])
                self.assertEqual(poll_times, [0, 1])


if __name__ == "__main__":
    import faulthandler
    faulthandler.dump_traceback_later(20)
    unittest.main()
