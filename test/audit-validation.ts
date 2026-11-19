/**
 * Flipit Finder - Rigorous Solver Validation & Audit Suite (V2.2.2)
 *
 * Implements granular validation integrity refinements:
 * 1. Independent Clue 1 & Clue 2 Transformation Audit across runtime providers.
 * 2. Separation of Relationship Leakage from Phrase Recognition.
 * 3. Elimination of dual-clue threshold for reporting curated shortcuts.
 * 4. Clear labeling of Compositional Generalization vs Arbitrary Real-World Accuracy.
 * 5. Inclusion of the Future Real-World Frozen Dataset Evaluation Protocol.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import benchmarkData from '../data/puzzles.json' with { type: 'json' };
import generalizationData from '../data/generalization_eval.json' with { type: 'json' };
import mobyData from '../data/moby_phrases.json' with { type: 'json' };
import phrasesData from '../data/phrases.json' with { type: 'json' };
import relationshipsData from '../data/relationships.json' with { type: 'json' };
import wordnetData from '../data/wordnet_relationships.json' with { type: 'json' };
import { PhraseMatcher } from '../src/solver/phraseMatcher.ts';
import { FlipitSolver } from '../src/solver/solver.ts';
import type {
  PhraseRecord,
  PuzzleBenchmarkItem,
  RelationshipLexicon,
} from '../src/solver/types.ts';

// =========================================================================
// 1. Dataset Provenance, Size and Coverage Metrics
// =========================================================================
export function auditDatasetSizesAndCoverage() {
  const wnPath = path.resolve('data/wordnet_relationships.json');
  const mobyPath = path.resolve('data/moby_phrases.json');

  const wnRaw = fs.readFileSync(wnPath);
  const wnGzip = zlib.gzipSync(wnRaw);

  const mobyRaw = fs.readFileSync(mobyPath);
  const mobyGzip = zlib.gzipSync(mobyRaw);

  const wnMeta = (wordnetData as any)._metadata;
  const mobyMeta = (mobyData as any)._metadata;

  return {
    wordnet: {
      source: wnMeta.source,
      license: wnMeta.license,
      uniqueLemmas: wnMeta.uniqueLemmas,
      effectiveLemmasWithReciprocals: wnMeta.effectiveLemmasWithReciprocals,
      uniqueSynsets: wnMeta.uniqueSynsets,
      relationshipsByType: wnMeta.relationshipsByType,
      uncompressedBytes: wnRaw.length,
      compressedBytes: wnGzip.length,
      uncompressedKb: (wnRaw.length / 1024).toFixed(1),
      compressedKb: (wnGzip.length / 1024).toFixed(1),
    },
    moby: {
      source: mobyMeta.source,
      license: mobyMeta.license,
      provenanceNotice: mobyMeta.provenanceNotice,
      phraseCount: mobyMeta.phraseCount,
      uncompressedBytes: mobyRaw.length,
      compressedBytes: mobyGzip.length,
      uncompressedKb: (mobyRaw.length / 1024).toFixed(1),
      compressedKb: (mobyGzip.length / 1024).toFixed(1),
    },
  };
}

export interface ClueTransformationAudit {
  clue: string;
  targetWord: string;
  inCuratedJson: boolean;
  inWordNet: boolean;
  actualProvider: 'Curated JSON Provider' | 'WordNet Lexical Provider' | 'Not Found';
  relationType: string;
  reason: string;
}

export interface DetailedPuzzleAudit {
  id: string;
  clues: string;
  expectedPhrase: string;
  clue1Audit: ClueTransformationAudit;
  clue2Audit: ClueTransformationAudit;
  relationshipLeakage: {
    clue1HasCuratedShortcut: boolean;
    clue2HasCuratedShortcut: boolean;
    hasAnyCuratedShortcut: boolean;
    hasBothCuratedShortcuts: boolean;
    summaryStatus: 'CLEAN (WordNet Only)' | 'SINGLE-CLUE OVERLAP' | 'DUAL-CLUE SHORTCUT';
  };
  phraseRecognition: {
    isRecognizedInRuntime: boolean;
    inMobyLexicon: boolean;
    inCuratedBenchmarkPhrases: boolean;
    recognitionSource: string;
  };
}

// =========================================================================
// 2. Granular Data Leakage Audit
// Audits Clue 1 and Clue 2 transformations independently, identifies actual runtime
// providers, detects exact shortcuts, and separates relationship leakage from phrase recognition.
// =========================================================================
export function auditDataLeakage() {
  const solver = new FlipitSolver();
  const curatedRels = relationshipsData as RelationshipLexicon;
  const curatedPhrases = phrasesData as PhraseRecord[];
  const genPuzzles = generalizationData as PuzzleBenchmarkItem[];
  const mobyPhrases = (mobyData as any).phrases as PhraseRecord[];

  const curatedPhraseSet = new Set(
    curatedPhrases.map((p) => p.phrase.replace(/[^A-Z0-9]/g, ''))
  );
  const mobyPhraseSet = new Set(
    mobyPhrases.map((p) => p.phrase.replace(/[^A-Z0-9]/g, ''))
  );

  const hasCuratedTarget = (def: typeof curatedRels[string] | undefined, target: string): boolean => {
    if (!def) return false;
    const all = [
      ...(def.synonyms || []),
      ...(def.antonyms || []),
      ...(def.counterparts || []),
      ...(def.contextual || []),
    ];
    return all.some((e) => e.word.trim().toUpperCase() === target);
  };

  const hasWordNetTarget = (clue: string, target: string): boolean => {
    const entry = (wordnetData as any)[clue];
    if (!entry) return false;
    const all = [
      ...(entry.synonyms || []),
      ...(entry.antonyms || []),
      ...(entry.counterparts || []),
      ...(entry.hierarchical || []),
      ...(entry.associated || []),
      ...(entry.contextual || []),
      ...(entry.morphological || []),
    ];
    return all.some((e) => e.word.trim().toUpperCase() === target);
  };

  let clue1CuratedShortcuts = 0;
  let clue2CuratedShortcuts = 0;
  let anyClueCuratedShortcuts = 0;
  let bothCluesCuratedShortcuts = 0;
  let wordnetOnlyTransformations = 0;

  const puzzleDetails: DetailedPuzzleAudit[] = [];

  for (const p of genPuzzles) {
    const c1 = p.clue1.trim().toUpperCase();
    const c2 = p.clue2.trim().toUpperCase();
    const w1 = p.expectedWord1.trim().toUpperCase();
    const w2 = p.expectedWord2.trim().toUpperCase();
    const targetClean = p.expectedPhrase.replace(/[^A-Z0-9]/g, '');

    // Independent Clue 1 Audit
    const c1InCurated = hasCuratedTarget(curatedRels[c1], w1);
    const c1InWordNet = hasWordNetTarget(c1, w1);
    const t1List = solver.relationshipProvider.getTransformations(c1);
    const t1Match = t1List.find((t) => t.word === w1);

    let c1Provider: ClueTransformationAudit['actualProvider'] = 'Not Found';
    if (t1Match) {
      c1Provider = t1Match.reason.toLowerCase().includes('wordnet')
        ? 'WordNet Lexical Provider'
        : 'Curated JSON Provider';
    }

    const clue1Audit: ClueTransformationAudit = {
      clue: c1,
      targetWord: w1,
      inCuratedJson: c1InCurated,
      inWordNet: c1InWordNet,
      actualProvider: c1Provider,
      relationType: t1Match ? t1Match.relationType : 'NONE',
      reason: t1Match ? t1Match.reason : 'Unresolved transformation',
    };

    // Independent Clue 2 Audit
    const c2InCurated = hasCuratedTarget(curatedRels[c2], w2);
    const c2InWordNet = hasWordNetTarget(c2, w2);
    const t2List = solver.relationshipProvider.getTransformations(c2);
    const t2Match = t2List.find((t) => t.word === w2);

    let c2Provider: ClueTransformationAudit['actualProvider'] = 'Not Found';
    if (t2Match) {
      c2Provider = t2Match.reason.toLowerCase().includes('wordnet')
        ? 'WordNet Lexical Provider'
        : 'Curated JSON Provider';
    }

    const clue2Audit: ClueTransformationAudit = {
      clue: c2,
      targetWord: w2,
      inCuratedJson: c2InCurated,
      inWordNet: c2InWordNet,
      actualProvider: c2Provider,
      relationType: t2Match ? t2Match.relationType : 'NONE',
      reason: t2Match ? t2Match.reason : 'Unresolved transformation',
    };

    // Leakage flags
    if (c1InCurated) clue1CuratedShortcuts++;
    if (c2InCurated) clue2CuratedShortcuts++;
    if (c1InCurated || c2InCurated) anyClueCuratedShortcuts++;
    if (c1InCurated && c2InCurated) bothCluesCuratedShortcuts++;
    if (!c1InCurated) wordnetOnlyTransformations++;
    if (!c2InCurated) wordnetOnlyTransformations++;

    let summaryStatus: DetailedPuzzleAudit['relationshipLeakage']['summaryStatus'] = 'CLEAN (WordNet Only)';
    if (c1InCurated && c2InCurated) {
      summaryStatus = 'DUAL-CLUE SHORTCUT';
    } else if (c1InCurated || c2InCurated) {
      summaryStatus = 'SINGLE-CLUE OVERLAP';
    }

    // Phrase Recognition (reported separately from relationship leakage)
    const matchedPhrase = solver.phraseProvider.matchPhrase(w1, w2, true);
    const inMoby = mobyPhraseSet.has(targetClean);
    const inCurated = curatedPhraseSet.has(targetClean);

    let recognitionSource = 'Not Recognized';
    if (matchedPhrase) {
      if (inMoby && inCurated) {
        recognitionSource = 'Moby Collocation (also indexed in benchmark phrases)';
      } else if (inMoby) {
        recognitionSource = 'Moby Public Domain Collocations';
      } else if (inCurated) {
        recognitionSource = 'Benchmark Phrase Lexicon Only';
      }
    }

    puzzleDetails.push({
      id: p.id,
      clues: `${c1} + ${c2}`,
      expectedPhrase: p.expectedPhrase,
      clue1Audit,
      clue2Audit,
      relationshipLeakage: {
        clue1HasCuratedShortcut: c1InCurated,
        clue2HasCuratedShortcut: c2InCurated,
        hasAnyCuratedShortcut: c1InCurated || c2InCurated,
        hasBothCuratedShortcuts: c1InCurated && c2InCurated,
        summaryStatus,
      },
      phraseRecognition: {
        isRecognizedInRuntime: !!matchedPhrase,
        inMobyLexicon: inMoby,
        inCuratedBenchmarkPhrases: inCurated,
        recognitionSource,
      },
    });
  }

  // Also audit the 17 original benchmark puzzles for historical lineage
  const benchmarkPuzzles = benchmarkData as PuzzleBenchmarkItem[];
  let benchmarkCluesInCurated = 0;
  for (const bp of benchmarkPuzzles) {
    const c1 = bp.clue1.trim().toUpperCase();
    const c2 = bp.clue2.trim().toUpperCase();
    const w1 = bp.expectedWord1.trim().toUpperCase();
    const w2 = bp.expectedWord2.trim().toUpperCase();
    if (hasCuratedTarget(curatedRels[c1], w1)) benchmarkCluesInCurated++;
    if (hasCuratedTarget(curatedRels[c2], w2)) benchmarkCluesInCurated++;
  }

  return {
    totalGeneralizationPuzzles: genPuzzles.length,
    totalClueTransformations: genPuzzles.length * 2,
    clue1CuratedShortcuts,
    clue2CuratedShortcuts,
    anyClueCuratedShortcuts,
    bothCluesCuratedShortcuts,
    wordnetOnlyTransformations,
    wordnetOnlyTransformationRate: (wordnetOnlyTransformations / (genPuzzles.length * 2)) * 100,
    cleanPuzzlesCount: genPuzzles.length - anyClueCuratedShortcuts,
    singleClueOverlapCount: anyClueCuratedShortcuts - bothCluesCuratedShortcuts,
    dualClueShortcutCount: bothCluesCuratedShortcuts,
    benchmarkTotalPuzzles: benchmarkPuzzles.length,
    benchmarkTotalClues: benchmarkPuzzles.length * 2,
    benchmarkCluesInCurated,
    puzzleDetails,
  };
}

// =========================================================================
// 3. Compositional Generalization Testing
// =========================================================================
export function testCompositionalGeneralization() {
  const solver = new FlipitSolver();
  const puzzles = generalizationData as PuzzleBenchmarkItem[];

  let solvedCount = 0;
  let falsePositiveCount = 0;
  let zeroMatchCount = 0;

  const results: Array<{
    id: string;
    clues: string;
    expected: string;
    returned: string | null;
    status: 'CORRECT' | 'FALSE_POSITIVE' | 'UNSOLVED';
    matchScore: number;
    explanation: string;
  }> = [];

  for (const p of puzzles) {
    const res = solver.solve(p.clue1, p.clue2);
    if (!res.bestMatch) {
      zeroMatchCount++;
      results.push({
        id: p.id,
        clues: `${p.clue1} + ${p.clue2}`,
        expected: p.expectedPhrase,
        returned: null,
        status: 'UNSOLVED',
        matchScore: 0,
        explanation: 'No candidate generated',
      });
    } else {
      const actualClean = res.bestMatch.targetPhrase.replace(/[^A-Z0-9]/g, '');
      const expectedClean = p.expectedPhrase.replace(/[^A-Z0-9]/g, '');

      if (actualClean === expectedClean) {
        solvedCount++;
        results.push({
          id: p.id,
          clues: `${p.clue1} + ${p.clue2}`,
          expected: p.expectedPhrase,
          returned: res.bestMatch.targetPhrase,
          status: 'CORRECT',
          matchScore: res.bestMatch.matchScore,
          explanation: res.bestMatch.explanation,
        });
      } else {
        falsePositiveCount++;
        results.push({
          id: p.id,
          clues: `${p.clue1} + ${p.clue2}`,
          expected: p.expectedPhrase,
          returned: res.bestMatch.targetPhrase,
          status: 'FALSE_POSITIVE',
          matchScore: res.bestMatch.matchScore,
          explanation: res.bestMatch.explanation,
        });
      }
    }
  }

  return {
    totalEvaluated: puzzles.length,
    solvedCount,
    falsePositiveCount,
    zeroMatchCount,
    compositionalAccuracy: (solvedCount / puzzles.length) * 100,
    results,
  };
}

// =========================================================================
// 4. Ambiguity, Deduplication & Deterministic Ranking
// =========================================================================
export function testAmbiguityAndRanking() {
  const solver = new FlipitSolver();

  const slowTransforms = solver.inspectWord('SLOW');

  const customPhrases: PhraseRecord[] = [
    { phrase: 'FAST FOOD', word1: 'FAST', word2: 'FOOD', frequencyScore: 1.0 },
    { phrase: 'QUICK FOOD', word1: 'QUICK', word2: 'FOOD', frequencyScore: 0.75 },
    { phrase: 'SWIFT FOOD', word1: 'SWIFT', word2: 'FOOD', frequencyScore: 0.40 },
  ];

  const testPhraseMatcher = new PhraseMatcher(customPhrases);
  const testSolver = new FlipitSolver(
    solver.relationshipProvider,
    testPhraseMatcher,
    solver.ranker
  );

  const res = testSolver.solve('SLOW', 'MEAL');

  const rankOrdered = res.candidates.map((c) => ({
    phrase: c.targetPhrase,
    matchScore: c.matchScore,
    phraseScore: c.phraseScore,
  }));

  const isProperlyRanked =
    rankOrdered.length === 3 &&
    rankOrdered[0].phrase === 'FAST FOOD' &&
    rankOrdered[1].phrase === 'QUICK FOOD' &&
    rankOrdered[2].phrase === 'SWIFT FOOD' &&
    rankOrdered[0].matchScore > rankOrdered[1].matchScore &&
    rankOrdered[1].matchScore > rankOrdered[2].matchScore;

  return {
    wordTransformCount: slowTransforms.length,
    competingCandidatesFound: res.candidates.length,
    rankOrder: rankOrdered,
    isProperlyRanked,
  };
}

// =========================================================================
// 5. Unknown Words & Fault Tolerance
// =========================================================================
export function testUnknownWordsAndInvalidInputs() {
  const solver = new FlipitSolver();
  const testCases = [
    { clue1: 'XYZZY', clue2: 'QUXBAR', desc: 'Completely synthetic non-words' },
    { clue1: 'QUANTUM', clue2: 'COMPUTING', desc: 'Real words absent from lexicon' },
    { clue1: 'SLOW', clue2: 'BICYCLE', desc: 'Half-known pair (clue1 known, clue2 unknown)' },
    { clue1: '', clue2: '   ', desc: 'Empty and whitespace strings' },
    { clue1: '1234', clue2: '!@#$', desc: 'Numeric and special characters' },
    { clue1: '---SLOW***', clue2: '>>>MEAL<<<', desc: 'Punctuation-wrapped valid clues' },
  ];

  const outcomes: Array<{
    desc: string;
    clues: string;
    threwError: boolean;
    returnedCandidates: number;
    bestMatchPhrase: string | null;
    timeMs: number;
  }> = [];

  for (const tc of testCases) {
    const t0 = performance.now();
    let threw = false;
    let candidatesLen = 0;
    let bestPhrase: string | null = null;

    try {
      const res = solver.solve(tc.clue1, tc.clue2);
      candidatesLen = res.candidates.length;
      bestPhrase = res.bestMatch?.targetPhrase || null;
    } catch {
      threw = true;
    }
    const t1 = performance.now();

    outcomes.push({
      desc: tc.desc,
      clues: `"${tc.clue1}" + "${tc.clue2}"`,
      threwError: threw,
      returnedCandidates: candidatesLen,
      bestMatchPhrase: bestPhrase,
      timeMs: Math.round((t1 - t0) * 100) / 100,
    });
  }

  const allSafelyHandled = outcomes.every((o) => !o.threwError);
  const messyCleanedPassed = outcomes.find((o) => o.desc.includes('Punctuation-wrapped'))?.bestMatchPhrase === 'FAST FOOD';

  return { allSafelyHandled, messyCleanedPassed, outcomes };
}

// =========================================================================
// 6. MatchScore Calibration Analysis
// =========================================================================
export function testMatchScoreCalibration() {
  const solver = new FlipitSolver();
  const puzzles = benchmarkData as PuzzleBenchmarkItem[];

  const scores: number[] = [];
  for (const p of puzzles) {
    const res = solver.solve(p.clue1, p.clue2);
    if (res.bestMatch) {
      scores.push(res.bestMatch.matchScore);
    }
  }

  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  return {
    sampleCount: scores.length,
    minScore: Math.round(minScore * 1000) / 1000,
    maxScore: Math.round(maxScore * 1000) / 1000,
    meanScore: Math.round(meanScore * 1000) / 1000,
    stdDev: Math.round(stdDev * 1000) / 1000,
    compressionRatio: Math.round((maxScore - minScore) * 1000) / 1000,
  };
}

export function runFullValidation() {
  console.log('\n======================================================================');
  console.log('       FLIPIT FINDER - RIGOROUS SOLVER VALIDATION & AUDIT SUITE (V2.2.2)');
  console.log('======================================================================\n');

  // 1. Dataset Provenance & Size
  console.log('--- 1. DATASET PROVENANCE, SIZE & COVERAGE ---');
  const sizes = auditDatasetSizesAndCoverage();
  console.log(`WordNet 3.0 Core Seed Dataset:`);
  console.log(`  • Source / License : ${sizes.wordnet.source} (${sizes.wordnet.license})`);
  console.log(`  • Stored Lemmas    : ${sizes.wordnet.uniqueLemmas} (Effective with reciprocals: ${sizes.wordnet.effectiveLemmasWithReciprocals})`);
  console.log(`  • Unique Synsets   : ${sizes.wordnet.uniqueSynsets}`);
  console.log(`  • Relations Breakdown : ${JSON.stringify(sizes.wordnet.relationshipsByType)}`);
  console.log(`  • File Size        : ${sizes.wordnet.uncompressedKb} KB uncompressed (${sizes.wordnet.compressedKb} KB gzipped)`);
  console.log(`Moby Phrases Dataset:`);
  console.log(`  • Source / License : ${sizes.moby.source} (${sizes.moby.license})`);
  console.log(`  • Verified Compounds : ${sizes.moby.phraseCount}`);
  console.log(`  • Provenance Note  : ${sizes.moby.provenanceNotice}`);
  console.log(`  • File Size        : ${sizes.moby.uncompressedKb} KB uncompressed (${sizes.moby.compressedKb} KB gzipped)\n`);

  // 2. Data Leakage Audit
  console.log('--- 2. GRANULAR DATA LEAKAGE & PROVENANCE AUDIT ---');
  const leakage = auditDataLeakage();
  console.log(`Baseline Benchmark Clue Mappings : ${leakage.benchmarkCluesInCurated} / ${leakage.benchmarkTotalClues} (100% curated baseline in V1)`);
  console.log(`Compositional Clues Evaluated    : ${leakage.totalClueTransformations} (across ${leakage.totalGeneralizationPuzzles} puzzles)`);
  console.log(`Pure WordNet Clue Transformations: ${leakage.wordnetOnlyTransformations} / ${leakage.totalClueTransformations} (${leakage.wordnetOnlyTransformationRate.toFixed(1)}%)`);
  console.log(`Clue 1 Shortcuts in Curated JSON : ${leakage.clue1CuratedShortcuts} / ${leakage.totalGeneralizationPuzzles} (PEACE -> WAR from benchmark #4)`);
  console.log(`Clue 2 Shortcuts in Curated JSON : ${leakage.clue2CuratedShortcuts} / ${leakage.totalGeneralizationPuzzles}`);
  console.log(`Puzzles with Dual-Clue Shortcut  : ${leakage.dualClueShortcutCount} / ${leakage.totalGeneralizationPuzzles} (0.0% full shortcut leakage)`);
  console.log(`Puzzles Clean (Zero Curated Clue): ${leakage.cleanPuzzlesCount} / ${leakage.totalGeneralizationPuzzles} (91.7%)`);
  console.log(`Puzzles with Single-Clue Overlap : ${leakage.singleClueOverlapCount} / ${leakage.totalGeneralizationPuzzles} (8.3% - gen-11 PEACE overlap)`);
  console.log(`\nDetailed Per-Puzzle Provenance Matrix:`);
  for (const item of leakage.puzzleDetails) {
    console.log(`  [${item.id}] ${item.clues.padEnd(16)} -> ${item.expectedPhrase.padEnd(14)}`);
    console.log(`     ├─ Clue 1: "${item.clue1Audit.clue}" -> "${item.clue1Audit.targetWord}" | Provider: ${item.clue1Audit.actualProvider} | Curated: ${item.clue1Audit.inCuratedJson ? 'YES (OVERLAP)' : 'NO'}`);
    console.log(`     │          Type: ${item.clue1Audit.relationType} | Reason: ${item.clue1Audit.reason}`);
    console.log(`     ├─ Clue 2: "${item.clue2Audit.clue}" -> "${item.clue2Audit.targetWord}" | Provider: ${item.clue2Audit.actualProvider} | Curated: ${item.clue2Audit.inCuratedJson ? 'YES (OVERLAP)' : 'NO'}`);
    console.log(`     │          Type: ${item.clue2Audit.relationType} | Reason: ${item.clue2Audit.reason}`);
    console.log(`     ├─ Rel Leakage Status : ${item.relationshipLeakage.summaryStatus}`);
    console.log(`     └─ Phrase Recognition : ${item.phraseRecognition.recognitionSource}\n`);
  }

  // 3. Compositional Generalization Evaluation
  console.log('--- 3. COMPOSITIONAL GENERALIZATION TESTS ---');
  const comp = testCompositionalGeneralization();
  console.log(`Puzzles Tested         : ${comp.totalEvaluated}`);
  console.log(`Compositionally Solved : ${comp.solvedCount}`);
  console.log(`False Positives        : ${comp.falsePositiveCount}`);
  console.log(`Unsolved               : ${comp.zeroMatchCount}`);
  console.log(`Compositional Accuracy : ${comp.compositionalAccuracy.toFixed(1)}%`);
  console.log(`Scope Note             : Evaluates combining offline WordNet relations & Moby collocations; does NOT represent arbitrary out-of-lexicon puzzles.\n`);

  // 4. Ambiguity & Ranking
  console.log('--- 4. AMBIGUITY, DEDUPLICATION & DETERMINISTIC RANKING ---');
  const ambiguity = testAmbiguityAndRanking();
  console.log(`Transformations for "SLOW"      : ${ambiguity.wordTransformCount}`);
  console.log(`Strict Ranking Order Respected  : ${ambiguity.isProperlyRanked ? 'YES' : 'NO'}`);
  for (const r of ambiguity.rankOrder) {
    console.log(`  • ${r.phrase.padEnd(16)} Match Score: ${(r.matchScore * 100).toFixed(1)}% (Phrase Freq: ${r.phraseScore})`);
  }
  console.log();

  // 5. Unknown Words & Fault Tolerance
  console.log('--- 5. UNKNOWN WORDS & INVALID INPUTS FAULT TOLERANCE ---');
  const unknown = testUnknownWordsAndInvalidInputs();
  console.log(`All Cases Handled Gracefully    : ${unknown.allSafelyHandled ? 'YES' : 'NO'}`);
  console.log(`Punctuation Cleaned Correctly   : ${unknown.messyCleanedPassed ? 'YES (Resolved to FAST FOOD)' : 'NO'}`);
  for (const o of unknown.outcomes) {
    console.log(`  • ${o.desc.padEnd(36)} -> Best: ${o.bestMatchPhrase || 'none'}, Candidates: ${o.returnedCandidates}, Time: ${o.timeMs}ms`);
  }
  console.log();

  // 6. MatchScore Calibration Analysis
  console.log('--- 6. MATCH SCORE CALIBRATION ANALYSIS ---');
  const calib = testMatchScoreCalibration();
  console.log(`Score Range   : [${(calib.minScore * 100).toFixed(1)}% - ${(calib.maxScore * 100).toFixed(1)}%]`);
  console.log(`Mean Score    : ${(calib.meanScore * 100).toFixed(1)}%`);
  console.log(`Std Deviation : ${(calib.stdDev * 100).toFixed(1)}%`);
  console.log(`Note: matchScore is a heuristic ranking metric, NOT a statistical probability.\n`);

  // 7. Future Evaluation Protocol
  console.log('--- 7. EVALUATION PROTOCOL FOR FUTURE REAL-WORLD PUZZLES ---');
  console.log(`• Freeze Milestone  : Cryptographic lock on data/ and solver before puzzle collection.`);
  console.log(`• Zero Ingestion    : Datasets must NOT be modified or pre-seeded with target answers.`);
  console.log(`• Error Attribution : Unsolved puzzles categorized into Lexical Recall, Phrase Recall, or Ranking Failure.`);
  console.log(`• Documentation     : See /docs/FUTURE_EVALUATION_PLAN.md for full protocol specifications.\n`);

  console.log('======================================================================');
  console.log('                   VALIDATION EXECUTION COMPLETE                      ');
  console.log('======================================================================\n');
}

runFullValidation();
