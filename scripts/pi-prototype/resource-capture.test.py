"""Pure resource-counter tests: no process queries, native builds/apps/providers."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('resource_capture', Path(__file__).with_name('resource-capture.py'))
resource = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resource)
HASH = 'a' * 64
OTHER = 'b' * 64


def manifest(complete=True):
    return {'schema': resource.SCHEMA, 'processCoverage': 'attested-complete' if complete else 'partial',
            'rendererCoverage': 'attested-complete' if complete else 'unknown',
            'membershipEvidenceSha256': HASH if complete else None,
            'processes': [{'pid': 10, 'role': 'app', 'startSha256': HASH},
                          {'pid': 11, 'role': 'renderer', 'startSha256': OTHER}]}


def observed():
    return {10: {'pid': 10, 'ppid': 1, 'rssBytes': 100, 'startSha256': HASH},
            11: {'pid': 11, 'ppid': 1, 'rssBytes': 200, 'startSha256': OTHER}}


def rss(samples=None, complete=True):
    owned = manifest(complete)
    return {'schema': resource.SCHEMA, 'kind': 'rss', 'intervalMs': 100,
            'startIdentityPrecision': 'ps-lstart-one-second',
            'clock': 'collector-monotonic-independent-of-journey',
            **{key: owned[key] for key in ['processCoverage', 'rendererCoverage', 'membershipEvidenceSha256']},
            'samples': samples if samples is not None else [resource.resource_sample(owned, observed(), 0)]}


def condition(pair=1, order=0, **fields):
    return {'scenario': 'short', 'pairIndex': pair, 'order': order, 'buildVerified': True,
            'buildReceiptSha256': HASH, 'modelSha256': HASH, 'configurationSha256': HASH,
            'retentionOperationSha256': None, 'semanticMode': 'disabled', 'windowState': 'foreground',
            'rendererObservation': 'two-animation-frames', 'seededSubmissions': 2,
            'seededConversations': 1, 'operationCount': 1, 'outputBudget': 32,
            'samplingIntervalMs': 100, **fields}


def journey(lane='old', elapsed=20):
    return {'schema': resource.measurement.SCHEMA, 'lane': lane, 'protocol': 'compatible',
            'case': 'short', 'cache': 'cold-process', 'provider': 'fixture', 'profile': 'debug',
            'revision': 'a' * 40, **{key: HASH for key in resource.measurement.HASH_KEYS if key != 'revision'},
            'providerCoverage': 'complete', 'ipcCoverage': 'complete',
            'events': [{'kind': 'send', 'atMs': 0}, {'kind': 'first_visible', 'atMs': 10},
                       {'kind': 'terminal', 'atMs': elapsed}]}


def bundle(lane='old', pair=1, order=None, **fields):
    return resource.assemble(journey(lane, 20 if lane == 'old' else 25),
                             condition(pair, order if order is not None else (lane == 'pi') * 1, **fields), rss())


class ResourceTests(unittest.TestCase):
    def test_ps_parser_keeps_only_numeric_identity_and_start_hash(self):
        row = resource.parse_ps(' 10 1 12 Thu Oct 15 09:10:11 2026\n', {10})[10]
        self.assertEqual(row['rssBytes'], 12288)
        self.assertEqual(row['ppid'], 1)
        self.assertNotIn('Oct', str(row))
        for raw in ['10 1 3 private-command-with-args', '11 1 3 Thu Oct 15 09:10:11 2026',
                    '10 1 3 Thu Oct 15 09:10:11 2026\n10 1 3 Thu Oct 15 09:10:11 2026']:
            with self.assertRaises(ValueError):
                resource.parse_ps(raw, {10})

    def test_renderer_unknown_cannot_claim_all_process_rss(self):
        metrics = resource.rss_metrics(rss(complete=False))
        self.assertEqual(metrics['sampledAppPeakRssBytes'], 100)
        self.assertEqual(metrics['sampledObservedProcessesPeakRssBytes'], 300)
        self.assertIsNone(metrics['sampledAllProcessesPeakRssBytes'])

    def test_complete_membership_sums_same_sample_not_individual_peaks(self):
        first = observed(); second = observed()
        first[10]['rssBytes'] = 1000
        second[11]['rssBytes'] = 2000
        samples = [resource.resource_sample(manifest(), first, 0), resource.resource_sample(manifest(), second, 100)]
        self.assertEqual(resource.rss_metrics(rss(samples))['sampledAllProcessesPeakRssBytes'], 2100)

    def test_missing_or_reused_pid_invalidates_entire_capture_completeness(self):
        for loss in ['missing', 'reuse']:
            middle = observed()
            if loss == 'missing':
                del middle[11]
            else:
                middle[11]['startSha256'] = HASH
            samples = [resource.resource_sample(manifest(), observed(), 0),
                       resource.resource_sample(manifest(), middle, 100),
                       resource.resource_sample(manifest(), observed(), 200)]
            metrics = resource.rss_metrics(rss(samples))
            self.assertEqual(metrics['sampledAppPeakRssBytes'], 100)
            self.assertIsNone(metrics['sampledAllProcessesPeakRssBytes'])

    def test_complete_coverage_requires_membership_evidence(self):
        value = manifest(); value['membershipEvidenceSha256'] = None
        with self.assertRaises(ValueError):
            resource.owned_processes(value)

    def test_pin_returns_usable_manifest_without_process_discovery(self):
        calls = []
        def snapshot(pids):
            calls.append(pids)
            return observed()
        value = resource.pin([{'pid': 10, 'role': 'app'}, {'pid': 11, 'role': 'renderer'}], snapshot=snapshot)
        self.assertEqual(calls, [{10, 11}])
        self.assertEqual(value['rendererCoverage'], 'unknown')
        self.assertEqual(value['processes'][1]['startSha256'], OTHER)
        self.assertIsNone(resource.resource_sample(value, observed(), 0)['allProcessRssBytes'])
        value = manifest(); value['processes'][1]['pid'] = 10
        with self.assertRaises(ValueError):
            resource.owned_processes(value)

    def test_sample_uses_injected_clock_and_snapshot_only(self):
        clock = [0]
        def sleep(seconds):
            clock[0] += seconds
        value = resource.sample(manifest(), 100, 200, snapshot=lambda pids: observed(), now=lambda: clock[0], sleep=sleep)
        self.assertEqual([row['atMs'] for row in value['samples']], [0, 100, 200])
        self.assertEqual(resource.rss_metrics(value)['sampledAllProcessesPeakRssBytes'], 300)

    def test_no_process_args_or_extra_counter_fields_accepted(self):
        value = rss(); value['samples'][0]['processes'][0]['args'] = 'private'
        with self.assertRaises(ValueError):
            resource.rss_metrics(value)
        with self.assertRaises(ValueError):
            resource.observer_metrics({'schema': resource.SCHEMA, 'prompt': 'private'})
        with self.assertRaises(ValueError):
            resource.conditions(condition(secret='private'))

    def test_metadata_storage_groups_and_closed_vs_live_growth(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            (root / 'private.sqlite').write_bytes(b'x' * 10)
            (root / 'private.sqlite-wal').write_bytes(b'x' * 3)
            before = resource.storage_snapshot(root, 'live')
            (root / 'private.sqlite-wal').write_bytes(b'x' * 8)
            after = resource.storage_snapshot(root, 'live')
            metrics = resource.storage_metrics(before, after)
            self.assertEqual(metrics['walLogicalGrowthBytes'], 5)
            self.assertEqual(metrics['observedLogicalStorageGrowthBytes'], 5)
            self.assertIsNone(metrics['retainedLogicalStorageGrowthBytes'])
            before['state'] = after['state'] = 'closed'
            self.assertEqual(resource.storage_metrics(before, after)['retainedLogicalStorageGrowthBytes'], 5)
            self.assertNotIn('private', str(before))

    def test_partial_transport_cannot_become_zero_complete_frames(self):
        value = {'schema': resource.SCHEMA, 'transport': {'coverage': 'partial',
                 'before': {'chunks': 20, 'bytes': 100}, 'after': {'chunks': 22, 'bytes': 200}}}
        self.assertIsNone(resource.observer_metrics(value)['transportChunks'])
        value['transport']['coverage'] = 'complete'
        metrics = resource.observer_metrics(value)
        self.assertEqual(metrics['transportChunks'], 2)
        self.assertEqual(metrics['transportBytes'], 100)
        self.assertIsNone(metrics['transportFrames'])
        value['transport']['after']['chunks'] = 19
        with self.assertRaises(ValueError):
            resource.observer_metrics(value)

    def test_operations_and_negative_collection_growth(self):
        metrics = resource.observer_metrics({'schema': resource.SCHEMA,
            'operations': {'save': {'startMs': 10, 'settledMs': 17, 'observation': 'two-animation-frames', 'uncertaintyMs': 0}},
            'counters': {'watchers': {'before': 3, 'after': 1}, 'retiredDocuments': {'before': 5, 'after': 0}}})
        self.assertEqual(metrics['saveMs'], 7)
        self.assertEqual(metrics['watchersGrowth'], -2)
        self.assertEqual(metrics['retiredDocumentsGrowth'], -5)
        self.assertIsNone(metrics['sourceMs'])

    def test_unknown_original_metrics_stay_unknown_in_bundle(self):
        value = journey(); value['events'] = []; value['ipcCoverage'] = 'unknown'; value['providerCoverage'] = 'unknown'
        result = resource.assemble(value, condition())
        for key in ['completionMs', 'allIpcCalls', 'outsideProviderMs', 'sampledAllProcessesPeakRssBytes', 'saveMs']:
            self.assertIsNone(result['metrics'][key])

    def test_paired_delta_requires_equivalent_conditions_and_pinned_build(self):
        old, pi = bundle(), bundle('pi')
        paired = resource.compare(old, pi)
        self.assertTrue(paired['comparable'])
        self.assertEqual(paired['metrics']['completionMs']['piMinusOld'], 5)
        self.assertEqual(paired['verdict'], 'unproven-pending-acceptance')
        for key, value in [('buildVerified', False), ('modelSha256', OTHER), ('seededSubmissions', 1005), ('windowState', 'background')]:
            changed = copy.deepcopy(pi); changed['conditions'][key] = value
            result = resource.compare(old, changed)
            self.assertFalse(result['comparable'])
            self.assertIsNone(result['metrics']['completionMs']['piMinusOld'])

    def test_incomplete_renderer_does_not_block_other_valid_metrics(self):
        pi = resource.assemble(journey('pi', 25), condition(order=1), rss(complete=False))
        result = resource.compare(bundle(), pi)
        self.assertEqual(result['metrics']['completionMs']['piMinusOld'], 5)
        self.assertIsNone(result['metrics']['sampledAllProcessesPeakRssBytes']['piMinusOld'])
        self.assertIsNone(result['metrics']['sampledObservedProcessesPeakRssBytes']['piMinusOld'])

    def test_bundles_reject_unrecognized_metric_keys(self):
        value = bundle('pi'); value['metrics']['private-text'] = 1
        with self.assertRaises(ValueError):
            resource.compare(bundle(), value)

    def test_storage_states_must_match_across_both_lanes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            before = resource.storage_snapshot(root, 'closed')
            (root / 'data.sqlite').write_bytes(b'x')
            after = resource.storage_snapshot(root, 'closed')
            old = resource.assemble(journey(), condition(), before=before, after=after)
            before['state'] = after['state'] = 'checkpointed'
            pi = resource.assemble(journey('pi'), condition(order=1), before=before, after=after)
            paired = resource.compare(old, pi)
            self.assertIsNone(paired['metrics']['retainedLogicalStorageGrowthBytes']['piMinusOld'])
            self.assertIsNone(paired['metrics']['sqliteLogicalGrowthBytes']['piMinusOld'])

    def test_series_uses_paired_differences_median_and_range_without_verdict(self):
        old = [bundle(pair=pair, order=pair % 2) for pair in [1, 2, 3]]
        pi = [bundle('pi', pair=pair, order=1 - pair % 2) for pair in [1, 2, 3]]
        result = resource.compare_runs(old, list(reversed(pi)))
        aggregate = result['aggregate']['short']
        self.assertTrue(aggregate['atLeastThreePairs'])
        self.assertTrue(aggregate['alternatingOrder'])
        self.assertEqual(aggregate['metrics']['completionMs']['pairedDifference'], {'median': 5, 'min': 5, 'max': 5})
        self.assertEqual(result['verdict'], 'unproven-pending-acceptance')

    def test_series_cannot_mix_cache_protocol_or_builds(self):
        old = [bundle(pair=1), bundle(pair=2)]
        pi = [bundle('pi', pair=1), bundle('pi', pair=2)]
        old[1]['identity']['protocol'] = pi[1]['identity']['protocol'] = 'responses'
        with self.assertRaises(ValueError):
            resource.compare_runs(old, pi)
        with self.assertRaises(ValueError):
            resource.compare_runs([bundle(pair=1), bundle(pair=1)], pi)

    def test_observer_mode_must_match_pair_conditions(self):
        with self.assertRaises(ValueError):
            resource.assemble(journey(), condition(), observer={'schema': resource.SCHEMA,
                'operations': {'reopen': {'startMs': 0, 'settledMs': 10, 'observation': 'polling', 'uncertaintyMs': 100}}})


if __name__ == '__main__':
    unittest.main()
