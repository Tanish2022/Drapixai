"""Queue-lifecycle receipt only. No image/model/inference configuration."""
from __future__ import annotations


class TryOnLimitExceeded(PermissionError):
    """Known pre-enqueue quota refusal, unlike an arbitrary I/O PermissionError."""


class TryOnTerminalFailure(RuntimeError):
    """The worker is already failed or a completed result is unusable."""


class AdmissionProtocolMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") not in {"/ai/tryon", "/ai/tryon/base64"}:
            return await self.app(scope, receive, send)
        state = scope.setdefault("state", {})
        state["admission_work_state"] = "not-dispatched"

        async def receipt(message):
            if message["type"] == "http.response.start":
                headers = [(name, value) for name, value in message.get("headers", [])
                           if name.lower() not in {b"x-drapixai-admission-protocol", b"x-drapixai-work-state"}]
                work_state = state.get("admission_work_state", "uncertain")
                if work_state not in {"not-dispatched", "terminal"}:
                    work_state = "uncertain"
                headers.extend([(b"x-drapixai-admission-protocol", b"1"),
                                (b"x-drapixai-work-state", work_state.encode("ascii"))])
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, receipt)
