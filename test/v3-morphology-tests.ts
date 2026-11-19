/**
 * Flipit Finder V3 — Milestone 3.2 Morphological & Semantic Recall Test Suite
 * Tests general-purpose English morphological normalization, irregular exceptions,
 * inflectional projection, relationship recall fixes, and morphological phrase matching.
 */

import * as assert from 'node:assert/strict';
import { CompositeV3PhraseProvider } from '../src/solver/v3/compositeV3PhraseProvider.ts';
import { CompositeV3RelationshipProvider } from '../src/solver/v3/compositeV3Provider.ts';
import { defaultMorphologyEngine } from '../src/solver/v3/morphology.ts';

async function runMorphologyTests() {
  let passed = 0;
  let total = 0;

  function check(name: string, fn: () => void | Promise<void>) {
    return (async () => {
      total++;
      try {
        await fn();
        passed++;
        console.log(`  ✓ ${name}`);
      } catch (err: any) {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err?.message || err}`);
        process.exitCode = 1;
      }
    })();
  }

  console.log('=== V3 Milestone 3.2: Morphology & Semantic Recall Tests ===\n');

  console.log('[1] OfflineMorphologyEngine Unit Tests');
  await check('Noun plural rules: VEGETABLES, GARMENTS, BOXES, HALVES, BERRIES', () => {
    assert.ok(defaultMorphologyEngine.lemmatize('VEGETABLES').baseLemmas.includes('VEGETABLE'));
    assert.ok(defaultMorphologyEngine.lemmatize('GARMENTS').baseLemmas.includes('GARMENT'));
    assert.ok(defaultMorphologyEngine.lemmatize('BOXES').baseLemmas.includes('BOX'));
    assert.ok(defaultMorphologyEngine.lemmatize('HALVES').baseLemmas.includes('HALF'));
    assert.ok(defaultMorphologyEngine.lemmatize('BERRIES').baseLemmas.includes('BERRY'));
    assert.ok(defaultMorphologyEngine.lemmatize('CLOTHES').baseLemmas.includes('CLOTHING'));
  });

  await check('Verb -ing / -ed rules: LEAVING, COMING, CLEANING, TRIED, RUNNING, STOPPED', () => {
    assert.ok(defaultMorphologyEngine.lemmatize('LEAVING').baseLemmas.includes('LEAVE'));
    assert.ok(defaultMorphologyEngine.lemmatize('COMING').baseLemmas.includes('COME'));
    assert.ok(defaultMorphologyEngine.lemmatize('CLEANING').baseLemmas.includes('CLEAN'));
    assert.ok(defaultMorphologyEngine.lemmatize('TRIED').baseLemmas.includes('TRY'));
    assert.ok(defaultMorphologyEngine.lemmatize('RUNNING').baseLemmas.includes('RUN'));
    assert.ok(defaultMorphologyEngine.lemmatize('STOPPED').baseLemmas.includes('STOP'));
  });

  await check('Irregular WordNet exceptions: CHILDREN, MICE, FEET, WENT', () => {
    assert.ok(defaultMorphologyEngine.lemmatize('CHILDREN').baseLemmas.includes('CHILD'));
    assert.ok(defaultMorphologyEngine.lemmatize('MICE').baseLemmas.includes('MOUSE'));
    assert.ok(defaultMorphologyEngine.lemmatize('FEET').baseLemmas.includes('FOOT'));
    assert.ok(defaultMorphologyEngine.lemmatize('WENT').baseLemmas.includes('GO'));
  });

  await check('Guards against corrupting -ss / -us / short tokens: GLASS, BUS, GAS', () => {
    const glass = defaultMorphologyEngine.lemmatize('GLASS');
    assert.equal(glass.isInflected, false);
    assert.deepEqual(glass.baseLemmas, ['GLASS']);

    const bus = defaultMorphologyEngine.lemmatize('BUS');
    assert.equal(bus.isInflected, false);
  });

  await check('Targeted inflection projection: gerund-verb & plural-noun', () => {
    assert.ok(
      defaultMorphologyEngine.projectForInflection('COME', 'gerund-verb').includes('COMING')
    );
    assert.ok(
      defaultMorphologyEngine.projectForInflection('FRUIT', 'plural-noun').includes('FRUITS')
    );
    assert.ok(
      defaultMorphologyEngine.projectForInflection('GARMENT', 'plural-noun').includes('GARMENTS')
    );
    assert.ok(
      defaultMorphologyEngine.projectForInflection('CHILD', 'plural-noun').includes('CHILDREN')
    );
  });

  console.log('\n[2] CompositeV3RelationshipProvider Morphological & Recall Tests');
  const relProvider = new CompositeV3RelationshipProvider();

  await check('ANGEL generates DEMON via expanded Moby Thesaurus II index', async () => {
    const res = await relProvider.lookupWithDiagnostics('ANGEL');
    assert.ok(res.transformations.some((t) => t.word === 'DEMON'), 'DEMON missing for ANGEL');
    assert.ok(res.transformations.length <= 80);
  });

  await check('LEAVING generates COMING with length=6 constraint and preserves morphology provenance', async () => {
    const res = await relProvider.lookupWithDiagnostics('LEAVING', { length: 6 });
    const coming = res.transformations.find((t) => t.word === 'COMING');
    assert.ok(coming, 'COMING missing for LEAVING');
    assert.equal(coming.relationType, 'antonym');
    assert.ok(coming.reason.includes('LEAVE'));
    assert.equal(res.diagnostics.morphology?.isInflected, true);
    assert.ok(res.diagnostics.morphology?.baseLemmas.includes('LEAVE'));
  });

  await check('CLOTHES generates GARMENTS with length=8 constraint', async () => {
    const res = await relProvider.lookupWithDiagnostics('CLOTHES', { length: 8 });
    const garments = res.transformations.find((t) => t.word === 'GARMENTS');
    assert.ok(garments, 'GARMENTS missing for CLOTHES');
    assert.ok(['synonym', 'coordinate'].includes(garments.relationType));
  });

  await check('VEGETABLES generates FRUITS with length=6 constraint via WordNet produce coordinates', async () => {
    const res = await relProvider.lookupWithDiagnostics('VEGETABLES', { length: 6 });
    const fruits = res.transformations.find((t) => t.word === 'FRUITS');
    assert.ok(fruits, 'FRUITS missing for VEGETABLES');
    assert.ok(fruits.reason.includes('VEGETABLE'));
  });

  await check('Independent irregular & inflected words resolve cleanly: CHILDREN, CLEANING, BOXES', async () => {
    const childrenRes = await relProvider.lookupWithDiagnostics('CHILDREN');
    assert.ok(childrenRes.transformations.length > 0, 'CHILDREN produced no candidates');

    const cleaningRes = await relProvider.lookupWithDiagnostics('CLEANING');
    assert.ok(cleaningRes.transformations.some((t) => t.word === 'DIRTY' || t.word === 'WASHING' || t.word === 'SOILING' || t.word === 'CLEANSE'));

    const boxesRes = await relProvider.lookupWithDiagnostics('BOXES');
    assert.ok(boxesRes.transformations.length > 0, 'BOXES produced no candidates');
  });

  console.log('\n[3] CompositeV3PhraseProvider Morphological Phrase Matching Tests (Curated Disabled)');
  const phraseProvider = new CompositeV3PhraseProvider({ enableCurated: false });

  await check('DRY FRUITS resolves via morphological normalization to WordNet DRIED FRUIT', async () => {
    const { match, diagnostics } = await phraseProvider.lookupWithDiagnostics('DRY', 'FRUITS');
    assert.ok(match, 'DRY FRUITS did not match morphologically');
    assert.equal(diagnostics.found, true);
    assert.ok(match.explanation?.includes('DRIED FRUIT'));
  });

  await check('OUTER GARMENT resolves cleanly without false positives', async () => {
    const { match } = await phraseProvider.lookupWithDiagnostics('OUTER', 'GARMENTS');
    assert.ok(match, 'OUTER GARMENTS did not match');
    const neg = await phraseProvider.lookupWithDiagnostics('DRY', 'BOX');
    assert.equal(neg.match, null, 'False positive match on unrelated words');
  });

  await check('Comparative/superlative guard blocks false matches like DRIER CLEANER / DRIER MOPPING', async () => {
    const drierCleaner = await phraseProvider.lookupWithDiagnostics('DRIER', 'CLEANER');
    assert.equal(drierCleaner.match, null, 'DRIER CLEANER should not falsely match DRY CLEANER');
    const drierMopping = await phraseProvider.lookupWithDiagnostics('DRIER', 'MOPPING');
    assert.equal(drierMopping.match, null, 'DRIER MOPPING should not falsely match DRY MOP');
  });

  console.log(`\nSummary: ${passed}/${total} Milestone 3.2 tests passed.`);
  if (passed !== total) process.exit(1);
}

runMorphologyTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
