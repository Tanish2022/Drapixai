"""Actual ZAP image with generated HAR only, no target collection or network.

Use a locally cached official digest in DRAPIXAI_ZAP_OFFLINE_FIXTURE_IMAGE.
Docker Desktop transport adaptation is test-only, never a live-run override.
"""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("offline_zap",Path(__file__).parents[1]/"scripts/run-zap-staging.py")
zap=importlib.util.module_from_spec(spec);spec.loader.exec_module(zap)


def run():
    image=os.environ.get("DRAPIXAI_ZAP_OFFLINE_FIXTURE_IMAGE","")
    if not zap.IMAGE.fullmatch(image):raise ValueError("Pinned official fixture image required")
    root=Path(__file__).resolve().parents[2]
    out=root/"runtime/launch-evidence/security-tooling-task2-20261030"
    out.mkdir(parents=True,exist_ok=True)
    evidence={"passed":False,"scope":"Actual offline ZAP with generated HAR; no staging capture, authorization or independent acceptance", "image":image,"checks":[],"containersRemoved":False}
    checked=zap.checked;owned=[];inspected=set()
    def observe(command,**kwargs):
        result=checked(command,**kwargs)
        if "create" in command:
            owned.append(result)
            state=json.loads(checked(["docker","inspect",result]))[0]
            assert state["HostConfig"]["NetworkMode"]=="none"
            assert state["HostConfig"]["ReadonlyRootfs"] is True
            assert state["HostConfig"]["CapDrop"]==["ALL"]
            assert not state["HostConfig"]["PortBindings"]
            assert state["Config"]["User"]!="0:0"
            assert all(m["Destination"]!="/var/run/docker.sock" for m in state["Mounts"])
            evidence["checks"].append("Created scanner is non-root, network-none, read-only, unprivileged and has no Docker socket or published ports")
        return result
    def check():
        for cid in owned:
            if cid in inspected:continue
            state=json.loads(checked(["docker","inspect",cid]))[0]
            if state["State"]["Running"]:
                interfaces=checked(["docker","exec",cid,"python3","-c","import os,json; print(json.dumps(os.listdir('/sys/class/net')))"])
                assert json.loads(interfaces)==["lo"]
                inspected.add(cid)
                evidence["checks"].append("Running scanner kernel exposes only loopback; no egress interface")
    now=datetime.now(timezone.utc).isoformat()
    def har(headers):
        return {"log":{"version":"1.2","creator":{"name":"synthetic offline fixture","version":"1"},"entries":[{"startedDateTime":now,"time":1,"request":{"method":"GET","url":"https://staging.fixture.invalid/v1/health","httpVersion":"HTTP/1.1","headers":[{"name":"Host","value":"staging.fixture.invalid"}],"cookies":[],"queryString":[],"headersSize":-1,"bodySize":0},"response":{"status":200,"statusText":"OK","httpVersion":"HTTP/1.1","headers":[{"name":k,"value":v}for k,v in headers.items()],"cookies":[],"content":{"size":11,"mimeType":"application/json","text":base64.b64encode(b'{"ok":true}').decode(),"encoding":"base64"},"redirectURL":"","headersSize":-1,"bodySize":11},"cache":{},"timings":{"send":0,"wait":1,"receive":0}}]}}
    good={"Content-Type":"application/json","Content-Length":"11","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; frame-ancestors 'none'; base-uri 'none'","Strict-Transport-Security":"max-age=63072000; includeSubDomains","X-Frame-Options":"DENY","Cache-Control":"no-cache, no-store, must-revalidate","Pragma":"no-cache","Expires":"0","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=()"}
    try:
        with patch.object(zap,"DOCKER",["docker"]),patch.object(zap,"checked",side_effect=observe),patch.object(zap.os,"getuid",return_value=1000,create=True),patch.object(zap.os,"getgid",return_value=1000,create=True):
            for name,headers,should_pass in (("clean-json",good,True),("missing-nosniff",{k:v for k,v in good.items()if k!="X-Content-Type-Options"},False)):
                work=Path(tempfile.mkdtemp(prefix="zap-offline-",dir=out));(work/"out").mkdir()
                (work/"traffic.har").write_text(json.dumps(har(headers)),encoding="utf-8")
                (work/"plan.yaml").write_text(json.dumps(zap.offline_plan("https://staging.fixture.invalid",["/v1/health"])),encoding="utf-8")
                rejected=False
                try:
                    image_id=zap.analyze({"zapImage":image},work,check,time.monotonic()+150)
                    evidence["imageId"]=image_id
                except zap.PolicyError as error:
                    rejected=True
                    if should_pass:raise AssertionError(name+": "+str(error)+"; inspect "+str(work/"out/scanner.log"))from error
                assert rejected is not should_pass
                if not should_pass:
                    report=zap.bounded_json(work/"out/report.json")
                    assert any(site["alerts"] for site in report["site"])
                evidence["checks"].append(name+": "+("accepted complete imported capture" if should_pass else "alerts rejected without a false pass"))
                evidence[name]={"path":str(work.relative_to(root)),"hashes":{str(f.relative_to(work)):hashlib.sha256(f.read_bytes()).hexdigest() for f in work.rglob("*")if f.is_file()}}
            # Exercise actual supervisor timeout/cleanup with an inert sleeping
            # process in the same pinned image, retaining every isolation flag.
            original_command=zap.docker_command
            def sleeper(*args):
                command=original_command(*args)
                command[command.index("--entrypoint")+1]="python3"
                position=command.index(image)
                command[position+1:]=["-c","import time; print('SYNTHETIC_SLEEP_STARTED',flush=True); time.sleep(60)"]
                return command
            work=Path(tempfile.mkdtemp(prefix="zap-timeout-",dir=out));(work/"out").mkdir()
            start=time.monotonic()
            with patch.object(zap,"docker_command",side_effect=sleeper):
                try:
                    zap.analyze({"zapImage":image},work,check,start+4)
                    raise AssertionError("Inert sleeping fixture should hit its deadline")
                except zap.PolicyError as error:
                    assert "deadline" in str(error)
            assert "SYNTHETIC_SLEEP_STARTED" in (work/"out/scanner.log").read_text()
            assert time.monotonic()-start<12
            evidence["checks"].append("A real inert container exceeds its deadline and is removed without reporting success")
        evidence["passed"]=True
    finally:
        evidence["containersRemoved"]=all(subprocess.run(["docker","inspect",cid],capture_output=True).returncode!=0 for cid in owned)
        if not evidence["containersRemoved"]:evidence["passed"]=False
        # A failed isolation assertion can occur before the runner receives its
        # created ID. Always remove only IDs this fixture itself just created.
        for cid in owned:
            if subprocess.run(["docker","inspect",cid],capture_output=True).returncode==0:
                subprocess.run(["docker","rm","--force",cid],capture_output=True,timeout=15,check=True)
        evidence["sourceSha256"]={str(f.relative_to(root)):hashlib.sha256(f.read_bytes()).hexdigest()for f in (Path(__file__).resolve(),root/"deploy/scripts/run-zap-staging.py")}
        (out/"offline-runtime.json").write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf-8")
    assert evidence["passed"] and evidence["containersRemoved"]
    print(json.dumps({"passed":True,"checks":len(evidence["checks"]),"containersRemoved":True,"evidence":str((out/"offline-runtime.json").relative_to(root))}))


if __name__=="__main__":run()
