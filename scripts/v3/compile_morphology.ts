/**
 * Flipit Finder V3 — WordNet Morphology Exception Compiler
 * Parses Princeton WordNet 3.0 exception lists (.exc files) and compiles
 * an offline fast lookup table for irregular English nouns, verbs, and adjectives.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd());
const WORDNET_DICT_DIR = path.join(ROOT_DIR, 'data/v3/raw/wordnet/dict');
const OUTPUT_FILE = path.join(ROOT_DIR, 'data/v3/compiled/wordnet/morphology_exceptions.json');

export interface CompiledMorphologyData {
  compiledAt: string;
  totalEntries: number;
  exceptions: Record<string, string[]>;
}

export function compileMorphologyExceptions(): CompiledMorphologyData {
  console.log('======================================================================');
  console.log(' Flipit Finder V3: Compiling WordNet Morphology Exception Lists');
  console.log('======================================================================');

  if (!fs.existsSync(WORDNET_DICT_DIR)) {
    throw new Error(`WordNet dict directory not found at ${WORDNET_DICT_DIR}`);
  }

  const exceptionFiles = ['noun.exc', 'verb.exc', 'adj.exc', 'adv.exc'];
  const exceptions: Record<string, string[]> = {};

  for (const filename of exceptionFiles) {
    const filePath = path.join(WORDNET_DICT_DIR, filename);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const inflected = parts[0].toUpperCase().replace(/[^A-Z]/g, '');
        if (!inflected || inflected.length < 2) continue;

        const baseBands = parts.slice(1).map((b) => b.toUpperCase().replace(/[^A-Z]/g, '')).filter(Boolean);
        if (baseBands.length === 0) continue;

        if (!exceptions[inflected]) {
          exceptions[inflected] = [];
        }
        for (const base of baseBands) {
          if (!exceptions[inflected].includes(base)) {
            exceptions[inflected].push(base);
          }
        }
      }
    }
  }

  const totalEntries = Object.keys(exceptions).length;
  const result: CompiledMorphologyData = {
    compiledAt: new Date().toISOString(),
    totalEntries,
    exceptions,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`[✓] Compiled ${totalEntries} irregular morphology mappings -> ${OUTPUT_FILE}`);
  console.log('======================================================================\n');

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileMorphologyExceptions();
}
