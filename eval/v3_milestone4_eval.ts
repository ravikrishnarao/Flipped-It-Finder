/**
 * Flipit Finder V3 — Milestone 4 / 4.1 End-to-End Evaluation Harness
 *
 * Evaluates FlipitV3Solver across all 3 Knowledge Configurations:
 *   - 'pure-v3': V3 WordNet + Coordinate + Moby Thesaurus + WordNet Collocations + Moby Compounds
 *   - 'hybrid': Pure V3 + ContextualAssociationProvider (curated phrases disabled)
 *   - 'full-compatibility': Hybrid + Legacy V2.2.4 Curated Relationships & Phrases
 *
 * Tested across both tiers:
 *   - Original 8 Frozen Core Puzzles (v3-01 .. v3-08)
 *   - Additional 2 Challenge Puzzles (v3-09 .. v3-10)
 *
 * Measures performance separately under standardized cache conditions:
 *   1. Initial process memory (before any solver/partition load)
 *   2. Cold-start first solve (unconstrained & constrained on isolated cold instances) + memory after 1 solve
 *   3. Warm-cache single solve (unconstrained & constrained under identical warm cache)
 *   4. Warm-cache repeated evaluation across all 6 modes (unconstrained & constrained)
 *   5. Final process memory & cached partition telemetry
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CluePairConstraints } from '../src/solver/types.ts';
import type { KnowledgeConfig } from '../src/solver/v3/types.ts';
import { FlipitV3Solver } from '../src/solver/v3/v3Solver.ts';

interface ReconciledPuzzle {
  id: string;
  tier: 'core-8' | 'challenge-2';
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
}

interface PuzzleEvalRecord {
  id: string;
  tier: string;
  clue1: string;
  clue2: string;
  expectedPhrase: string;
  constrained: boolean;
  knowledgeConfig: KnowledgeConfig;
  clue1RecallBeforeConstraints: boolean;
  clue1RecallAfterConstraints: boolean;
  clue2RecallBeforeConstraints: boolean;
  clue2RecallAfterConstraints: boolean;
  bothRecall: boolean;
  phraseRecognizedDirectly: boolean;
  clue1PreConstraintCount: number;
  clue1PostConstraintCount: number;
  clue2PreConstraintCount: number;
  clue2PostConstraintCount: number;
  combosBeforeConstraints: number;
  combosAfterConstraints: number;
  phraseMatchesCount: number;
  answerGenerated: boolean;
  rank: number | null;
  totalRanked: number;
  top1Hit: boolean;
  top5Hit: boolean;
  top1Phrase: string | null;
  top1Score: number | null;
  answerScore: number | null;
  rel1Source: string | null;
  rel2Source: string | null;
  phraseSource: string | null;
  phraseMatchType: string | null;
  solveTimeMs: number;
}

const FROZEN_V2_FILES = [
  'data/relationships.json',
  'data/phrases.json',
  'data/wordnet_relationships.json',
  'data/moby_phrases.json',
  'data/contextual_associations.json',
];

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapMemory() {
  const m = process.memoryUsage();
  return {
    rssMB: Math.round((m.rss / 1024 / 1024) * 100) / 100,
    heapUsedMB: Math.round((m.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((m.heapTotal / 1024 / 1024) * 100) / 100,
  };
}

function buildPuzzleConstraints(p: ReconciledPuzzle): CluePairConstraints {
  return {
    word1: {
      startsWith: p.expectedWord1.charAt(0),
      length: p.expectedWord1.length,
    },
    word2: {
      startsWith: p.expectedWord2.charAt(0),
      length: p.expectedWord2.length,
    },
  };
}

async function evaluateMode(
  solver: FlipitV3Solver,
  puzzles: ReconciledPuzzle[],
  tierLabel: string,
  knowledgeConfig: KnowledgeConfig,
  constrained: boolean
) {
  const records: PuzzleEvalRecord[] = [];
  const { phraseProvider } = solver.getProviders(knowledgeConfig);

  console.log(`\n----------------------------------------------------------------------`);
  console.log(
    ` ${tierLabel} | Config=${knowledgeConfig} | Constraints=${constrained ? 'ON (start+len)' : 'OFF'} [WARM CACHE]`
  );
  console.log(`----------------------------------------------------------------------`);

  for (const p of puzzles) {
    const constraints = constrained ? buildPuzzleConstraints(p) : undefined;
    const res = await solver.solve(p.clue1, p.clue2, constraints, { knowledgeConfig });

    const d1 = res.diagnostic.clue1;
    const d2 = res.diagnostic.clue2;

    const r1PreHit = d1.preConstraintTransformations.find((t) => t.word === p.expectedWord1);
    const r1PostHit = d1.survivingTransformations.find((t) => t.word === p.expectedWord1);
    const r2PreHit = d2.preConstraintTransformations.find((t) => t.word === p.expectedWord2);
    const r2PostHit = d2.survivingTransformations.find((t) => t.word === p.expectedWord2);

    const directPhraseRes = await phraseProvider.lookupWithDiagnostics(
      p.expectedWord1,
      p.expectedWord2
    );

    const ansIdx = res.candidates.findIndex((c) => c.targetPhrase === p.expectedPhrase);
    const answerGenerated = ansIdx >= 0;
    const rank = answerGenerated ? ansIdx + 1 : null;
    const ansCand = answerGenerated ? res.candidates[ansIdx] : null;

    const rec: PuzzleEvalRecord = {
      id: p.id,
      tier: p.tier,
      clue1: p.clue1,
      clue2: p.clue2,
      expectedPhrase: p.expectedPhrase,
      constrained,
      knowledgeConfig,
      clue1RecallBeforeConstraints: Boolean(r1PreHit),
      clue1RecallAfterConstraints: Boolean(r1PostHit),
      clue2RecallBeforeConstraints: Boolean(r2PreHit),
      clue2RecallAfterConstraints: Boolean(r2PostHit),
      bothRecall: Boolean(r1PostHit && r2PostHit),
      phraseRecognizedDirectly: Boolean(directPhraseRes.match),
      clue1PreConstraintCount: d1.preConstraintCount,
      clue1PostConstraintCount: d1.postConstraintCount,
      clue2PreConstraintCount: d2.preConstraintCount,
      clue2PostConstraintCount: d2.postConstraintCount,
      combosBeforeConstraints: res.diagnostic.totalCombinationsBeforeConstraints,
      combosAfterConstraints: res.diagnostic.totalCombinationsAfterConstraints,
      phraseMatchesCount: res.diagnostic.phraseMatchesCount,
      answerGenerated,
      rank,
      totalRanked: res.candidates.length,
      top1Hit: rank === 1,
      top5Hit: rank !== null && rank <= 5,
      top1Phrase: res.bestMatch?.targetPhrase ?? null,
      top1Score: res.bestMatch?.matchScore ?? null,
      answerScore: ansCand?.matchScore ?? null,
      rel1Source: ansCand
        ? `${ansCand.relation1.relationType} (${ansCand.relation1.source})`
        : r1PostHit
          ? `${r1PostHit.relationType} (${r1PostHit.source})`
          : null,
      rel2Source: ansCand
        ? `${ansCand.relation2.relationType} (${ansCand.relation2.source})`
        : r2PostHit
          ? `${r2PostHit.relationType} (${r2PostHit.source})`
          : null,
      phraseSource: ansCand
        ? ansCand.phraseMatch.sourceDataset
        : directPhraseRes.match
          ? directPhraseRes.match.sourceDataset
          : null,
      phraseMatchType: ansCand
        ? ansCand.phraseMatch.matchType
        : directPhraseRes.match
          ? directPhraseRes.match.matchType
          : null,
      solveTimeMs: res.solveTimeMs,
    };
    records.push(rec);

    const status = rec.top1Hit
      ? 'TOP-1'
      : rec.top5Hit
        ? `TOP-${rank}`
        : rec.answerGenerated
          ? `RANK-#${rank}`
          : 'MISS';
    console.log(
      `${p.id} [${status.padEnd(8)}] ${p.clue1} + ${p.clue2} -> ${p.expectedPhrase} | ` +
        `C1:${d1.preConstraintCount}->${d1.postConstraintCount}(pre:${rec.clue1RecallBeforeConstraints ? 'Y' : 'N'}/post:${rec.clue1RecallAfterConstraints ? 'Y' : 'N'}) ` +
        `C2:${d2.preConstraintCount}->${d2.postConstraintCount}(pre:${rec.clue2RecallBeforeConstraints ? 'Y' : 'N'}/post:${rec.clue2RecallAfterConstraints ? 'Y' : 'N'}) | ` +
        `PhrRec:${rec.phraseRecognizedDirectly ? 'Y' : 'N'} | Top1:${rec.top1Phrase ?? 'NONE'}(${rec.top1Score ?? '-'}) | ` +
        `${res.solveTimeMs}ms`
    );
  }

  const n = records.length;
  const c1Pre = records.filter((r) => r.clue1RecallBeforeConstraints).length;
  const c1Post = records.filter((r) => r.clue1RecallAfterConstraints).length;
  const c2Pre = records.filter((r) => r.clue2RecallBeforeConstraints).length;
  const c2Post = records.filter((r) => r.clue2RecallAfterConstraints).length;
  const bothRecall = records.filter((r) => r.bothRecall).length;
  const phrRec = records.filter((r) => r.phraseRecognizedDirectly).length;
  const ansGen = records.filter((r) => r.answerGenerated).length;
  const top1 = records.filter((r) => r.top1Hit).length;
  const top5 = records.filter((r) => r.top5Hit).length;
  const avgMs = Math.round((records.reduce((s, r) => s + r.solveTimeMs, 0) / n) * 100) / 100;
  const maxMs = Math.max(...records.map((r) => r.solveTimeMs));

  const summary = {
    tier: tierLabel,
    knowledgeConfig,
    constrained,
    puzzleCount: n,
    clue1RecallPre: `${c1Pre}/${n}`,
    clue1RecallPost: `${c1Post}/${n}`,
    clue2RecallPre: `${c2Pre}/${n}`,
    clue2RecallPost: `${c2Post}/${n}`,
    bothRecall: `${bothRecall}/${n}`,
    phraseRecognized: `${phrRec}/${n}`,
    answerGenerated: `${ansGen}/${n}`,
    top1Accuracy: `${top1}/${n} (${((top1 / n) * 100).toFixed(1)}%)`,
    top5Accuracy: `${top5}/${n} (${((top5 / n) * 100).toFixed(1)}%)`,
    avgLatencyMs: avgMs,
    maxLatencyMs: maxMs,
  };

  console.log(
    `\nSUMMARY [${tierLabel} | ${knowledgeConfig} | ${constrained ? 'CONSTRAINED' : 'UNCONSTRAINED'}]: ` +
      `C1=${summary.clue1RecallPost} C2=${summary.clue2RecallPost} Both=${summary.bothRecall} | ` +
      `PhrRec=${summary.phraseRecognized} AnsGen=${summary.answerGenerated} | ` +
      `Top-1=${summary.top1Accuracy} | Top-5=${summary.top5Accuracy} | ` +
      `Avg=${avgMs}ms Max=${maxMs}ms`
  );

  return { summary, records };
}

async function main() {
  const frozenChecksums = JSON.parse(
    fs.readFileSync(path.resolve('eval/reports/frozen_checksums.json'), 'utf8')
  );

  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 4.1 INTEGRATED SOLVER EVALUATION');
  console.log('======================================================================');
  console.log('[Integrity] Verifying frozen V2.2.4 SHA-256 checksums...');

  const verifiedChecksums: Record<string, string> = {};
  for (const f of FROZEN_V2_FILES) {
    const actual = sha256(f);
    const expected = frozenChecksums.datasets?.[f] ?? frozenChecksums[f];
    if (expected && actual !== expected) {
      throw new Error(`Frozen V2.2.4 checksum mismatch for ${f}`);
    }
    verifiedChecksums[f] = actual;
    console.log(`  ✓ ${f}: ${actual.slice(0, 16)}...`);
  }

  const allPuzzles: ReconciledPuzzle[] = JSON.parse(
    fs.readFileSync(path.resolve('eval/dataset/v3_reconciled_puzzles.json'), 'utf8')
  );
  const core8 = allPuzzles.filter((p) => p.tier === 'core-8');
  const challenge2 = allPuzzles.filter((p) => p.tier === 'challenge-2');

  // 1. Initial Process Memory (before loading any partitions)
  const initialMemory = snapMemory();

  // 2. Cold-start First Solve (isolated fresh solvers)
  const samplePuzzle = core8[3]; // WET + VEGETABLES -> DRY FRUITS
  const coldSolverUnconstrained = new FlipitV3Solver();
  const coldUnconstrainedRes = await coldSolverUnconstrained.solve(
    samplePuzzle.clue1,
    samplePuzzle.clue2,
    undefined,
    { knowledgeConfig: 'pure-v3' }
  );
  const memoryAfterOneSolve = snapMemory();
  const cacheAfterOneSolve = coldSolverUnconstrained.getCacheStats();

  const coldSolverConstrained = new FlipitV3Solver();
  const coldConstrainedRes = await coldSolverConstrained.solve(
    samplePuzzle.clue1,
    samplePuzzle.clue2,
    buildPuzzleConstraints(samplePuzzle),
    { knowledgeConfig: 'pure-v3' }
  );

  // 3. Warm-up main evaluation solver across all 10 puzzles & 3 configs so all warm runs share equivalent cache conditions
  const solver = new FlipitV3Solver();
  for (const config of ['pure-v3', 'hybrid', 'full-compatibility'] as KnowledgeConfig[]) {
    for (const p of allPuzzles) {
      await solver.solve(p.clue1, p.clue2, undefined, { knowledgeConfig: config });
    }
  }

  // 4. Warm-cache single solve measurement (unconstrained vs constrained on identical warm cache)
  const warmSingleUnconstrained = await solver.solve(
    samplePuzzle.clue1,
    samplePuzzle.clue2,
    undefined,
    { knowledgeConfig: 'pure-v3' }
  );
  const warmSingleConstrained = await solver.solve(
    samplePuzzle.clue1,
    samplePuzzle.clue2,
    buildPuzzleConstraints(samplePuzzle),
    { knowledgeConfig: 'pure-v3' }
  );

  // 5. Full 6-mode evaluation under equivalent warm cache + repeated-solve timing benchmark
  const configs: KnowledgeConfig[] = ['pure-v3', 'hybrid', 'full-compatibility'];
  const allSummaries: unknown[] = [];
  const allRecords: PuzzleEvalRecord[] = [];

  for (const config of configs) {
    for (const constrained of [false, true]) {
      const rCore = await evaluateMode(solver, core8, 'ORIGINAL 8 FROZEN CORE', config, constrained);
      allSummaries.push(rCore.summary);
      allRecords.push(...rCore.records);

      const rChall = await evaluateMode(
        solver,
        challenge2,
        'ADDITIONAL 2 CHALLENGE',
        config,
        constrained
      );
      allSummaries.push(rChall.summary);
      allRecords.push(...rChall.records);
    }
  }

  // Repeated warm-cache solves (3 iterations across all 10 puzzles, unconstrained vs constrained under pure-v3)
  const repeatedUnconstrainedLatencies: number[] = [];
  const repeatedConstrainedLatencies: number[] = [];
  for (let round = 0; round < 3; round++) {
    for (const p of allPuzzles) {
      const u = await solver.solve(p.clue1, p.clue2, undefined, { knowledgeConfig: 'pure-v3' });
      repeatedUnconstrainedLatencies.push(u.solveTimeMs);
      const c = await solver.solve(p.clue1, p.clue2, buildPuzzleConstraints(p), {
        knowledgeConfig: 'pure-v3',
      });
      repeatedConstrainedLatencies.push(c.solveTimeMs);
    }
  }

  const avg = (arr: number[]) =>
    Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100;

  const finalMemory = snapMemory();
  const finalCacheStats = solver.getCacheStats();

  const performanceTelemetry = {
    initialProcessMemory: initialMemory,
    coldStartFirstSolve: {
      samplePuzzle: `${samplePuzzle.clue1} + ${samplePuzzle.clue2}`,
      unconstrainedMs: coldUnconstrainedRes.solveTimeMs,
      constrainedMs: coldConstrainedRes.solveTimeMs,
      memoryAfterOneSolve,
      cachedPartitionsAfterOneSolve: cacheAfterOneSolve.loadedPartitions.length,
      partitionCacheMBAfterOneSolve:
        Math.round((cacheAfterOneSolve.cacheSizeBytes / 1024 / 1024) * 100) / 100,
    },
    warmCacheSingleSolve: {
      samplePuzzle: `${samplePuzzle.clue1} + ${samplePuzzle.clue2}`,
      unconstrainedMs: warmSingleUnconstrained.solveTimeMs,
      constrainedMs: warmSingleConstrained.solveTimeMs,
    },
    warmCacheRepeatedSolves: {
      rounds: 3,
      puzzlesPerRound: allPuzzles.length,
      unconstrainedAvgMs: avg(repeatedUnconstrainedLatencies),
      unconstrainedMaxMs: Math.max(...repeatedUnconstrainedLatencies),
      constrainedAvgMs: avg(repeatedConstrainedLatencies),
      constrainedMaxMs: Math.max(...repeatedConstrainedLatencies),
    },
    finalProcessMemory: finalMemory,
    finalCachedPartitions: {
      count: finalCacheStats.loadedPartitions.length,
      sizeMB: Math.round((finalCacheStats.cacheSizeBytes / 1024 / 1024) * 100) / 100,
    },
  };

  // Constraint-safety check across all records
  const constraintDrops = allRecords.filter(
    (r) =>
      r.constrained &&
      ((r.clue1RecallBeforeConstraints && !r.clue1RecallAfterConstraints) ||
        (r.clue2RecallBeforeConstraints && !r.clue2RecallAfterConstraints))
  );

  console.log('\n======================================================================');
  console.log(' PERFORMANCE, MEMORY & CONSTRAINT-SAFETY TELEMETRY');
  console.log('======================================================================');
  console.log(
    `  Initial Memory:        RSS=${initialMemory.rssMB} MB | Heap=${initialMemory.heapUsedMB} MB`
  );
  console.log(
    `  Cold-Start 1st Solve:  Unconstrained=${coldUnconstrainedRes.solveTimeMs} ms | Constrained=${coldConstrainedRes.solveTimeMs} ms`
  );
  console.log(
    `  After 1st Solve:       RSS=${memoryAfterOneSolve.rssMB} MB | Heap=${memoryAfterOneSolve.heapUsedMB} MB | Partitions=${cacheAfterOneSolve.loadedPartitions.length} (${performanceTelemetry.coldStartFirstSolve.partitionCacheMBAfterOneSolve} MB)`
  );
  console.log(
    `  Warm-Cache Single:     Unconstrained=${warmSingleUnconstrained.solveTimeMs} ms | Constrained=${warmSingleConstrained.solveTimeMs} ms`
  );
  console.log(
    `  Warm-Cache Repeated:   Unconstrained Avg=${performanceTelemetry.warmCacheRepeatedSolves.unconstrainedAvgMs} ms (Max ${performanceTelemetry.warmCacheRepeatedSolves.unconstrainedMaxMs} ms) | ` +
      `Constrained Avg=${performanceTelemetry.warmCacheRepeatedSolves.constrainedAvgMs} ms (Max ${performanceTelemetry.warmCacheRepeatedSolves.constrainedMaxMs} ms)`
  );
  console.log(
    `  Final Memory & Cache:  RSS=${finalMemory.rssMB} MB | Heap=${finalMemory.heapUsedMB} MB | Partitions=${finalCacheStats.loadedPartitions.length} (${performanceTelemetry.finalCachedPartitions.sizeMB} MB)`
  );
  console.log(`  Constraint Drops:      ${constraintDrops.length} (expected 0)`);

  const reportOut = {
    generatedAt: new Date().toISOString(),
    milestone: 'Milestone 4.1 — Regression Investigation, Ranking Review & Standardized Evaluation',
    frozenChecksumsVerified: verifiedChecksums,
    performanceTelemetry,
    constraintSafetyViolations: constraintDrops.length,
    summaries: allSummaries,
    records: allRecords,
  };

  fs.writeFileSync(
    path.resolve('eval/reports/v3_milestone4_report.json'),
    JSON.stringify(reportOut, null, 2),
    'utf8'
  );
  console.log('\n[Report] Saved eval/reports/v3_milestone4_report.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
