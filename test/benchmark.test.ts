/**
 * Flipit Finder - Benchmark & Integration Test Suite
 * Tests all 17 provided puzzle examples, constraints, edge cases and performance.
 */

import puzzlesData from '../data/puzzles.json' with { type: 'json' };
import { FlipitSolver } from '../src/solver/solver.ts';
import type { PuzzleBenchmarkItem } from '../src/solver/types.ts';
import type { TestResult } from './unit.test.ts';

export interface BenchmarkDetail {
  id: string;
  clues: string;
  expected: string;
  resolved: string;
  matchScore: number;
  timeMs: number;
  passed: boolean;
  explanation: string;
}

export function runBenchmarkTests(): { results: TestResult[]; details: BenchmarkDetail[] } {
  const results: TestResult[] = [];
  const details: BenchmarkDetail[] = [];
  const solver = new FlipitSolver();
  const puzzles: PuzzleBenchmarkItem[] = puzzlesData as PuzzleBenchmarkItem[];

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  // 1. Test each of the 17 benchmark puzzles (Unconstrained)
  for (const p of puzzles) {
    const testName = `Solve ${p.clue1} ${p.clue2} -> ${p.expectedPhrase}`;
    try {
      const solveRes = solver.solve(p.clue1, p.clue2);
      assert(solveRes.bestMatch !== null, `Expected a match for "${p.clue1} ${p.clue2}", but got null`);

      const top = solveRes.bestMatch!;
      const actualPhrase = top.targetPhrase.replace(/[-\s]/g, '');
      const expectedPhrase = p.expectedPhrase.replace(/[-\s]/g, '');

      assert(
        actualPhrase === expectedPhrase,
        `Expected phrase "${p.expectedPhrase}", got "${top.targetPhrase}"`
      );

      assert(
        top.word1.toUpperCase() === p.expectedWord1.toUpperCase(),
        `Expected word1 "${p.expectedWord1}", got "${top.word1}"`
      );

      assert(
        top.word2.toUpperCase() === p.expectedWord2.toUpperCase(),
        `Expected word2 "${p.expectedWord2}", got "${top.word2}"`
      );

      assert(top.matchScore >= 0.85, `Match score ${top.matchScore} is below 0.85`);
      assert(top.explanation.length > 10, 'Explanation should be descriptive');

      results.push({ suite: 'Benchmark Tests', name: testName, passed: true });
      details.push({
        id: p.id,
        clues: `${p.clue1} + ${p.clue2}`,
        expected: p.expectedPhrase,
        resolved: top.targetPhrase,
        matchScore: top.matchScore,
        timeMs: solveRes.solveTimeMs,
        passed: true,
        explanation: top.explanation,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Benchmark Tests', name: testName, passed: false, error: msg });
      details.push({
        id: p.id,
        clues: `${p.clue1} + ${p.clue2}`,
        expected: p.expectedPhrase,
        resolved: 'FAILED',
        matchScore: 0,
        timeMs: 0,
        passed: false,
        explanation: msg,
      });
    }
  }

  // 2. Test puzzles under constraints (First-letter and Word-length)
  for (const p of puzzles) {
    if (!p.sampleConstraints) continue;
    const testName = `Constrained Solve ${p.clue1} ${p.clue2} with sample constraints`;
    try {
      const res = solver.solve(p.clue1, p.clue2, p.sampleConstraints);
      assert(res.bestMatch !== null, `Expected constrained match for ${p.clue1} ${p.clue2}`);

      const top = res.bestMatch!;
      assert(
        top.word1.toUpperCase() === p.expectedWord1.toUpperCase(),
        `Constrained word1 mismatch: expected ${p.expectedWord1}, got ${top.word1}`
      );
      assert(
        top.word2.toUpperCase() === p.expectedWord2.toUpperCase(),
        `Constrained word2 mismatch: expected ${p.expectedWord2}, got ${top.word2}`
      );

      // Verify constraint adherence
      if (p.sampleConstraints.word1?.length) {
        assert(top.word1.length === p.sampleConstraints.word1.length, 'Word 1 length violation');
      }
      if (p.sampleConstraints.word1?.startsWith) {
        assert(
          top.word1.startsWith(p.sampleConstraints.word1.startsWith),
          'Word 1 prefix violation'
        );
      }
      if (p.sampleConstraints.word2?.length) {
        assert(top.word2.length === p.sampleConstraints.word2.length, 'Word 2 length violation');
      }
      if (p.sampleConstraints.word2?.startsWith) {
        assert(
          top.word2.startsWith(p.sampleConstraints.word2.startsWith),
          'Word 2 prefix violation'
        );
      }

      results.push({ suite: 'Constraint Tests', name: testName, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Constraint Tests', name: testName, passed: false, error: msg });
    }
  }

  // 3. Negative constraint test (should filter out non-matching candidates)
  try {
    const res = solver.solve('SLOW', 'MEAL', {
      word1: { startsWith: 'Z' }, // Impossible for SLOW -> FAST
    });
    assert(
      res.candidates.length === 0,
      'Should return 0 candidates when constraint is unfulfillable'
    );
    results.push({
      suite: 'Constraint Tests',
      name: 'Rejection of candidates violating first-letter constraint',
      passed: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      suite: 'Constraint Tests',
      name: 'Rejection of candidates violating first-letter constraint',
      passed: false,
      error: msg,
    });
  }

  // 4. Edge Case: Completely unknown clue words
  try {
    const res = solver.solve('UNKNOWNCLUEONE', 'UNKNOWNCLUETWO');
    assert(res.candidates.length === 0, 'Candidates should be empty for unknown words');
    assert(res.bestMatch === null, 'Best match should be null for unknown words');
    results.push({
      suite: 'Edge Case Tests',
      name: 'Handles unknown clue words gracefully without error',
      passed: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      suite: 'Edge Case Tests',
      name: 'Handles unknown clue words gracefully without error',
      passed: false,
      error: msg,
    });
  }

  return { results, details };
}
