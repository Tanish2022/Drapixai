"""Local synthetic policy/HTTPS regressions; never contact staging or a provider."""
import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("zap_staging", Path(__file__).parents[1] / "scripts/run-zap-staging.py")
zap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(zap)


def authorization():
    now = datetime.now(timezone.utc)
    return {"schemaVersion": 1, "authorizationId": "SYNTHETIC-TEST-ONLY", "environment": "staging", "releaseCommit": "a" * 40,
            "approvedBy": "synthetic-reviewer", "approvalReference": "synthetic-not-a-live-grant", "incidentContact": "synthetic-operator", "validFrom": (now-timedelta(minutes=1)).isoformat(), "validUntil": (now+timedelta(minutes=10)).isoformat(),
            "targetOrigin": "https://staging.fixture.invalid", "targetAddresses": ["93.184.216.34"], "paths": ["/v1/health"], "zapImage": "ghcr.io/zaproxy/zaproxy@sha256:"+"a"*64,
            "maxRequestsPerSecond": 2, "requestTimeoutSeconds": 1, "maxRunSeconds": 120, "maxResponseBytes": 1024, "maxTotalBytes": 4096,
            "syntheticDataOnly": True, "companyOwnedTarget": True, "unauthenticatedGetOnly": True, "edgeRateLimitEnforced": True, "allowPrivateTargetAddresses": False, "allowProductionTargets": False, "allowThirdPartyTargets": False, "allowDestructiveTesting": False, "independentPentestReplacement": False}


class PolicyTests(unittest.TestCase):
    def test_positive_exact_scope_and_commit(self):
        data = authorization()
        self.assertIs(zap.validate_authorization(data, data["targetOrigin"], expected_commit="a"*40), data)

    def test_host_confusion_credentials_ports_and_paths_reject(self):
        for target in ("https://drapixai.com", "https://evilstaging.test", "https://staging.fixture.invalid/", "https://staging.fixture.invalid:443", "https://staging.fixture.invalid/a", "https://staging.fixture.invalid?x", "https://staging.fixture.invalid#x", "https://staging.fixture.invalid@other.test", "https://STAGING.fixture.invalid", "https://staging.fixture.invalid.", "http://staging.fixture.invalid", "https://staging..fixture.invalid", "https://staging.fixture.invalid\\evil", "https://staging.fixture.invalid\n"):
            with self.subTest(target=target), self.assertRaises(zap.PolicyError):
                zap.canonical_origin(target)
        with self.assertRaises(zap.PolicyError):
            zap.validate_authorization(authorization(), "https://staging.other.invalid")

    def test_schema_flags_integer_limits_and_placeholders_reject(self):
        changes = [{"schemaVersion": True}, {"releaseCommit": "0"*40}, {"releaseCommit": "B"*40}, {"unknown": 1}, {"maxRequestsPerSecond": True}, {"maxRequestsPerSecond": 3}, {"requestTimeoutSeconds": 11}, {"maxRunSeconds": 301}, {"maxResponseBytes": 1048577}, {"maxTotalBytes": 1}, {"zapImage": "other.invalid/zap@sha256:"+"a"*64}, {"zapImage": "ghcr.io/zaproxy/zaproxy:stable"}, {"approvedBy": "REPLACE_REVIEWER"}]
        changes += [{key: value} for key, value in (("syntheticDataOnly", False), ("companyOwnedTarget", 1), ("edgeRateLimitEnforced", False), ("allowProductionTargets", True), ("allowThirdPartyTargets", True), ("allowDestructiveTesting", True), ("independentPentestReplacement", True))]
        for change in changes:
            data = authorization(); data.update(change)
            with self.subTest(change=change), self.assertRaises(zap.PolicyError):
                zap.validate_authorization(data, data["targetOrigin"])

    def test_path_escape_unbounded_and_duplicate_lists_reject(self):
        for paths in (["/a", "/a"], [], ["/a"]*21, [None], ["//other.invalid"], ["/../other"], ["/a/./b"], ["/%2e%2e/other"], ["/a?q=x"], ["/a#x"], ["/a\r\nHost:evil"], ["/a\\b"]):
            data = authorization(); data["paths"] = paths
            with self.subTest(paths=paths), self.assertRaises(zap.PolicyError):
                zap.validate_authorization(data, data["targetOrigin"])

    def test_expiry_future_timezone_duration_and_wrong_commit_reject(self):
        now = datetime.now(timezone.utc)
        for start, end in ((now-timedelta(hours=2), now), (now+timedelta(seconds=1), now+timedelta(hours=1)), (now-timedelta(hours=25), now+timedelta(hours=1)), (now, now)):
            data = authorization(); data.update(validFrom=start.isoformat(), validUntil=end.isoformat())
            with self.subTest(start=start), self.assertRaises(zap.PolicyError):
                zap.validate_authorization(data, data["targetOrigin"], now=now)
        with self.assertRaises(zap.PolicyError):
            zap.validate_authorization(authorization(), authorization()["targetOrigin"], expected_commit="b"*40)

    def test_address_policy_rejects_metadata_loopback_mixed_ipv6_and_private_without_approval(self):
        for value in ("127.0.0.1", "0.0.0.0", "169.254.169.254", "100.64.0.1", "198.18.0.1", "192.0.2.1", "224.0.0.1", "240.0.0.1", "::1", "::ffff:127.0.0.1", "93.184.216.034", "10.0.0.1"):
            with self.subTest(value=value), self.assertRaises(zap.PolicyError):
                zap.permitted_ip(value, False)
        self.assertEqual(zap.permitted_ip("10.0.0.1", True), "10.0.0.1")
        for value in ("127.0.0.1", "169.254.169.254", "100.64.0.1"):
            with self.assertRaises(zap.PolicyError): zap.permitted_ip(value, True)

    def test_authorization_digest_tamper_duplicates_size_and_symlink_reject(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder)/"authorization.json"; file.write_text(json.dumps(authorization()))
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            self.assertEqual(zap.load_authorization(file, digest)["schemaVersion"], 1)
            for bad in ("", "A"*64, "0"*64):
                with self.assertRaises(zap.PolicyError): zap.load_authorization(file, bad)
            file.write_text('{"schemaVersion":1,"schemaVersion":2}')
            with self.assertRaises(zap.PolicyError): zap.load_authorization(file, hashlib.sha256(file.read_bytes()).hexdigest())
            file.write_bytes(b" "*32769)
            with self.assertRaises(zap.PolicyError): zap.load_authorization(file, hashlib.sha256(file.read_bytes()).hexdigest())

    def test_dns_matches_all_pins_and_rejects_mixed_or_changed_answers(self):
        data = authorization()
        for addresses, good in ((["93.184.216.34"], True), (["93.184.216.35"], False), (["93.184.216.34", "127.0.0.1"], False), (["93.184.216.34", "10.0.0.1"], False), (["::1"], False)):
            rows = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip,443)) for ip in addresses]
            with patch.object(zap.socket, "getaddrinfo", return_value=rows):
                if good: self.assertEqual(zap.resolve_pins(data,time.monotonic()+1), addresses[0])
                else:
                    with self.assertRaises(zap.PolicyError): zap.resolve_pins(data,time.monotonic()+1)

    def test_stalled_dns_cannot_start_a_late_request(self):
        def slow(*args, **kwargs):
            time.sleep(0.15); return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34",443))]
        with patch.object(zap.socket,"getaddrinfo",side_effect=slow), patch.object(zap,"capture_response") as capture:
            with self.assertRaises(zap.PolicyError): zap.collect(authorization(), lambda:None, time.monotonic()+0.02)
            time.sleep(0.2); capture.assert_not_called()

    def test_collector_rate_spacing_and_aggregate_budget(self):
        data=authorization(); data["paths"]=["/a","/b"]; starts=[]
        def response(policy, path, *_args):
            starts.append(time.monotonic()); return {"response":{"content":{"size":2}}}
        with patch.object(zap,"resolve_pins",return_value="synthetic"), patch.object(zap,"capture_response",side_effect=response):
            result=zap.collect(data,lambda:None,time.monotonic()+3)
        self.assertEqual(len(result["log"]["entries"]),2); self.assertGreaterEqual(starts[1]-starts[0],0.49)
        data["maxTotalBytes"]=3
        with patch.object(zap,"resolve_pins",return_value="synthetic"), patch.object(zap,"capture_response",side_effect=response), self.assertRaises(zap.PolicyError):
            zap.collect(data,lambda:None,time.monotonic()+3)

    def test_revocation_stops_before_the_next_target_request(self):
        data=authorization(); data["paths"]=["/a","/b"]; revoked=[]
        def check():
            if revoked: raise zap.PolicyError("synthetic revocation")
        def response(*_args):
            revoked.append(True);return {"response":{"content":{"size":1}}}
        with patch.object(zap,"resolve_pins",return_value="synthetic"), patch.object(zap,"capture_response",side_effect=response) as capture:
            with self.assertRaises(zap.PolicyError): zap.collect(data,check,time.monotonic()+3)
            self.assertEqual(capture.call_count,1)

    def test_offline_plan_has_no_crawl_request_or_active_jobs(self):
        plan=zap.offline_plan(authorization()["targetOrigin"],authorization()["paths"])
        jobs=plan["jobs"]
        self.assertEqual([j["type"] for j in jobs],["import","passiveScan-wait","export","report","exitStatus"])
        self.assertIs(jobs[0]["parameters"]["sendRequests"],False)
        self.assertIs(plan["env"]["parameters"]["failOnWarning"],True)
        self.assertEqual(jobs[-1]["parameters"]["errorLevel"],"Informational")

    def test_container_has_no_network_socket_mount_credentials_or_pull(self):
        command=zap.docker_command(authorization()["zapImage"],Path("/owned/fixture"),1000,1000,"synthetic-label")
        self.assertEqual(command[command.index("--network")+1],"none")
        for value in ("--read-only","--pull=never","no-new-privileges","ALL","4g","512"):
            self.assertIn(value,command)
        self.assertEqual(command[command.index("--user")+1],"1000:1000")
        self.assertFalse(any("docker.sock" in part and part.startswith("type=bind") for part in command))
        self.assertNotIn("--privileged",command); self.assertNotIn("--publish",command)

    def test_zero_exit_without_complete_import_or_valid_alert_report_cannot_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            work=Path(directory);(work/"out").mkdir()
            entry={"request":{"url":"https://staging.fixture.invalid/"},"response":{"status":200,"content":{"text":"synthetic","size":9}}}
            traffic={"log":{"entries":[entry]}}
            report={"@version":"synthetic-fixture","site":[{"@name":"https://staging.fixture.invalid","alerts":[]}]}
            (work/"traffic.har").write_text(json.dumps(traffic))
            (work/"out/imported.har").write_text(json.dumps(traffic))
            (work/"out/report.json").write_text(json.dumps(report))
            zap.verify_passive_artifacts(work)
            other=copy.deepcopy(entry);other["request"]["url"]="https://other.invalid/"
            altered=copy.deepcopy(entry);altered["response"]["content"]["text"]="different"
            for bad in ({"log":{"entries":[]}}, {"log":{"entries":[other]}}, {"log":{"entries":[altered]}}):
                (work/"out/imported.har").write_text(json.dumps(bad))
                with self.assertRaises(zap.PolicyError):zap.verify_passive_artifacts(work)
            (work/"out/imported.har").write_text(json.dumps(traffic))
            for bad in ({}, {"@version":"synthetic","site":[]}, {"@version":"synthetic","site":[{"alerts":[{"riskcode":"0"}]}]}, {"@version":"synthetic","site":[{"@name":"https://other.invalid","alerts":[]}]}):
                (work/"out/report.json").write_text(json.dumps(bad))
                with self.assertRaises(zap.PolicyError):zap.verify_passive_artifacts(work)

    def test_expired_run_never_opens_https_and_legacy_cli_fails(self):
        with patch.object(zap,"PinnedHttps") as connection,self.assertRaises(zap.PolicyError):
            zap.capture_response(authorization(),"/","synthetic",time.monotonic()-1)
        connection.assert_not_called()
        result=subprocess.run([sys.executable,str(Path(zap.__file__)),"https://staging.fixture.invalid"],capture_output=True,timeout=5)
        self.assertEqual(result.returncode,2)


class HttpsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory(); root=Path(cls.folder.name)
        openssl=shutil.which("openssl")
        if not openssl and shutil.which("git"):
            candidate=Path(shutil.which("git")).resolve().parents[1]/"usr/bin/openssl.exe"
            if candidate.exists(): openssl=str(candidate)
        if not openssl: raise RuntimeError("OpenSSL is required for real synthetic TLS regression tests")
        cls.cert,cls.key=root/"certificate.pem",root/"key.pem"
        subprocess.run([openssl,"req","-x509","-newkey","rsa:2048","-nodes","-keyout",str(cls.key),"-out",str(cls.cert),"-days","1","-subj","/CN=staging.fixture.invalid","-addext","subjectAltName=DNS:staging.fixture.invalid"],check=True,capture_output=True,timeout=20)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cls.cert,cls.key)
        cls.requests=[]; cls.reply={}
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version="HTTP/1.1"
            def log_message(self,*_args): pass
            def do_GET(self):
                cls.requests.append(self.path); r=cls.reply
                try:
                    if r.get("slowHeaders"):
                        for byte in b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n":
                            self.wfile.write(bytes([byte]));self.wfile.flush();time.sleep(0.05)
                        return
                    self.send_response(r.get("status",200));self.send_header("Connection","close")
                    for key,value in r.get("headers",[("Content-Type","text/plain")]):self.send_header(key,value)
                    self.end_headers()
                    if r.get("slowBody"):
                        for _ in range(100): self.wfile.write(b"a");self.wfile.flush();time.sleep(0.05)
                    else:self.wfile.write(r.get("body",b"synthetic-body"))
                except (OSError,ssl.SSLError):pass
                finally:self.close_connection=True
        cls.server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Handler);cls.server.daemon_threads=True
        cls.server.socket=context.wrap_socket(cls.server.socket,server_side=True)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        original=zap.PinnedHttps
        class FixtureConnection(original):
            def __init__(self,host,address,deadline):
                super().__init__(host,address,deadline);self.port=cls.server.server_port
                self._context=ssl.create_default_context(cafile=str(cls.cert))
        cls.fixture=FixtureConnection

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.folder.cleanup()

    def setUp(self):
        self.requests.clear();type(self).reply={};self.data=authorization()
        self.transport=patch.object(zap,"PinnedHttps",self.fixture);self.transport.start()

    def tearDown(self):self.transport.stop()

    def capture(self):return zap.capture_response(self.data,"/v1/health","127.0.0.1",time.monotonic()+2)

    def test_real_tls_pinned_connection_never_resolves_again_and_preserves_bytes(self):
        type(self).reply={"body":"synthetic-गुजरात".encode()}
        with patch.object(socket,"getaddrinfo",side_effect=AssertionError("No second DNS lookup")):
            entry=self.capture()
        self.assertEqual(base64.b64decode(entry["response"]["content"]["text"]),self.reply["body"])
        self.assertEqual(self.requests,["/v1/health"])

    def test_real_tls_hostname_mismatch_rejects_without_http_request(self):
        self.data["targetOrigin"]="https://staging.wrong.invalid"
        with self.assertRaises(zap.PolicyError):self.capture()
        self.assertEqual(self.requests,[])

    def test_real_tls_untrusted_certificate_is_not_silently_accepted(self):
        fixture=self.fixture
        class UntrustedConnection(fixture):
            def __init__(self,*args):
                super().__init__(*args);self._context=ssl.create_default_context()
        with patch.object(zap,"PinnedHttps",UntrustedConnection),self.assertRaises(zap.PolicyError):self.capture()
        self.assertEqual(self.requests,[])

    def test_foreign_same_origin_and_relative_redirects_are_never_followed(self):
        for location in ("https://drapixai.com/", "https://other.invalid/", "https://staging.fixture.invalid/elsewhere", "/elsewhere", "http://169.254.169.254/latest/meta-data"):
            type(self).reply={"status":302,"headers":[("Location",location)]}
            before=len(self.requests)
            with self.subTest(location=location),self.assertRaises(zap.PolicyError):self.capture()
            self.assertEqual(len(self.requests),before+1)

    def test_http_error_denials_and_outages_cannot_count_as_coverage(self):
        for status in (204,301,401,403,404,429,500,503):
            type(self).reply={"status":status}
            with self.subTest(status=status),self.assertRaises(zap.PolicyError):self.capture()

    def test_declared_streamed_compressed_duplicate_and_truncated_bodies_reject(self):
        cases=[{"headers":[("Content-Length","2048")]},{"body":b"x"*1025},{"headers":[("Content-Encoding","gzip")]},{"headers":[("Content-Length","2"),("Content-Length","2")]},{"headers":[("Content-Length","50")],"body":b"x"},{"headers":[("Content-Length","-1")]}]
        for reply in cases:
            type(self).reply=reply
            with self.subTest(reply=str(reply)[:50]),self.assertRaises(zap.PolicyError):self.capture()

    def test_exact_byte_boundary_succeeds(self):
        type(self).reply={"body":b"x"*1024,"headers":[("Content-Length","1024")]}
        self.assertEqual(self.capture()["response"]["content"]["size"],1024)

    def test_slow_header_and_body_deadlines_close_the_connection(self):
        for flag in ("slowHeaders","slowBody"):
            type(self).reply={flag:True};start=time.monotonic()
            with self.subTest(flag=flag),self.assertRaises(zap.PolicyError):self.capture()
            self.assertLess(time.monotonic()-start,1.7)


if __name__ == "__main__":unittest.main(verbosity=2)
