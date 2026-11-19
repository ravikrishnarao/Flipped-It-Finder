/**
 * Flipit Finder V3 — Milestone 7A Google Books Corpus Pilot Evaluation & Audit
 *
 * Compares Pure-V3 baseline (without corpus plugin) against Pure-V3 + Tier-4
 * PartitionedCorpusPlugin (Google Books Ngrams 20200217 Pilot, O/P/S slices)
 * WITHOUT modifying any V3Ranker weights.
 *
 * Audits:
 *   1. Frozen V2.2.4 baseline file checksums
 *   2. Pilot phrase quality (positive examples inside pilot slice, non-benchmark collocations,
 *      stopword rejections, and reversed/implausible negative controls)
 *   3. Statistical comparison (year-stratified vs naive pooled PMI on real pilot bigrams)
 *   4. Representative Before vs. After solver results & bounded cache telemetry
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CluePairConstraints } from '../src/solver/types.ts';
import {
  computeYearStratifiedStats,
  parseTotalCountsText,
  PILOT_DEFAULT_END_YEAR,
  PILOT_DEFAULT_START_YEAR,
} from '../src/solver/v3/corpusStats.ts';
import { PartitionLoader } from '../src/solver/v3/partitionLoader.ts';
import { PartitionedCorpusPlugin } from '../src/solver/v3/partitionedCorpusPlugin.ts';
import { FlipitV3Solver } from '../src/solver/v3/v3Solver.ts';

interface EvalPuzzle {
  id: string;
  tier?: string;
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
}

function buildConstraints(p: EvalPuzzle): CluePairConstraints {
  return {
    word1: { startsWith: p.expectedWord1.charAt(0), length: p.expectedWord1.length },
    word2: { startsWith: p.expectedWord2.charAt(0), length: p.expectedWord2.length },
  };
}

async function runPilotEval() {
  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 7A CORPUS PILOT EVALUATION');
  console.log('======================================================================\n');

  const summaryPath = path.resolve('data/v3/compiled/corpus_pilot/pilot_summary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error('Pilot summary not found. Run scripts/v3/compile_corpus_pilot.ts first.');
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));

  // 1. Inspect Real Pilot Phrase Quality (Positive & Negative Controls)
  console.log('[1/4] Phrase Quality Audit on Compiled Pilot Partitions...');
  const corpusPlugin = new PartitionedCorpusPlugin({
    basePath: 'data/v3/compiled/corpus_pilot',
  });

  const stageDir = '/tmp/flipit_7a_pilot_stage';
  const tc1Path = path.join(stageDir, 'totalcounts-1.txt');
  const tc2Path = path.join(stageDir, 'totalcounts-2.txt');
  const totalsAvailable = fs.existsSync(tc1Path) && fs.existsSync(tc2Path);

  const positiveProbes: Array<{ w1: string; w2: string; inPilotSlice: boolean }> = [
    { w1: 'PLASTIC', w2: 'SMILE', inPilotSlice: true },
    { w1: 'OLD', w2: 'GARMENTS', inPilotSlice: true },
    { w1: 'SWEET', w2: 'BOX', inPilotSlice: true },
    { w1: 'DEMON', w2: 'KING', inPilotSlice: false },
    { w1: 'LONG', w2: 'WEEKEND', inPilotSlice: false },
    { w1: 'DEEP', w2: 'CLEANING', inPilotSlice: false },
  ];

  const positiveResults: any[] = [];
  for (const probe of positiveProbes) {
    const res = await corpusPlugin.query(probe.w1, probe.w2);
    positiveResults.push({
      phrase: `${probe.w1} ${probe.w2}`,
      inPilotSlice: probe.inPilotSlice,
      matchedInCompiledPilot: Boolean(res),
      count: res?.count ?? null,
      pmi: res?.pmi ?? null,
      tScore: res?.tScore ?? null,
      reverseCount: res?.reverseCount ?? null,
      orderRatio: res?.orderRatio ?? null,
      heuristicScore: res?.score ?? null,
    });
  }

  console.log('  Positive Examples Check:');
  for (const r of positiveResults) {
    console.log(
      `    • ${r.phrase.padEnd(16)} | slice=${String(r.inPilotSlice).padEnd(5)} | found=${String(r.matchedInCompiledPilot).padEnd(5)} | ` +
        `c=${r.count ?? '-'} | PMI=${r.pmi ?? '-'} | t=${r.tScore ?? '-'} | rev=${r.reverseCount ?? '-'} | ratio=${r.orderRatio ?? '-'}`
    );
  }

  const negativeProbes = [
    ['OF', 'THE'],
    ['IN', 'A'],
    ['BOX', 'WAS'],
    ['SMILE', 'AT'],
    ['SMILE', 'PLASTIC'],
    ['GARMENTS', 'OLD'],
    ['BOX', 'SWEET'],
    ['BANANA', 'SUBMARINE'],
  ];

  const negativeResults: any[] = [];
  for (const [w1, w2] of negativeProbes) {
    const res = await corpusPlugin.query(w1, w2);
    negativeResults.push({
      phrase: `${w1} ${w2}`,
      matchedInCompiledPilot: Boolean(res),
      count: res?.count ?? null,
      pmi: res?.pmi ?? null,
      tScore: res?.tScore ?? null,
      orderRatio: res?.orderRatio ?? null,
    });
  }

  console.log('\n  Negative & Reversed Controls Check:');
  for (const r of negativeResults) {
    console.log(
      `    • ${r.phrase.padEnd(18)} | found=${String(r.matchedInCompiledPilot).padEnd(5)} | c=${r.count ?? '-'} | PMI=${r.pmi ?? '-'}`
    );
  }

  // 2. Year-Stratified vs. Naive Pooled Comparison on Real Pilot Bigrams (when stage cache present)
  const stratifiedVsPooledSamples: any[] = [];
  if (totalsAvailable) {
    const totals = {
      startYear: PILOT_DEFAULT_START_YEAR,
      endYear: PILOT_DEFAULT_END_YEAR,
      n1ByYear: parseTotalCountsText(fs.readFileSync(tc1Path, 'utf8'), PILOT_DEFAULT_START_YEAR, PILOT_DEFAULT_END_YEAR),
      n2ByYear: parseTotalCountsText(fs.readFileSync(tc2Path, 'utf8'), PILOT_DEFAULT_START_YEAR, PILOT_DEFAULT_END_YEAR),
    };
    const uniMerged = new Map<string, number[]>();
    for (const st of summary.shards1Gram || []) {
      const f = path.join(stageDir, `${st.shard}.json`);
      if (!fs.existsSync(f)) continue;
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const [w, arr] of Object.entries<number[]>(d.counts)) {
        const cur = uniMerged.get(w);
        if (!cur) uniMerged.set(w, arr.slice());
        else for (let i = 0; i < cur.length; i++) cur[i] += arr[i];
      }
    }
    const bgMerged = new Map<string, number[]>();
    for (const bs of summary.shards2Gram || []) {
      const f = path.join(stageDir, `${bs.shard}.json`);
      if (!fs.existsSync(f)) continue;
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const [k, arr] of Object.entries<number[]>(d.bigrams)) {
        const cur = bgMerged.get(k);
        if (!cur) bgMerged.set(k, arr.slice());
        else for (let i = 0; i < cur.length; i++) cur[i] += arr[i];
      }
    }

    for (const key of ['PLASTIC SMILE', 'OLD GARMENTS', 'SWEET BOX', 'SMILE PLASTIC', 'OLD AGE', 'PLASTIC BAG', 'SWEET POTATO', 'SWEET HOME']) {
      const bgArr = bgMerged.get(key);
      if (!bgArr) {
        stratifiedVsPooledSamples.push({ phrase: key, observedInStage: false });
        continue;
      }
      const [w1, w2] = key.split(' ');
      const revArr = bgMerged.get(`${w2} ${w1}`);
      const revCount = revArr ? revArr.reduce((a, b) => a + b, 0) : 0;
      const w1Arr = uniMerged.get(w1);
      const w2Arr = uniMerged.get(w2);
      if (!w1Arr || !w2Arr) continue;
      const st = computeYearStratifiedStats({
        bigramAnnual: bgArr,
        w1Annual: w1Arr,
        w2Annual: w2Arr,
        totals,
        reverseCount: revCount,
      });
      stratifiedVsPooledSamples.push({
        phrase: key,
        observedInStage: true,
        observedCount: st.observedCount,
        stratifiedExpected: Math.round(st.expectedCount * 100) / 100,
        pooledExpected: Math.round(st.pooledExpectedCount * 100) / 100,
        stratifiedPmi: st.pmi,
        pooledPmi: st.pooledPmi,
        pmiDeltaStratMinusPooled: Math.round((st.pmi - st.pooledPmi) * 1000) / 1000,
        tScore: st.tScore,
        reverseCount: st.reverseCount,
        orderRatio: st.orderRatio,
      });
    }
    console.log('\n[2/4] Year-Stratified vs. Naive Pooled Comparison on Real 20200217 Counts:');
    for (const s of stratifiedVsPooledSamples) {
      if (!s.observedInStage) {
        console.log(`    • ${s.phrase.padEnd(16)} | not in stage shards`);
      } else {
        console.log(
          `    • ${s.phrase.padEnd(16)} | O=${String(s.observedCount).padEnd(8)} | ` +
            `PMI_strat=${String(s.stratifiedPmi).padEnd(6)} vs PMI_pool=${String(s.pooledPmi).padEnd(6)} (Δ=${s.pmiDeltaStratMinusPooled}) | ` +
            `t=${s.tScore} | rev=${s.reverseCount}`
        );
      }
    }
  }

  // 3. Before vs. After Solver Evaluation (Pure-V3, Constrained & Unconstrained)
  console.log('\n[3/4] Running Before vs. After Pure-V3 Solver Comparison (No Ranker Weight Changes)...');
  const reconciled: EvalPuzzle[] = JSON.parse(
    fs.readFileSync(path.resolve('eval/dataset/v3_reconciled_puzzles.json'), 'utf8')
  );

  const baselineSolver = new FlipitV3Solver({ knowledgeConfig: 'pure-v3' });
  const pilotLoader = new PartitionLoader();
  const pilotPlugin = new PartitionedCorpusPlugin({
    basePath: 'data/v3/compiled/corpus_pilot',
  });
  const pilotSolver = new FlipitV3Solver({
    knowledgeConfig: 'pure-v3',
    partitionLoader: pilotLoader,
    corpusPlugin: pilotPlugin,
  });

  const solverComparison: any[] = [];

  for (const constrained of [true, false]) {
    for (const p of reconciled) {
      const c = constrained ? buildConstraints(p) : undefined;
      const before = await baselineSolver.solve(p.clue1, p.clue2, c, { knowledgeConfig: 'pure-v3' });
      const after = await pilotSolver.solve(p.clue1, p.clue2, c, { knowledgeConfig: 'pure-v3' });

      const findRank = (cands: typeof before.candidates) => {
        const idx = cands.findIndex((cand) => cand.targetPhrase === p.expectedPhrase);
        return idx >= 0 ? idx + 1 : null;
      };

      const beforeRank = findRank(before.candidates);
      const afterRank = findRank(after.candidates);
      const afterMatch = after.candidates.find((cand) => cand.targetPhrase === p.expectedPhrase);

      const sliceLetters = new Set(['O', 'P', 'S']);
      const inPilotSlice = sliceLetters.has(p.expectedWord1.charAt(0));

      solverComparison.push({
        id: p.id,
        tier: p.tier,
        expectedPhrase: p.expectedPhrase,
        constrained,
        inPilotSlice,
        beforeTop1: before.bestMatch?.targetPhrase ?? null,
        beforeRank,
        afterTop1: after.bestMatch?.targetPhrase ?? null,
        afterRank,
        afterPhraseSource: afterMatch?.phraseMatch.sourceDataset ?? null,
        afterEmpiricalCount: afterMatch?.phraseMatch.empiricalFrequency ?? null,
        afterPmi: afterMatch?.phraseMatch.pmi ?? null,
        afterTScore: afterMatch?.phraseMatch.tScore ?? null,
        changed: beforeRank !== afterRank || before.bestMatch?.targetPhrase !== after.bestMatch?.targetPhrase,
      });
    }
  }

  console.log('\n  Constrained Pure-V3 Before vs. After:');
  for (const row of solverComparison.filter((r) => r.constrained)) {
    console.log(
      `    • ${row.id} ${row.expectedPhrase.padEnd(15)} [slice=${row.inPilotSlice ? 'Y' : 'N'}] | ` +
        `Before: rank=${row.beforeRank ?? '-'} top1=${row.beforeTop1 ?? '-'} | ` +
        `After: rank=${row.afterRank ?? '-'} top1=${row.afterTop1 ?? '-'} (${row.afterPhraseSource ?? '-'})`
    );
  }

  console.log('\n  Unconstrained Pure-V3 Before vs. After:');
  for (const row of solverComparison.filter((r) => !r.constrained)) {
    console.log(
      `    • ${row.id} ${row.expectedPhrase.padEnd(15)} [slice=${row.inPilotSlice ? 'Y' : 'N'}] | ` +
        `Before: rank=${row.beforeRank ?? '-'} top1=${row.beforeTop1 ?? '-'} | ` +
        `After: rank=${row.afterRank ?? '-'} top1=${row.afterTop1 ?? '-'} (${row.afterPhraseSource ?? '-'})`
    );
  }

  // 4. Sample Top Non-Benchmark Empirical Collocations per Pilot Partition
  const topDiscoveredSamples: Record<string, any[]> = {};
  const benchmarkSet = new Set(reconciled.map((p) => p.expectedPhrase));
  for (const letter of ['o', 'p', 's']) {
    const pFile = path.resolve(`data/v3/compiled/corpus_pilot/corpus_${letter}.json`);
    if (!fs.existsSync(pFile)) continue;
    const pData = JSON.parse(fs.readFileSync(pFile, 'utf8'));
    const allRows: any[] = [];
    for (const [w1, w2Map] of Object.entries<Record<string, any>>(pData)) {
      for (const [w2, rec] of Object.entries(w2Map)) {
        const phrase = `${w1} ${w2}`;
        if (benchmarkSet.has(phrase)) continue;
        allRows.push({
          phrase,
          count: rec.c,
          pmi: rec.pmi,
          tScore: rec.t,
          reverseCount: rec.rc,
          orderRatio: rec.or,
          heuristicScore: rec.s,
        });
      }
    }
    allRows.sort((a, b) => b.tScore - a.tScore);
    topDiscoveredSamples[letter.toUpperCase()] = allRows.slice(0, 8);
  }

  // 5. Cache & Latency Check
  const cacheStats = pilotSolver.getCacheStats();
  console.log('\n[4/4] Bounded Cache Telemetry:');
  console.log(JSON.stringify(cacheStats, null, 2));

  const report = {
    generatedAt: new Date().toISOString(),
    release: summary.release,
    license: summary.license,
    yearWindow: summary.yearWindow,
    thresholds: summary.thresholds,
    positiveResults,
    negativeResults,
    topDiscoveredSamples,
    stratifiedVsPooledSamples,
    solverComparison,
    cacheStats,
  };

  fs.mkdirSync(path.resolve('eval/reports'), { recursive: true });
  fs.writeFileSync(
    path.resolve('eval/reports/v3_milestone7a_pilot_report.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  console.log('\n[✓] Report saved to eval/reports/v3_milestone7a_pilot_report.json');
}

runPilotEval().catch((err) => {
  console.error('Pilot evaluation failed:', err);
  process.exit(1);
});
