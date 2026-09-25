#!/usr/bin/env python3
"""Validate redacted GPU image-verifier output against this release's image record.

This checks artifact identity and a complete successful verifier result. It does
not authenticate the evidence author, prove host identity, or establish recency.
"""

import argparse
import json
from pathlib import Path
import re
import shlex
import sys


PREFIX = "DRAPIXAI_RELEASE_IMAGE_EVIDENCE_V1="
MARKER = "PASS: Staging ai services use expected release image digests and revision "
COMMIT = re.compile(r"[a-f0-9]{40}")
IMAGE = re.compile(r"[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}")
ASSIGNMENT = re.compile(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)")
MAX_BYTES = 65536


def read_bounded(path):
    with Path(path).open("rb") as source:
        content = source.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError("Evidence or image record exceeds the supported size")
    return content.decode("utf-8")


def image_record(path):
    """Read static dotenv assignments without executing shell code or expansions."""
    values = {}
    for line in read_bounded(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        assignment = ASSIGNMENT.fullmatch(line)
        if not assignment or assignment[1] in values:
            raise ValueError("Image record must contain unique static assignments")
        tokens = shlex.split(assignment[2], comments=True, posix=True)
        if len(tokens) != 1 or re.search(r"[$`\\;<>|&\r\n]", tokens[0]):
            raise ValueError("Image record contains a non-static assignment")
        values[assignment[1]] = tokens[0]
    return values


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("Duplicate evidence field")
        result[name] = value
    return result


def reject_constant(_value):
    raise ValueError("Invalid evidence number")


def validate(evidence_path, images_path, expected_commit):
    if not COMMIT.fullmatch(expected_commit):
        raise ValueError("Expected commit must be an exact lowercase 40-character commit")
    images = image_record(images_path)
    expected_image = images.get("DRAPIXAI_AI_RELEASE_IMAGE", "")
    if images.get("DRAPIXAI_RELEASE_COMMIT") != expected_commit or not IMAGE.fullmatch(expected_image):
        raise ValueError("Image record must match the current release and pin the AI image digest")

    # Only the complete two-line success format is accepted. Prefix searches and
    # arbitrary surrounding output could hide failed or concatenated verifier runs.
    lines = read_bounded(evidence_path).splitlines()
    if len(lines) != 2 or not lines[0].startswith(PREFIX) or lines[1] != MARKER + expected_commit:
        raise ValueError("GPU image evidence must be one complete successful current-release verifier result")
    record = json.loads(lines[0][len(PREFIX):], object_pairs_hook=unique_object, parse_constant=reject_constant)
    if not isinstance(record, dict) or set(record) != {"schema_version", "role", "release_commit", "services"}:
        raise ValueError("Invalid GPU image evidence fields")
    if type(record["schema_version"]) is not int or record["schema_version"] != 1 or record["role"] != "ai":
        raise ValueError("Unsupported GPU image evidence schema or service role")
    if record["release_commit"] != expected_commit:
        raise ValueError("GPU image evidence is for another release")
    services = record["services"]
    if not isinstance(services, dict) or set(services) != {"ai-api", "ai-worker"}:
        raise ValueError("GPU image evidence must cover both approved AI services")
    for service in services.values():
        if not isinstance(service, dict) or set(service) != {"image", "revision"}:
            raise ValueError("Invalid GPU service identity fields")
        if service["image"] != expected_image or service["revision"] != expected_commit:
            raise ValueError("GPU service image or revision differs from the current approved artifact")
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--images-env", required=True)
    parser.add_argument("--expected-commit", required=True)
    args = parser.parse_args()
    try:
        record = validate(args.evidence, args.images_env, args.expected_commit)
    except (OSError, UnicodeError, ValueError, TypeError, RecursionError):
        # Never echo untrusted logs or private configuration into certification output.
        print("GPU release-image evidence is invalid or does not match the approved release artifact; rerun the GPU image verifier.", file=sys.stderr)
        return 1
    print(PREFIX + json.dumps(record, separators=(",", ":"), sort_keys=True))
    print(MARKER + args.expected_commit)
    return 0


if __name__ == "__main__":
    sys.exit(main())
