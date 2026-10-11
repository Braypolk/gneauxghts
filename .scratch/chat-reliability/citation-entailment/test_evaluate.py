"""Offline regression checks for review integrity, not a semantic model judge."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from evaluate import ROOT, evaluate, load, score, verify_origin


class CitationReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.corpus = load(ROOT / 'fixtures.json')
        cls.baseline = load(ROOT / 'recorded-baseline.json')
        cls.cases = {c['id']: c for c in cls.corpus['cases']}

    def test_all_positive_and_negative_controls_have_expected_accounting(self):
        result = evaluate(self.corpus, self.baseline)
        self.assertEqual(len(result['controls']['results']), 28)
        self.assertEqual(result['controls']['summary']['passingReviewedSamples'], 13)
        self.assertTrue(all(row['score']['wholeAnswerPass'] is None for row in result['recordedBaseline']['results']))

    def test_valid_title_link_does_not_override_manual_unsupported_verdict(self):
        case = self.cases['title_is_not_content']
        result = score(case['controls'][1], case['sources'], case['requirements'])
        addition = result['claims'][1]
        self.assertTrue(addition['citationPresent'] and addition['citationMembership'] and addition['readAuthority'])
        self.assertEqual(addition['semanticVerdict'], 'unsupported')
        self.assertFalse(result['passed'])

    def test_preview_text_match_cannot_grant_read_authority(self):
        case = self.cases['preview_is_not_read']
        result = score(case['controls'][1], case['sources'], case['requirements'])
        self.assertEqual(result['claims'][0]['semanticVerdict'], 'supported')
        self.assertTrue(result['claims'][0]['citationMembership'])
        self.assertFalse(result['claims'][0]['readAuthority'])
        self.assertFalse(result['passed'])

    def test_unknown_source_fails_even_with_a_positive_semantic_annotation(self):
        case = self.cases['event_date_is_not_edit_date']
        review = copy.deepcopy(case['controls'][0])
        review['answer'] = review['answer'].replace('passage:outcome', 'passage:unknown')
        review['claims'][0]['citationIds'] = ['unknown']
        result = score(review, case['sources'], case['requirements'])
        self.assertFalse(result['claims'][0]['citationMembership'])
        self.assertFalse(result['passed'])

    def test_pending_or_empty_claim_review_cannot_pass(self):
        case = self.cases['event_date_is_not_edit_date']
        review = copy.deepcopy(case['controls'][0])
        review['claims'][0]['verdict'] = 'unreviewed'
        result = score(review, case['sources'], case['requirements'])
        self.assertFalse(result['reviewComplete'])
        self.assertFalse(result['passed'])
        review['claims'] = []
        review['answer'] = 'No factual answer.'
        result = score(review, case['sources'], case['requirements'])
        self.assertFalse(result['reviewComplete'])
        self.assertFalse(result['passed'])

    def test_omitted_required_fact_prevents_evasive_pass(self):
        case = self.cases['event_date_is_not_edit_date']
        review = copy.deepcopy(case['controls'][0])
        review['coverage'][0]['status'] = 'missing'
        self.assertFalse(score(review, case['sources'], case['requirements'])['passed'])

    def test_unmapped_or_invented_review_citations_are_rejected(self):
        case = self.cases['title_is_not_content']
        review = copy.deepcopy(case['controls'][0])
        review['claims'][1]['citationIds'] = ['never-rendered']
        with self.assertRaisesRegex(ValueError, 'absent from answer'):
            score(review, case['sources'], case['requirements'])
        review = copy.deepcopy(case['controls'][0])
        review['claims'].pop()
        with self.assertRaisesRegex(ValueError, 'association'):
            score(review, case['sources'], case['requirements'])

    def test_quote_coverage_and_snapshot_tampering_are_rejected(self):
        case = self.cases['event_date_is_not_edit_date']
        review = copy.deepcopy(case['controls'][0])
        review['claims'][0]['quote'] = 'Fabricated quotation'
        with self.assertRaisesRegex(ValueError, 'substring'):
            score(review, case['sources'], case['requirements'])
        review = copy.deepcopy(case['controls'][0])
        review['coverage'] = []
        with self.assertRaisesRegex(ValueError, 'Coverage'):
            score(review, case['sources'], case['requirements'])
        baseline = copy.deepcopy(self.baseline)
        baseline['observations'][0]['answer'] += ' altered'
        with self.assertRaisesRegex(ValueError, 'snapshot changed'):
            evaluate(self.corpus, baseline)

    def test_original_trace_binding_rejects_hash_changes(self):
        observation = copy.deepcopy(self.baseline['observations'][0])
        # An isolated local file tests provenance failure without touching the original.
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as trace:
            json.dump({}, trace)
            trace.flush()
            observation['origin']['path'] = trace.name
            observation['origin']['sha256'] = 'not-the-file-hash'
            with self.assertRaisesRegex(ValueError, 'hash changed'):
                verify_origin(observation)

    def test_semantic_support_is_never_inferred_from_keyword_overlap(self):
        case = self.cases['event_date_is_not_edit_date']
        review = copy.deepcopy(case['controls'][0])
        review['claims'][0]['verdict'] = 'unreviewed'
        result = score(review, case['sources'], case['requirements'])
        self.assertEqual(result['claims'][0]['semanticVerdict'], 'unreviewed')
        self.assertFalse(result['passed'])

    def test_custom_corpus_cli_preserves_binding_and_rejects_default_corpus(self):
        case = copy.deepcopy(self.cases['event_date_is_not_edit_date'])
        case['id'] = 'fresh-heldout-case'
        control = case['controls'][0]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            corpus, answers, review, report = [directory / name for name in
                                              ['corpus.json', 'answers.json', 'review.json', 'report.json']]
            corpus.write_text(json.dumps({'cases': [case]}))
            answers.write_text(json.dumps([{'caseId': case['id'], 'answer': control['answer']}]))

            def cli(*args):
                return subprocess.run([sys.executable, str(ROOT / 'evaluate.py'), *map(str, args)], capture_output=True, text=True)

            prepared = cli('--corpus', corpus, 'prepare', answers, '--output', review)
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            completed = load(review)
            completed['results'][0].update(claims=control['claims'], coverage=control['coverage'])
            review.write_text(json.dumps(completed))
            self.assertIn('different corpus', cli('grade', review, '--output', report).stderr)
            self.assertFalse(report.exists())
            graded = cli('--corpus', corpus, 'grade', review, '--output', report)
            self.assertEqual(graded.returncode, 0, graded.stderr)
            self.assertEqual(load(report)['summary']['passingReviewedSamples'], 1)

    def test_prepare_and_grade_cli_bind_manual_review_to_answer_and_corpus(self):
        case = self.cases['event_date_is_not_edit_date']
        control = case['controls'][0]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            answers, review, report = [directory / name for name in ['answers.json', 'review.json', 'report.json']]
            answers.write_text(json.dumps([{'caseId': case['id'], 'answer': control['answer'], 'variant': 'baseline'}]))

            def cli(*args):
                return subprocess.run([sys.executable, str(ROOT / 'evaluate.py'), *map(str, args)], capture_output=True, text=True)

            prepared = cli('prepare', answers, '--output', review)
            self.assertEqual(prepared.returncode, 0, prepared.stderr)
            self.assertEqual(load(review)['results'][0]['claims'], [])
            original = review.read_bytes()
            self.assertNotEqual(cli('prepare', answers, '--output', review).returncode, 0)
            self.assertEqual(review.read_bytes(), original)
            # An unannotated inline citation cannot produce a passing grade.
            self.assertNotEqual(cli('grade', review, '--output', report).returncode, 0)
            self.assertFalse(report.exists())
            completed = load(review)
            completed['results'][0].update(claims=control['claims'], coverage=control['coverage'])
            review.write_text(json.dumps(completed))
            graded = cli('grade', review, '--output', report)
            self.assertEqual(graded.returncode, 0, graded.stderr)
            self.assertEqual(load(report)['summary']['passingReviewedSamples'], 1)
            self.assertEqual(load(report)['results'][0]['metadata']['variant'], 'baseline')
            completed['results'][0]['answer'] += ' altered'
            review.write_text(json.dumps(completed))
            self.assertIn('differs from prepared answer', cli('grade', review, '--output', report).stderr)
            completed['results'][0]['answer'] = control['answer']
            completed['corpusSha256'] = 'different-corpus'
            review.write_text(json.dumps(completed))
            self.assertIn('different corpus', cli('grade', review, '--output', report).stderr)


if __name__ == '__main__':
    unittest.main()
