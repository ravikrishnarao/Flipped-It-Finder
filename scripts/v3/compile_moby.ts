/**
 * Flipit Finder V3 — Moby Lexicon Compiler
 * Ingests Moby Thesaurus II (mthesaur.txt) and Moby Compound Words (compound.txt),
 * normalizes two-word expressions, extracts contextual associations,
 * applies frequency/relevance filtering, and emits compact letter-partitioned JSON files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const ROOT_DIR = path.resolve(process.cwd());
const RAW_MOBY_DIR = path.join(ROOT_DIR, 'data/v3/raw/moby');
const OUTPUT_PHRASES_DIR = path.join(ROOT_DIR, 'data/v3/compiled/moby/phrases');
const OUTPUT_ASSOC_DIR = path.join(ROOT_DIR, 'data/v3/compiled/moby/associations');

export interface CompiledPhraseRecord {
  phrase: string;
  word1: string;
  word2: string;
  frequencyScore: number;
  category: string;
  alternateForms: string[];
}

export interface MobyAssociationEntry {
  word: string;
  score: number;
  reason: string;
  relationType: 'associated' | 'contextual';
  source: string;
}

function isValidSingleWord(token: string): boolean {
  return /^[A-Z]{2,20}$/.test(token);
}

export async function compileMoby() {
  console.log('======================================================================');
  console.log(' Flipit Finder V3: Compiling Moby Lexicon (Compounds & Thesaurus)');
  console.log('======================================================================');

  const compoundFile = path.join(RAW_MOBY_DIR, 'compound.txt');
  const thesaurusFile = path.join(RAW_MOBY_DIR, 'mthesaur.txt');

  if (!fs.existsSync(compoundFile) || !fs.existsSync(thesaurusFile)) {
    throw new Error(`Missing raw Moby files in ${RAW_MOBY_DIR}. Run download script first.`);
  }

  fs.mkdirSync(OUTPUT_PHRASES_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_ASSOC_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // 1. Compile Moby Compound Words (compound.txt)
  // -------------------------------------------------------------------------
  console.log('[1/4] Streaming and parsing Moby Compound Words (compound.txt)...');
  const phraseMap = new Map<string, CompiledPhraseRecord>();

  const compoundStream = fs.createReadStream(compoundFile, { encoding: 'utf-8' });
  const compoundRl = readline.createInterface({ input: compoundStream, crlfDelay: Infinity });

  let rawCompoundLines = 0;
  let validTwoWordPhrases = 0;

  for await (const line of compoundRl) {
    rawCompoundLines++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Normalize separators (hyphens, spaces) to single space
    const cleanUpper = trimmed.toUpperCase().replace(/['"`]/g, '');
    const tokens = cleanUpper.split(/[\s\-]+/).filter(Boolean);

    // Only process genuine two-word phrases where both tokens are valid English words
    if (tokens.length === 2 && isValidSingleWord(tokens[0]) && isValidSingleWord(tokens[1])) {
      const [w1, w2] = tokens;
      const normalizedPhrase = `${w1} ${w2}`;

      if (!phraseMap.has(normalizedPhrase)) {
        const alternateForms: string[] = [];
        const closedForm = `${w1}${w2}`;
        const hyphenatedForm = `${w1}-${w2}`;

        if (cleanUpper.includes('-')) {
          alternateForms.push(hyphenatedForm);
        }
        alternateForms.push(closedForm);

        phraseMap.set(normalizedPhrase, {
          phrase: normalizedPhrase,
          word1: w1,
          word2: w2,
          frequencyScore: 0.95,
          category: 'moby-compound',
          alternateForms: Array.from(new Set(alternateForms)),
        });
        validTwoWordPhrases++;
      }
    }
  }

  console.log(`[✓] Parsed ${rawCompoundLines} compound lines -> ${validTwoWordPhrases} valid two-word expressions.`);

  // Partition phrases by word1 initial letter (A-Z)
  console.log('[2/4] Emitting partitioned phrase files (phrases_a.json .. phrases_z.json)...');
  const phraseBuckets = new Map<string, CompiledPhraseRecord[]>();
  for (let c = 65; c <= 90; c++) {
    phraseBuckets.set(String.fromCharCode(c), []);
  }

  for (const record of phraseMap.values()) {
    const initial = record.word1.charAt(0);
    const bucket = phraseBuckets.get(initial);
    if (bucket) {
      bucket.push(record);
    }
  }

  let totalPhraseBytes = 0;
  for (const [letter, records] of phraseBuckets.entries()) {
    const filename = `phrases_${letter.toLowerCase()}.json`;
    const filePath = path.join(OUTPUT_PHRASES_DIR, filename);
    const jsonStr = JSON.stringify(records);
    fs.writeFileSync(filePath, jsonStr, 'utf-8');
    totalPhraseBytes += Buffer.byteLength(jsonStr, 'utf-8');
  }

  // -------------------------------------------------------------------------
  // 2. Compile Moby Thesaurus II (mthesaur.txt)
  // -------------------------------------------------------------------------
  console.log('[3/4] Streaming and parsing Moby Thesaurus II (mthesaur.txt)...');
  const thesaurusStream = fs.createReadStream(thesaurusFile, { encoding: 'utf-8' });
  const thesaurusRl = readline.createInterface({ input: thesaurusStream, crlfDelay: Infinity });

  const assocMap = new Map<string, string[]>();
  let rawThesaurusRoots = 0;
  let totalAssocLinks = 0;

  for await (const line of thesaurusRl) {
    rawThesaurusRoots++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(',');
    if (parts.length < 2) continue;

    const rootWord = parts[0].trim().toUpperCase();
    if (!isValidSingleWord(rootWord)) continue;

    const relatedEntries: string[] = [];
    const seenWords = new Set<string>([rootWord]);

    for (let i = 1; i < parts.length; i++) {
      const candidate = parts[i].trim().toUpperCase();
      if (isValidSingleWord(candidate) && !seenWords.has(candidate)) {
        seenWords.add(candidate);
        relatedEntries.push(candidate);
        totalAssocLinks++;

        // Bound to top 60 strongest single-word associations per root lemma
        if (relatedEntries.length >= 60) break;
      }
    }

    if (relatedEntries.length > 0) {
      assocMap.set(rootWord, relatedEntries);
    }
  }

  console.log(`[✓] Parsed ${rawThesaurusRoots} thesaurus roots -> ${assocMap.size} indexed lemmas with ${totalAssocLinks} contextual links.`);

  // Partition associations by initial letter (A-Z)
  console.log('[4/4] Emitting partitioned association files (assoc_a.json .. assoc_z.json)...');
  const assocBuckets = new Map<string, Record<string, string[]>>();
  for (let c = 65; c <= 90; c++) {
    assocBuckets.set(String.fromCharCode(c), {});
  }

  for (const [word, entries] of assocMap.entries()) {
    const initial = word.charAt(0);
    const bucket = assocBuckets.get(initial);
    if (bucket) {
      bucket[word] = entries;
    }
  }

  let totalAssocBytes = 0;
  for (const [letter, records] of assocBuckets.entries()) {
    const filename = `assoc_${letter.toLowerCase()}.json`;
    const filePath = path.join(OUTPUT_ASSOC_DIR, filename);
    const jsonStr = JSON.stringify(records);
    fs.writeFileSync(filePath, jsonStr, 'utf-8');
    totalAssocBytes += Buffer.byteLength(jsonStr, 'utf-8');
  }

  const mobySummary = {
    compiledAt: new Date().toISOString(),
    rawCompoundLines,
    validTwoWordPhrases,
    totalPhraseMB: Math.round((totalPhraseBytes / (1024 * 1024)) * 100) / 100,
    rawThesaurusRoots,
    indexedAssociationLemmas: assocMap.size,
    totalAssocLinks,
    totalAssocMB: Math.round((totalAssocBytes / (1024 * 1024)) * 100) / 100,
  };

  fs.writeFileSync(
    path.join(ROOT_DIR, 'data/v3/compiled/moby/summary.json'),
    JSON.stringify(mobySummary, null, 2),
    'utf-8'
  );

  console.log('======================================================================');
  console.log(' Moby Compilation Complete!');
  console.log(` - Valid Two-Word Phrases:   ${validTwoWordPhrases} (${mobySummary.totalPhraseMB} MB)`);
  console.log(` - Contextual Assoc Lemmas:  ${assocMap.size} (${totalAssocLinks} links, ${mobySummary.totalAssocMB} MB)`);
  console.log('======================================================================');

  return mobySummary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileMoby().catch((err) => {
    console.error('Moby compilation failed:', err);
    process.exit(1);
  });
}
