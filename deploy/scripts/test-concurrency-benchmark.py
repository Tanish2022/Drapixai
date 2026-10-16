#!/usr/bin/env python3
"""CPU-only adversarial verifier tests. No HTTP, credentials or GPU inference."""
from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def load(name: str):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


public = load('benchmark-three-tenant-public-api')
direct = load('benchmark-three-user-tryon')


def options(count=3):
    return argparse.Namespace(concurrent_tenants=count, required_worker_batch_size=count, quality_threshold=0.95,
                              minimum_headroom_ratio=0.20, latency_target_ms=12000, timeout=1, retain_output_images=False)


def result(index=0, batch=3):
    return dict(id=f'tenant-{index}', token_env=f'BENCHMARK_TEST_TOKEN_{index}', product_id=f'product-{index}',
                tryon_id=f'result-{index}', status=200, quality_score=0.97, candidate_count=1, warnings=[],
                wall_ms=9000, media_retention='transient-only', training_use='none', worker_batch_size=batch,
                gpu_peak_allocated_mb=60000, gpu_peak_reserved_mb=70000, gpu_total_mb=100000,
                gpu_headroom_ratio=0.30, timings={}, error=None)


def cases(count=3):
    return [dict(id=f'tenant-{i}', person=f'/synthetic/person-{i}.jpg', product_id=f'product-{i}',
                 token_env=f'BENCHMARK_TEST_TOKEN_{i}') for i in range(count)]


class BenchmarkTests(unittest.TestCase):
    def test_valid_measurement(self):
        for module in (public, direct):
            self.assertEqual(module.result_failures(result(), options()), [])
        self.assertEqual(public.result_failures(result(batch=4), options(4)), [])

    def test_invalid_measurements_cannot_pass(self):
        changes = [
            {'quality_score': float('nan')}, {'quality_score': float('inf')}, {'quality_score': 1.01},
            {'quality_score': 0.949}, {'gpu_headroom_ratio': float('nan')}, {'gpu_headroom_ratio': float('inf')},
            {'gpu_headroom_ratio': 1.0}, {'gpu_headroom_ratio': 0.19}, {'gpu_headroom_ratio': 0.7},
            {'gpu_total_mb': 0}, {'gpu_peak_reserved_mb': 100001}, {'gpu_peak_reserved_mb': 81000},
            {'gpu_peak_allocated_mb': 0}, {'gpu_peak_allocated_mb': 71000}, {'candidate_count': 2},
            {'worker_batch_size': 1}, {'warnings': ['quality_warning']}, {'wall_ms': 0}, {'wall_ms': 12001},
        ]
        for module in (public, direct):
            for change in changes:
                with self.subTest(module=module.__name__, change=change):
                    self.assertTrue(module.result_failures({**result(), **change}, options()))
        self.assertTrue(public.result_failures(result(batch=3), options(4)), 'A three-item batch cannot prove four-item execution')

    def test_cli_cannot_relax_acceptance(self):
        invalid = [('--quality-threshold', 'nan'), ('--quality-threshold', 'inf'), ('--quality-threshold', '.94'),
                   ('--quality-threshold', '1.01'), ('--minimum-headroom-ratio', 'nan'),
                   ('--minimum-headroom-ratio', '.19'), ('--latency-target-ms', '12001'), ('--timeout', '0')]
        for module in (public, direct):
            for flag, value in invalid:
                argv = ['benchmark', '--manifest', 'synthetic.json', flag, value]
                if module is public:
                    argv += ['--base-url', 'https://fixture.invalid/v1']
                with self.subTest(module=module.__name__, flag=flag, value=value), patch('sys.argv', argv), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit):
                        module.parse_args()
        with patch('sys.argv', ['benchmark', '--manifest', 'synthetic.json', '--base-url', 'https://fixture.invalid/v1']):
            self.assertEqual(public.parse_args().required_worker_batch_size, 3)
        with patch('sys.argv', ['benchmark', '--manifest', 'synthetic.json', '--base-url', 'https://fixture.invalid/v1', '--concurrent-tenants', '4']):
            self.assertEqual(public.parse_args().required_worker_batch_size, 4)
        with patch('sys.argv', ['benchmark', '--manifest', 'synthetic.json', '--base-url', 'https://fixture.invalid/v1', '--concurrent-tenants', '4', '--required-worker-batch-size', '3']), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                public.parse_args()

    def test_nonfinite_headers_fail_closed(self):
        for value in ('NaN', 'Infinity', '-Infinity', 'invalid'):
            self.assertEqual(public._float_header(argparse.Namespace(headers={'quality': value}), 'quality'), 0)
        for value in (float('nan'), float('inf'), True, 3.9):
            self.assertEqual(public._int_header_from_timing({'batch': value}, 'batch'), 0)
            self.assertEqual(direct.finite_int(value), 0)
        for invalid in ('NaN', 'Infinity', '1e999'):
            header = argparse.Namespace(headers={'x-drapixai-timing-json': '{"gpu_headroom_ratio": ' + invalid + '}'})
            self.assertEqual(public.parse_timing_header(header), {})
            self.assertEqual(direct.parse_json_header(header, 'x-drapixai-timing-json'), {})

    def test_complete_four_tenant_mock_measurement(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {f'BENCHMARK_TEST_TOKEN_{i}': f'synthetic-{i}' for i in range(4)}):
            args = options(4)
            args.manifest, args.output_dir, args.base_url = 'synthetic.json', temporary, 'https://fixture.invalid/v1'
            def response(url, headers, **kwargs):
                i = int(url.rsplit('-', 1)[1])
                owner = headers['Authorization'] == f'Bearer synthetic-{i}'
                return argparse.Namespace(status_code=200 if owner else 404, json=lambda: {'product_id': f'product-{i}'})
            with patch.object(public, 'parse_args', return_value=args), patch.object(public, 'load_manifest', return_value=cases(4)), patch.object(public, 'run_case', side_effect=lambda case, **kwargs: result(int(case['id'].rsplit('-', 1)[1]), 4)), patch.object(public.requests, 'get', side_effect=response), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(public.main(), 0)
            report = json.loads((Path(temporary) / 'summary.json').read_text())
            self.assertEqual(report['cross_tenant_probes'], 12)
            self.assertEqual(report['cross_tenant_denials'], 12)
            self.assertEqual(report['scope'], 'technical-concurrency-measurement-not-visual-or-release-approval')

    def test_manifest_identity_and_paths(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {f'BENCHMARK_TEST_TOKEN_{i}': f'synthetic-{i}' for i in range(4)}):
            manifest = Path(temporary) / 'manifest.json'
            manifest.write_text(json.dumps({'cases': cases(4)}))
            self.assertEqual(len(public.load_manifest(manifest, 4)), 4)
            with self.assertRaises(ValueError):
                public.load_manifest(manifest, 3)
            for unsafe_id in ('../escape', '/absolute', 'tenant-1'):
                rows = cases(4)
                rows[0]['id'] = unsafe_id
                manifest.write_text(json.dumps({'cases': rows}))
                with self.assertRaises(ValueError):
                    public.load_manifest(manifest, 4)
            manifest.write_text(json.dumps({'cases': cases(4)}))
            with patch.dict(os.environ, {'BENCHMARK_TEST_TOKEN_1': 'synthetic-0'}):
                with self.assertRaises(ValueError):
                    public.load_manifest(manifest, 4)

    def test_four_tenants_require_twelve_cross_denials(self):
        tokens = {f'BENCHMARK_TEST_TOKEN_{i}': f'synthetic-{i}' for i in range(4)}
        def response(url, headers, **kwargs):
            i = int(url.rsplit('-', 1)[1])
            owner = headers['Authorization'] == f'Bearer synthetic-{i}'
            return argparse.Namespace(status_code=200 if owner else 404, json=lambda: {'product_id': f'product-{i}'})
        with patch.dict(os.environ, tokens), patch.object(public.requests, 'get', side_effect=response) as get:
            counts = {}
            self.assertEqual(public.verify_tenant_boundaries(cases(4), [result(i, 4) for i in range(4)], 'https://fixture.invalid/v1', 1, counts), [])
            self.assertEqual(get.call_count, 16)  # Four owner lookups and all twelve cross-tenant probes.
            self.assertEqual(counts, {'owner_attempts': 4, 'cross_attempts': 12, 'cross_denials': 12})
        with patch.dict(os.environ, tokens), patch.object(public.requests, 'get', return_value=argparse.Namespace(status_code=200, json=lambda: {})):
            self.assertTrue(public.verify_tenant_boundaries(cases(4), [result(i, 4) for i in range(4)], 'https://fixture.invalid/v1', 1))

    def test_one_bad_output_cannot_hide_in_average(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = options(4)
            args.manifest, args.output_dir, args.base_url = 'synthetic.json', temporary, 'https://fixture.invalid/v1'
            def run(case, **kwargs):
                row = result(int(case['id'].rsplit('-', 1)[1]), 4)
                row['quality_score'] = .94 if row['id'] == 'tenant-0' else .99
                return row
            with patch.object(public, 'parse_args', return_value=args), patch.object(public, 'load_manifest', return_value=cases(4)), patch.object(public, 'run_case', side_effect=run), patch.object(public, 'verify_tenant_boundaries', return_value=[]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(public.main(), 1)
            report = json.loads((Path(temporary) / 'summary.json').read_text())
            self.assertEqual(len(report['results']), 4)
            self.assertEqual(report['status'], 'FAIL')
            self.assertEqual(report['accepted_requests'], 3)
            self.assertEqual(report['failed_or_rejected_requests'], 1)
            self.assertGreater(sum(row['quality_score'] for row in report['results']) / 4, .95)

    def test_failed_direct_attempt_is_retained(self):
        with tempfile.TemporaryDirectory() as temporary:
            args = options()
            args.manifest, args.output_dir, args.endpoint, args.service_token = 'synthetic.json', temporary, 'https://fixture.invalid/ai/tryon', ''
            def run(index, case, **kwargs):
                if index == 1:
                    raise RuntimeError('private-error-details-must-not-be-recorded')
                return result(index)
            with patch.object(direct, 'parse_args', return_value=args), patch.object(direct, 'load_manifest', return_value=cases()), patch.object(direct, 'run_case', side_effect=run), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(direct.main(), 1)
            text = (Path(temporary) / 'summary.json').read_text()
            self.assertEqual(len(json.loads(text)['results']), 3)
            self.assertNotIn('private-error-details', text)


if __name__ == '__main__':
    unittest.main()
