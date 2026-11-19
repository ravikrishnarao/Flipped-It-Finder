/**
 * Flipit Finder - Diagnostic & Regression Test Suite (V2.2.3)
 * Validates the fix for candidate generation failure on INVOCATION + RITUAL -> PRAYER CEREMONY,
 * constraint rejection auditing, diagnostic telemetry, and compositional synonym generalization.
 */

import { FlipitSolver } from '../src/solver/solver.ts';
import { CompositeRelationshipProvider } from '../src/solver/compositeRelationshipProvider.ts';
import { CompositePhraseProvider } from '../src/solver/compositePhraseProvider.ts';
import type { TestResult } from './unit.test.ts';

export function runDiagnosticRegressionTests(): TestResult[] {
  const results: TestResult[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ suite: 'Diagnostic & Regression Tests', name, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Diagnostic & Regression Tests', name, passed: false, error: msg });
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  function assertEqual<T>(actual: T, expected: T, msg: string) {
    if (actual !== expected) {
      throw new Error(`${msg} (Expected: ${String(expected)}, Got: ${String(actual)})`);
    }
  }

  // 1. Independent Transformation Tests
  test('Independent Transformation: INVOCATION -> PRAYER resolved from WordNet provider', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('INVOCATION');
    const prayer = transforms.find((t) => t.word === 'PRAYER');
    assert(!!prayer, 'INVOCATION must generate PRAYER as a candidate');
    assertEqual(prayer?.relationType, 'synonym', 'Relationship type must be synonym');
    assert((prayer?.score || 0) >= 0.9, 'Match score for synonym must be >= 0.9');
    assert(Boolean(prayer?.reason.toLowerCase().includes('wordnet')), 'Reason must document WordNet provenance');
  });

  test('Independent Transformation: RITUAL -> CEREMONY resolved from WordNet provider', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('RITUAL');
    const ceremony = transforms.find((t) => t.word === 'CEREMONY');
    assert(!!ceremony, 'RITUAL must generate CEREMONY as a candidate');
    assertEqual(ceremony?.relationType, 'synonym', 'Relationship type must be synonym');
    assert((ceremony?.score || 0) >= 0.9, 'Match score for synonym must be >= 0.9');
    assert(Boolean(ceremony?.reason.toLowerCase().includes('wordnet')), 'Reason must document WordNet provenance');
  });

  // 2. Phrase Recognition Test
  test('Independent Phrase Recognition: PRAYER CEREMONY recognized in phrase repository', () => {
    const phraseProvider = new CompositePhraseProvider();
    const phrase = phraseProvider.matchPhrase('PRAYER', 'CEREMONY');
    assert(!!phrase, 'PRAYER CEREMONY must be recognized by PhraseProvider');
    assertEqual(phrase?.phrase, 'PRAYER CEREMONY', 'Normalized phrase must be PRAYER CEREMONY');
    assert((phrase?.frequencyScore || 0) > 0.9, 'Collocation frequency score must be > 0.9');
  });

  // 3. Exact Failed Puzzle with Constraints
  test('Regression: INVOCATION + RITUAL solves correctly with length & prefix constraints', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('INVOCATION', 'RITUAL', {
      word1: { length: 6, startsWith: 'P' },
      word2: { length: 8, startsWith: 'C' },
    });

    assert(!!result.bestMatch, 'Solver must find a best match');
    assertEqual(result.bestMatch?.targetPhrase, 'PRAYER CEREMONY', 'Target phrase must be PRAYER CEREMONY');
    assertEqual(result.bestMatch?.word1, 'PRAYER', 'Word 1 must be PRAYER');
    assertEqual(result.bestMatch?.word2, 'CEREMONY', 'Word 2 must be CEREMONY');
    assert(result.totalCombinationsEvaluated >= 1, 'At least 1 candidate combination must be evaluated');
  });

  // 4. Exact Puzzle without Constraints
  test('Regression: INVOCATION + RITUAL solves correctly without constraints', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('INVOCATION', 'RITUAL');

    assert(!!result.bestMatch, 'Solver must find best match without constraints');
    assertEqual(result.bestMatch?.targetPhrase, 'PRAYER CEREMONY', 'Best ranked match must be PRAYER CEREMONY');
    assert(result.totalCombinationsEvaluated >= 10, 'Candidate generator must evaluate multiple cross-combinations');
  });

  // 5. Diagnostic Constraint Filtering & Rejection Reasons
  test('Diagnostic Instrumentation: Records constraint rejections with specific reasons', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('INVOCATION', 'RITUAL', {
      word1: { length: 6, startsWith: 'P' },
      word2: { length: 8, startsWith: 'C' },
    });

    const diag = result.diagnostic;
    assert(!!diag, 'Diagnostic telemetry must be populated');
    assertEqual(diag?.clue1.clue, 'INVOCATION', 'Clue 1 name in diagnostic');
    assertEqual(diag?.clue2.clue, 'RITUAL', 'Clue 2 name in diagnostic');

    // Clue 1 surviving and rejections
    assertEqual(diag?.clue1.survivingCount, 1, 'Exactly 1 candidate survives Clue 1 constraints');
    assertEqual(diag?.clue1.survivingTransformations[0].word, 'PRAYER', 'Surviving candidate is PRAYER');
    assert((diag?.clue1.rejectedCount || 0) >= 3, 'At least 3 candidates rejected for Clue 1');

    const supplicationRejection = diag?.clue1.rejections.find((r) => r.word === 'SUPPLICATION');
    assert(!!supplicationRejection, 'SUPPLICATION must be recorded as rejected');
    assert(Boolean(supplicationRejection?.reason.includes('Length is 12')), 'Rejection reason must mention length mismatch');

    // Clue 2 surviving and rejections
    assertEqual(diag?.clue2.survivingCount, 1, 'Exactly 1 candidate survives Clue 2 constraints');
    assertEqual(diag?.clue2.survivingTransformations[0].word, 'CEREMONY', 'Surviving candidate is CEREMONY');

    const riteRejection = diag?.clue2.rejections.find((r) => r.word === 'RITE');
    assert(!!riteRejection, 'RITE must be recorded as rejected');
    assert(Boolean(riteRejection?.reason.includes('Length is 4')), 'Rejection reason for RITE must mention length');
  });

  // 6. Diagnostic Failure Telemetry on Unsolvable Inputs
  test('Diagnostic Instrumentation: Detects NO_CLUE_TRANSFORMATIONS on unknown clues', () => {
    const solver = new FlipitSolver();
    const res = solver.solve('UNKNOWNXYZ123', 'RITUAL');
    assertEqual(res.diagnostic?.failureReason, 'NO_CLUE1_TRANSFORMATIONS', 'Failure reason must identify unknown Clue 1');
    assert(res.diagnostic?.failureDescription?.includes('UNKNOWNXYZ123') || false, 'Description must name the unknown clue');
  });

  test('Diagnostic Instrumentation: Detects ALL_CLUE_FILTERED_BY_CONSTRAINTS on impossible constraints', () => {
    const solver = new FlipitSolver();
    const res = solver.solve('INVOCATION', 'RITUAL', {
      word1: { length: 99 },
    });
    assertEqual(res.diagnostic?.failureReason, 'ALL_CLUE1_FILTERED_BY_CONSTRAINTS', 'Failure reason must identify strict constraints');
  });

  // 7. Generalization on Similar Unseen Clue Pair
  test('Generalization: PETITION + RITE -> PRAYER CEREMONY with constraints', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('PETITION', 'RITE', {
      word1: { length: 6, startsWith: 'P' },
      word2: { length: 8, startsWith: 'C' },
    });

    assert(!!result.bestMatch, 'Generalization puzzle must solve');
    assertEqual(result.bestMatch?.targetPhrase, 'PRAYER CEREMONY', 'Result should be PRAYER CEREMONY');
    assertEqual(result.bestMatch?.word1, 'PRAYER', 'Word 1 should be PRAYER');
    assertEqual(result.bestMatch?.word2, 'CEREMONY', 'Word 2 should be CEREMONY');
  });

  test('Generalization: PETITION + RITE -> PRAYER CEREMONY unconstrained ranking', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('PETITION', 'RITE');

    assert(!!result.bestMatch, 'Unconstrained generalization puzzle must solve');
    assertEqual(result.bestMatch?.targetPhrase, 'PRAYER CEREMONY', 'Best unconstrained match is PRAYER CEREMONY');
  });

  return results;
}
