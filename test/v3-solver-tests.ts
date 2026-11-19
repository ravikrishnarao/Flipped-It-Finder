/**
 * Flipit Finder V3 — Milestone 4 Integrated Solver & Ranker Test Suite
 * Verifies:
 *   1. V3Ranker monotonicity, score decomposition, heuristic disclaimer, and penalties
 *   2. Knowledge configuration isolation ('pure-v3', 'hybrid', 'full-compatibility')
 *   3. Constraint filtering without premature morphological discarding
 *   4. Cross-product phrase matching (open, closed, hyphenated) and deduplication
 *   5. Diagnostics, provenance attribution, and error/empty-input handling
 */

import * as assert from 'node:assert';
import { PartitionLoader } from '../src/solver/v3/partitionLoader.ts';
import type { V3PhraseMatch } from '../src/solver/v3/phraseTypes.ts';
import type { WordTransformation } from '../src/solver/v3/types.ts';
import { V3Ranker } from '../src/solver/v3/v3Ranker.ts';
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

function makeRel(
  clue: string,
  word: string,
  relationType: WordTransformation['relationType'],
  score: number,
  source = 'Princeton WordNet 3.0',
  extra?: Partial<WordTransformation>
): WordTransformation {
  return {
    originalClue: clue,
    word,
    relationType,
    score,
    reason: `${relationType} of ${clue}`,
    source,
    ...extra,
  };
}

function makePhrase(
  w1: string,
  w2: string,
  overrides?: Partial<V3PhraseMatch>
): V3PhraseMatch {
  return {
    phrase: `${w1} ${w2}`,
    word1: w1,
    word2: w2,
    frequencyScore: 0.96,
    category: 'wordnet-collocation',
    alternateForms: [],
    normalizedPhrase: `${w1} ${w2}`,
    originalPhraseForm: `${w1} ${w2}`,
    phraseCategory: 'collocation',
    sourceDataset: 'Princeton WordNet 3.0 Collocations',
    empiricalFrequency: null,
    heuristicScore: 0.96,
    explanation: 'Verified collocation',
    matchType: 'open',
    ...overrides,
  };
}

async function main() {
  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 4 SOLVER & RANKER TESTS');
  console.log('======================================================================\n');

  const ranker = new V3Ranker();

  await runTest('V3Ranker: explicit heuristic (non-probability) disclaimer included', () => {
    const cand = ranker.evaluateCandidate({
      clue1: 'SLOW',
      clue2: 'MEAL',
      relation1: makeRel('SLOW', 'FAST', 'antonym', 0.99),
      relation2: makeRel('MEAL', 'FOOD', 'synonym', 0.95),
      phraseMatch: makePhrase('FAST', 'FOOD'),
    });
    assert.ok(cand.matchScore > 0 && cand.matchScore <= 1);
    assert.ok(
      cand.rankingBreakdown.scoreIsHeuristicNote.toLowerCase().includes('not a statistical probability')
    );
  });

  await runTest('V3Ranker: direct antonym+synonym outranks coordinate+thesaurus', () => {
    const strong = ranker.evaluateCandidate({
      clue1: 'ANGEL',
      clue2: 'QUEEN',
      relation1: makeRel('ANGEL', 'DEMON', 'antonym', 0.99),
      relation2: makeRel('QUEEN', 'KING', 'antonym', 0.98),
      phraseMatch: makePhrase('DEMON', 'KING', {
        sourceDataset: 'Moby Compound Words (Grady Ward)',
        heuristicScore: 0.94,
      }),
    });
    const weak = ranker.evaluateCandidate({
      clue1: 'ANGEL',
      clue2: 'QUEEN',
      relation1: makeRel('ANGEL', 'SAINT', 'coordinate', 0.85, 'Princeton WordNet 3.0', { depth: 5 }),
      relation2: makeRel('QUEEN', 'MONARCH', 'thesaurus', 0.82, 'Moby Thesaurus II'),
      phraseMatch: makePhrase('SAINT', 'MONARCH', {
        sourceDataset: 'Moby Compound Words (Grady Ward)',
        heuristicScore: 0.94,
      }),
    });
    assert.ok(
      strong.matchScore > weak.matchScore,
      `Expected strong (${strong.matchScore}) > weak (${weak.matchScore})`
    );
  });

  await runTest('V3Ranker: reversed phrase match receives explicit penalty and ranks lower', () => {
    const forward = ranker.evaluateCandidate({
      clue1: 'NEW',
      clue2: 'CLOTHES',
      relation1: makeRel('NEW', 'OLD', 'antonym', 0.99),
      relation2: makeRel('CLOTHES', 'GARMENTS', 'synonym', 0.95),
      phraseMatch: makePhrase('OLD', 'GARMENTS', { isReversed: false }),
    });
    const reversed = ranker.evaluateCandidate({
      clue1: 'NEW',
      clue2: 'CLOTHES',
      relation1: makeRel('NEW', 'OLD', 'antonym', 0.99),
      relation2: makeRel('CLOTHES', 'GARMENTS', 'synonym', 0.95),
      phraseMatch: makePhrase('OLD', 'GARMENTS', { isReversed: true }),
    });
    assert.strictEqual(forward.rankingBreakdown.reversedOrderPenalty, 0);
    assert.ok(reversed.rankingBreakdown.reversedOrderPenalty > 0);
    assert.ok(forward.matchScore > reversed.matchScore);
  });

  await runTest('V3Ranker: inflectional parity rewards matching plural/gerund projections', () => {
    const matchedPlural = ranker.evaluateCandidate({
      clue1: 'WET',
      clue2: 'VEGETABLES',
      relation1: makeRel('WET', 'DRY', 'antonym', 0.99),
      relation2: makeRel('VEGETABLES', 'FRUITS', 'coordinate', 0.84, 'Princeton WordNet 3.0', {
        depth: 7,
        reason: 'Coordinate term [via lemma VEGETABLE] [inflection projected → FRUITS]',
      }),
      phraseMatch: makePhrase('DRY', 'FRUITS', { heuristicScore: 0.9 }),
    });
    const droppedPlural = ranker.evaluateCandidate({
      clue1: 'WET',
      clue2: 'VEGETABLES',
      relation1: makeRel('WET', 'DRY', 'antonym', 0.99),
      relation2: makeRel('VEGETABLES', 'SHOOT', 'coordinate', 0.84, 'Princeton WordNet 3.0', {
        depth: 7,
        reason: 'Coordinate term [via lemma VEGETABLE]',
      }),
      phraseMatch: makePhrase('DRY', 'SHOOT', { heuristicScore: 0.9 }),
    });
    assert.ok(
      matchedPlural.rankingBreakdown.morphologicalCompatibility >
        droppedPlural.rankingBreakdown.morphologicalCompatibility
    );
    assert.ok(matchedPlural.matchScore > droppedPlural.matchScore);
  });

  await runTest('V3Ranker: ambiguity penalty triggers on high-fanout weak tiers and dual-thesaurus', () => {
    const noisy = ranker.evaluateCandidate({
      clue1: 'LIGHT',
      clue2: 'WORK',
      clue1Fanout: 140,
      clue2Fanout: 120,
      relation1: makeRel('LIGHT', 'PALE', 'thesaurus', 0.82, 'Moby Thesaurus II'),
      relation2: makeRel('WORK', 'TASK', 'thesaurus', 0.82, 'Moby Thesaurus II'),
      phraseMatch: makePhrase('PALE', 'TASK'),
    });
    assert.ok(noisy.rankingBreakdown.ambiguityPenalty >= 0.05);
  });

  // Shared solver using a single PartitionLoader for fast multi-config testing
  const solver = new FlipitV3Solver();

  await runTest('Knowledge isolation: pure-v3 excludes ContextualAssociationProvider and CuratedPhraseProvider', async () => {
    const providers = solver.getProviders('pure-v3');
    assert.strictEqual(providers.relationshipProvider.includeContextual, false);
    assert.strictEqual(providers.relationshipProvider.includeLegacyCurated, false);

    const res = await solver.solve('DRY', 'MOP', undefined, { knowledgeConfig: 'pure-v3' });
    assert.strictEqual(res.knowledgeConfig, 'pure-v3');
    assert.strictEqual(res.diagnostic.clue1.providerCounts.ContextualAssociationProvider, undefined);
    assert.strictEqual(res.diagnostic.clue1.providerCounts.LegacyCuratedProviders, undefined);
    for (const c of res.candidates) {
      assert.notStrictEqual(c.phraseProvenanceCategory, 'curated');
      assert.notStrictEqual(c.relation1ProvenanceCategory, 'contextual');
      assert.notStrictEqual(c.relation2ProvenanceCategory, 'contextual');
    }
  });

  await runTest('Knowledge isolation: hybrid enables ContextualAssociationProvider without CuratedPhraseProvider', async () => {
    const providers = solver.getProviders('hybrid');
    assert.strictEqual(providers.relationshipProvider.includeContextual, true);
    assert.strictEqual(providers.relationshipProvider.includeLegacyCurated, false);

    const res = await solver.solve('DRY', 'MOP', undefined, { knowledgeConfig: 'hybrid' });
    assert.strictEqual(res.knowledgeConfig, 'hybrid');
    assert.ok((res.diagnostic.clue1.providerCounts.ContextualAssociationProvider ?? 0) > 0);
    const hasCleanSweep = res.candidates.some((c) => c.targetPhrase === 'CLEAN SWEEP');
    assert.ok(hasCleanSweep, 'Hybrid mode should discover CLEAN SWEEP via Contextual + Moby/WordNet phrases');
    for (const c of res.candidates) {
      assert.notStrictEqual(c.phraseProvenanceCategory, 'curated');
    }
  });

  await runTest('Knowledge isolation: full-compatibility enables legacy curated relationships and phrases', async () => {
    const providers = solver.getProviders('full-compatibility');
    assert.strictEqual(providers.relationshipProvider.includeContextual, true);
    assert.strictEqual(providers.relationshipProvider.includeLegacyCurated, true);

    const res = await solver.solve('SLOW', 'MEAL', undefined, {
      knowledgeConfig: 'full-compatibility',
    });
    assert.ok(res.candidates.some((c) => c.targetPhrase === 'FAST FOOD'));
  });

  await runTest('Constraints preserve inflected clues via morphological projection (LEAVING -> COMING)', async () => {
    const unconstrained = await solver.solve('ABODE', 'LEAVING', undefined, {
      knowledgeConfig: 'pure-v3',
    });
    const constrained = await solver.solve(
      'ABODE',
      'LEAVING',
      {
        word1: { startsWith: 'H', length: 4 },
        word2: { startsWith: 'C', length: 6 },
      },
      { knowledgeConfig: 'pure-v3' }
    );

    assert.ok(
      constrained.diagnostic.clue1.preConstraintCount >=
        constrained.diagnostic.clue1.postConstraintCount
    );
    assert.ok(
      constrained.diagnostic.clue2.preConstraintCount >=
        constrained.diagnostic.clue2.postConstraintCount
    );
    assert.ok(
      constrained.diagnostic.totalCombinationsBeforeConstraints >=
        constrained.diagnostic.totalCombinationsAfterConstraints
    );
    assert.strictEqual(
      constrained.bestMatch?.targetPhrase,
      'HOME COMING',
      `Expected HOME COMING as top constrained answer, got ${constrained.bestMatch?.targetPhrase}`
    );
    assert.ok(unconstrained.candidates.some((c) => c.targetPhrase === 'HOME COMING'));
  });

  await runTest('Constraints preserve plural clues via morphological projection (VEGETABLES -> FRUITS)', async () => {
    const constrained = await solver.solve(
      'WET',
      'VEGETABLES',
      {
        word1: { startsWith: 'D', length: 3 },
        word2: { startsWith: 'F', length: 6 },
      },
      { knowledgeConfig: 'pure-v3' }
    );
    assert.strictEqual(constrained.bestMatch?.targetPhrase, 'DRY FRUITS');
    assert.ok(constrained.diagnostic.clue2.morphology.isInflected);
  });

  await runTest('Compound & match-type filtering: allowedMatchTypes=["open"] excludes closed-only compounds', async () => {
    const withCompounds = await solver.solve(
      'ABODE',
      'LEAVING',
      {
        word1: { startsWith: 'H', length: 4 },
        word2: { startsWith: 'C', length: 6 },
      },
      { knowledgeConfig: 'pure-v3', enableCompoundMatching: true }
    );
    const openOnly = await solver.solve(
      'ABODE',
      'LEAVING',
      {
        word1: { startsWith: 'H', length: 4 },
        word2: { startsWith: 'C', length: 6 },
      },
      { knowledgeConfig: 'pure-v3', allowedMatchTypes: ['open'] }
    );

    assert.ok(withCompounds.candidates.some((c) => c.targetPhrase === 'HOME COMING'));
    assert.ok(
      openOnly.candidates.every((c) => c.phraseMatch.matchType === 'open'),
      'All candidates under allowedMatchTypes=["open"] must have open matchType'
    );
  });

  await runTest('Empty and unknown inputs return structured failure diagnostics without throwing', async () => {
    const emptyRes = await solver.solve('', 'RITUAL', undefined, { knowledgeConfig: 'pure-v3' });
    assert.strictEqual(emptyRes.candidates.length, 0);
    assert.strictEqual(emptyRes.bestMatch, null);
    assert.strictEqual(emptyRes.diagnostic.failureReason, 'INPUT_EMPTY');

    const unknownRes = await solver.solve('XYZQWERTY', 'RITUAL', undefined, {
      knowledgeConfig: 'pure-v3',
    });
    assert.strictEqual(unknownRes.candidates.length, 0);
    assert.strictEqual(unknownRes.diagnostic.failureReason, 'NO_CLUE1_TRANSFORMATIONS');
  });

  await runTest('Milestone 4.1 Regression: SOILING recalls CLEAN and projected CLEANING across all configs', async () => {
    for (const cfg of ['pure-v3', 'hybrid', 'full-compatibility'] as const) {
      const unconstrained = await solver.solve('SHALLOW', 'SOILING', undefined, {
        knowledgeConfig: cfg,
      });
      const clue2Pre = unconstrained.diagnostic.clue2.preConstraintTransformations;
      const cleanEntry = clue2Pre.find((t) => t.word === 'CLEAN');
      const cleaningEntry = clue2Pre.find((t) => t.word === 'CLEANING');
      assert.ok(cleanEntry, `Expected CLEAN in SOILING pre-constraint candidates (${cfg})`);
      assert.ok(cleaningEntry, `Expected CLEANING in SOILING pre-constraint candidates (${cfg})`);
      assert.strictEqual(cleaningEntry.relationType, 'antonym');
      assert.ok(cleaningEntry.reason.includes('SOIL'));
      assert.ok(cleaningEntry.reason.includes('CLEANING'));

      const constrained = await solver.solve(
        'SHALLOW',
        'SOILING',
        { word1: { startsWith: 'D', length: 4 }, word2: { startsWith: 'C', length: 8 } },
        { knowledgeConfig: cfg }
      );
      const clue2Post = constrained.diagnostic.clue2.survivingTransformations;
      const cIdx = clue2Post.findIndex((t) => t.word === 'CLEANING');
      assert.ok(cIdx >= 0, `Expected CLEANING to survive constraint in ${cfg}`);
      assert.strictEqual(cIdx, 0, `Expected CLEANING at rank #1 for constrained SOILING in ${cfg}`);
    }
  });

  await runTest('Milestone 4.1 Ranking Policy: coordinate outranks contextual at equal base score', () => {
    const qAnt = ranker.computeRelationQuality(makeRel('A', 'B', 'antonym', 0.9));
    const qSyn = ranker.computeRelationQuality(makeRel('A', 'B', 'synonym', 0.9));
    const qHyp = ranker.computeRelationQuality(makeRel('A', 'B', 'hypernym', 0.9));
    const qCoord = ranker.computeRelationQuality(makeRel('A', 'B', 'coordinate', 0.9, 'Princeton WordNet 3.0', { depth: 6 }));
    const qCtx = ranker.computeRelationQuality(makeRel('A', 'B', 'contextual', 0.9, 'Curated Contextual Lexicon'));
    const qAssoc = ranker.computeRelationQuality(makeRel('A', 'B', 'associated', 0.9, 'Curated Contextual Lexicon'));
    const qThes = ranker.computeRelationQuality(makeRel('A', 'B', 'thesaurus', 0.9, 'Moby Thesaurus II'));

    assert.ok(qAnt > qSyn, `antonym (${qAnt}) > synonym (${qSyn})`);
    assert.ok(qSyn > qHyp, `synonym (${qSyn}) > hypernym (${qHyp})`);
    assert.ok(qHyp > qCoord, `hypernym (${qHyp}) > coordinate (${qCoord})`);
    assert.ok(qCoord > qCtx, `coordinate (${qCoord}) > contextual (${qCtx})`);
    assert.ok(qCtx > qAssoc, `contextual (${qCtx}) > associated (${qAssoc})`);
    assert.ok(qAssoc > qThes, `associated (${qAssoc}) > thesaurus (${qThes})`);
  });

  await runTest('Milestone 4.1 Constraint Safety: disabling constraints preserves exact candidate inventory', async () => {
    const run1 = await solver.solve('ABODE', 'LEAVING', undefined, { knowledgeConfig: 'pure-v3' });
    await solver.solve(
      'ABODE',
      'LEAVING',
      { word1: { startsWith: 'H', length: 4 }, word2: { startsWith: 'C', length: 6 } },
      { knowledgeConfig: 'pure-v3' }
    );
    const run2 = await solver.solve('ABODE', 'LEAVING', undefined, { knowledgeConfig: 'pure-v3' });

    assert.deepStrictEqual(
      run1.diagnostic.clue1.survivingTransformations.map((t) => t.word),
      run2.diagnostic.clue1.survivingTransformations.map((t) => t.word)
    );
    assert.deepStrictEqual(
      run1.diagnostic.clue2.survivingTransformations.map((t) => t.word),
      run2.diagnostic.clue2.survivingTransformations.map((t) => t.word)
    );
  });

  await runTest('Milestone 5 Bounded Cache: PartitionLoader enforces maxPartitions & maxCacheBytes with LRU eviction', async () => {
    const boundedLoader = new PartitionLoader({
      maxPartitions: 3,
      maxCacheBytes: 3 * 1024 * 1024, // 3 MiB cap
    });

    await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_x.json');
    await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_z.json');
    await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_q.json');
    // Touch wn_x.json so wn_z.json becomes the least recently used entry
    const hitRes = await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_x.json');
    assert.strictEqual(hitRes.stats.cached, true);

    // Loading a 4th small partition must evict wn_z.json (LRU), keeping wn_x.json
    await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_y.json');
    const stats = boundedLoader.getDetailedCacheStats();

    assert.ok(stats.partitionCount <= 3, `Expected <= 3 partitions, got ${stats.partitionCount}`);
    assert.ok(stats.cacheSizeBytes <= 3 * 1024 * 1024, `Expected <= 3 MiB cached, got ${stats.cacheSizeBytes}`);
    assert.ok(stats.evictions >= 1, `Expected >= 1 LRU eviction, got ${stats.evictions}`);
    assert.ok(boundedLoader.isCached('data/v3/compiled/wordnet/wn_x.json'), 'Recently used wn_x.json should remain cached');
    assert.strictEqual(boundedLoader.isCached('data/v3/compiled/wordnet/wn_z.json'), false, 'LRU wn_z.json should be evicted');

    // Evicted partition reloads transparently when needed again
    const reloaded = await boundedLoader.loadPartition('data/v3/compiled/wordnet/wn_z.json');
    assert.ok(reloaded.data !== null);
    assert.strictEqual(reloaded.stats.cached, false);
  });

  await runTest('Milestone 5 Bounded Solver: tight bounded cache solves diverse puzzles without losing accuracy', async () => {
    const tightLoader = new PartitionLoader({
      maxPartitions: 32,
      maxCacheBytes: 32 * 1024 * 1024, // 32 MiB bounded cap
    });
    const boundedSolver = new FlipitV3Solver({ partitionLoader: tightLoader });

    const r1 = await boundedSolver.solve(
      'ABODE',
      'LEAVING',
      { word1: { startsWith: 'H', length: 4 }, word2: { startsWith: 'C', length: 6 } },
      { knowledgeConfig: 'pure-v3' }
    );
    const r2 = await boundedSolver.solve(
      'ANGEL',
      'QUEEN',
      { word1: { startsWith: 'D', length: 5 }, word2: { startsWith: 'K', length: 4 } },
      { knowledgeConfig: 'pure-v3' }
    );
    const r3 = await boundedSolver.solve(
      'SHALLOW',
      'SOILING',
      { word1: { startsWith: 'D', length: 4 }, word2: { startsWith: 'C', length: 8 } },
      { knowledgeConfig: 'pure-v3' }
    );
    const r4 = await boundedSolver.solve(
      'WET',
      'VEGETABLES',
      { word1: { startsWith: 'D', length: 3 }, word2: { startsWith: 'F', length: 6 } },
      { knowledgeConfig: 'pure-v3' }
    );
    const r5 = await boundedSolver.solve(
      'DRY',
      'MOP',
      { word1: { startsWith: 'C', length: 5 }, word2: { startsWith: 'S', length: 5 } },
      { knowledgeConfig: 'hybrid' }
    );
    const r6 = await boundedSolver.solve(
      'ABODE',
      'LEAVING',
      { word1: { startsWith: 'H', length: 4 }, word2: { startsWith: 'C', length: 6 } },
      { knowledgeConfig: 'pure-v3' }
    );

    assert.strictEqual(r1.bestMatch?.targetPhrase, 'HOME COMING');
    assert.ok(r2.diagnostic.clue1.survivingTransformations.some((t) => t.word === 'DEMON'));
    assert.ok(r2.diagnostic.clue2.survivingTransformations.some((t) => t.word === 'KING'));
    assert.ok(r3.diagnostic.clue1.survivingTransformations.some((t) => t.word === 'DEEP'));
    assert.ok(r3.diagnostic.clue2.survivingTransformations.some((t) => t.word === 'CLEANING'));
    assert.strictEqual(r4.bestMatch?.targetPhrase, 'DRY FRUITS');
    assert.strictEqual(r5.bestMatch?.targetPhrase, 'CLEAN SWEEP');
    assert.strictEqual(r6.bestMatch?.targetPhrase, 'HOME COMING');

    const cStats = boundedSolver.getCacheStats();
    assert.ok(cStats.cacheSizeBytes <= 32 * 1024 * 1024);
    assert.ok(cStats.partitionCount <= 32);
  });

  console.log('\n----------------------------------------------------------------------');
  console.log(` RESULTS: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------------------------');
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
