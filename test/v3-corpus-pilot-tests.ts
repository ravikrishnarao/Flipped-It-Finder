/**
 * Flipit Finder V3 — Milestone 7A Google Books Corpus Pilot Test Suite
 *
 * Verifies:
 *   1. Year-stratified statistical model vs. naive pooled estimation (corpus-growth invariance / Simpson's paradox)
 *   2. Missing-record (>40 cutoff), low-frequency instability, POS-tag duplicate exclusion, directional order asymmetry
 *   3. Function-word stopword filter precision (blocks OF THE / SMILE AT; preserves OLD / LONG / SWEET / CLEAN)
 *   4. Tier-4 ExternalCorpusPlugin precedence (Curated -> WordNet -> Moby -> CorpusPlugin, zero shadowing)
 *   5. Dedicated 16 MiB / 8-partition LRU isolation, eviction, cache-miss safety, zero disk I/O in querySync()
 *   6. Real pilot partition checksum determinism, statistical quality positive/negative controls, & zero-leakage build audit
 */

import * as assert from 'node:assert';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExternalCorpusPlugin } from '../src/solver/v3/collocationPhraseProvider.ts';
import { CompositeV3PhraseProvider } from '../src/solver/v3/compositeV3PhraseProvider.ts';
import { atomicWriteFileSync } from '../scripts/v3/compile_corpus_pilot.ts';
import {
  accumulateAnnualTupleCells,
  computeCorpusHeuristicScore,
  computeYearStratifiedStats,
  DEFAULT_PILOT_THRESHOLDS,
  isAnyCaseAlphaBigram,
  isAnyCaseAlphaToken,
  isCorpusStopword,
  isPosTaggedNgram,
  isStrictLowerAlphaBigram,
  isStrictLowerAlphaToken,
  parseTotalCountsText,
  passesCorpusThresholds,
  type AnnualTotalCounts,
} from '../src/solver/v3/corpusStats.ts';
import { PartitionLoader } from '../src/solver/v3/partitionLoader.ts';
import {
  CORPUS_PLUGIN_MAX_CACHE_BYTES,
  CORPUS_PLUGIN_MAX_PARTITIONS,
  PartitionedCorpusPlugin,
  type CorpusPartitionData,
} from '../src/solver/v3/partitionedCorpusPlugin.ts';
import { FlipitV3Solver } from '../src/solver/v3/v3Solver.ts';

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error('   ', err);
    failed++;
  }
}

function makeTotals2Yr(n1Y0: number, n1Y1: number, n2Y0: number, n2Y1: number): AnnualTotalCounts {
  return {
    startYear: 1950,
    endYear: 1951,
    n1ByYear: new Float64Array([n1Y0, n1Y1]),
    n2ByYear: new Float64Array([n2Y0, n2Y1]),
  };
}

async function main() {
  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 7A CORPUS PILOT VERIFICATION SUITE');
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Statistical Methodology & Edge-Case Tests
  // -------------------------------------------------------------------------
  console.log('[1/4] Testing Year-Stratified Statistical Model & Edge Cases...');

  await runTest('Corpus-size variation (Simpson paradox): stratified E eliminates pooled PMI drift', () => {
    // Year 0 (1950): small corpus N1=1M, N2=1M; words active mostly in Y0 (rate 0.1 each -> independent E0 = 10k)
    // Year 1 (1951): huge corpus N1=10M, N2=10M; words quiet in Y1 (rate 0.001 each -> independent E1 = 10)
    // Exact true annual independent expectation: O = 10010, so true PMI_strat = 0.0!
    // Naive pooled sees marginal share averaged across unbalanced denominators and inflates pooled PMI > +1.9!
    const totals = makeTotals2Yr(1_000_000, 10_000_000, 1_000_000, 10_000_000);
    const w1 = new Float64Array([100_000, 10_000]);
    const w2 = new Float64Array([100_000, 10_000]);
    const exactIndependent = new Float64Array([10_000, 10]);

    const stats = computeYearStratifiedStats({
      bigramAnnual: exactIndependent,
      w1Annual: w1,
      w2Annual: w2,
      totals,
    });

    assert.strictEqual(stats.observedCount, 10010);
    assert.ok(Math.abs(stats.pmi) < 0.005, `Expected stratified PMI ≈ 0, got ${stats.pmi}`);
    assert.ok(
      stats.pooledPmi > 1.5,
      `Expected naive pooled PMI to spuriously inflate (>1.5), got ${stats.pooledPmi}`
    );
  });

  await runTest('Missing records (>40 corpus cutoff) return unobserved zero count and fail thresholds', () => {
    const totals = makeTotals2Yr(1_000_000, 1_000_000, 1_000_000, 1_000_000);
    const stats = computeYearStratifiedStats({
      bigramAnnual: [0, 0],
      w1Annual: [5000, 5000],
      w2Annual: [5000, 5000],
      totals,
    });
    assert.strictEqual(stats.observedCount, 0);
    assert.strictEqual(passesCorpusThresholds(stats, DEFAULT_PILOT_THRESHOLDS), false);
  });

  await runTest('Low-frequency PMI spike is suppressed by minimum count and t-score thresholds', () => {
    const totals = makeTotals2Yr(100_000_000, 100_000_000, 100_000_000, 100_000_000);
    const stats = computeYearStratifiedStats({
      bigramAnnual: [3, 2], // total observed = 5 (rare!)
      w1Annual: [100, 100],
      w2Annual: [100, 100],
      totals,
    });
    assert.ok(stats.pmi > 12, `Rare co-occurrence has huge raw PMI (${stats.pmi})`);
    assert.ok(stats.tScore < 2.3, `t-score remains low (${stats.tScore})`);
    assert.strictEqual(passesCorpusThresholds(stats, { minCount: 500, minPmi: 2.0, minTScore: 2.0 }), false);
  });

  await runTest('POS-tagged overlap detection & capitalization accumulation prevent double-counting', () => {
    assert.strictEqual(isPosTaggedNgram('plastic smile'), false);
    assert.strictEqual(isPosTaggedNgram('plastic_ADJ smile_NOUN'), true);
    assert.strictEqual(isPosTaggedNgram('smile_VERB at'), true);
    assert.strictEqual(isPosTaggedNgram('_NOUN'), true);

    const out = new Float64Array(4);
    accumulateAnnualTupleCells(
      ['plastic smile', '1950,10,5', '1952,25,12', '1953,15,8'],
      1,
      out,
      1950,
      1953
    );
    accumulateAnnualTupleCells(['Plastic smile', '1950,5,3', '1952,5,4'], 1, out, 1950, 1953);
    assert.deepStrictEqual(Array.from(out), [15, 0, 30, 15]);
  });

  await runTest('Directional order asymmetry affects ranking score softly without hard-rejecting', () => {
    const totals = makeTotals2Yr(10_000_000, 10_000_000, 10_000_000, 10_000_000);
    const base = {
      bigramAnnual: [1000, 1000],
      w1Annual: [20_000, 20_000],
      w2Annual: [20_000, 20_000],
      totals,
    };
    const canonical = computeYearStratifiedStats({ ...base, reverseCount: 50 }); // orderRatio = 2000 / 51 ≈ 39.2
    const balanced = computeYearStratifiedStats({ ...base, reverseCount: 1800 }); // orderRatio ≈ 1.11
    const reversedDom = computeYearStratifiedStats({ ...base, reverseCount: 20_000 }); // orderRatio ≈ 0.10

    assert.ok(canonical.orderRatio >= 2.0);
    assert.ok(reversedDom.orderRatio < 0.5);
    assert.strictEqual(passesCorpusThresholds(reversedDom), true);

    const sCan = computeCorpusHeuristicScore(canonical);
    const sBal = computeCorpusHeuristicScore(balanced);
    const sRev = computeCorpusHeuristicScore(reversedDom);
    assert.ok(sCan > sBal && sBal > sRev, `Expected sCan(${sCan}) > sBal(${sBal}) > sRev(${sRev})`);
    assert.ok(sCan <= 0.88 && sRev >= 0.62, 'Scores remain bounded cleanly within [0.62, 0.88]');
  });

  await runTest('Stopword filter blocks closed-class function words (incl. WHERE/UNDER/OVER) & preserves meaningful phrases', () => {
    // Direct closed-class stopwords
    for (const sw of ['THE', 'OF', 'IN', 'A', 'WAS', 'AT', 'WHERE', 'UNDER', 'OVER', 'WHEN', 'WHY', 'HERE', 'THERE', 'BENEATH']) {
      assert.strictEqual(isCorpusStopword(sw), true, `${sw} must be treated as function stopword`);
    }
    // Negative-control structural bigrams (at least one word must trigger stopword rejection)
    for (const [w1, w2] of [
      ['OF', 'THE'],
      ['IN', 'A'],
      ['BOX', 'WAS'],
      ['SMILE', 'AT'],
      ['PLACES', 'WHERE'],
      ['PLACE', 'WHERE'],
      ['PLACED', 'UNDER'],
      ['PLACED', 'OVER'],
    ]) {
      assert.strictEqual(
        isCorpusStopword(w1) || isCorpusStopword(w2),
        true,
        `Negative control "${w1} ${w2}" must be rejected by stopword filter`
      );
    }
    // Content words & meaningful open-class idioms must NEVER be rejected
    for (const cw of [
      'OLD', 'NEW', 'LONG', 'SHORT', 'SWEET', 'PLASTIC', 'SMILE', 'CLEAN', 'BOX', 'GARMENTS',
      'PLACE', 'PLACES', 'PLACED', 'ORDER', 'MARKET', 'SECOND', 'BAG', 'AGE', 'SPECIES', 'MEMBRANE',
    ]) {
      assert.strictEqual(isCorpusStopword(cw), false, `${cw} must NOT be blocked by stopword list`);
    }
    for (const [p1, p2] of [
      ['OLD', 'GARMENTS'],
      ['PLASTIC', 'SMILE'],
      ['PLASTIC', 'BAG'],
      ['SECOND', 'PLACE'],
      ['MARKET', 'PLACE'],
      ['PLACED', 'ORDER'],
      ['PLANNING', 'PROCESS'],
      ['PLASMA', 'MEMBRANE'],
    ]) {
      assert.strictEqual(
        isCorpusStopword(p1) || isCorpusStopword(p2),
        false,
        `Meaningful phrase "${p1} ${p2}" must NOT be rejected`
      );
    }
  });

  await runTest('Case-normalization predicates enforce strict lowercase consistency and detect mixed-case drift', () => {
    assert.strictEqual(isStrictLowerAlphaToken('plastic'), true);
    assert.strictEqual(isStrictLowerAlphaToken('Plastic'), false);
    assert.strictEqual(isStrictLowerAlphaToken('contInuIty'), false);
    assert.strictEqual(isStrictLowerAlphaToken('ofWilmer'), false);
    assert.strictEqual(isAnyCaseAlphaToken('Plastic'), true);

    assert.strictEqual(isStrictLowerAlphaBigram('plastic smile'), true);
    assert.strictEqual(isStrictLowerAlphaBigram('old Age'), false);
    assert.strictEqual(isStrictLowerAlphaBigram('Old age'), false);
    assert.strictEqual(isAnyCaseAlphaBigram('old Age'), true);
  });

  await runTest('atomicWriteFileSync writes complete UTF-8 contents cleanly without leftover tmp files', () => {
    const tmpAtomicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flipit_7a1_atomic_'));
    try {
      const target = path.join(tmpAtomicDir, 'totalcounts-1.txt');
      atomicWriteFileSync(target, '1950,8628214793,1,1\n');
      atomicWriteFileSync(target, '1950,8628214793,1,1\n2019,22826152232,1,1\n');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), '1950,8628214793,1,1\n2019,22826152232,1,1\n');
      assert.deepStrictEqual(fs.readdirSync(tmpAtomicDir), ['totalcounts-1.txt']);
    } finally {
      fs.rmSync(tmpAtomicDir, { recursive: true, force: true });
    }
  });

  await runTest('totalcounts TSV parser extracts annual corpus totals accurately', () => {
    const parsed = parseTotalCountsText('\t1949,999,1\t1950,1200000,500\t1951,2400000,900\t1952,1,1', 1950, 1951);
    assert.deepStrictEqual(Array.from(parsed), [1_200_000, 2_400_000]);
  });

  // -------------------------------------------------------------------------
  // 2. Integration Seam: Precedence, Sync Zero-I/O, Bounded 16MiB/8-Partition Cache
  // -------------------------------------------------------------------------
  console.log('\n[2/4] Testing Tier-4 Integration Seam, Precedence & Bounded LRU Isolation...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flipit_7a_seam_'));
  try {
    // Write small synthetic partitions for unit-testing cache eviction & precedence cleanly
    const syntheticA: CorpusPartitionData = {
      ALPHA: { OMEGA: { c: 1200, pmi: 4.5, t: 31.2, rc: 10, or: 109.1, s: 0.78 } },
      AA: { GUN: { c: 3200, pmi: 5.5, t: 50.0, rc: 2, or: 1000, s: 0.83 } },
    };
    const syntheticB: CorpusPartitionData = {
      BOOK: { SHELF: { c: 9000, pmi: 6.1, t: 88.0, rc: 5, or: 1500, s: 0.85 } },
    };
    const syntheticH: CorpusPartitionData = {
      HOT: { DOG: { c: 50000, pmi: 7.2, t: 210.0, rc: 40, or: 1219.5, s: 0.87 } },
    };
    const syntheticS: CorpusPartitionData = {
      SOLAR: { SYSTEM: { c: 80000, pmi: 8.1, t: 280.0, rc: 100, or: 792.1, s: 0.88 } },
    };
    const syntheticZ: CorpusPartitionData = {
      ZANY: { QUEST: { c: 1500, pmi: 5.0, t: 34.0, rc: 0, or: 1500, s: 0.79 } },
    };

    fs.writeFileSync(path.join(tmpDir, 'corpus_a.json'), JSON.stringify(syntheticA));
    fs.writeFileSync(path.join(tmpDir, 'corpus_b.json'), JSON.stringify(syntheticB));
    fs.writeFileSync(path.join(tmpDir, 'corpus_h.json'), JSON.stringify(syntheticH));
    fs.writeFileSync(path.join(tmpDir, 'corpus_s.json'), JSON.stringify(syntheticS));
    fs.writeFileSync(path.join(tmpDir, 'corpus_z.json'), JSON.stringify(syntheticZ));

    await runTest('Strict Tier-4 precedence: Curated, WordNet & Moby are NEVER shadowed by CorpusPlugin', async () => {
      const plugin = new PartitionedCorpusPlugin({
        basePath: tmpDir,
        sourceName: 'Synthetic Corpus Mock',
      });
      const phraseProvider = new CompositeV3PhraseProvider({
        enableCurated: true,
        corpusPlugin: plugin,
      });

      // Tier 1: Curated wins over Moby & Corpus
      const hotDog = await phraseProvider.lookupWithDiagnostics('HOT', 'DOG');
      assert.strictEqual(hotDog.match?.sourceDataset, 'Curated Phrase Repository');
      assert.strictEqual(hotDog.match?.empiricalFrequency, null);

      // Tier 2: WordNet wins over Corpus
      const solarSystem = await phraseProvider.lookupWithDiagnostics('SOLAR', 'SYSTEM');
      assert.strictEqual(solarSystem.match?.sourceDataset, 'Princeton WordNet 3.0 Collocations');
      assert.strictEqual(solarSystem.match?.empiricalFrequency, null);

      // Tier 3: Moby wins over Corpus (both with Curated enabled and Pure-V3 without Curated)
      const aaGun = await phraseProvider.lookupWithDiagnostics('AA', 'GUN');
      assert.ok(
        aaGun.match?.sourceDataset.includes('Moby'),
        `Expected Moby provenance for AA GUN, got ${aaGun.match?.sourceDataset}`
      );
      assert.strictEqual(aaGun.match?.empiricalFrequency, null);

      const purePhraseProvider = new CompositeV3PhraseProvider({
        enableCurated: false,
        corpusPlugin: plugin,
      });
      const bookShelf = await purePhraseProvider.lookupWithDiagnostics('BOOK', 'SHELF');
      assert.ok(
        bookShelf.match && !bookShelf.match.sourceDataset.includes('Corpus'),
        `Expected WordNet/Moby provenance for BOOK SHELF, got ${bookShelf.match?.sourceDataset}`
      );
      assert.strictEqual(bookShelf.match?.empiricalFrequency, null);

      // Tier 4 fallback activates ONLY when Curated/WordNet/Moby miss
      const zanyQuest = await phraseProvider.lookupWithDiagnostics('ZANY', 'QUEST');
      assert.strictEqual(zanyQuest.match?.sourceDataset, 'Synthetic Corpus Mock');
      assert.strictEqual(zanyQuest.match?.empiricalFrequency, 1500);
      assert.strictEqual(zanyQuest.match?.pmi, 5.0);
      assert.strictEqual(zanyQuest.match?.tScore, 34.0);
      assert.strictEqual(zanyQuest.diagnostics.empiricalFrequency, 1500);
      assert.strictEqual(zanyQuest.diagnostics.pmi, 5.0);
    });

    await runTest('querySync executes zero disk I/O on uncached partitions and resolves deterministically after preloadPartition', async () => {
      const plugin = new PartitionedCorpusPlugin({ basePath: tmpDir });
      // Before preloading: must return null synchronously (cache miss, zero disk read)
      assert.strictEqual(plugin.querySync('ZANY', 'QUEST'), null);
      assert.strictEqual(plugin.getCacheStats().partitionCount, 0);

      // After preloading 'Z': deterministic hit from cache
      const loadStats = await plugin.preloadPartition('Z');
      assert.strictEqual(loadStats.cached, false);
      const hit = plugin.querySync('ZANY', 'QUEST');
      assert.ok(hit && hit.count === 1500 && hit.pmi === 5.0);

      // Missing partition ('Q') returns null cleanly without throwing or occupying LRU slot
      const missStats = await plugin.preloadPartition('Q');
      assert.strictEqual(missStats.sizeBytes, 0);
      assert.strictEqual(plugin.isPartitionMissing('Q'), true);
      assert.strictEqual(plugin.querySync('QUIET', 'ROOM'), null);
      assert.strictEqual(plugin.getCacheStats().partitionCount, 1);
    });

    await runTest('Separate bounded LRU cache (default 16 MiB / 8 partitions) evicts cleanly without crowding core cache', async () => {
      assert.strictEqual(CORPUS_PLUGIN_MAX_PARTITIONS, 8);
      assert.strictEqual(CORPUS_PLUGIN_MAX_CACHE_BYTES, 16 * 1024 * 1024);

      const coreLoader = new PartitionLoader();
      await coreLoader.loadPartition('data/v3/compiled/wordnet/wn_x.json');

      const tightPlugin = new PartitionedCorpusPlugin({
        basePath: tmpDir,
        maxPartitions: 3,
        maxCacheBytes: 1024 * 1024,
      });

      await tightPlugin.preloadPartition('A');
      await tightPlugin.preloadPartition('B');
      await tightPlugin.preloadPartition('H');
      // Touch 'A' so 'B' becomes LRU
      assert.ok(tightPlugin.querySync('ALPHA', 'OMEGA'));
      // Loading 'Z' must evict 'B'
      await tightPlugin.preloadPartition('Z');

      const stats = tightPlugin.getCacheStats();
      assert.strictEqual(stats.partitionCount, 3);
      assert.ok(stats.evictions >= 1);
      assert.ok(tightPlugin.querySync('ALPHA', 'OMEGA') !== null, 'Touched partition A must stay cached');
      assert.strictEqual(tightPlugin.querySync('BOOK', 'SHELF'), null, 'Evicted partition B must return null in querySync');
      assert.ok(coreLoader.isCached('data/v3/compiled/wordnet/wn_x.json'), 'Core lexical cache must be untouched');
    });

    await runTest('Spy check guarantees FlipitV3Solver preloads and evaluates corpus plugin without shadowing or sync disk reads', async () => {
      let queryCalls = 0;
      let preloadCalls = 0;
      const spyPlugin: ExternalCorpusPlugin = {
        name: 'Spy Corpus Plugin',
        async preloadPartition() {
          preloadCalls++;
          return { partition: 'spy', filePath: 'spy', sizeBytes: 10, loadTimeMs: 0, cached: false };
        },
        querySync(w1, w2) {
          queryCalls++;
          if (w1 === 'PLASTIC' && w2 === 'SMILE') {
            return {
              count: 4200,
              score: 0.77,
              pmi: 4.9,
              tScore: 62.5,
              orderRatio: 400.0,
              reverseCount: 9,
              sourceDataset: 'Spy Corpus Plugin',
            };
          }
          return null;
        },
        async query(w1, w2) {
          return this.querySync!(w1, w2);
        },
      };

      const solver = new FlipitV3Solver({
        knowledgeConfig: 'pure-v3',
        corpusPlugin: spyPlugin,
      });

      const res = await solver.solve(
        'SYNTHETIC',
        'FROWN',
        { word1: { startsWith: 'P', length: 7 }, word2: { startsWith: 'S', length: 5 } },
        { knowledgeConfig: 'pure-v3' }
      );

      assert.ok(preloadCalls > 0, 'Expected solver to preload corpus partitions');
      assert.ok(queryCalls > 0, 'Expected solver cross-product loop to invoke querySync');
      assert.ok(res.candidates.length > 0);
      assert.strictEqual(res.bestMatch?.targetPhrase, 'PLASTIC SMILE');
      assert.strictEqual(res.bestMatch?.phraseMatch.empiricalFrequency, 4200);
      assert.strictEqual(res.bestMatch?.phraseMatch.pmi, 4.9);
      assert.strictEqual(res.bestMatch?.phraseProvenanceCategory, 'corpus-plugin');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  // 3. Real Compiled Pilot Artifacts & Quality Controls (if pilot compiled)
  // -------------------------------------------------------------------------
  console.log('\n[3/4] Verifying Real Compiled Google Books Pilot Artifacts & Quality Controls...');
  const pilotDir = path.join(process.cwd(), 'data/v3/compiled/corpus_pilot');
  const pilotSummaryPath = path.join(pilotDir, 'pilot_summary.json');
  const pilotChecksumsPath = path.join(pilotDir, 'checksums.json');

  if (fs.existsSync(pilotSummaryPath) && fs.existsSync(pilotChecksumsPath)) {
    await runTest('Pilot SHA-256 checksums verify cleanly against all compiled corpus_*.json partitions', () => {
      const checkJson = JSON.parse(fs.readFileSync(pilotChecksumsPath, 'utf8'));
      const entries = Object.entries<string>(checkJson.checksums || {});
      assert.ok(entries.length >= 2, `Expected >= 2 pilot partitions, got ${entries.length}`);
      for (const [relPath, expectedSha] of entries) {
        const fullPath = path.resolve(relPath);
        assert.ok(fs.existsSync(fullPath), `Missing partition file ${relPath}`);
        const actualSha = crypto.createHash('sha256').update(fs.readFileSync(fullPath)).digest('hex');
        assert.strictEqual(actualSha, expectedSha, `SHA-256 mismatch on ${relPath}`);
      }
    });

    await runTest('Real pilot corpus distinguishes high-PMI collocations from stopword & reversed negative controls', async () => {
      const plugin = new PartitionedCorpusPlugin({ basePath: 'data/v3/compiled/corpus_pilot' });

      // Negative function-word bigrams MUST NOT exist in compiled corpus partitions
      for (const [n1, n2] of [
        ['OF', 'THE'],
        ['IN', 'A'],
        ['BOX', 'WAS'],
        ['SMILE', 'AT'],
        ['OLD', 'THE'],
      ]) {
        const neg = await plugin.query(n1, n2);
        assert.strictEqual(neg, null, `Negative control stopword pair "${n1} ${n2}" must not exist in corpus partitions`);
      }

      // Summary telemetry confirms stopword rejection & positive thresholded quality
      const summary = JSON.parse(fs.readFileSync(pilotSummaryPath, 'utf8'));
      assert.strictEqual(summary.release, '20200217');
      assert.ok(summary.filteringCounts.retainedCount > 100);
      assert.ok(summary.negativeControlAudits.topStopwordRejectedPairs.length > 0);
    });
  } else {
    console.log('  [info] Compiled pilot partitions not present yet; skipping live partition check.');
  }

  // -------------------------------------------------------------------------
  // 4. Zero-Leakage Audit on Milestone 7A Runtime & Build Scripts
  // -------------------------------------------------------------------------
  console.log('\n[4/4] Verifying Zero Benchmark Answer Leakage in Corpus Scripts & Plugin...');
  await runTest('Zero puzzle answers hardcoded in compile_corpus_pilot.ts, corpusStats.ts, or partitionedCorpusPlugin.ts', () => {
    const FORBIDDEN = [
      'PLASTIC SMILE',
      'DRY FRUITS',
      'HOME COMING',
      'OLD GARMENTS',
      'SWEET BOX',
      'DEMON KING',
      'LONG WEEKEND',
      'DEEP CLEANING',
    ];
    for (const rel of [
      'scripts/v3/compile_corpus_pilot.ts',
      'src/solver/v3/corpusStats.ts',
      'src/solver/v3/partitionedCorpusPlugin.ts',
    ]) {
      const txt = fs.readFileSync(path.resolve(rel), 'utf8').toUpperCase();
      for (const ans of FORBIDDEN) {
        assert.strictEqual(
          txt.includes(ans),
          false,
          `Integrity violation: "${ans}" must NEVER appear in ${rel}`
        );
      }
    }
  });

  console.log('\n----------------------------------------------------------------------');
  console.log(` MILESTONE 7A PILOT TESTS: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------------------------');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
