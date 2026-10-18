import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location('review_bundle', Path(__file__).with_name('verify_review_bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class ReviewBundleTests(unittest.TestCase):
    def create(self, directory, *, content=b'public review evidence', expected=None, name='evidence/report.txt', duplicate=False, symlink=False, status=None):
        archive = Path(directory)/'review.zip'
        manifest = {'schemaVersion': 1, 'status': 'REVIEW_CANDIDATE_NOT_APPROVED', 'productionApproved': False,
                    'independentReviewCompleted': False, 'files': [{'path': name, 'bytes': len(content),
                    'sha256': expected or hashlib.sha256(content).hexdigest()}]}
        if status:
            manifest.update(status)
        with zipfile.ZipFile(archive, 'w') as output:
            output.writestr('manifest.json', json.dumps(manifest))
            entry = zipfile.ZipInfo(name)
            if symlink:
                entry.create_system = 3
                entry.external_attr = 0o120777 << 16
            output.writestr(entry, content)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter('ignore', UserWarning)
                    output.writestr(name, content)
        return archive, bundle.digest_file(archive)

    def test_valid_bundle_is_integrity_only_and_extracts_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            path, digest = self.create(directory)
            result = bundle.verify(path, digest)
            self.assertEqual(result['status'], 'INTEGRITY_VERIFIED_REVIEW_PENDING')
            self.assertFalse(result['productionApproved'])
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_external_digest_is_mandatory_and_wrong_digest_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path, _ = self.create(directory)
            for value in ['', 'abc', '0'*64]:
                with self.subTest(value=value), self.assertRaises(ValueError):
                    bundle.verify(path, value)

    def test_manifest_cannot_hide_changed_file_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path, digest = self.create(directory, expected='0'*64)
            with self.assertRaisesRegex(ValueError, 'FILE_SHA256_MISMATCH'):
                bundle.verify(path, digest)

    def test_paths_duplicates_and_symlinks_are_rejected_without_extraction(self):
        for options in [{'name':'../escape'}, {'name':'/absolute'}, {'name':'C:/escape'},
                        {'name':'a\\escape'}, {'name':'a//escape'}, {'duplicate':True}, {'symlink':True}]:
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                path, digest = self.create(directory, **options)
                with self.assertRaises(ValueError):
                    bundle.verify(path, digest)

    def test_review_package_cannot_be_mislabelled_as_approval(self):
        for status in [{'productionApproved':True}, {'independentReviewCompleted':True}, {'status':'APPROVED'}]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                path, digest = self.create(directory, status=status)
                with self.assertRaisesRegex(ValueError, 'REVIEW_STATUS_INVALID'):
                    bundle.verify(path, digest)

    def test_resource_limit_applies_before_reading_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            path, digest = self.create(directory)
            with self.assertRaisesRegex(ValueError, 'RESOURCE_LIMIT'):
                bundle.verify(path, digest, max_total_bytes=1)

    def test_non_object_and_boolean_schema_cannot_pass(self):
        for value in [[], None, {'schemaVersion':True}]:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'review.zip'
                with zipfile.ZipFile(path,'w') as output:
                    output.writestr('manifest.json',json.dumps(value))
                with self.assertRaises(ValueError):
                    bundle.verify(path,bundle.digest_file(path))


if __name__ == '__main__':
    unittest.main()
