"""CPU-only execution of actual ingress/queue methods with synthetic adapters."""
from __future__ import annotations

import ast
import asyncio
import base64
import copy
import importlib.util
import json
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


async def noop(*args):
    return None


def actual_routes(mode):
    source = ast.parse((ROOT / "drapixai_ai/api/ai_server.py").read_text(encoding="utf-8"))
    functions = [copy.deepcopy(node) for node in source.body if isinstance(node, ast.AsyncFunctionDef) and node.name in {"tryon", "tryon_base64"}]
    for node in functions:
        node.decorator_list = []
    def enqueue(**kwargs):
        if mode == "quota": raise protocol.TryOnLimitExceeded("TRY_ON_LIMIT_EXCEEDED")
        if mode == "lost-enqueue": raise PermissionError("synthetic I/O ambiguity")
        return object()
    def wait(job):
        if mode == "timeout": raise TimeoutError()
        if mode == "failed": raise protocol.TryOnTerminalFailure("TRY_ON_FAILED")
        if mode == "unknown": raise RuntimeError("synthetic unknown")
        return {"image_base64": base64.b64encode(b"synthetic-image").decode(), "format": "png"}
    namespace = dict(asyncio=asyncio, base64=base64, json=json, HTTPException=HttpError, Response=Response,
                     TryOnLimitExceeded=protocol.TryOnLimitExceeded, TryOnTerminalFailure=protocol.TryOnTerminalFailure,
                     Form=lambda *a, **k: None, File=lambda *a, **k: None,
                     settings=SimpleNamespace(request_max_bytes=1024),
                     _quality_mode=lambda value: "standard", _normalize_garment_type=lambda value: "upper",
                     _tryon_profile_type=lambda *a: "upper", _validate_person_for_garment_type=noop,
                     _read_upload_limited=lambda *a: asyncio.sleep(0, result=b"image"),
                     _decode_base64_image=lambda *a: b"image", _validate_image_bytes=lambda *a: None,
                     service=SimpleNamespace(enqueue_tryon=enqueue, wait_for_result=wait),
                     logger=SimpleNamespace(info=lambda *a, **k: None))
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

    def test_middleware_wraps_existing_auth_body_refusals(self):
        tree = ast.parse((ROOT / "drapixai_ai/api/ai_server.py").read_text(encoding="utf-8"))
        logger = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "request_logger")
        registration = next(n for n in tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                            and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == "add_middleware")
        self.assertGreater(registration.lineno, logger.end_lineno)

    def test_queue_failure_types_do_not_invent_terminal_state(self):
        tree = ast.parse((ROOT / "drapixai_ai/services/tryon_service.py").read_text(encoding="utf-8"))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "TryOnService")
        namespace = dict(base64=base64, time=__import__("time"), TryOnLimitExceeded=protocol.TryOnLimitExceeded,
                         TryOnTerminalFailure=protocol.TryOnTerminalFailure, settings=SimpleNamespace(max_wait_seconds=0),
                         delete_transient=lambda *a: None)
        exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls], type_ignores=[])), "actual-queue-class", "exec"), namespace)
        service = namespace["TryOnService"].__new__(namespace["TryOnService"])
        service.limiter = SimpleNamespace(check_and_increment=lambda user: False)
        with self.assertRaises(protocol.TryOnLimitExceeded): service.enqueue_tryon("synthetic", b"a", b"b")
        job = SimpleNamespace(refresh=lambda: None, is_started=True)
        with self.assertRaises(TimeoutError): service.wait_for_result(job)


if __name__ == "__main__":
    import faulthandler
    faulthandler.dump_traceback_later(20)
    unittest.main()
