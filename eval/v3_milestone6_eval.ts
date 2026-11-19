/**
 * Flipit Finder V3 — Milestone 6 End-to-End Evaluation, Contamination Audit & Memory Telemetry
 *
 * Evaluates FlipitV3Solver across all 3 Knowledge Configurations:
 *   - 'pure-v3'
 *   - 'hybrid'
 *   - 'full-compatibility'
 *
 * Under BOTH Unconstrained and Constrained (starting letter + length) modes across:
 *   1. Frozen Core Set (8 puzzles, eval/dataset/v3_reconciled_puzzles.json tier=core-8)
 *   2. Challenge Set (2 puzzles, eval/dataset/v3_reconciled_puzzles.json tier=challenge-2)
 *   3. Genuine Unseen Validation Set (16 puzzles, eval/dataset/v3_unseen_validation.json)
 *   4. Historical V2 Holdout Set (15 puzzles, data/holdout_puzzles.json — tracked separately)
 *
 * Also measures Cold-Start vs Warm-Session latency, LRU evictions (64 / 64 MiB),
 * V8 heap vs raw JSON cache budget expansion, and prints clean per-mode & per-puzzle tables.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CluePairConstraints } from '../src/solver/types.ts';
import { DEFAULT_MAX_CACHE_BYTES, DEFAULT_MAX_PARTITIONS, PartitionLoader } from '../src/solver/v3/partitionLoader.ts';
import type { KnowledgeConfig } from '../src/solver/v3/types.ts';
import { FlipitV3Solver } from '../src/solver/v3/v3Solver.ts';

interface EvalPuzzle {
  id: string;
  tier?: string;
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
  category?: string;
}

interface PuzzleEvalRecord {
  id: string;
  dataset: string;
  clue1: string;
  clue2: string;
  expectedPhrase: string;
  knowledgeConfig: KnowledgeConfig;
  constrained: boolean;
  clue1RecallPre: boolean;
  clue1RecallPost: boolean;
  clue2RecallPre: boolean;
  clue2RecallPost: boolean;
  bothRecall: boolean;
  phraseRecognized: boolean;
  answerGenerated: boolean;
  rank: number | null;
  totalRanked: number;
  top1Hit: boolean;
  top5Hit: boolean;
  top1Phrase: string | null;
  top1Score: number | null;
  answerScore: number | null;
  rel1Type: string | null;
  rel1Source: string | null;
  rel2Type: string | null;
  rel2Source: string | null;
  phraseSource: string | null;
  phraseMatchType: string | null;
  dependsOnLegacyOrCurated: boolean;
  legacyDependencyReason: string | null;
  solveTimeMs: number;
}

interface ModeSummary {
  dataset: string;
  knowledgeConfig: KnowledgeConfig;
  constrained: boolean;
  puzzleCount: number;
  clue1Recall: number;
  clue2Recall: number;
  bothClueRecall: number;
  phraseRecognized: number;
  answerGenerated: number;
  top1Count: number;
  top5Count: number;
  top1Pct: number;
  top5Pct: number;
  legacyDependentCount: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
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
    externalMB: Math.round((m.external / 1024 / 1024) * 100) / 100,
    arrayBuffersMB: Math.round((m.arrayBuffers / 1024 / 1024) * 100) / 100,
  };
}

function buildConstraints(p: EvalPuzzle): CluePairConstraints {
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

function verifyUnseenContamination(unseen: EvalPuzzle[]): {
  clean: boolean;
  phraseOverlaps: string[];
  cluePairOverlaps: string[];
  contextualKeyOverlaps: string[];
} {
  const existingPhrases = new Set<string>();
  const existingCluePairs = new Set<string>();

  for (const f of [
    'data/puzzles.json',
    'data/holdout_puzzles.json',
    'data/generalization_eval.json',
    'eval/dataset/v3_reconciled_puzzles.json',
  ]) {
    const arr = JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
    for (const p of arr) {
      if (p.expectedPhrase) existingPhrases.add(p.expectedPhrase);
      if (p.clue1 && p.clue2) existingCluePairs.add(`${p.clue1}+${p.clue2}`);
    }
  }

  for (const p of JSON.parse(fs.readFileSync(path.resolve('data/phrases.json'), 'utf8'))) {
    if (p.phrase) existingPhrases.add(p.phrase);
  }
  const mobyPhrases = JSON.parse(fs.readFileSync(path.resolve('data/moby_phrases.json'), 'utf8'));
  for (const p of mobyPhrases.phrases || []) {
    if (p.phrase) existingPhrases.add(p.phrase);
  }

  const ctxData = JSON.parse(fs.readFileSync(path.resolve('data/contextual_associations.json'), 'utf8'));
  const ctxKeys = new Set(Object.keys(ctxData).filter((k) => !k.startsWith('_')));

  const phraseOverlaps: string[] = [];
  const cluePairOverlaps: string[] = [];
  const contextualKeyOverlaps: string[] = [];

  for (const p of unseen) {
    if (existingPhrases.has(p.expectedPhrase)) phraseOverlaps.push(p.expectedPhrase);
    const pair = `${p.clue1}+${p.clue2}`;
    if (existingCluePairs.has(pair)) cluePairOverlaps.push(pair);
    if (ctxKeys.has(p.clue1)) contextualKeyOverlaps.push(p.clue1);
    if (ctxKeys.has(p.clue2)) contextualKeyOverlaps.push(p.clue2);
  }

  return {
    clean:
      phraseOverlaps.length === 0 &&
      cluePairOverlaps.length === 0 &&
      contextualKeyOverlaps.length === 0,
    phraseOverlaps,
    cluePairOverlaps,
    contextualKeyOverlaps,
  };
}

function isLegacyOrCuratedSource(source: string | null): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return (
    s.includes('curated') ||
    s.includes('legacy') ||
    s.includes('contextual lexicon') ||
    s.includes('v2.2.4')
  );
}

async function evaluateDatasetMode(
  solver: FlipitV3Solver,
  puzzles: EvalPuzzle[],
  datasetLabel: string,
  knowledgeConfig: KnowledgeConfig,
  constrained: boolean
): Promise<{ summary: ModeSummary; records: PuzzleEvalRecord[] }> {
  const records: PuzzleEvalRecord[] = [];
  const { phraseProvider } = solver.getProviders(knowledgeConfig);

  for (const p of puzzles) {
    const constraints = constrained ? buildConstraints(p) : undefined;
    const res = await solver.solve(p.clue1, p.clue2, constraints, { knowledgeConfig });

    const d1 = res.diagnostic.clue1;
    const d2 = res.diagnostic.clue2;
    const r1Pre = d1.preConstraintTransformations.find((t) => t.word === p.expectedWord1);
    const r1Post = d1.survivingTransformations.find((t) => t.word === p.expectedWord1);
    const r2Pre = d2.preConstraintTransformations.find((t) => t.word === p.expectedWord2);
    const r2Post = d2.survivingTransformations.find((t) => t.word === p.expectedWord2);

    const directPhrase = await phraseProvider.lookupWithDiagnostics(p.expectedWord1, p.expectedWord2);

    const ansIdx = res.candidates.findIndex((c) => c.targetPhrase === p.expectedPhrase);
    const answerGenerated = ansIdx >= 0;
    const rank = answerGenerated ? ansIdx + 1 : null;
    const ansCand = answerGenerated ? res.candidates[ansIdx] : null;

    const rel1Source = ansCand?.relation1.source ?? r1Post?.source ?? null;
    const rel2Source = ansCand?.relation2.source ?? r2Post?.source ?? null;
    const phraseSource = ansCand?.phraseMatch.sourceDataset ?? directPhrase.match?.sourceDataset ?? null;

    const legReasons: string[] = [];
    if (isLegacyOrCuratedSource(rel1Source)) legReasons.push(`Rel1:${rel1Source}`);
    if (isLegacyOrCuratedSource(rel2Source)) legReasons.push(`Rel2:${rel2Source}`);
    if (isLegacyOrCuratedSource(phraseSource)) legReasons.push(`Phrase:${phraseSource}`);

    records.push({
      id: p.id,
      dataset: datasetLabel,
      clue1: p.clue1,
      clue2: p.clue2,
      expectedPhrase: p.expectedPhrase,
      knowledgeConfig,
      constrained,
      clue1RecallPre: Boolean(r1Pre),
      clue1RecallPost: Boolean(r1Post),
      clue2RecallPre: Boolean(r2Pre),
      clue2RecallPost: Boolean(r2Post),
      bothRecall: Boolean(r1Post && r2Post),
      phraseRecognized: Boolean(directPhrase.match),
      answerGenerated,
      rank,
      totalRanked: res.candidates.length,
      top1Hit: rank === 1,
      top5Hit: rank !== null && rank <= 5,
      top1Phrase: res.bestMatch?.targetPhrase ?? null,
      top1Score: res.bestMatch?.matchScore ?? null,
      answerScore: ansCand?.matchScore ?? null,
      rel1Type: ansCand?.relation1.relationType ?? r1Post?.relationType ?? null,
      rel1Source,
      rel2Type: ansCand?.relation2.relationType ?? r2Post?.relationType ?? null,
      rel2Source,
      phraseSource,
      phraseMatchType: ansCand?.phraseMatch.matchType ?? directPhrase.match?.matchType ?? null,
      dependsOnLegacyOrCurated: legReasons.length > 0,
      legacyDependencyReason: legReasons.length > 0 ? legReasons.join(' + ') : null,
      solveTimeMs: res.solveTimeMs,
    });
  }

  const n = records.length;
  const top1Count = records.filter((r) => r.top1Hit).length;
  const top5Count = records.filter((r) => r.top5Hit).length;

  const summary: ModeSummary = {
    dataset: datasetLabel,
    knowledgeConfig,
    constrained,
    puzzleCount: n,
    clue1Recall: records.filter((r) => r.clue1RecallPost).length,
    clue2Recall: records.filter((r) => r.clue2RecallPost).length,
    bothClueRecall: records.filter((r) => r.bothRecall).length,
    phraseRecognized: records.filter((r) => r.phraseRecognized).length,
    answerGenerated: records.filter((r) => r.answerGenerated).length,
    top1Count,
    top5Count,
    top1Pct: Math.round((top1Count / n) * 1000) / 10,
    top5Pct: Math.round((top5Count / n) * 1000) / 10,
    legacyDependentCount: records.filter((r) => r.dependsOnLegacyOrCurated).length,
    avgLatencyMs: Math.round((records.reduce((s, r) => s + r.solveTimeMs, 0) / n) * 100) / 100,
    maxLatencyMs: Math.round(Math.max(...records.map((r) => r.solveTimeMs)) * 100) / 100,
  };

  return { summary, records };
}

async function measureMemoryAndHeapExpansion() {
  const initial = snapMemory();

  // Cold-start constrained & unconstrained isolated solvers
  const coldLoaderU = new PartitionLoader({
    maxPartitions: DEFAULT_MAX_PARTITIONS,
    maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
  });
  const coldSolverU = new FlipitV3Solver({ partitionLoader: coldLoaderU });
  const coldURes = await coldSolverU.solve('WET', 'VEGETABLES', undefined, {
    knowledgeConfig: 'pure-v3',
  });
  const afterColdUnconstrained = {
    latencyMs: coldURes.solveTimeMs,
    cacheStats: coldSolverU.getCacheStats(),
    memory: snapMemory(),
  };

  const coldLoaderC = new PartitionLoader({
    maxPartitions: DEFAULT_MAX_PARTITIONS,
    maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
  });
  const coldSolverC = new FlipitV3Solver({ partitionLoader: coldLoaderC });
  const coldCRes = await coldSolverC.solve(
    'WET',
    'VEGETABLES',
    { word1: { startsWith: 'D', length: 3 }, word2: { startsWith: 'F', length: 6 } },
    { knowledgeConfig: 'pure-v3' }
  );
  const afterColdConstrained = {
    latencyMs: coldCRes.solveTimeMs,
    cacheStats: coldSolverC.getCacheStats(),
    memory: snapMemory(),
  };

  // Measure JSON raw byte -> V8 heap expansion directly on representative compiled partitions
  const expansionSamples: Array<{
    partition: string;
    rawJsonMB: number;
    heapDeltaMB: number;
    expansionFactor: number;
  }> = [];

  const probeLoader = new PartitionLoader({ maxPartitions: 64, maxCacheBytes: 64 * 1024 * 1024 });
  for (const relPath of [
    'data/v3/compiled/wordnet/wn_s.json',
    'data/v3/compiled/wordnet/wn_c.json',
    'data/v3/compiled/moby/associations/assoc_s.json',
    'data/v3/compiled/moby/phrases/phrases_s.json',
    'data/v3/compiled/wordnet/collocations/collocations_s.json',
  ]) {
    const hBefore = process.memoryUsage().heapUsed;
    const { stats } = await probeLoader.loadPartition(relPath);
    const hAfter = process.memoryUsage().heapUsed;
    const rawJsonMB = Math.round((stats.sizeBytes / 1024 / 1024) * 100) / 100;
    const heapDeltaMB = Math.round(((hAfter - hBefore) / 1024 / 1024) * 100) / 100;
    expansionSamples.push({
      partition: relPath,
      rawJsonMB,
      heapDeltaMB,
      expansionFactor: rawJsonMB > 0 ? Math.round((heapDeltaMB / rawJsonMB) * 100) / 100 : 0,
    });
  }

  return {
    lruLimits: {
      maxPartitions: DEFAULT_MAX_PARTITIONS,
      maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
      maxCacheMiB: DEFAULT_MAX_CACHE_BYTES / 1024 / 1024,
    },
    initialProcessMemory: initial,
    coldStartUnconstrained: afterColdUnconstrained,
    coldStartConstrained: afterColdConstrained,
    jsonToV8HeapExpansionSamples: expansionSamples,
  };
}

async function main() {
  const isBaseline = process.argv.includes('--baseline');
  console.log('======================================================================');
  console.log(
    ` FLIPIT FINDER V3 — MILESTONE 6 END-TO-END EVALUATION (${isBaseline ? 'BEFORE BASELINE' : 'AFTER IMPROVEMENTS'})`
  );
  console.log('======================================================================');

  // 1. Verify frozen V2.2.4 checksums
  const frozenChecksums = JSON.parse(
    fs.readFileSync(path.resolve('eval/reports/frozen_checksums.json'), 'utf8')
  );
  for (const f of FROZEN_V2_FILES) {
    const actual = sha256(f);
    const expected = frozenChecksums.datasets?.[f] ?? frozenChecksums[f];
    if (expected && actual !== expected) {
      throw new Error(`Frozen V2.2.4 checksum mismatch for ${f}`);
    }
  }
  console.log('[✓] Verified 5 frozen V2.2.4 dataset SHA-256 checksums unchanged.');

  // 2. Load datasets & verify unseen contamination
  const reconciled: EvalPuzzle[] = JSON.parse(
    fs.readFileSync(path.resolve('eval/dataset/v3_reconciled_puzzles.json'), 'utf8')
  );
  const core8 = reconciled.filter((p) => p.tier === 'core-8');
  const challenge2 = reconciled.filter((p) => p.tier === 'challenge-2');

  const unseenFile = JSON.parse(
    fs.readFileSync(path.resolve('eval/dataset/v3_unseen_validation.json'), 'utf8')
  );
  const unseen16: EvalPuzzle[] = unseenFile.puzzles;
  const holdout15: EvalPuzzle[] = JSON.parse(
    fs.readFileSync(path.resolve('data/holdout_puzzles.json'), 'utf8')
  );

  const audit = verifyUnseenContamination(unseen16);
  if (!audit.clean) {
    throw new Error(`Unseen dataset contamination detected: ${JSON.stringify(audit)}`);
  }
  console.log(`[✓] Verified 0% overlap on ${unseen16.length} unseen puzzles against all frozen/curated/contextual sets.`);

  // 3. Cold-Start & Heap Expansion Telemetry
  const memoryTelemetry = await measureMemoryAndHeapExpansion();

  // 4. Shared Bounded Warm Solver for Standardized Multi-Mode Evaluation
  const warmSolver = new FlipitV3Solver({
    partitionLoader: new PartitionLoader({
      maxPartitions: DEFAULT_MAX_PARTITIONS,
      maxCacheBytes: DEFAULT_MAX_CACHE_BYTES,
    }),
  });

  // Warm-up across reconciled + unseen under pure-v3
  for (const p of [...reconciled, ...unseen16]) {
    await warmSolver.solve(p.clue1, p.clue2, undefined, { knowledgeConfig: 'pure-v3' });
  }

  const configs: KnowledgeConfig[] = ['pure-v3', 'hybrid', 'full-compatibility'];
  const datasets: Array<{ label: string; puzzles: EvalPuzzle[] }> = [
    { label: 'core-8', puzzles: core8 },
    { label: 'challenge-2', puzzles: challenge2 },
    { label: 'unseen-16', puzzles: unseen16 },
    { label: 'holdout-15', puzzles: holdout15 },
  ];

  const summaries: ModeSummary[] = [];
  const allRecords: PuzzleEvalRecord[] = [];

  for (const ds of datasets) {
    console.log(`\n==================== DATASET: ${ds.label.toUpperCase()} (${ds.puzzles.length} puzzles) ====================`);
    for (const cfg of configs) {
      for (const constrained of [false, true]) {
        const { summary, records } = await evaluateDatasetMode(
          warmSolver,
          ds.puzzles,
          ds.label,
          cfg,
          constrained
        );
        summaries.push(summary);
        allRecords.push(...records);
        console.log(
          `  [${cfg.padEnd(18)} | ${constrained ? 'CONSTR  ' : 'UNCONSTR'}] ` +
            `C1=${summary.clue1Recall}/${summary.puzzleCount} C2=${summary.clue2Recall}/${summary.puzzleCount} ` +
            `Both=${summary.bothClueRecall}/${summary.puzzleCount} | Phr=${summary.phraseRecognized}/${summary.puzzleCount} | ` +
            `Gen=${summary.answerGenerated}/${summary.puzzleCount} | Top1=${summary.top1Count}/${summary.puzzleCount} (${summary.top1Pct}%) | ` +
            `Top5=${summary.top5Count}/${summary.puzzleCount} (${summary.top5Pct}%) | LegDep=${summary.legacyDependentCount} | ` +
            `Avg=${summary.avgLatencyMs}ms`
        );
      }
    }
  }

  // Warm repeated-session latency benchmark (constrained + unconstrained across core-8 + challenge-2)
  const warmSessionLatenciesU: number[] = [];
  const warmSessionLatenciesC: number[] = [];
  for (let i = 0; i < 2; i++) {
    for (const p of reconciled) {
      const u = await warmSolver.solve(p.clue1, p.clue2, undefined, { knowledgeConfig: 'hybrid' });
      warmSessionLatenciesU.push(u.solveTimeMs);
      const c = await warmSolver.solve(p.clue1, p.clue2, buildConstraints(p), { knowledgeConfig: 'hybrid' });
      warmSessionLatenciesC.push(c.solveTimeMs);
    }
  }
  const avgArr = (a: number[]) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100;

  const warmFinalMemory = snapMemory();
  const warmFinalCache = warmSolver.getCacheStats();

  const report = {
    generatedAt: new Date().toISOString(),
    phase: isBaseline ? 'milestone-6-before-baseline' : 'milestone-6-after-improvements',
    contaminationAudit: audit,
    memoryAndPerformance: {
      ...memoryTelemetry,
      warmSession: {
        unconstrainedAvgMs: avgArr(warmSessionLatenciesU),
        unconstrainedMaxMs: Math.round(Math.max(...warmSessionLatenciesU) * 100) / 100,
        constrainedAvgMs: avgArr(warmSessionLatenciesC),
        constrainedMaxMs: Math.round(Math.max(...warmSessionLatenciesC) * 100) / 100,
        finalMemory: warmFinalMemory,
        finalCacheStats: {
          partitionCount: warmFinalCache.partitionCount,
          cacheSizeBytes: warmFinalCache.cacheSizeBytes,
          cacheSizeMB: Math.round((warmFinalCache.cacheSizeBytes / 1024 / 1024) * 100) / 100,
          maxPartitions: warmFinalCache.maxPartitions,
          maxCacheMB: warmFinalCache.maxCacheBytes / 1024 / 1024,
          hits: warmFinalCache.hits,
          misses: warmFinalCache.misses,
          evictions: warmFinalCache.evictions,
          evictedMB: Math.round((warmFinalCache.evictedBytes / 1024 / 1024) * 100) / 100,
        },
      },
    },
    summaries,
    records: allRecords,
  };

  const outFile = isBaseline
    ? 'eval/reports/v3_milestone6_baseline_before.json'
    : 'eval/reports/v3_milestone6_report.json';
  fs.writeFileSync(path.resolve(outFile), JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[Report] Saved ${outFile}`);
  console.log('[Warm Cache Final]', report.memoryAndPerformance.warmSession.finalCacheStats);
  console.log('[Warm Memory Final]', report.memoryAndPerformance.warmSession.finalMemory);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
