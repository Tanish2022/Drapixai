"""Verify a review snapshot against an externally supplied digest; never extract it."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile


def digest_file(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def verify(path, expected_sha256, max_total_bytes=2 * 1024**3):
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha256):
        raise ValueError('EXTERNAL_SHA256_REQUIRED')
    path = Path(path)
    if path.stat().st_size > 1024**3:
        raise ValueError('BUNDLE_ARCHIVE_TOO_LARGE')
    if digest_file(path) != expected_sha256:
        raise ValueError('BUNDLE_SHA256_MISMATCH')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > 1000 or sum(e.file_size for e in entries) > max_total_bytes:
            raise ValueError('BUNDLE_RESOURCE_LIMIT')
        names = set()
        portable = set()
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if (not name or name != entry.orig_filename or '\\' in name or ':' in name
                    or name.startswith('/') or name.endswith('/') or not parts
                    or any(part in {'', '.', '..', '.git'} for part in name.split('/'))
                    or mode not in {0, stat.S_IFREG}):
                raise ValueError('UNSAFE_BUNDLE_ENTRY')
            if name in names or name.casefold() in portable:
                raise ValueError('DUPLICATE_BUNDLE_ENTRY')
            names.add(name)
            portable.add(name.casefold())
        if 'manifest.json' not in names or archive.getinfo('manifest.json').file_size > 1024 * 1024:
            raise ValueError('BUNDLE_MANIFEST_REQUIRED')
        manifest = json.loads(archive.read('manifest.json'))
        if (not isinstance(manifest, dict) or type(manifest.get('schemaVersion')) is not int
                or manifest.get('schemaVersion') != 1 or manifest.get('status') != 'REVIEW_CANDIDATE_NOT_APPROVED'
                or manifest.get('productionApproved') is not False
                or manifest.get('independentReviewCompleted') is not False):
            raise ValueError('REVIEW_STATUS_INVALID')
        files = manifest.get('files')
        if not isinstance(files, list) or not files:
            raise ValueError('BUNDLE_FILE_INVENTORY_REQUIRED')
        listed = [item.get('path') for item in files if isinstance(item, dict)]
        if (len(listed) != len(files) or not all(isinstance(name, str) for name in listed)
                or len(set(listed)) != len(listed) or set(listed) != names - {'manifest.json'}):
            raise ValueError('BUNDLE_FILE_INVENTORY_MISMATCH')
        for item in files:
            expected = item.get('sha256')
            if not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected):
                raise ValueError('BUNDLE_FILE_SHA256_INVALID')
            entry = archive.getinfo(item['path'])
            if type(item.get('bytes')) is not int or item['bytes'] != entry.file_size:
                raise ValueError('BUNDLE_FILE_SIZE_MISMATCH')
            actual = hashlib.sha256()
            with archive.open(entry) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    actual.update(chunk)
            if actual.hexdigest() != expected:
                raise ValueError('BUNDLE_FILE_SHA256_MISMATCH')
    return {'status': 'INTEGRITY_VERIFIED_REVIEW_PENDING', 'sha256': expected_sha256,
            'fileCount': len(files), 'productionApproved': False, 'independentReviewCompleted': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--expected-sha256', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.bundle, args.expected_sha256), indent=2))
    except (ValueError, OSError, zipfile.BadZipFile, TypeError, KeyError):
        parser.exit(1, 'Review bundle integrity verification failed; no files extracted.\n')
