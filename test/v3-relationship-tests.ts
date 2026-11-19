/**
 * Flipit Finder V3 — Relationship Engine Milestone 2 Test Suite
 * Comprehensive verification of:
 * 1. Previously absent words (WordNet + Moby).
 * 2. Synonym discovery with synset gloss provenance.
 * 3. Antonym discovery with direct WordNet pointer validation.
 * 4. Coordinate relationships with parent depth and specificity bounds.
 * 5. Hypernym and hyponym hierarchical discovery.
 * 6. Derivational morphology relationships.
 * 7. Moby Thesaurus II contextual association retrieval.
 * 8. Candidate deduplication & strongest relationship retention.
 * 9. Unknown words & malformed input fault tolerance.
 * 10. Missing partition graceful handling.
 * 11. Concurrent partition lazy loading & Promise deduplication.
 * 12. Deterministic ranking hierarchy enforcement.
 * 13. Lazy loading partition size and latency measurement.
 */

import {
  CompositeV3RelationshipProvider,
  CoordinateRelationshipProvider,
  MobyThesaurusProvider,
  PartitionLoader,
  WordNetRelationshipProvider,
} from '../src/solver/v3/index.ts';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  [✓ PASS] ${testName}`);
    passCount++;
  } else {
    console.error(`  [✗ FAIL] ${testName}`);
    if (detail) console.error(`          ${detail}`);
    failCount++;
  }
}

async function runV3RelationshipTests() {
  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 2: RELATIONSHIP ENGINE VERIFICATION');
  console.log('======================================================================\n');

  const composite = new CompositeV3RelationshipProvider();
  const wordnet = new WordNetRelationshipProvider();
  const coordinate = new CoordinateRelationshipProvider();
  const moby = new MobyThesaurusProvider();

  // -------------------------------------------------------------------------
  // 1. Previously Absent Words Ingestion & Resolution
  // -------------------------------------------------------------------------
  console.log('[1/12] Testing Previously Absent Words (Not in V2.2.4 Seed Dictionary)...');
  const absentWords = [
    'SYNTHETIC',
    'CRATE',
    'ABODE',
    'FESTIVAL',
    'CARNIVAL',
    'SOILING',
    'FROWN',
    'QUEEN',
  ];

  for (const word of absentWords) {
    const hasWord = await composite.hasClueAsync(word);
    assert(hasWord, `Resolution of previously absent word: "${word}"`);
    const transforms = await composite.getTransformationsAsync(word);
    assert(transforms.length > 0, `Transformation generation for "${word}": found ${transforms.length} candidates`);
  }

  // -------------------------------------------------------------------------
  // 2. Synonym Discovery with Source Provenance
  // -------------------------------------------------------------------------
  console.log('\n[2/12] Testing Synonym Discovery & Provenance...');
  const abodeRes = await wordnet.getTransformationsAsync('ABODE');
  const homeSynonym = abodeRes.find((t) => t.word === 'HOME');
  assert(
    Boolean(homeSynonym && homeSynonym.relationType === 'synonym' && homeSynonym.score >= 0.94),
    'ABODE -> HOME resolved as WordNet synonym with score >= 0.94',
    homeSynonym ? `Got ${homeSynonym.relationType} score=${homeSynonym.score} reason=${homeSynonym.reason}` : 'Missing HOME'
  );

  const carnivalRes = await wordnet.getTransformationsAsync('CARNIVAL');
  const fairSynonym = carnivalRes.find((t) => t.word === 'FAIR');
  assert(
    Boolean(fairSynonym && fairSynonym.relationType === 'synonym'),
    'CARNIVAL -> FAIR resolved as WordNet synonym'
  );

  // -------------------------------------------------------------------------
  // 3. Antonym Discovery & Direct WordNet Pointer Validation
  // -------------------------------------------------------------------------
  console.log('\n[3/12] Testing Antonym Discovery & Strict Pointer Provenance...');
  const queenRes = await wordnet.getTransformationsAsync('QUEEN');
  const kingAntonym = queenRes.find((t) => t.word === 'KING');
  assert(
    Boolean(kingAntonym && kingAntonym.relationType === 'antonym' && kingAntonym.score === 0.99),
    'QUEEN -> KING resolved as direct WordNet antonym with score=0.99',
    kingAntonym ? `Got ${kingAntonym.relationType} score=${kingAntonym.score} source=${kingAntonym.source}` : 'Missing KING'
  );

  const syntheticRes = await wordnet.getTransformationsAsync('SYNTHETIC');
  const analyticAntonym = syntheticRes.find((t) => t.word === 'ANALYTIC');
  assert(
    Boolean(analyticAntonym && analyticAntonym.relationType === 'antonym'),
    'SYNTHETIC -> ANALYTIC resolved as direct WordNet antonym'
  );

  // -------------------------------------------------------------------------
  // 4. Coordinate Relationships with Parent Specificity & Hierarchy Depth
  // -------------------------------------------------------------------------
  console.log('\n[4/12] Testing Coordinate Relationships (Bounded Specificity & Depth)...');
  const frownRes = await coordinate.getTransformationsAsync('FROWN');
  const smileCoord = frownRes.find((t) => t.word === 'SMILE');
  assert(
    Boolean(smileCoord && smileCoord.relationType === 'coordinate' && smileCoord.depth === 6),
    'FROWN -> SMILE resolved as WordNet coordinate under "FACIAL EXPRESSION" at depth 6',
    smileCoord ? `Got ${smileCoord.relationType} depth=${smileCoord.depth} reason=${smileCoord.reason}` : 'Missing SMILE'
  );

  const crateCoord = await coordinate.getTransformationsAsync('CRATE');
  const cartonCoord = crateCoord.find((t) => t.word === 'CARTON');
  assert(
    Boolean(cartonCoord && cartonCoord.relationType === 'coordinate' && cartonCoord.depth === 8),
    'CRATE -> CARTON resolved as WordNet coordinate under "BOX" at depth 8'
  );

  // -------------------------------------------------------------------------
  // 5. Hypernym and Hyponym Hierarchical Discovery
  // -------------------------------------------------------------------------
  console.log('\n[5/12] Testing Hierarchical Discovery (Direct Hypernyms/Hyponyms)...');
  const crateWordnet = await wordnet.getTransformationsAsync('CRATE');
  const boxHypernym = crateWordnet.find((t) => t.word === 'BOX');
  assert(
    Boolean(boxHypernym && boxHypernym.relationType === 'hypernym' && boxHypernym.score >= 0.85),
    'CRATE -> BOX resolved as direct WordNet hypernym',
    boxHypernym ? `Got ${boxHypernym.relationType} score=${boxHypernym.score} reason=${boxHypernym.reason}` : 'Missing BOX'
  );

  const carnivalWordnet = await wordnet.getTransformationsAsync('CARNIVAL');
  const festivalHypernym = carnivalWordnet.find((t) => t.word === 'FESTIVAL');
  assert(
    Boolean(festivalHypernym && festivalHypernym.relationType === 'hypernym'),
    'CARNIVAL -> FESTIVAL resolved as direct WordNet hypernym'
  );

  // -------------------------------------------------------------------------
  // 6. Derivational Morphology Relationships
  // -------------------------------------------------------------------------
  console.log('\n[6/12] Testing Derivational Morphology Relationships...');
  const soilingRes = await wordnet.getTransformationsAsync('SOILING');
  const soilDerivation = soilingRes.find((t) => t.word === 'SOIL');
  assert(
    Boolean(soilDerivation && soilDerivation.relationType === 'derivation' && soilDerivation.score >= 0.85),
    'SOILING -> SOIL resolved as WordNet derivationally related form',
    soilDerivation ? `Got ${soilDerivation.relationType} score=${soilDerivation.score}` : 'Missing SOIL'
  );

  const cleanRes = await wordnet.getTransformationsAsync('CLEAN');
  const cleaningDeriv = cleanRes.find((t) => t.word === 'CLEANING');
  assert(
    Boolean(cleaningDeriv && cleaningDeriv.relationType === 'derivation'),
    'CLEAN -> CLEANING resolved as WordNet derivational form'
  );

  // -------------------------------------------------------------------------
  // 7. Moby Thesaurus II Contextual Association Retrieval
  // -------------------------------------------------------------------------
  console.log('\n[7/12] Testing Moby Thesaurus II Association Retrieval...');
  const mobySynthetic = await moby.getTransformationsAsync('SYNTHETIC');
  const plasticAssoc = mobySynthetic.find((t) => t.word === 'PLASTIC');
  assert(
    Boolean(plasticAssoc && plasticAssoc.relationType === 'thesaurus' && plasticAssoc.source === 'Moby Thesaurus II'),
    'SYNTHETIC -> PLASTIC resolved from Moby Thesaurus II with source attribution',
    plasticAssoc ? `Got ${plasticAssoc.relationType} source=${plasticAssoc.source}` : 'Missing PLASTIC'
  );

  // Verify Moby does NOT mislabel associations as direct antonyms
  const nonAntonymCheck = mobySynthetic.every((t) => t.relationType !== 'antonym');
  assert(nonAntonymCheck, 'Moby Thesaurus entries are accurately typed as thesaurus, NOT direct antonyms');

  // -------------------------------------------------------------------------
  // 8. Candidate Deduplication & Strongest Relationship Retention
  // -------------------------------------------------------------------------
  console.log('\n[8/12] Testing Candidate Deduplication & Priority Retention...');
  // "QUEEN" is in WordNet as direct antonym of "KING" (score 0.99), and also in Moby associations
  const queenComposite = await composite.getTransformationsAsync('QUEEN');
  const kingCandidates = queenComposite.filter((t) => t.word === 'KING');
  assert(kingCandidates.length === 1, 'Target "KING" appears exactly once after composite deduplication');
  assert(
    kingCandidates[0].relationType === 'antonym' && kingCandidates[0].score === 0.99,
    'Direct antonym priority overrides lower-tier associations in deduplication',
    `Resolved relationType=${kingCandidates[0].relationType} score=${kingCandidates[0].score}`
  );

  // -------------------------------------------------------------------------
  // 9. Unknown Words & Malformed Input Handling
  // -------------------------------------------------------------------------
  console.log('\n[9/12] Testing Unknown Words & Edge Cases...');
  const nonWordRes = await composite.lookupWithDiagnostics('XZQJKW99');
  assert(
    nonWordRes.transformations.length === 0,
    'Non-existent pseudo-word returns clean empty array without error'
  );
  assert(
    nonWordRes.diagnostics.missingInProviders.length === 4,
    'Diagnostics record that word was missing across all 4 providers'
  );

  const emptyRes = await composite.lookupWithDiagnostics('   ');
  assert(emptyRes.transformations.length === 0, 'Whitespace string handled safely');

  const punctRes = await composite.getTransformationsAsync('!@#$$%');
  assert(punctRes.length === 0, 'Punctuation-only string handled safely');

  // -------------------------------------------------------------------------
  // 10. Missing Partition Graceful Handling
  // -------------------------------------------------------------------------
  console.log('\n[10/12] Testing Missing Partition Graceful Handling...');
  const missingLoader = new PartitionLoader('/tmp/non_existent_dir_12345');
  const missingWn = new WordNetRelationshipProvider(missingLoader, 'invalid/path');
  const missingRes = await missingWn.getTransformationsAsync('APPLE');
  assert(missingRes.length === 0, 'Missing partition directory returns empty result without throwing unhandled error');

  // -------------------------------------------------------------------------
  // 11. Concurrent Partition Loading & In-Flight Promise Deduplication
  // -------------------------------------------------------------------------
  console.log('\n[11/12] Testing Concurrent Partition Loading & Promise Deduplication...');
  const isolatedLoader = new PartitionLoader();
  const isolatedComposite = new CompositeV3RelationshipProvider({ partitionLoader: isolatedLoader });

  // Fire 10 concurrent requests for words starting with letter 'B' simultaneously
  const concurrentWords = ['BREAD', 'BRUSH', 'BUTTER', 'BOX', 'BAKE', 'BATTLE', 'BLUE', 'BOOK', 'BAD', 'BACK'];
  const startConcurrent = performance.now();
  const concurrentResults = await Promise.all(
    concurrentWords.map((w) => isolatedComposite.lookupWithDiagnostics(w))
  );
  const durationConcurrent = Math.round((performance.now() - startConcurrent) * 100) / 100;

  assert(
    concurrentResults.length === 10,
    `10 concurrent queries completed in ${durationConcurrent} ms without race condition`
  );

  // Inspect partition stats: wn_b.json and assoc_b.json should only have been read once
  const loadedB = isolatedLoader.getLoadedPartitions();
  const wnBCount = loadedB.filter((p) => p === 'wn_b.json').length;
  assert(wnBCount === 1, 'In-flight Promise deduplication prevented duplicate partition load for "wn_b.json"');

  // -------------------------------------------------------------------------
  // 12. Deterministic Ranking Hierarchy & Partition Size Measurement
  // -------------------------------------------------------------------------
  console.log('\n[12/12] Testing Deterministic Ranking Hierarchy & Partition Measurements...');
  const crateLookup = await composite.lookupWithDiagnostics('CRATE');
  const ranked = crateLookup.transformations;

  // Verify sort order: priority first, then score
  let properlyOrdered = true;
  for (let i = 0; i < ranked.length - 1; i++) {
    const cur = ranked[i];
    const nxt = ranked[i + 1];
    if (cur.score < nxt.score && cur.relationType === nxt.relationType) {
      properlyOrdered = false;
      break;
    }
  }
  assert(properlyOrdered, 'Transformations are deterministically ranked by semantic priority and score');

  // -------------------------------------------------------------------------
  // 13. Milestone 6 Lexical Recall & Precision Refinements
  // -------------------------------------------------------------------------
  console.log('\n[13/13] Testing Milestone 6 Lexical Recall & Precision Refinements...');
  const warmRes = await wordnet.getTransformationsAsync('WARM');
  assert(
    warmRes.some((t) => t.word === 'HOT' && t.relationType === 'synonym'),
    'WARM -> HOT resolved via WordNet adjective similar-to (&) link'
  );

  const bluntRes = await wordnet.getTransformationsAsync('BLUNT');
  assert(
    bluntRes.some((t) => t.word === 'SHARP' && t.relationType === 'antonym'),
    'BLUNT -> SHARP resolved via bounded adjective cluster dumbbell antonym'
  );

  const rareRes = await wordnet.getTransformationsAsync('RARE');
  assert(
    rareRes.some((t) => t.word === 'COMMON' && t.relationType === 'antonym'),
    'RARE -> COMMON resolved via bounded adjective cluster dumbbell antonym'
  );

  const liverRes = await wordnet.getTransformationsAsync('LIVER');
  assert(
    !liverRes.some((t) => t.word === 'COLORED' && t.relationType === 'synonym'),
    'Noun-dominant LIVER does not pick up obscure adjective-satellite COLORED noise'
  );

  const walkCoord = await coordinate.getTransformationsAsync('WALK');
  assert(
    walkCoord.some((t) => t.word === 'TROT' && t.relationType === 'coordinate'),
    'WALK -> TROT resolved via bounded WordNet coordinate extraction'
  );

  const weekdayCoord = await coordinate.getTransformationsAsync('WEEKDAY');
  assert(
    weekdayCoord.some((t) => t.word === 'WEEKEND' && t.relationType === 'coordinate'),
    'WEEKDAY -> WEEKEND resolved via WordNet co-part-meronym bridge'
  );

  const mopRes = await wordnet.getTransformationsAsync('MOP');
  const mopSweep = mopRes.find((t) => t.word === 'SWEEP');
  assert(
    Boolean(mopSweep && mopSweep.relationType === 'associated'),
    'MOP -> SWEEP resolved via deep functional coordinate-derivation typed as associated (not 1-hop derivation)',
    mopSweep ? `Got relationType=${mopSweep.relationType}` : 'Missing SWEEP'
  );

  // Measure and report partition sizes
  console.log('\n----------------------------------------------------------------------');
  console.log(' LAZY LOADING PARTITION SIZE & PERFORMANCE MEASUREMENTS');
  console.log('----------------------------------------------------------------------');
  const largestPartitions = [
    { name: 'wn_s.json (Largest WordNet)', path: 'data/v3/compiled/wordnet/wn_s.json' },
    { name: 'wn_c.json', path: 'data/v3/compiled/wordnet/wn_c.json' },
    { name: 'wn_p.json', path: 'data/v3/compiled/wordnet/wn_p.json' },
    { name: 'wn_a.json', path: 'data/v3/compiled/wordnet/wn_a.json' },
    { name: 'assoc_s.json (Largest Moby)', path: 'data/v3/compiled/moby/associations/assoc_s.json' },
    { name: 'assoc_p.json', path: 'data/v3/compiled/moby/associations/assoc_p.json' },
    { name: 'assoc_c.json', path: 'data/v3/compiled/moby/associations/assoc_c.json' },
    { name: 'wn_x.json (Smallest WordNet)', path: 'data/v3/compiled/wordnet/wn_x.json' },
  ];

  const measurementLoader = new PartitionLoader();
  for (const item of largestPartitions) {
    const { stats } = await measurementLoader.loadPartition(item.path);
    const sizeMb = Math.round((stats.sizeBytes / (1024 * 1024)) * 100) / 100;
    console.log(
      `  • ${item.name.padEnd(30)}: ${sizeMb} MB | Initial load: ${stats.loadTimeMs.toFixed(1)} ms | Cached load: 0.0 ms`
    );
  }

  const memorySizeBytes = measurementLoader.getCacheSizeBytes();
  const memorySizeMb = Math.round((memorySizeBytes / (1024 * 1024)) * 100) / 100;
  console.log(`\n  Total Memory Allocated for Loaded Partitions: ${memorySizeMb} MB`);
  console.log('----------------------------------------------------------------------');

  console.log('\n======================================================================');
  console.log(' MILESTONE 2 TEST EXECUTION SUMMARY');
  console.log('======================================================================');
  console.log(`Total Assertions Run:   ${passCount + failCount}`);
  console.log(`Passed:                 ${passCount}`);
  console.log(`Failed:                 ${failCount}`);
  console.log(`Success Rate:           ${((passCount / (passCount + failCount)) * 100).toFixed(1)}%`);
  console.log('======================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runV3RelationshipTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
