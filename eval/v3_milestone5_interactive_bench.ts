/**
 * Flipit Finder V3 — Milestone 5 Interactive Session & Bounded Cache Benchmark
 *
 * Measures realistic interactive UI server behavior under bounded LRU partition caching:
 *   1. Baseline process RSS / Heap before solving
 *   2. Cold first-solve response time & memory delta
 *   3. Subsequent interactive solve response times (warm hit + switching modes)
 *   4. Repeated 25-solve interactive session spanning diverse initial letters A-Z
 *      verifying bounded partition count, bounded byte footprint, and LRU evictions
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CluePairConstraints } from '../src/solver/types.ts';
import { PartitionLoader } from '../src/solver/v3/partitionLoader.ts';
import type { KnowledgeConfig } from '../src/solver/v3/types.ts';
import { FlipitV3Solver } from '../src/solver/v3/v3Solver.ts';

interface PuzzleItem {
  id: string;
  tier: string;
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
}

function snapMem() {
  const m = process.memoryUsage();
  return {
    rssMB: Math.round((m.rss / 1024 / 1024) * 100) / 100,
    heapUsedMB: Math.round((m.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((m.heapTotal / 1024 / 1024) * 100) / 100,
  };
}

function makeConstraints(p: PuzzleItem): CluePairConstraints {
  return {
    word1: { startsWith: p.expectedWord1.charAt(0), length: p.expectedWord1.length },
    word2: { startsWith: p.expectedWord2.charAt(0), length: p.expectedWord2.length },
  };
}

async function main() {
  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 5 INTERACTIVE PERFORMANCE & CACHE BENCH');
  console.log('======================================================================\n');

  const puzzlesPath = path.resolve(process.cwd(), 'eval/dataset/v3_reconciled_puzzles.json');
  const puzzles = JSON.parse(fs.readFileSync(puzzlesPath, 'utf-8')) as PuzzleItem[];

  const maxPartitions = 64;
  const maxCacheBytes = 64 * 1024 * 1024; // 64 MiB matching server.ts
  const loader = new PartitionLoader({ maxPartitions, maxCacheBytes });
  const solver = new FlipitV3Solver({ partitionLoader: loader, knowledgeConfig: 'pure-v3' });

  const memInitial = snapMem();
  console.log(`Initial Process Memory: RSS ${memInitial.rssMB} MB | HeapUsed ${memInitial.heapUsedMB} MB`);

  // 1. First Solve (Cold Cache) — ABODE + LEAVING (Pure V3, constrained)
  const firstPuzzle = puzzles.find((p) => p.clue1 === 'ABODE')!;
  const t0 = performance.now();
  const firstRes = await solver.solve(
    firstPuzzle.clue1,
    firstPuzzle.clue2,
    makeConstraints(firstPuzzle),
    { knowledgeConfig: 'pure-v3' }
  );
  const firstWallMs = Math.round((performance.now() - t0) * 100) / 100;
  const memAfter1 = snapMem();
  const cacheAfter1 = solver.getCacheStats();

  assert.strictEqual(firstRes.bestMatch?.targetPhrase, 'HOME COMING');
  console.log(
    `1st Solve (Cold, ABODE+LEAVING, pure-v3): ${firstWallMs} ms (internal ${firstRes.solveTimeMs} ms) | ` +
      `Cache: ${cacheAfter1.partitionCount} files / ${(cacheAfter1.cacheSizeBytes / 1024 / 1024).toFixed(2)} MiB | ` +
      `RSS ${memAfter1.rssMB} MB | HeapUsed ${memAfter1.heapUsedMB} MB`
  );

  // 2. Subsequent Solve (Same clues, switching to Hybrid & Unconstrained)
  const t1 = performance.now();
  const secondRes = await solver.solve(firstPuzzle.clue1, firstPuzzle.clue2, undefined, {
    knowledgeConfig: 'hybrid',
  });
  const secondWallMs = Math.round((performance.now() - t1) * 100) / 100;
  const cacheAfter2 = solver.getCacheStats();
  const memAfter2 = snapMem();
  assert.ok(secondRes.candidates.some((c) => c.targetPhrase === 'HOME COMING'));
  console.log(
    `2nd Solve (Warm clues, switching -> hybrid unconstrained): ${secondWallMs} ms | ` +
      `Cache hits=${cacheAfter2.hits}, misses=${cacheAfter2.misses}, evictions=${cacheAfter2.evictions} | ` +
      `RSS ${memAfter2.rssMB} MB | HeapUsed ${memAfter2.heapUsedMB} MB`
  );

  // 3. Normal Interactive Sequence (5 typical puzzles, mixed configs)
  const normalSequence: Array<{
    clue1: string;
    clue2: string;
    constraints?: CluePairConstraints;
    cfg: KnowledgeConfig;
    expectedPhrase?: string;
    expectClue1?: string;
    expectClue2?: string;
  }> = [
    {
      clue1: 'WET',
      clue2: 'VEGETABLES',
      constraints: { word1: { startsWith: 'D', length: 3 }, word2: { startsWith: 'F', length: 6 } },
      cfg: 'pure-v3',
      expectedPhrase: 'DRY FRUITS',
    },
    {
      clue1: 'DRY',
      clue2: 'MOP',
      constraints: { word1: { startsWith: 'C', length: 5 }, word2: { startsWith: 'S', length: 5 } },
      cfg: 'hybrid',
      expectedPhrase: 'CLEAN SWEEP',
    },
    {
      clue1: 'SLOW',
      clue2: 'MEAL',
      constraints: { word1: { startsWith: 'F', length: 4 }, word2: { startsWith: 'F', length: 4 } },
      cfg: 'full-compatibility',
      expectedPhrase: 'FAST FOOD',
    },
    {
      clue1: 'ABODE',
      clue2: 'LEAVING',
      constraints: { word1: { startsWith: 'H', length: 4 }, word2: { startsWith: 'C', length: 6 } },
      cfg: 'pure-v3',
      expectedPhrase: 'HOME COMING',
    },
    {
      clue1: 'SHALLOW',
      clue2: 'SOILING',
      constraints: { word1: { startsWith: 'D', length: 4 }, word2: { startsWith: 'C', length: 8 } },
      cfg: 'pure-v3',
      expectClue1: 'DEEP',
      expectClue2: 'CLEANING',
    },
  ];

  const seqTimes: number[] = [];
  for (const step of normalSequence) {
    const sStart = performance.now();
    const r = await solver.solve(step.clue1, step.clue2, step.constraints, {
      knowledgeConfig: step.cfg,
    });
    const sMs = Math.round((performance.now() - sStart) * 100) / 100;
    seqTimes.push(sMs);
    if (step.expectedPhrase) {
      assert.strictEqual(
        r.bestMatch?.targetPhrase,
        step.expectedPhrase,
        `Expected ${step.expectedPhrase} for ${step.clue1}+${step.clue2}`
      );
    }
    if (step.expectClue1) {
      assert.ok(r.diagnostic.clue1.survivingTransformations.some((t) => t.word === step.expectClue1));
    }
    if (step.expectClue2) {
      assert.ok(r.diagnostic.clue2.survivingTransformations.some((t) => t.word === step.expectClue2));
    }
  }
  const memAfterNormal5 = snapMem();
  const cacheAfterNormal5 = solver.getCacheStats();
  console.log(
    `\nAfter 5 Interactive Solves: Times [${seqTimes.join(', ')}] ms (avg ${(
      seqTimes.reduce((a, b) => a + b, 0) / seqTimes.length
    ).toFixed(1)} ms)`
  );
  console.log(
    `  Memory (Normal Interactive): RSS ${memAfterNormal5.rssMB} MB | HeapUsed ${memAfterNormal5.heapUsedMB} MB | ` +
      `Cache ${cacheAfterNormal5.partitionCount}/${cacheAfterNormal5.maxPartitions} files (${(
        cacheAfterNormal5.cacheSizeBytes /
        1024 /
        1024
      ).toFixed(2)} MiB / ${(maxCacheBytes / 1024 / 1024).toFixed(0)} MiB cap)`
  );

  // 4. Repeat same puzzle twice to measure warm-repeat response time
  const repeatTimes: number[] = [];
  for (const step of normalSequence) {
    const rStart = performance.now();
    await solver.solve(step.clue1, step.clue2, step.constraints, {
      knowledgeConfig: step.cfg,
    });
    repeatTimes.push(Math.round((performance.now() - rStart) * 100) / 100);
  }
  console.log(
    `Warm Repeat Times (5 puzzles): [${repeatTimes.join(', ')}] ms (avg ${(
      repeatTimes.reduce((a, b) => a + b, 0) / repeatTimes.length
    ).toFixed(1)} ms)`
  );

  // 5. Extended 25-solve stress session across diverse starting letters (A-Z)
  const stressPairs: Array<[string, string, KnowledgeConfig]> = [
    ['BRAVE', 'HEART', 'pure-v3'],
    ['CLEAR', 'WATER', 'hybrid'],
    ['EARTH', 'QUAKE', 'pure-v3'],
    ['FIRE', 'WORK', 'pure-v3'],
    ['GREEN', 'HOUSE', 'pure-v3'],
    ['HAPPY', 'HOUR', 'hybrid'],
    ['ICE', 'BERG', 'pure-v3'],
    ['JUNGLE', 'FEVER', 'pure-v3'],
    ['KEY', 'BOARD', 'hybrid'],
    ['LIGHT', 'HOUSE', 'pure-v3'],
    ['MOON', 'LIGHT', 'pure-v3'],
    ['NIGHT', 'MARE', 'pure-v3'],
    ['OPEN', 'BOOK', 'pure-v3'],
    ['PAPER', 'CLIP', 'pure-v3'],
    ['QUICK', 'SILVER', 'pure-v3'],
    ['RAIN', 'BOW', 'pure-v3'],
    ['STAR', 'LIGHT', 'pure-v3'],
    ['TIME', 'TABLE', 'pure-v3'],
    ['UNDER', 'GROUND', 'pure-v3'],
    ['VOICE', 'MAIL', 'pure-v3'],
    ['WIND', 'MILL', 'pure-v3'],
    ['YELLOW', 'PAGE', 'pure-v3'],
    ['ZERO', 'HOUR', 'pure-v3'],
    ['SLOW', 'MEAL', 'full-compatibility'],
    ['SHALLOW', 'SOILING', 'pure-v3'],
  ];

  const stressTimes: number[] = [];
  for (const [c1, c2, cfg] of stressPairs) {
    const st = performance.now();
    await solver.solve(c1, c2, undefined, { knowledgeConfig: cfg });
    stressTimes.push(Math.round((performance.now() - st) * 100) / 100);
    const snap = solver.getCacheStats();
    assert.ok(
      snap.partitionCount <= maxPartitions,
      `Partition count ${snap.partitionCount} exceeded cap ${maxPartitions}`
    );
    assert.ok(
      snap.cacheSizeBytes <= maxCacheBytes,
      `Cache size ${snap.cacheSizeBytes} exceeded cap ${maxCacheBytes}`
    );
  }

  if (typeof global.gc === 'function') {
    global.gc();
  }
  const memFinal = snapMem();
  const cacheFinal = solver.getCacheStats();

  console.log(
    `\nAfter 32 Total Interactive Solves (spanning A-Z + all 3 modes):`
  );
  console.log(
    `  Avg Stress Solve Time: ${(stressTimes.reduce((a, b) => a + b, 0) / stressTimes.length).toFixed(1)} ms`
  );
  console.log(
    `  Final Memory: RSS ${memFinal.rssMB} MB | HeapUsed ${memFinal.heapUsedMB} MB | HeapTotal ${memFinal.heapTotalMB} MB`
  );
  console.log(
    `  Bounded Cache: ${cacheFinal.partitionCount}/${cacheFinal.maxPartitions} partitions | ` +
      `${(cacheFinal.cacheSizeBytes / 1024 / 1024).toFixed(2)} / ${(
        cacheFinal.maxCacheBytes /
        1024 /
        1024
      ).toFixed(0)} MiB`
  );
  console.log(
    `  Cache Telemetry: hits=${cacheFinal.hits} | misses=${cacheFinal.misses} | evictions=${cacheFinal.evictions} | ` +
      `evictedData=${(cacheFinal.evictedBytes / 1024 / 1024).toFixed(2)} MiB`
  );

  assert.ok(cacheFinal.evictions > 0, 'Expected LRU cache evictions under bounded A-Z workload');

  const report = {
    timestamp: new Date().toISOString(),
    config: { maxPartitions, maxCacheBytes },
    memory: {
      initial: memInitial,
      afterFirstSolve: memAfter1,
      afterSecondSolve: memAfter2,
      afterFiveNormalSolves: memAfterNormal5,
      afterThirtyTwoSolves: memFinal,
    },
    timingsMs: {
      firstColdSolveMs: firstWallMs,
      secondModeSwitchSolveMs: secondWallMs,
      normalFiveSolvesMs: seqTimes,
      normalFiveAvgMs: Math.round((seqTimes.reduce((a, b) => a + b, 0) / seqTimes.length) * 100) / 100,
      warmFiveRepeatsMs: repeatTimes,
      warmFiveAvgMs: Math.round((repeatTimes.reduce((a, b) => a + b, 0) / repeatTimes.length) * 100) / 100,
      stressTwentyFiveAvgMs:
        Math.round((stressTimes.reduce((a, b) => a + b, 0) / stressTimes.length) * 100) / 100,
    },
    cacheStatsFinal: cacheFinal,
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'eval/reports/v3_milestone5_interactive_report.json'),
    JSON.stringify(report, null, 2),
    'utf-8'
  );
  console.log('\nSaved report to eval/reports/v3_milestone5_interactive_report.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
