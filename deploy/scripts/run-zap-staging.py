#!/usr/bin/env python3
"""Bounded staging HTTPS capture and network-disabled ZAP passive analysis.

No spider, active scanner, authentication, form submission or redirect following.
The exact URL list is approved, not discovered from untrusted page content.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import http.client
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import queue
import re
import signal
import socket
import ssl
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import urlsplit

# Reuse release/UTC governance; never activate the Strix scanner or an LLM.
spec = importlib.util.spec_from_file_location("drapixai_scan_governance", Path(__file__).with_name("run-strix-staging.py"))
governance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(governance)
PolicyError = governance.PolicyError
ACK = "I_HAVE_WRITTEN_AUTHORIZATION_FOR_THIS_STAGING_TARGET"
IMAGE = re.compile(r"ghcr\.io/zaproxy/zaproxy@sha256:[a-f0-9]{64}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
MAX_FILE = 8 * 1024 * 1024
DOCKER = ["docker", "--host", "unix:///var/run/docker.sock"]


def canonical_origin(value):
    if not isinstance(value, str) or not re.fullmatch(r"https://[a-z0-9.-]+", value):
        raise PolicyError("Exact lowercase HTTPS origin required; no port, path, credentials, query or fragment")
    host = urlsplit(value).hostname
    if len(host) > 253 or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")):
        raise PolicyError("Invalid target hostname")
    if not re.search(r"(?:^|[.-])staging(?:[.-]|$)", host) or host in governance.PRODUCTION_HOSTS:
        raise PolicyError("Explicit non-production staging origin required")
    return host


def permitted_ip(value, allow_private):
    if not isinstance(value, str):
        raise PolicyError("Target addresses must be literal IP strings")
    try:
        ip = ipaddress.ip_address(value)
    except ValueError as error:
        raise PolicyError("Invalid target address") from error
    if str(ip) != value or not isinstance(ip, ipaddress.IPv4Address):
        raise PolicyError("This collector supports canonical IPv4 pins only")
    private = any(ip in ipaddress.ip_network(cidr) for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
    if any(ip in ipaddress.ip_network(cidr) for cidr in ("0.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4")):
        raise PolicyError("Forbidden special-purpose target address")
    if not ip.is_global and not (allow_private and private):
        raise PolicyError("Target address is outside permitted public/RFC1918 space")
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        raise PolicyError("Forbidden target address")
    return value


def validate_authorization(data, target, *, now=None, expected_commit=None):
    fields = {"schemaVersion", "authorizationId", "environment", "releaseCommit", "approvedBy", "approvalReference", "incidentContact", "validFrom", "validUntil", "targetOrigin", "targetAddresses", "paths", "zapImage", "maxRequestsPerSecond", "requestTimeoutSeconds", "maxRunSeconds", "maxResponseBytes", "maxTotalBytes", "syntheticDataOnly", "companyOwnedTarget", "unauthenticatedGetOnly", "edgeRateLimitEnforced", "allowPrivateTargetAddresses", "allowProductionTargets", "allowThirdPartyTargets", "allowDestructiveTesting", "independentPentestReplacement"}
    if not isinstance(data, dict) or set(data) != fields or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
        raise PolicyError("Exact ZAP authorization schema required")
    if data["environment"] != "staging":
        raise PolicyError("environment must be staging")
    canonical_origin(data["targetOrigin"])
    if target != data["targetOrigin"]:
        raise PolicyError("Requested target does not exactly match authorization")
    for key in ("authorizationId", "approvedBy", "approvalReference", "incidentContact"):
        governance.require_text(data, key, 8, 256)
        if re.search(r"REPLACE|EXAMPLE|YYYY", data[key], re.I):
            raise PolicyError("Authorization placeholders are not approvals")
    if not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", data["authorizationId"]):
        raise PolicyError("Invalid authorization reference")
    if not isinstance(data["releaseCommit"], str) or not re.fullmatch(r"[a-f0-9]{40}", data["releaseCommit"]) or data["releaseCommit"] == "0" * 40:
        raise PolicyError("Exact release commit required")
    if expected_commit is not None and data["releaseCommit"] != expected_commit:
        raise PolicyError("Authorization does not match the clean release")
    for key in ("syntheticDataOnly", "companyOwnedTarget", "unauthenticatedGetOnly", "edgeRateLimitEnforced"):
        if data[key] is not True:
            raise PolicyError(key + " must be true")
    for key in ("allowProductionTargets", "allowThirdPartyTargets", "allowDestructiveTesting", "independentPentestReplacement"):
        if data[key] is not False:
            raise PolicyError(key + " must be false")
    if type(data["allowPrivateTargetAddresses"]) is not bool:
        raise PolicyError("Private address approval must be explicit")
    start, end = (governance.parse_utc(data[key], key) for key in ("validFrom", "validUntil"))
    current = now or datetime.now(timezone.utc)
    if not 0 < (end - start).total_seconds() <= 86400 or not start <= current < end:
        raise PolicyError("Authorization window is inactive, inverted or longer than 24 hours")
    for key, minimum, maximum in (("maxRequestsPerSecond", 1, 2), ("requestTimeoutSeconds", 1, 10), ("maxRunSeconds", 5, 300), ("maxResponseBytes", 1, 1048576), ("maxTotalBytes", 1, MAX_FILE)):
        if type(data[key]) is not int or not minimum <= data[key] <= maximum:
            raise PolicyError("Invalid bound: " + key)
    if data["maxTotalBytes"] < data["maxResponseBytes"]:
        raise PolicyError("Total byte budget is smaller than response budget")
    paths = data["paths"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= 20 or any(not isinstance(v, str) for v in paths) or len(set(paths)) != len(paths):
        raise PolicyError("Approve one to twenty unique exact paths")
    for value in paths:
        if len(value) > 512 or not re.fullmatch(r"/[A-Za-z0-9_./-]*", value) or "//" in value or any(part in (".", "..") for part in value.split("/")):
            raise PolicyError("Paths cannot contain queries, escapes, traversal or other origins")
    addresses = data["targetAddresses"]
    if not isinstance(addresses, list) or not 1 <= len(addresses) <= 8 or any(not isinstance(v, str) for v in addresses) or len(set(addresses)) != len(addresses):
        raise PolicyError("Approve one to eight exact address pins")
    for address in addresses:
        permitted_ip(address, data["allowPrivateTargetAddresses"])
    if not isinstance(data["zapImage"], str) or not IMAGE.fullmatch(data["zapImage"]):
        raise PolicyError("Approved official ZAP image digest required")
    return data


def load_authorization(file, digest):
    if not isinstance(digest, str) or not SHA.fullmatch(digest):
        raise PolicyError("Separately reviewed authorization SHA-256 required")
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 32768:
        raise PolicyError("Authorization must be a bounded regular file")
    content = file.read_bytes()
    if hashlib.sha256(content).hexdigest() != digest:
        raise PolicyError("Authorization changed or digest does not match")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise PolicyError("Duplicate authorization field")
            result[key] = value
        return result
    try:
        return json.loads(content, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as error:
        raise PolicyError("Invalid authorization JSON") from error


def resolve_pins(policy, deadline):
    host = canonical_origin(policy["targetOrigin"])
    results = queue.Queue(maxsize=1)
    def lookup():
        try:
            results.put(socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM))
        except Exception:
            results.put(None)
    threading.Thread(target=lookup, daemon=True).start()
    try:
        rows = results.get(timeout=max(0.001, min(5, deadline - time.monotonic())))
    except queue.Empty as error:
        raise PolicyError("DNS deadline exceeded") from error
    if not rows:
        raise PolicyError("DNS resolution failed")
    if time.monotonic() >= deadline:
        raise PolicyError("DNS completed after the run deadline")
    addresses = {row[4][0] for row in rows}
    for address in addresses:
        permitted_ip(address, policy["allowPrivateTargetAddresses"])
    if addresses != set(policy["targetAddresses"]):
        raise PolicyError("DNS does not exactly match approved address pins")
    return sorted(addresses)[0]


class PinnedHttps(http.client.HTTPSConnection):
    def __init__(self, host, address, deadline):
        super().__init__(host, 443, timeout=max(0.001, deadline - time.monotonic()), context=ssl.create_default_context())
        self.address, self.deadline = address, deadline
        self.stopped = threading.Event()
        self.live = []
        self.guard = threading.Lock()

    def track(self, connection):
        with self.guard:
            if self.stopped.is_set():
                connection.close()
                raise PolicyError("HTTPS deadline exceeded")
            self.live.append(connection)

    def abort(self):
        self.stopped.set()
        with self.guard:
            for connection in self.live:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()

    def connect(self):
        raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.track(raw)
        raw.settimeout(max(0.001, self.deadline - time.monotonic()))
        raw.connect((self.address, self.port))
        secured = self._context.wrap_socket(raw, server_hostname=self.host, do_handshake_on_connect=False)
        self.track(secured)
        secured.settimeout(max(0.001, self.deadline - time.monotonic()))
        secured.do_handshake()
        self.sock = secured


def capture_response(policy, path, address, deadline):
    host = canonical_origin(policy["targetOrigin"])
    end = min(deadline, time.monotonic() + policy["requestTimeoutSeconds"])
    if time.monotonic() >= end:
        raise PolicyError("Run deadline exceeded before HTTPS connection")
    connection = PinnedHttps(host, address, end)
    timer = threading.Timer(max(0.001, end - time.monotonic()), connection.abort)
    timer.daemon = True
    timer.start()
    started = datetime.now(timezone.utc).isoformat()
    headers = {"Accept": "text/html,application/json,text/plain", "Accept-Encoding": "identity", "User-Agent": "DrapixAI-Scoped-Passive-Capture/1", "Connection": "close"}
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        if response.status != 200:
            raise PolicyError("Capture requires HTTP 200; redirects and errors are not coverage")
        if response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
            raise PolicyError("Compressed responses are not accepted")
        lengths = [v for k, v in response.getheaders() if k.lower() == "content-length"]
        if lengths and (len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]) or int(lengths[0]) > policy["maxResponseBytes"]):
            raise PolicyError("Invalid or excessive declared response length")
        chunks, total = [], 0
        while True:
            if time.monotonic() >= end:
                raise PolicyError("HTTPS deadline exceeded")
            chunk = response.read1(min(65536, policy["maxResponseBytes"] - total + 1))
            if connection.stopped.is_set() or time.monotonic() >= end:
                raise PolicyError("HTTPS deadline exceeded during body read")
            if not chunk:
                break
            total += len(chunk)
            if total > policy["maxResponseBytes"]:
                raise PolicyError("Response byte budget exceeded")
            chunks.append(chunk)
        body = b"".join(chunks)
        if lengths and len(body) != int(lengths[0]):
            raise PolicyError("Truncated response cannot count as coverage")
        return {"startedDateTime": started, "time": 0, "request": {"method": "GET", "url": policy["targetOrigin"] + path, "httpVersion": "HTTP/1.1", "cookies": [], "headers": [{"name": k, "value": v} for k, v in headers.items()], "queryString": [], "headersSize": -1, "bodySize": 0},
                "response": {"status": 200, "statusText": "OK", "httpVersion": "HTTP/1.1", "cookies": [], "headers": [{"name": k, "value": v} for k, v in response.getheaders()], "content": {"size": len(body), "mimeType": response.getheader("Content-Type", "application/octet-stream").split(";")[0], "text": base64.b64encode(body).decode("ascii"), "encoding": "base64"}, "redirectURL": "", "headersSize": -1, "bodySize": len(body)}, "cache": {}, "timings": {"send": 0, "wait": 0, "receive": 0}}
    except (OSError, http.client.HTTPException) as error:
        raise PolicyError("Verified HTTPS capture failed or exceeded its deadline") from error
    finally:
        timer.cancel()
        connection.abort()
        connection.close()


def collect(policy, check, deadline):
    entries, total, next_request = [], 0, 0.0
    for path in policy["paths"]:
        delay = max(0, next_request - time.monotonic())
        if delay:
            time.sleep(min(delay, max(0, deadline - time.monotonic())))
        check()
        if time.monotonic() >= deadline:
            raise PolicyError("Run deadline exceeded before capture")
        remaining = policy["maxTotalBytes"] - total
        if remaining <= 0:
            raise PolicyError("Aggregate byte budget exhausted before next request")
        address = resolve_pins(policy, deadline)
        check()
        entry = capture_response({**policy, "maxResponseBytes": min(policy["maxResponseBytes"], remaining)}, path, address, deadline)
        total += entry["response"]["content"]["size"]
        if total > policy["maxTotalBytes"]:
            raise PolicyError("Aggregate response byte budget exceeded")
        entries.append(entry)
        next_request = time.monotonic() + 1 / policy["maxRequestsPerSecond"]
    check()
    return {"log": {"version": "1.2", "creator": {"name": "DrapixAI scoped capture", "version": "1"}, "entries": entries}}


def offline_plan(origin, paths):
    return {"env": {"contexts": [{"name": "authorized-capture", "urls": [origin], "includePaths": ["^" + re.escape(origin + path) + "$" for path in paths]}], "parameters": {"failOnError": True, "failOnWarning": True, "continueOnFailure": False}}, "jobs": [
        {"type": "import", "parameters": {"type": "har", "fileName": "/zap/wrk/traffic.har", "sendRequests": False, "maxMessages": 20}},
        {"type": "passiveScan-wait", "parameters": {"maxDuration": 1}},
        {"type": "export", "parameters": {"type": "har", "source": "history", "fileName": "/zap/wrk/out/imported.har"}},
        {"type": "report", "parameters": {"template": "traditional-json", "reportDir": "/zap/wrk/out", "reportFile": "report.json", "displayReport": False}},
        {"type": "exitStatus", "parameters": {"errorLevel": "Informational", "okExitValue": 0, "errorExitValue": 1, "warnExitValue": 2}}]}


def docker_command(image, work, uid, gid, label):
    return [*DOCKER, "create", "--pull=never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--memory", "4g", "--cpus", "2", "--user", f"{uid}:{gid}", "--label", label,
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m,mode=1777", "--env", "HOME=/tmp/zap-home", "--env", "JAVA_TOOL_OPTIONS=-XX:ActiveProcessorCount=2 -Xmx2g",
            "--mount", f"type=bind,source={work},target=/zap/wrk,readonly", "--mount", f"type=bind,source={work / 'out'},target=/zap/wrk/out", "--entrypoint", "zap.sh", image,
            "-cmd", "-dir", "/tmp/zap-home", "-autorun", "/zap/wrk/plan.yaml"]


def checked(command, **kwargs):
    result = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False, **kwargs)
    if result.returncode:
        raise PolicyError("Local Docker/release preflight failed")
    return result.stdout.strip()


def analyze(policy, work, check, deadline):
    image = json.loads(checked([*DOCKER, "image", "inspect", policy["zapImage"]]))[0]
    if policy["zapImage"] not in image.get("RepoDigests", []):
        raise PolicyError("Approved ZAP digest must already exist locally")
    command = docker_command(policy["zapImage"], work, os.getuid(), os.getgid(), "drapixai.zap-run=" + uuid.uuid4().hex)
    check()
    if time.monotonic() >= deadline:
        raise PolicyError("Run deadline exceeded before creating scanner")
    cid = checked(command)
    if not re.fullmatch(r"[a-f0-9]{64}", cid):
        raise PolicyError("Docker did not return an exact owned container ID")
    (work / "container-id.txt").write_text(cid + "\n", encoding="ascii")
    process = None
    try:
        if time.monotonic() >= deadline:
            raise PolicyError("Run deadline exceeded before starting scanner")
        with (work / "out" / "scanner.log").open("wb") as log:
            process = subprocess.Popen([*DOCKER, "start", "--attach", cid], stdout=log, stderr=subprocess.STDOUT)
            while process.poll() is None:
                check()
                if time.monotonic() >= deadline:
                    raise PolicyError("Offline analysis exceeded run deadline")
                files = list((work / "out").iterdir())
                if len(files) > 10 or any(f.is_symlink() or not f.is_file() for f in files) or sum(f.stat().st_size for f in files) > 32 * 1024 * 1024:
                    raise PolicyError("Offline report storage budget exceeded")
                time.sleep(0.1)
        check()
        if process.returncode != 0:
            raise PolicyError("ZAP reported alerts, warnings or incomplete analysis; review private output")
        if time.monotonic() >= deadline:
            raise PolicyError("Offline analysis completed after run deadline")
    finally:
        removed = None
        try:
            removed = subprocess.run([*DOCKER, "rm", "--force", cid], capture_output=True, timeout=15, check=False)
        finally:
            if process is not None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        if removed is None:
            raise PolicyError("Owned scanner cleanup incomplete; inspect container-id.txt")
        if removed.returncode != 0:
            raise PolicyError("Owned scanner container cleanup failed")
    verify_passive_artifacts(work)
    return image["Id"]


def verify_passive_artifacts(work):
    imported = bounded_json(work / "out" / "imported.har")
    original = bounded_json(work / "traffic.har")
    def signature(row):
        content = row["response"]["content"]
        body = base64.b64decode(content["text"], validate=True) if content.get("encoding") == "base64" else content["text"].encode("utf-8")
        if type(content["size"]) is not int or content["size"] != len(body):
            raise PolicyError("Imported body length does not match recorded content")
        return row["request"]["url"], row["response"]["status"], hashlib.sha256(body).hexdigest()
    wanted = sorted(signature(row) for row in original["log"]["entries"])
    observed = sorted(signature(row) for row in imported["log"]["entries"])
    if not wanted or observed != wanted:
        raise PolicyError("Offline import coverage did not match the complete capture")
    report = bounded_json(work / "out" / "report.json")
    if not isinstance(report, dict) or not isinstance(report.get("@version"), str) or not report["@version"].strip() or not isinstance(report.get("site"), list) or not report["site"] or any(not isinstance(site.get("alerts"), list) or site["alerts"] for site in report["site"]):
        raise PolicyError("Missing, invalid or nonempty passive report")
    expected_origins = {"https://" + urlsplit(row[0]).netloc for row in wanted}
    if {site.get("@name") for site in report["site"]} != expected_origins:
        raise PolicyError("Passive report does not cover the exact captured origin")


def bounded_json(file):
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 16 * 1024 * 1024:
        raise PolicyError("Missing/oversized evidence artifact")
    return json.loads(file.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorization", type=Path, required=True)
    parser.add_argument("--authorization-sha256", required=True)
    parser.add_argument("--target", required=True)
    args = parser.parse_args()
    if os.environ.get("DRAPIXAI_PENTEST_ENVIRONMENT") != "staging" or os.environ.get("DRAPIXAI_PENTEST_ACTIVE_TEST_ACK") != ACK:
        raise PolicyError("Explicit staging environment and written-authorization acknowledgement required")
    repo = Path(__file__).resolve().parents[2]
    raw = load_authorization(args.authorization, args.authorization_sha256)
    policy = validate_authorization(raw, args.target, expected_commit=governance.git_release(repo))
    if sys.platform != "linux" or os.geteuid() == 0:
        raise PolicyError("Dedicated non-root Linux security runner with local Docker required")
    import fcntl
    os.umask(0o077)
    root = repo / "runtime" / "security"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / (args.authorization_sha256 + ".lock")).open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise PolicyError("An analysis for this authorization is already running") from error
        def check():
            validate_authorization(load_authorization(args.authorization, args.authorization_sha256), args.target, expected_commit=policy["releaseCommit"])
        check()
        work = root / ("zap-" + uuid.uuid4().hex)
        work.mkdir(mode=0o700)
        (work / "out").mkdir(mode=0o700)
        deadline = time.monotonic() + min(policy["maxRunSeconds"], (governance.parse_utc(policy["validUntil"], "validUntil") - datetime.now(timezone.utc)).total_seconds())
        summary = {"schemaVersion": 1, "status": "FAIL_INCOMPLETE", "authorizationId": policy["authorizationId"], "authorizationSha256": args.authorization_sha256, "releaseCommit": policy["releaseCommit"], "targetOrigin": policy["targetOrigin"], "paths": policy["paths"], "zapImage": policy["zapImage"], "startedAt": datetime.now(timezone.utc).isoformat(), "independentAssessmentPassed": False, "launchGatePassed": False, "scope": "Unauthenticated GET capture only; offline passive analysis; no spider/active/authenticated coverage"}
        try:
            checked([*DOCKER, "image", "inspect", policy["zapImage"]])
            traffic = collect(policy, check, deadline)
            (work / "traffic.har").write_text(json.dumps(traffic), encoding="utf-8")
            (work / "plan.yaml").write_text(json.dumps(offline_plan(policy["targetOrigin"], policy["paths"])), encoding="utf-8")
            summary["imageId"] = analyze(policy, work, check, deadline)
            check()
            summary["status"] = "PASSIVE_NO_ALERTS_IN_CAPTURE"
            return 0
        finally:
            summary["finishedAt"] = datetime.now(timezone.utc).isoformat()
            summary["artifactSha256"] = {str(f.relative_to(work)): hashlib.sha256(f.read_bytes()).hexdigest() for f in (work / "traffic.har", work / "plan.yaml", work / "container-id.txt", work / "out" / "imported.har", work / "out" / "report.json", work / "out" / "scanner.log") if f.is_file() and not f.is_symlink() and f.stat().st_size <= 32 * 1024 * 1024}
            (work / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
            print("Private passive evidence: " + str(work / "summary.json"))


if __name__ == "__main__":
    def stop(_signal, _frame):
        raise KeyboardInterrupt("Stop requested")
    signal.signal(signal.SIGTERM, stop)
    try:
        raise SystemExit(main())
    except (PolicyError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print("REFUSED: " + (str(error) if isinstance(error, PolicyError) else "Invalid input, transport or local tooling failure"), file=sys.stderr)
        raise SystemExit(2)
