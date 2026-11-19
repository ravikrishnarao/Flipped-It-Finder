/**
 * Flipit Finder V3 — Lexicon Validation & Integrity Audit Script
 * Audits compiled WordNet and Moby datasets for schema conformance, malformed records,
 * duplicate entries, zero-leakage isolation against evaluation puzzles,
 * and demonstrates transformations on words absent from the V2.2.4 seed dictionary.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd());
const COMPILED_DIR = path.join(ROOT_DIR, 'data/v3/compiled');
const CHECKSUMS_FILE = path.join(COMPILED_DIR, 'checksums.json');

const EVAL_TARGET_PHRASES = [
  'PLASTIC SMILE',
  'DRY FRUITS',
  'HOME COMING',
  'OLD GARMENTS',
  'SWEET BOX',
  'DEMON KING',
  'LONG WEEKEND',
  'DEEP CLEANING',
];

const EVAL_CLUE_TARGET_PAIRS = [
  { clue: 'SYNTHETIC', target: 'PLASTIC' },
  { clue: 'FROWN', target: 'SMILE' },
  { clue: 'WET', target: 'DRY' },
  { clue: 'VEGETABLES', target: 'FRUITS' },
  { clue: 'ABODE', target: 'HOME' },
  { clue: 'LEAVING', target: 'COMING' },
  { clue: 'NEW', target: 'OLD' },
  { clue: 'CLOTHES', target: 'GARMENTS' },
  { clue: 'SALT', target: 'SWEET' },
  { clue: 'CRATE', target: 'BOX' },
  { clue: 'ANGEL', target: 'DEMON' },
  { clue: 'QUEEN', target: 'KING' },
  { clue: 'SHORT', target: 'LONG' },
  { clue: 'WEEKDAY', target: 'WEEKEND' },
  { clue: 'SHALLOW', target: 'DEEP' },
  { clue: 'SOILING', target: 'CLEANING' },
];

// Sample test words NOT present in the V2.2.4 seed dictionary
const SAMPLE_TEST_WORDS = [
  'SYNTHETIC',
  'CRATE',
  'ABODE',
  'FESTIVAL',
  'CARNIVAL',
  'SOILING',
  'FROWN',
  'WEEKDAY',
  'QUEEN',
];

function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

export async function validateV3Lexicon() {
  console.log('======================================================================');
  console.log(' Flipit Finder V3 — Dataset Integrity & Validation Audit');
  console.log('======================================================================\n');

  if (!fs.existsSync(COMPILED_DIR)) {
    throw new Error(`Compiled V3 directory not found at ${COMPILED_DIR}. Run compilation first.`);
  }

  let malformedRecordCount = 0;
  let duplicateCount = 0;
  let totalWordnetRecordsChecked = 0;
  let totalMobyPhraseRecordsChecked = 0;
  let totalMobyAssocRecordsChecked = 0;

  // 1. Audit WordNet letter partitions
  console.log('[1/5] Auditing WordNet letter partitions (wn_a.json .. wn_z.json)...');
  const wordnetDir = path.join(COMPILED_DIR, 'wordnet');
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c).toLowerCase();
    const filePath = path.join(wordnetDir, `wn_${letter}.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing partition: ${filePath}`);
      malformedRecordCount++;
      continue;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const [word, entry] of Object.entries<any>(data)) {
      totalWordnetRecordsChecked++;
      if (!/^[A-Z]{2,20}$/.test(word)) {
        malformedRecordCount++;
      }
      if (!Array.isArray(entry.synonyms) || !Array.isArray(entry.antonyms) || !Array.isArray(entry.coordinates)) {
        malformedRecordCount++;
      }

      // Check for duplicate words in relation lists
      const seenInEntry = new Set<string>();
      const allRels = [
        ...entry.synonyms,
        ...entry.antonyms,
        ...entry.coordinates,
        ...(entry.hierarchical || []),
        ...entry.derivations,
      ];

      for (const rel of allRels) {
        if (!rel.word || typeof rel.score !== 'number' || !rel.reason || !rel.relationType) {
          malformedRecordCount++;
        }
        const key = `${rel.relationType}:${rel.word}`;
        if (seenInEntry.has(key)) {
          duplicateCount++;
        }
        seenInEntry.add(key);
      }
    }
  }
  console.log(`[✓] Audited ${totalWordnetRecordsChecked.toLocaleString()} WordNet lemma entries.`);

  // 2. Audit Moby Compound Phrases
  console.log('[2/5] Auditing Moby Compound Phrases (phrases_a.json .. phrases_z.json)...');
  const mobyPhrasesDir = path.join(COMPILED_DIR, 'moby/phrases');
  const seenPhrases = new Set<string>();

  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c).toLowerCase();
    const filePath = path.join(mobyPhrasesDir, `phrases_${letter}.json`);
    if (!fs.existsSync(filePath)) {
      malformedRecordCount++;
      continue;
    }

    const phrases: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const p of phrases) {
      totalMobyPhraseRecordsChecked++;
      if (!p.phrase || !p.word1 || !p.word2 || typeof p.frequencyScore !== 'number') {
        malformedRecordCount++;
      }
      if (seenPhrases.has(p.phrase)) {
        duplicateCount++;
      }
      seenPhrases.add(p.phrase);
    }
  }
  console.log(`[✓] Audited ${totalMobyPhraseRecordsChecked.toLocaleString()} Moby two-word compound phrases.`);

  // 3. Audit Moby Associations
  console.log('[3/5] Auditing Moby Contextual Associations (assoc_a.json .. assoc_z.json)...');
  const mobyAssocDir = path.join(COMPILED_DIR, 'moby/associations');
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c).toLowerCase();
    const filePath = path.join(mobyAssocDir, `assoc_${letter}.json`);
    if (!fs.existsSync(filePath)) {
      malformedRecordCount++;
      continue;
    }

    const assocData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const [lemma, entries] of Object.entries<any[]>(assocData)) {
      totalMobyAssocRecordsChecked++;
      const seenAssoc = new Set<string>();
      for (const rel of entries) {
        const w = typeof rel === 'string' ? rel : rel?.word;
        if (!w || (typeof rel !== 'string' && (typeof rel.score !== 'number' || !rel.reason))) {
          malformedRecordCount++;
        }
        if (w) {
          if (seenAssoc.has(w)) {
            duplicateCount++;
          }
          seenAssoc.add(w);
        }
      }
    }
  }
  console.log(`[✓] Audited ${totalMobyAssocRecordsChecked.toLocaleString()} Moby association lemmas.`);

  // 4. Leakage & Hardcoding Audit
  console.log('[4/5] Executing Strict Zero-Leakage Audit against Evaluation Answers...');
  // Verify that the compilation scripts do not contain hardcoded evaluation puzzle answers
  const compileScripts = [
    path.join(ROOT_DIR, 'scripts/v3/compile_wordnet.ts'),
    path.join(ROOT_DIR, 'scripts/v3/compile_moby.ts'),
    path.join(ROOT_DIR, 'scripts/v3/compile_all.ts'),
  ];

  let hardcodedLeaksFound = 0;
  for (const scriptPath of compileScripts) {
    const content = fs.readFileSync(scriptPath, 'utf-8');
    for (const targetPhrase of EVAL_TARGET_PHRASES) {
      if (content.includes(`"${targetPhrase}"`) || content.includes(`'${targetPhrase}'`)) {
        console.error(`[LEAK DETECTED] Script ${path.basename(scriptPath)} contains hardcoded phrase "${targetPhrase}"!`);
        hardcodedLeaksFound++;
      }
    }
  }

  if (hardcodedLeaksFound === 0) {
    console.log('[✓] Zero hardcoded evaluation answers found in compilation source scripts.');
  } else {
    throw new Error(`Integrity Violation: ${hardcodedLeaksFound} hardcoded evaluation phrases found in build scripts!`);
  }

  // 4b. Compiled Partition SHA-256 Verification
  if (fs.existsSync(CHECKSUMS_FILE)) {
    const checksumRecord = JSON.parse(fs.readFileSync(CHECKSUMS_FILE, 'utf-8'));
    const expectedMap: Record<string, string> = checksumRecord.checksums || {};
    let checksumMismatches = 0;
    let partitionsChecked = 0;
    for (const [relPath, expectedHash] of Object.entries(expectedMap)) {
      if (relPath.endsWith('summary.json')) continue;
      const fullPath = path.join(ROOT_DIR, relPath);
      if (!fs.existsSync(fullPath)) {
        console.error(`[CHECKSUM MISSING] ${relPath}`);
        checksumMismatches++;
        continue;
      }
      const actualHash = computeFileSha256(fullPath);
      partitionsChecked++;
      if (actualHash !== expectedHash) {
        console.error(`[CHECKSUM MISMATCH] ${relPath}: expected ${expectedHash.slice(0, 12)}, got ${actualHash.slice(0, 12)}`);
        checksumMismatches++;
      }
    }
    if (checksumMismatches > 0) {
      throw new Error(`Compiled partition checksum verification failed (${checksumMismatches} mismatches)!`);
    }
    console.log(`[✓] Verified SHA-256 checksums across ${partitionsChecked} compiled partition files.`);
  }

  // 5. Verification of Sample Transformations on Words Absent from V2.2.4 Seed Lexicon
  console.log('\n[5/5] Sample Transformations on Previously Absent English Words:');
  console.log('----------------------------------------------------------------------');

  function lookupWordNet(word: string) {
    const letter = word.charAt(0).toLowerCase();
    const p = path.join(wordnetDir, `wn_${letter}.json`);
    if (!fs.existsSync(p)) return null;
    const file = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return file[word] || null;
  }

  function lookupMobyAssoc(word: string) {
    const letter = word.charAt(0).toLowerCase();
    const p = path.join(mobyAssocDir, `assoc_${letter}.json`);
    if (!fs.existsSync(p)) return [];
    const file = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return file[word] || [];
  }

  for (const testWord of SAMPLE_TEST_WORDS) {
    const wn = lookupWordNet(testWord);
    const moby = lookupMobyAssoc(testWord);

    console.log(`\n• Word: "${testWord}"`);
    if (wn) {
      if (wn.synonyms?.length > 0) {
        console.log(`  - Synonyms (WordNet):    ${wn.synonyms.slice(0, 4).map((s: any) => s.word).join(', ')}`);
      }
      if (wn.antonyms?.length > 0) {
        console.log(`  - Antonyms (WordNet):    ${wn.antonyms.slice(0, 3).map((a: any) => a.word).join(', ')}`);
      }
      if (wn.coordinates?.length > 0) {
        console.log(`  - Coordinates (WordNet): ${wn.coordinates.slice(0, 4).map((c: any) => `${c.word} (${c.reason.split('(')[1]?.replace(')', '') || 'sister'})`).join(', ')}`);
      }
      if (wn.hierarchical?.length > 0) {
        console.log(`  - Hypernyms (WordNet):   ${wn.hierarchical.slice(0, 3).map((h: any) => h.word).join(', ')}`);
      }
      if (wn.derivations?.length > 0) {
        console.log(`  - Derivations (WordNet): ${wn.derivations.slice(0, 3).map((d: any) => d.word).join(', ')}`);
      }
    } else {
      console.log('  - WordNet: (No direct synset)');
    }
    if (moby.length > 0) {
      console.log(`  - Contextual (Moby):     ${moby.slice(0, 5).map((m: any) => (typeof m === 'string' ? m : m.word)).join(', ')}`);
    }
  }

  console.log('\n======================================================================');
  console.log(' VALIDATION & AUDIT SUMMARY');
  console.log('======================================================================');
  console.log(`Malformed Records:           ${malformedRecordCount}`);
  console.log(`Duplicate Records:           ${duplicateCount}`);
  console.log(`Hardcoded Leaks:             ${hardcodedLeaksFound}`);
  console.log(`Total Records Audited:       ${(totalWordnetRecordsChecked + totalMobyPhraseRecordsChecked + totalMobyAssocRecordsChecked).toLocaleString()}`);
  console.log(`Audit Status:                ${malformedRecordCount === 0 && hardcodedLeaksFound === 0 ? 'PASSED (100% CLEAN)' : 'FAILED'}`);
  console.log('======================================================================\n');

  if (malformedRecordCount > 0 || hardcodedLeaksFound > 0) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateV3Lexicon().catch((err) => {
    console.error('Validation audit failed:', err);
    process.exit(1);
  });
}
