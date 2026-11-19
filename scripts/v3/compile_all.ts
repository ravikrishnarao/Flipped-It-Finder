/**
 * Flipit Finder V3 — Master Compilation Pipeline
 * Coordinates the offline compilation of Princeton WordNet 3.0 and Moby Lexicon,
 * computes SHA-256 integrity checksums for all emitted artifacts,
 * and outputs comprehensive dataset statistics.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileMoby } from './compile_moby.ts';
import { compileWordNet } from './compile_wordnet.ts';
import { compileWordNetCollocations } from './compile_wordnet_collocations.ts';

const ROOT_DIR = path.resolve(process.cwd());
const COMPILED_DIR = path.join(ROOT_DIR, 'data/v3/compiled');
const CHECKSUMS_FILE = path.join(COMPILED_DIR, 'checksums.json');

function computeFileSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

export async function compileAll() {
  const startTime = Date.now();
  console.log('======================================================================');
  console.log(' Flipit Finder V3 — Starting Master Offline Compilation Pipeline');
  console.log('======================================================================\n');

  // 1. Run WordNet Compilation
  const wnSummary = await compileWordNet();
  console.log('\n');

  // 2. Run WordNet Collocations Compilation
  const wnCollocSummary = await compileWordNetCollocations();
  console.log('\n');

  // 3. Run Moby Compilation
  const mobySummary = await compileMoby();
  console.log('\n');

  // 3. Compute Checksums for all compiled artifacts
  console.log('[3/3] Generating SHA-256 cryptographic digests for all compiled artifacts...');
  const checksums: Record<string, string> = {};

  function scanAndDigest(dir: string, relBase: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        scanAndDigest(fullPath, relPath);
      } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'checksums.json') {
        checksums[relPath] = computeFileSha256(fullPath);
      }
    }
  }

  scanAndDigest(COMPILED_DIR, 'data/v3/compiled');

  const checksumsRecord = {
    generatedAt: new Date().toISOString(),
    totalArtifacts: Object.keys(checksums).length,
    checksums,
  };

  fs.writeFileSync(CHECKSUMS_FILE, JSON.stringify(checksumsRecord, null, 2), 'utf-8');

  const totalTimeSeconds = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;

  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MASTER COMPILATION COMPLETE');
  console.log('======================================================================');
  console.log(`Execution Time:               ${totalTimeSeconds}s`);
  console.log(`Total Compiled Artifacts:     ${Object.keys(checksums).length} files`);
  console.log(`Princeton WordNet 3.0:`);
  console.log(`  - Raw Synsets Parsed:       ${wnSummary.totalRawSynsets.toLocaleString()}`);
  console.log(`  - Emitted Lemmas:           ${wnSummary.totalEmittedWords.toLocaleString()}`);
  console.log(`  - Direct Antonyms:          ${wnSummary.antonymCount.toLocaleString()}`);
  console.log(`  - Direct Synonyms:          ${wnSummary.synonymCount.toLocaleString()}`);
  console.log(`  - Derivations:              ${wnSummary.derivationCount.toLocaleString()}`);
  console.log(`  - Bounded Coordinates:      ${wnSummary.coordinateCount.toLocaleString()}`);
  console.log(`  - Direct Hierarchical:      ${wnSummary.hierarchicalCount.toLocaleString()}`);
  console.log(`  - Two-Word Collocations:    ${wnCollocSummary.totalCollocations.toLocaleString()} (${wnCollocSummary.totalCompiledMB} MB)`);
  console.log(`  - Compiled Size:            ${wnSummary.totalCompiledMB} MB`);
  console.log(`Moby Lexicon Project:`);
  console.log(`  - Two-Word Compounds:       ${mobySummary.validTwoWordPhrases.toLocaleString()} (${mobySummary.totalPhraseMB} MB)`);
  console.log(`  - Contextual Assoc Lemmas:  ${mobySummary.indexedAssociationLemmas.toLocaleString()} (${mobySummary.totalAssocLinks.toLocaleString()} links, ${mobySummary.totalAssocMB} MB)`);
  console.log(`Integrity Checksums Saved to: data/v3/compiled/checksums.json`);
  console.log('======================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileAll().catch((err) => {
    console.error('Master compilation failed:', err);
    process.exit(1);
  });
}
