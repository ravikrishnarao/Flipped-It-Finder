/**
 * Flipit Finder V3 — WordNet 3.0 Collocation Compiler
 * Ingests multi-word expressions from Princeton WordNet 3.0 index files (noun, adj, verb),
 * extracts established two-word collocations and compound nouns, and emits letter-partitioned JSON files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT_DIR = path.resolve(process.cwd());
const WORDNET_DICT_DIR = path.join(ROOT_DIR, 'data/v3/raw/wordnet/dict');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data/v3/compiled/wordnet/collocations');

export interface CompiledCollocationRecord {
  phrase: string;
  word1: string;
  word2: string;
  frequencyScore: number;
  category: string;
  alternateForms: string[];
}

export async function compileWordNetCollocations() {
  console.log('======================================================================');
  console.log(' Flipit Finder V3: Compiling Princeton WordNet 3.0 Collocations');
  console.log('======================================================================');

  if (!fs.existsSync(WORDNET_DICT_DIR)) {
    throw new Error(`WordNet dict directory not found at ${WORDNET_DICT_DIR}. Run download script first.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const indexFiles = ['index.noun', 'index.adj', 'index.verb'];
  const collocations = new Map<string, CompiledCollocationRecord>();
  const singleWordNouns = new Set<string>();

  for (const file of indexFiles) {
    const filePath = path.join(WORDNET_DICT_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line || line.startsWith('  ')) continue;
      const lemma = line.split(' ')[0];
      if (!lemma) continue;

      if (lemma.includes('_')) {
        const parts = lemma.split('_');
        // Only process genuine two-word expressions
        if (
          parts.length === 2 &&
          /^[a-zA-Z]{2,20}$/.test(parts[0]) &&
          /^[a-zA-Z]{2,20}$/.test(parts[1])
        ) {
          const w1 = parts[0].toUpperCase();
          const w2 = parts[1].toUpperCase();
          const phrase = `${w1} ${w2}`;

          if (!collocations.has(phrase)) {
            const alternateForms = [`${w1}${w2}`, `${w1}-${w2}`];
            collocations.set(phrase, {
              phrase,
              word1: w1,
              word2: w2,
              frequencyScore: 0.96, // Heuristic indicator of established dictionary lexicalization
              category: 'wordnet-collocation',
              alternateForms,
            });
          }
        }
      } else if (file === 'index.noun' && /^[a-z]{3,15}$/.test(lemma)) {
        singleWordNouns.add(lemma.toLowerCase());
      }
    }
  }

  // Decompose single-word closed compound nouns (e.g. sunlight -> sun + light)
  const falseSuffixes = new Set([
    'ness', 'ment', 'tion', 'sion', 'able', 'ible', 'less', 'ship',
    'hood', 'ward', 'like', 'wise', 'itis', 'osis', 'ling', 'ster', 'ance', 'ence',
  ]);
  const falsePrefixes = new Set([
    'anti', 'auto', 'para', 'mono', 'poly', 'semi', 'mega', 'micro',
    'hyper', 'super', 'trans', 'inter', 'intra', 'extra', 'ultra',
  ]);

  let closedCompoundCount = 0;
  for (const word of singleWordNouns) {
    if (word.length < 6) continue;
    for (let i = 3; i <= word.length - 3; i++) {
      const p1 = word.slice(0, i);
      const p2 = word.slice(i);
      if (falsePrefixes.has(p1) || falseSuffixes.has(p2)) continue;
      if (singleWordNouns.has(p1) && singleWordNouns.has(p2)) {
        const w1 = p1.toUpperCase();
        const w2 = p2.toUpperCase();
        const phrase = `${w1} ${w2}`;
        if (!collocations.has(phrase)) {
          collocations.set(phrase, {
            phrase,
            word1: w1,
            word2: w2,
            frequencyScore: 0.95,
            category: 'wordnet-compound',
            alternateForms: [word.toUpperCase(), `${w1}-${w2}`],
          });
          closedCompoundCount++;
        }
      }
    }
  }

  console.log(`[✓] Extracted ${collocations.size} expressions (including ${closedCompoundCount} closed compounds) from WordNet 3.0.`);

  // Partition by Word 1 initial letter
  const buckets = new Map<string, CompiledCollocationRecord[]>();
  for (let c = 65; c <= 90; c++) {
    buckets.set(String.fromCharCode(c), []);
  }

  for (const record of collocations.values()) {
    const initial = record.word1.charAt(0);
    const bucket = buckets.get(initial);
    if (bucket) {
      bucket.push(record);
    }
  }

  let totalBytes = 0;
  for (const [letter, records] of buckets.entries()) {
    const filename = `collocations_${letter.toLowerCase()}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    const jsonStr = JSON.stringify(records);
    fs.writeFileSync(filePath, jsonStr, 'utf-8');
    totalBytes += Buffer.byteLength(jsonStr, 'utf-8');
  }

  const summary = {
    compiledAt: new Date().toISOString(),
    totalCollocations: collocations.size,
    totalCompiledMB: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  console.log(`[✓] Emitted 26 letter partitions into data/v3/compiled/wordnet/collocations/ (${summary.totalCompiledMB} MB).`);
  console.log('======================================================================\n');

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileWordNetCollocations().catch((err) => {
    console.error('WordNet collocation compilation failed:', err);
    process.exit(1);
  });
}
