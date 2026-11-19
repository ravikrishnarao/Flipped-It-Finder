/**
 * Flipit Finder - Compositional Generalization Test Suite (V2.2.2)
 * Tests compositional generalization across offline WordNet 3.0 relations and Moby phrases.
 * NOTE: This suite validates compositional capability on vocabulary present within the offline
 * lexical/phrase datasets; it is NOT claimed as a measure of accuracy on arbitrary out-of-lexicon puzzles.
 */

import generalizationData from '../data/generalization_eval.json' with { type: 'json' };
import { FlipitSolver } from '../src/solver/solver.ts';
import type { PuzzleBenchmarkItem } from '../src/solver/types.ts';
import type { TestResult } from './unit.test.ts';

export interface GeneralizationDetail {
  id: string;
  clues: string;
  expected: string;
  resolved: string;
  matchScore: number;
  timeMs: number;
  passed: boolean;
  explanation: string;
}

export function runGeneralizationTests(): { results: TestResult[]; details: GeneralizationDetail[] } {
  const results: TestResult[] = [];
  const details: GeneralizationDetail[] = [];
  const solver = new FlipitSolver();
  const puzzles: PuzzleBenchmarkItem[] = generalizationData as PuzzleBenchmarkItem[];

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  // 1. Test each of the 12 compositional generalization puzzles (Unconstrained)
  for (const p of puzzles) {
    const testName = `Compositional Generalization: ${p.clue1} + ${p.clue2} -> ${p.expectedPhrase}`;
    try {
      const solveRes = solver.solve(p.clue1, p.clue2);
      assert(solveRes.bestMatch !== null, `Expected a match for "${p.clue1} + ${p.clue2}", but got null`);

      const top = solveRes.bestMatch!;
      const actualPhrase = top.targetPhrase.replace(/[^A-Z0-9]/g, '');
      const expectedPhrase = p.expectedPhrase.replace(/[^A-Z0-9]/g, '');

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

      assert(top.matchScore >= 0.80, `Match score ${top.matchScore} is below 0.80`);
      assert(top.explanation.length > 10, 'Explanation should be descriptive');

      results.push({ suite: 'Compositional Generalization Tests', name: testName, passed: true });
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
      results.push({ suite: 'Compositional Generalization Tests', name: testName, passed: false, error: msg });
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

  // 2. Test unseen puzzles under constraints (First-letter and Word-length)
  for (const p of puzzles) {
    if (!p.sampleConstraints) continue;
    const testName = `Constrained Compositional: ${p.clue1} + ${p.clue2}`;
    try {
      const res = solver.solve(p.clue1, p.clue2, p.sampleConstraints);
      assert(res.bestMatch !== null, `Expected constrained match for ${p.clue1} + ${p.clue2}`);

      const top = res.bestMatch!;
      assert(
        top.word1.toUpperCase() === p.expectedWord1.toUpperCase(),
        `Constrained word1 mismatch: expected ${p.expectedWord1}, got ${top.word1}`
      );
      assert(
        top.word2.toUpperCase() === p.expectedWord2.toUpperCase(),
        `Constrained word2 mismatch: expected ${p.expectedWord2}, got ${top.word2}`
      );

      results.push({ suite: 'Compositional Constraint Tests', name: testName, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Compositional Constraint Tests', name: testName, passed: false, error: msg });
    }
  }

  return { results, details };
}
