# rembg SAM validation backport candidate

This offline builder adds a model-name allowlist before SAM constructs filenames
or URLs, using the same three names supported in upstream rembg 2.0.82. It targets
GHSA-qr6x-7v33-6qmg. The exact official 2.0.69 wheel and SAM source are hash pinned.
The output remains version 2.0.69 with build tag `1drapixai`; no scanner exception
or misleading version change is added. Existing blocking audits remain blocking.

This narrow candidate preserves every other source member, license, dependency
constraint, model operation, default session and download behavior. It avoids
changing NumPy or installing rembg 2.0.82, whose Pillow `<13` constraint conflicts
with the Pillow 13 security candidate. It is **not installed in DrapixAI**.

Tests execute the wheel's actual `download_models` method in an isolated namespace
with recording-only transport and a synthetic model-cache path. The upstream
negative control reaches unsafe filename/URL construction; the patched method
rejects traversal, absolute paths, fragments and unexpected types before any
transport. Default and all supported name/quantization combinations retain
identical behavior. Two builds, every unchanged wheel member and every RECORD
digest are compared. No ONNX model or private data is read and no network request
is made by the tests. This is narrower than a full rembg import or inference test.

The build and test CLIs require `--wheel` pointing to the official wheel. Build
outputs must be beneath `runtime/security-candidate/`. CI retains the review
artifact and its provenance. Independent security review, exact image integration
and scans, actual background-removal regression, and Standard direct/SDK GPU
quality certification remain required before promotion. Other rembg advisories,
download hash pinning and host/cache tampering are outside this patch's claim.

Primary references:

- [Advisory](https://github.com/danielgatis/rembg/security/advisories/GHSA-qr6x-7v33-6qmg)
- [Official package metadata](https://pypi.org/pypi/rembg/2.0.69/json)
- [Upstream allowlist implementation](https://github.com/danielgatis/rembg/blob/v2.0.82/rembg/sessions/sam.py)
