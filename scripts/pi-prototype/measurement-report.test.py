"""Pure counter/fixture tests: no native builds, applications or providers."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('measurement_report', Path(__file__).with_name('measurement-report.py'))
measurement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measurement)


def journey(events=(), **fields):
    return {'schema': measurement.SCHEMA, 'lane': 'old', 'protocol': 'compatible',
            'case': 'short', 'cache': 'warm-process', 'provider': 'fixture',
            'profile': 'debug', 'events': list(events), **fields}


class MeasurementTests(unittest.TestCase):
    def test_unknown_does_not_become_zero(self):
        result = measurement.summarize(journey())
        self.assertTrue(all(value is None for value in result['metrics'].values()))
        self.assertEqual(result['identity']['binarySha256'], None)

    def test_union_preserves_overlap_and_trailing_completion(self):
        result = measurement.summarize(journey([
            {'kind': 'send', 'atMs': 0},
            {'kind': 'provider_start', 'dispatch': 0, 'atMs': 10},
            {'kind': 'provider_start', 'dispatch': 1, 'atMs': 20},
            {'kind': 'provider_end', 'dispatch': 0, 'atMs': 40},
            {'kind': 'provider_end', 'dispatch': 1, 'atMs': 50},
            {'kind': 'first_visible', 'atMs': 55},
            {'kind': 'terminal', 'atMs': 60}], providerCoverage='complete'))['metrics']
        self.assertEqual(result['providerTransportMs'], 40)
        self.assertEqual(result['outsideProviderMs'], 20)
        self.assertEqual(result['postProviderCompletionMs'], 10)
        self.assertEqual(result['firstVisibleMs'], 55)

    def test_partial_provider_capture_cannot_claim_overhead(self):
        result = measurement.summarize(journey([
            {'kind': 'send', 'atMs': 0},
            {'kind': 'provider_start', 'dispatch': 0, 'atMs': 10},
            {'kind': 'terminal', 'atMs': 60}], providerCoverage='partial'))['metrics']
        self.assertEqual(result['completionMs'], 60)
        self.assertIsNone(result['outsideProviderMs'])

    def test_partial_ipc_counts_are_observations_only(self):
        events = [{'kind': 'ipc', 'atMs': 0, 'category': 'sqlite', 'requestBytes': 30}]
        result = measurement.summarize(journey(events, ipcCoverage='partial'))['metrics']
        self.assertEqual(result['sqliteIpcObservedCalls'], 1)
        self.assertIsNone(result['sqliteIpcCalls'])
        result = measurement.summarize(journey(events, ipcCoverage='complete'))['metrics']
        self.assertEqual(result['sqliteIpcRequestBytes'], 30)
        self.assertIsNone(result['sqliteIpcResponseBytes'])
        self.assertEqual(result['domainIpcCalls'], 0)

    def test_rejects_raw_payload_and_multiple_clock_boundaries(self):
        for value in [journey(prompt='private'), journey([{'kind': 'send', 'atMs': 0, 'sql': 'private'}]),
                      journey([{'kind': 'send', 'atMs': 0}, {'kind': 'send', 'atMs': 1}]),
                      journey([{'kind': 'send', 'atMs': 1}, {'kind': 'terminal', 'atMs': 0}])]:
            with self.assertRaises(ValueError):
                measurement.summarize(value)

    def test_cancellation_rss_and_storage_counters(self):
        result = measurement.summarize(journey([
            {'kind': 'storage', 'atMs': 0, 'bytes': 100},
            {'kind': 'rss', 'atMs': 10, 'bytes': 500},
            {'kind': 'cancel_request', 'atMs': 11},
            {'kind': 'rss', 'atMs': 12, 'bytes': 700},
            {'kind': 'cancel_settled', 'atMs': 14},
            {'kind': 'storage', 'atMs': 20, 'bytes': 90}]))['metrics']
        self.assertEqual(result['cancellationMs'], 3)
        self.assertEqual(result['sampledProcessPeakRssBytes'], 700)
        self.assertEqual(result['storageGrowthBytes'], -10)

    def test_fixture_equivalence_and_no_fake_native_seeding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve() / 'pair'
            manifest = measurement.fixtures(root)
            self.assertEqual((root / 'old/fixture.json').read_bytes(), (root / 'pi/fixture.json').read_bytes())
            self.assertEqual(manifest['longMessages'], 2010)
            self.assertEqual(manifest['longSubmissions'], 1005)
            self.assertFalse(manifest['seededNativeHistory'])
            with self.assertRaises(ValueError):
                measurement.fixtures(root)

    def test_storage_never_reads_contents_and_refuses_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / 'private.md').write_bytes(b'x' * 5)
            (root / 'test.sqlite').write_bytes(b'x' * 4)
            (root / 'test.sqlite-wal').write_bytes(b'x' * 3)
            result = measurement.storage(root)
            self.assertEqual(result['logicalBytes'], 12)
            self.assertNotIn('private', str(result))
            (root / 'link').symlink_to(root / 'private.md')
            with self.assertRaises(ValueError):
                measurement.storage(root)


if __name__ == '__main__':
    unittest.main()
