/**
 * Flipit Finder V3 — Milestone 7A / 7A.1 Google Books English Ngrams Corpus Pilot Compiler
 *
 * Streams a limited, representative alphabetical subset of official Google Books
 * English Ngrams Version 3 (Release 20200217, CC BY 3.0) shards over HTTPS without
 * saving multi-gigabyte raw archives to disk.
 *
 * Key Methodology (Milestone 7A.1 Hardened):
 *   - Complete 8-shard lowercase unigram coverage (`1-00016` through `1-00023`) for A–Z.
 *   - Excludes POS-tagged lines (`_NOUN`, `_VERB_`, etc.) from primary frequency
 *     sums because 20200217 exports include overlapping tagged + untagged entries.
 *   - Consistent strict-lowercase normalization by default (`[a-z]{2,20}` for 1-grams
 *     and `[a-z]{2,20} [a-z]{2,20}` for 2-grams) so bigram numerators and lowercase-partitioned
 *     unigram marginals inhabit the same casing regime (with optional `--case-mode=fold-mixed`
 *     ablation mode for audit comparisons).
 *   - Filters tokens strictly against the general WordNet 3.0 + Moby + Morphology
 *     English vocabulary (zero puzzle-specific lists, zero benchmark hardcoding).
 *   - Computes year-stratified expectation E_strat, PMI, t-score, and directional
 *     forward-vs-reverse order ratio using official totalcounts-1 & totalcounts-2.
 *   - Deterministic intermediate stage payloads (`*.json`) free of elapsed-time fields,
 *     with lexicographically sorted Map keys, separate runtime telemetry (`*.meta.json`),
 *     and atomic temporary-file writes + fsync + rename throughout.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
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
  PILOT_DEFAULT_END_YEAR,
  PILOT_DEFAULT_START_YEAR,
  type AnnualTotalCounts,
  type CorpusThresholds,
} from '../../src/solver/v3/corpusStats.ts';
import { OfflineMorphologyEngine } from '../../src/solver/v3/morphology.ts';
import type { CorpusPartitionData, CorpusPartitionRecord } from '../../src/solver/v3/partitionedCorpusPlugin.ts';

export const GOOGLE_BOOKS_RELEASE = '20200217';
export const GOOGLE_BOOKS_BASE_URL =
  'https://storage.googleapis.com/books/ngrams/books/20200217/eng';
export const GOOGLE_BOOKS_LICENSE = 'CC BY 3.0 (http://creativecommons.org/licenses/by/3.0/)';

export const PILOT_1GRAM_SHARDS = [
  '1-00016-of-00024.gz', // a..c
  '1-00017-of-00024.gz', // c..e (completes C, full D, early E)
  '1-00018-of-00024.gz', // e..h
  '1-00019-of-00024.gz', // h..l (completes H, full I/J/K, early L)
  '1-00020-of-00024.gz', // l..o
  '1-00021-of-00024.gz', // o..r
  '1-00022-of-00024.gz', // r..t
  '1-00023-of-00024.gz', // t..z
] as const;

export const PILOT_2GRAM_SHARDS = [
  '2-00478-of-00589.gz', // O partition slice: office..oligo
  '2-00493-of-00589.gz', // P partition slice: pipin..play.2
  '2-00530-of-00589.gz', // S partition slice: skimmer..smiling
  '2-00543-of-00589.gz', // S partition slice: swallowing..tO
] as const;

export type CorpusCaseMode = 'strict-lowercase' | 'fold-mixed';

const ROOT_DIR = path.resolve(process.cwd());
const COMPILED_DIR = path.join(ROOT_DIR, 'data/v3/compiled');
const PILOT_OUT_DIR = path.join(COMPILED_DIR, 'corpus_pilot');
const STAGE_DIR = process.env.FLIPIT_STAGE_DIR || '/tmp/flipit_7a_pilot_stage';

interface ParsedArgs {
  stage: 'all' | 'unigrams' | 'bigrams';
  startYear: number;
  endYear: number;
  minCount: number;
  minPmi: number;
  minTScore: number;
  caseMode: CorpusCaseMode;
  shardsFilter: Set<string> | null;
  noCache: boolean;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const out: ParsedArgs = {
    stage: 'all',
    startYear: PILOT_DEFAULT_START_YEAR,
    endYear: PILOT_DEFAULT_END_YEAR,
    minCount: DEFAULT_PILOT_THRESHOLDS.minCount,
    minPmi: DEFAULT_PILOT_THRESHOLDS.minPmi,
    minTScore: DEFAULT_PILOT_THRESHOLDS.minTScore,
    caseMode: 'strict-lowercase',
    shardsFilter: null,
    noCache: false,
  };

  for (const a of args) {
    if (a.startsWith('--stage=')) {
      const s = a.slice('--stage='.length);
      if (s === 'all' || s === 'unigrams' || s === 'bigrams') out.stage = s;
    } else if (a.startsWith('--start-year=')) {
      out.startYear = Number.parseInt(a.slice('--start-year='.length), 10);
    } else if (a.startsWith('--end-year=')) {
      out.endYear = Number.parseInt(a.slice('--end-year='.length), 10);
    } else if (a.startsWith('--min-count=')) {
      out.minCount = Number.parseInt(a.slice('--min-count='.length), 10);
    } else if (a.startsWith('--min-pmi=')) {
      out.minPmi = Number.parseFloat(a.slice('--min-pmi='.length));
    } else if (a.startsWith('--min-tscore=')) {
      out.minTScore = Number.parseFloat(a.slice('--min-tscore='.length));
    } else if (a.startsWith('--case-mode=')) {
      const cm = a.slice('--case-mode='.length);
      if (cm === 'strict-lowercase' || cm === 'fold-mixed') {
        out.caseMode = cm;
      } else {
        throw new Error(`Unsupported --case-mode="${cm}". Expected strict-lowercase or fold-mixed.`);
      }
    } else if (a.startsWith('--shards=')) {
      out.shardsFilter = new Set(a.slice('--shards='.length).split(',').map((x) => x.trim()).filter(Boolean));
    } else if (a === '--no-cache') {
      out.noCache = true;
    }
  }
  return out;
}

/**
 * Atomic file write: write to process-unique `.tmp.${pid}.${runNonce}`, fsync fd,
 * close fd, then atomically rename into `targetPath`. Prevents partial reads and
 * concurrent write collisions.
 */
export function atomicWriteFileSync(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const nonce = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const tmpPath = `${targetPath}.tmp.${nonce}`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    const buf = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < buf.length) {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, targetPath);
}

export function sha256Buffer(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Build general English vocabulary strictly from existing V3 WordNet + Moby datasets
 * plus offline morphology base-lemma verification. Contains ZERO benchmark puzzle lists.
 */
function buildGeneralEnglishVocab(): {
  exactLexicon: Set<string>;
  morphology: OfflineMorphologyEngine;
} {
  const exactLexicon = new Set<string>();
  const morphology = new OfflineMorphologyEngine();

  const wnDir = path.join(COMPILED_DIR, 'wordnet');
  const wnCollocDir = path.join(COMPILED_DIR, 'wordnet/collocations');
  const mobyAssocDir = path.join(COMPILED_DIR, 'moby/associations');
  const mobyPhraseDir = path.join(COMPILED_DIR, 'moby/phrases');

  for (let c = 65; c <= 90; c++) {
    const l = String.fromCharCode(c).toLowerCase();

    const wnPath = path.join(wnDir, `wn_${l}.json`);
    if (fs.existsSync(wnPath)) {
      const data = JSON.parse(fs.readFileSync(wnPath, 'utf8'));
      for (const [key, entry] of Object.entries<any>(data)) {
        if (/^[A-Z]{2,20}$/.test(key)) exactLexicon.add(key);
        for (const field of ['synonyms', 'antonyms', 'coordinates', 'hierarchical', 'derivations']) {
          const list = entry?.[field];
          if (Array.isArray(list)) {
            for (const rel of list) {
              if (rel?.word && /^[A-Z]{2,20}$/.test(rel.word)) exactLexicon.add(rel.word);
            }
          }
        }
      }
    }

    const assocPath = path.join(mobyAssocDir, `assoc_${l}.json`);
    if (fs.existsSync(assocPath)) {
      const data = JSON.parse(fs.readFileSync(assocPath, 'utf8'));
      for (const [key, list] of Object.entries<any[]>(data)) {
        if (/^[A-Z]{2,20}$/.test(key)) exactLexicon.add(key);
        if (Array.isArray(list)) {
          for (const item of list) {
            const w = typeof item === 'string' ? item : item?.word;
            if (w && /^[A-Z]{2,20}$/.test(w)) exactLexicon.add(w);
          }
        }
      }
    }

    const collocPath = path.join(wnCollocDir, `collocations_${l}.json`);
    if (fs.existsSync(collocPath)) {
      const list = JSON.parse(fs.readFileSync(collocPath, 'utf8'));
      for (const rec of list) {
        if (rec?.word1 && /^[A-Z]{2,20}$/.test(rec.word1)) exactLexicon.add(rec.word1);
        if (rec?.word2 && /^[A-Z]{2,20}$/.test(rec.word2)) exactLexicon.add(rec.word2);
      }
    }

    const phrasePath = path.join(mobyPhraseDir, `phrases_${l}.json`);
    if (fs.existsSync(phrasePath)) {
      const list = JSON.parse(fs.readFileSync(phrasePath, 'utf8'));
      for (const rec of list) {
        if (rec?.word1 && /^[A-Z]{2,20}$/.test(rec.word1)) exactLexicon.add(rec.word1);
        if (rec?.word2 && /^[A-Z]{2,20}$/.test(rec.word2)) exactLexicon.add(rec.word2);
      }
    }
  }

  return { exactLexicon, morphology };
}

function isGeneralLexicalWord(
  word: string,
  exactLexicon: Set<string>,
  morphology: OfflineMorphologyEngine,
  cache: Map<string, boolean>
): boolean {
  const cached = cache.get(word);
  if (cached !== undefined) return cached;

  if (exactLexicon.has(word)) {
    cache.set(word, true);
    return true;
  }

  const morph = morphology.lemmatize(word);
  const valid = morph.baseLemmas.some((b) => exactLexicon.has(b));
  cache.set(word, valid);
  return valid;
}

interface StreamTelemetry {
  startTime: string;
  endTime: string;
  elapsedSec: number;
  cpuUserSec: number;
  cpuSystemSec: number;
  peakRssMB: number;
  peakHeapUsedMB: number;
  gzBytes: number;
  expectedContentLength: number | null;
  decompressedBytes: number;
  totalLines: number;
  inputGzSha256: string;
  gunzipCompletedWithoutError: boolean;
}

/**
 * Stream a gzip-compressed TSV URL line-by-line cleanly with Node fetch + zlib.createGunzip().
 * Validates Content-Length, gunzip EOF completion, computes raw compressed SHA-256,
 * and samples process RSS / V8 heap / CPU usage.
 */
async function streamGzipTsvLines(
  url: string,
  onLine: (line: string) => void
): Promise<StreamTelemetry> {
  const startTime = new Date().toISOString();
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();

  let peakRssBytes = process.memoryUsage().rss;
  let peakHeapUsedBytes = process.memoryUsage().heapUsed;
  const sampleMem = () => {
    const m = process.memoryUsage();
    if (m.rss > peakRssBytes) peakRssBytes = m.rss;
    if (m.heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = m.heapUsed;
  };

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }
  const contentLengthHeader = res.headers.get('content-length');
  const expectedContentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;

  const gzHash = crypto.createHash('sha256');
  const gunzip = zlib.createGunzip();
  let gzBytes = 0;
  let decompressedBytes = 0;
  let totalLines = 0;
  let leftover = '';
  let gunzipEnded = false;

  const consumePromise = new Promise<void>((resolve, reject) => {
    gunzip.on('data', (chunk: Buffer) => {
      decompressedBytes += chunk.byteLength;
      leftover += chunk.toString('utf8');
      let start = 0;
      let nl = leftover.indexOf('\n', start);
      while (nl !== -1) {
        const line = leftover.slice(start, nl);
        totalLines++;
        if ((totalLines & 0x3ffff) === 0) sampleMem();
        onLine(line);
        start = nl + 1;
        nl = leftover.indexOf('\n', start);
      }
      leftover = leftover.slice(start);
    });
    gunzip.on('end', () => {
      if (leftover.length > 0) {
        totalLines++;
        onLine(leftover);
        leftover = '';
      }
      gunzipEnded = true;
      resolve();
    });
    gunzip.on('error', reject);
  });

  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        gzBytes += value.byteLength;
        gzHash.update(value);
        const canContinue = gunzip.write(value);
        if (!canContinue) {
          await new Promise<void>((r) => gunzip.once('drain', r));
        }
      }
    }
    gunzip.end();
  } catch (err) {
    gunzip.destroy(err as Error);
    throw err;
  }

  await consumePromise;
  if (!gunzipEnded) {
    throw new Error(`Gunzip stream for ${url} terminated before EOF`);
  }
  if (expectedContentLength !== null && gzBytes !== expectedContentLength) {
    throw new Error(`Compressed size mismatch for ${url}: got ${gzBytes}, expected ${expectedContentLength}`);
  }

  sampleMem();
  const endTime = new Date().toISOString();
  const elapsedSec = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
  const cpuDelta = process.cpuUsage(cpu0);

  return {
    startTime,
    endTime,
    elapsedSec,
    cpuUserSec: Math.round((cpuDelta.user / 1e6) * 100) / 100,
    cpuSystemSec: Math.round((cpuDelta.system / 1e6) * 100) / 100,
    peakRssMB: Math.round((peakRssBytes / 1048576) * 100) / 100,
    peakHeapUsedMB: Math.round((peakHeapUsedBytes / 1048576) * 100) / 100,
    gzBytes,
    expectedContentLength,
    decompressedBytes,
    totalLines,
    inputGzSha256: gzHash.digest('hex'),
    gunzipCompletedWithoutError: gunzipEnded,
  };
}

async function fetchTotalCounts(startYear: number, endYear: number): Promise<AnnualTotalCounts> {
  const tc1Stage = path.join(STAGE_DIR, 'totalcounts-1.txt');
  const tc2Stage = path.join(STAGE_DIR, 'totalcounts-2.txt');
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  let txt1: string;
  let txt2: string;

  if (fs.existsSync(tc1Stage) && fs.existsSync(tc2Stage)) {
    txt1 = fs.readFileSync(tc1Stage, 'utf8');
    txt2 = fs.readFileSync(tc2Stage, 'utf8');
  } else {
    const [r1, r2] = await Promise.all([
      fetch(`${GOOGLE_BOOKS_BASE_URL}/totalcounts-1`),
      fetch(`${GOOGLE_BOOKS_BASE_URL}/totalcounts-2`),
    ]);
    if (!r1.ok || !r2.ok) {
      throw new Error(`Failed fetching official totalcounts files (${r1.status}, ${r2.status})`);
    }
    txt1 = await r1.text();
    txt2 = await r2.text();
    atomicWriteFileSync(tc1Stage, txt1);
    atomicWriteFileSync(tc2Stage, txt2);
  }

  return {
    startYear,
    endYear,
    n1ByYear: parseTotalCountsText(txt1, startYear, endYear),
    n2ByYear: parseTotalCountsText(txt2, startYear, endYear),
  };
}

/**
 * Deterministic 1-gram intermediate stage payload (contains ZERO volatile timestamps/elapsedSec
 * and strictly lexicographically sorted `counts` keys).
 */
export interface Shard1GramStage {
  shard: string;
  caseMode: CorpusCaseMode;
  startYear: number;
  endYear: number;
  gzBytes: number;
  inputGzSha256: string;
  totalLines: number;
  emptyLines: number;
  malformedNoTab: number;
  posTaggedSkipped: number;
  nonAlphaSkipped: number;
  nonLexiconSkipped: number;
  zeroInWindowSkipped: number;
  untaggedAlphaSeen: number;
  validLinesAggregated: number;
  caseFoldedMerges: number;
  retainedWords: number;
  reconciliationDelta: number;
  counts: Record<string, number[]>;
}

/**
 * Deterministic 2-gram intermediate stage payload (contains ZERO volatile timestamps/elapsedSec
 * and strictly lexicographically sorted `bigrams` keys + deterministic tie-broken `stopwordAudit`).
 */
export interface ObservedBigramStage {
  shard: string;
  caseMode: CorpusCaseMode;
  startYear: number;
  endYear: number;
  gzBytes: number;
  inputGzSha256: string;
  totalLines: number;
  emptyLines: number;
  malformedNoTab: number;
  posTaggedSkipped: number;
  nonAlphaSkipped: number;
  missingMarginalSkipped: number;
  stopwordRejected: number;
  nonLexiconSkipped: number;
  zeroInWindowSkipped: number;
  validLinesAggregated: number;
  caseFoldedMerges: number;
  uniqueRetainedKeys: number;
  reconciliationDelta: number;
  stopwordAudit: Array<{ w1: string; w2: string; observedCount: number }>;
  bigrams: Record<string, number[]>;
}

export interface StageExecutionMeta {
  pid: number;
  ppid: number;
  runId: string;
  shard: string;
  caseMode: CorpusCaseMode;
  startTime: string;
  endTime: string;
  elapsedSec: number;
  cpuUserSec: number;
  cpuSystemSec: number;
  peakRssMB: number;
  peakHeapUsedMB: number;
  compressedBytes: number;
  expectedContentLength: number | null;
  decompressedBytes: number;
  inputGzSha256: string;
  gunzipCompletedWithoutError: boolean;
  dataFile: string;
  dataSizeBytes: number;
  dataSha256: string;
  reconciliationDelta: number;
}

async function processUnigramShard(
  shard: string,
  startYear: number,
  endYear: number,
  caseMode: CorpusCaseMode,
  exactLexicon: Set<string>,
  morphology: OfflineMorphologyEngine,
  lexCache: Map<string, boolean>,
  noCache: boolean
): Promise<{ data: Shard1GramStage; meta: StageExecutionMeta | null }> {
  const stageFile = path.join(STAGE_DIR, `${shard}.json`);
  const metaFile = path.join(STAGE_DIR, `${shard}.meta.json`);
  if (!noCache && fs.existsSync(stageFile)) {
    const cachedData = JSON.parse(fs.readFileSync(stageFile, 'utf8')) as Shard1GramStage;
    if (cachedData.caseMode === caseMode && cachedData.startYear === startYear && cachedData.endYear === endYear) {
      console.log(`  [cache] Reusing staged 1-gram summary: ${shard} (${caseMode})`);
      const cachedMeta = fs.existsSync(metaFile)
        ? (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as StageExecutionMeta)
        : null;
      return { data: cachedData, meta: cachedMeta };
    }
  }

  const numYears = endYear - startYear + 1;
  const agg = new Map<string, Float64Array>();
  let emptyLines = 0;
  let malformedNoTab = 0;
  let posTaggedSkipped = 0;
  let nonAlphaSkipped = 0;
  let nonLexiconSkipped = 0;
  let zeroInWindowSkipped = 0;
  let untaggedAlphaSeen = 0;
  let validLinesAggregated = 0;

  const isAllowedToken =
    caseMode === 'strict-lowercase' ? isStrictLowerAlphaToken : isAnyCaseAlphaToken;

  console.log(`  [stream] Fetching & parsing 1-gram shard ${shard} (caseMode=${caseMode})...`);
  const telemetry = await streamGzipTsvLines(`${GOOGLE_BOOKS_BASE_URL}/${shard}`, (line) => {
    if (line.length === 0) {
      emptyLines++;
      return;
    }
    const tab = line.indexOf('\t');
    if (tab <= 0) {
      malformedNoTab++;
      return;
    }
    const rawNgram = line.slice(0, tab);
    if (isPosTaggedNgram(rawNgram)) {
      posTaggedSkipped++;
      return;
    }
    if (!isAllowedToken(rawNgram)) {
      nonAlphaSkipped++;
      return;
    }
    untaggedAlphaSeen++;
    const word = rawNgram.toUpperCase();
    if (!isCorpusStopword(word) && !isGeneralLexicalWord(word, exactLexicon, morphology, lexCache)) {
      nonLexiconSkipped++;
      return;
    }

    const parts = line.split('\t');
    const lineYears = new Float64Array(numYears);
    accumulateAnnualTupleCells(parts, 1, lineYears, startYear, endYear);
    let sum = 0;
    for (let i = 0; i < numYears; i++) sum += lineYears[i];
    if (sum <= 0) {
      zeroInWindowSkipped++;
      return;
    }

    validLinesAggregated++;
    let arr = agg.get(word);
    if (!arr) {
      arr = lineYears;
      agg.set(word, arr);
    } else {
      for (let i = 0; i < numYears; i++) arr[i] += lineYears[i];
    }
  });

  // Sort Map-derived keys lexicographically so serialization is 100% deterministic
  const sortedWords = Array.from(agg.keys()).sort();
  const counts: Record<string, number[]> = {};
  for (const word of sortedWords) {
    counts[word] = Array.from(agg.get(word)!);
  }
  const retainedWords = sortedWords.length;
  const caseFoldedMerges = validLinesAggregated - retainedWords;

  const accounted =
    emptyLines +
    malformedNoTab +
    posTaggedSkipped +
    nonAlphaSkipped +
    nonLexiconSkipped +
    zeroInWindowSkipped +
    validLinesAggregated;
  const reconciliationDelta = telemetry.totalLines - accounted;
  if (reconciliationDelta !== 0) {
    throw new Error(`1-gram line reconciliation failed for ${shard}: delta=${reconciliationDelta}`);
  }

  const result: Shard1GramStage = {
    shard,
    caseMode,
    startYear,
    endYear,
    gzBytes: telemetry.gzBytes,
    inputGzSha256: telemetry.inputGzSha256,
    totalLines: telemetry.totalLines,
    emptyLines,
    malformedNoTab,
    posTaggedSkipped,
    nonAlphaSkipped,
    nonLexiconSkipped,
    zeroInWindowSkipped,
    untaggedAlphaSeen,
    validLinesAggregated,
    caseFoldedMerges,
    retainedWords,
    reconciliationDelta,
    counts,
  };

  const jsonPayload = JSON.stringify(result);
  atomicWriteFileSync(stageFile, jsonPayload);
  const dataSha256 = sha256Buffer(jsonPayload);

  const meta: StageExecutionMeta = {
    pid: process.pid,
    ppid: process.ppid,
    runId: crypto.randomUUID(),
    shard,
    caseMode,
    startTime: telemetry.startTime,
    endTime: telemetry.endTime,
    elapsedSec: telemetry.elapsedSec,
    cpuUserSec: telemetry.cpuUserSec,
    cpuSystemSec: telemetry.cpuSystemSec,
    peakRssMB: telemetry.peakRssMB,
    peakHeapUsedMB: telemetry.peakHeapUsedMB,
    compressedBytes: telemetry.gzBytes,
    expectedContentLength: telemetry.expectedContentLength,
    decompressedBytes: telemetry.decompressedBytes,
    inputGzSha256: telemetry.inputGzSha256,
    gunzipCompletedWithoutError: telemetry.gunzipCompletedWithoutError,
    dataFile: stageFile,
    dataSizeBytes: Buffer.byteLength(jsonPayload, 'utf8'),
    dataSha256,
    reconciliationDelta,
  };
  atomicWriteFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');

  console.log(
    `  [done] ${shard}: ${(telemetry.gzBytes / 1048576).toFixed(1)} MB in ${telemetry.elapsedSec}s | ` +
      `lines=${telemetry.totalLines.toLocaleString()} | retained=${retainedWords.toLocaleString()} words | ` +
      `dataSha256=${dataSha256.slice(0, 12)}...`
  );
  return { data: result, meta };
}

async function processBigramShard(
  shard: string,
  startYear: number,
  endYear: number,
  caseMode: CorpusCaseMode,
  unigramMap: Map<string, Float64Array>,
  exactLexicon: Set<string>,
  morphology: OfflineMorphologyEngine,
  lexCache: Map<string, boolean>,
  noCache: boolean
): Promise<{ data: ObservedBigramStage; meta: StageExecutionMeta | null }> {
  const stageFile = path.join(STAGE_DIR, `${shard}.json`);
  const metaFile = path.join(STAGE_DIR, `${shard}.meta.json`);
  if (!noCache && fs.existsSync(stageFile)) {
    const cachedData = JSON.parse(fs.readFileSync(stageFile, 'utf8')) as ObservedBigramStage;
    if (cachedData.caseMode === caseMode && cachedData.startYear === startYear && cachedData.endYear === endYear) {
      console.log(`  [cache] Reusing staged 2-gram summary: ${shard} (${caseMode})`);
      const cachedMeta = fs.existsSync(metaFile)
        ? (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as StageExecutionMeta)
        : null;
      return { data: cachedData, meta: cachedMeta };
    }
  }

  const numYears = endYear - startYear + 1;
  const agg = new Map<string, Float64Array>();
  const stopwordTotals = new Map<string, number>();

  let emptyLines = 0;
  let malformedNoTab = 0;
  let posTaggedSkipped = 0;
  let nonAlphaSkipped = 0;
  let missingMarginalSkipped = 0;
  let stopwordRejected = 0;
  let nonLexiconSkipped = 0;
  let zeroInWindowSkipped = 0;
  let validLinesAggregated = 0;

  const isAllowedBigram =
    caseMode === 'strict-lowercase' ? isStrictLowerAlphaBigram : isAnyCaseAlphaBigram;

  console.log(`  [stream] Fetching & parsing 2-gram shard ${shard} (caseMode=${caseMode})...`);
  const telemetry = await streamGzipTsvLines(`${GOOGLE_BOOKS_BASE_URL}/${shard}`, (line) => {
    if (line.length === 0) {
      emptyLines++;
      return;
    }
    const tab = line.indexOf('\t');
    if (tab <= 0) {
      malformedNoTab++;
      return;
    }
    const rawNgram = line.slice(0, tab);
    if (isPosTaggedNgram(rawNgram)) {
      posTaggedSkipped++;
      return;
    }

    const spaceIdx = rawNgram.indexOf(' ');
    if (
      spaceIdx < 2 ||
      rawNgram.indexOf(' ', spaceIdx + 1) !== -1 ||
      !isAllowedBigram(rawNgram)
    ) {
      nonAlphaSkipped++;
      return;
    }

    const w1 = rawNgram.slice(0, spaceIdx).toUpperCase();
    const w2 = rawNgram.slice(spaceIdx + 1).toUpperCase();

    if (!unigramMap.has(w1) || !unigramMap.has(w2)) {
      missingMarginalSkipped++;
      return;
    }

    if (isCorpusStopword(w1) || isCorpusStopword(w2)) {
      stopwordRejected++;
      const parts = line.split('\t');
      let sum = 0;
      for (let i = 1; i < parts.length; i++) {
        const c1 = parts[i].indexOf(',');
        if (c1 <= 0) continue;
        const y = Number.parseInt(parts[i].slice(0, c1), 10);
        if (y < startYear || y > endYear) continue;
        const c2 = parts[i].indexOf(',', c1 + 1);
        const cnt = Number.parseInt(c2 > c1 ? parts[i].slice(c1 + 1, c2) : parts[i].slice(c1 + 1), 10);
        if (cnt > 0) sum += cnt;
      }
      if (sum > 0) {
        const key = `${w1} ${w2}`;
        stopwordTotals.set(key, (stopwordTotals.get(key) || 0) + sum);
      }
      return;
    }

    if (
      !isGeneralLexicalWord(w1, exactLexicon, morphology, lexCache) ||
      !isGeneralLexicalWord(w2, exactLexicon, morphology, lexCache)
    ) {
      nonLexiconSkipped++;
      return;
    }

    const parts = line.split('\t');
    const lineYears = new Float64Array(numYears);
    accumulateAnnualTupleCells(parts, 1, lineYears, startYear, endYear);
    let sum = 0;
    for (let i = 0; i < numYears; i++) sum += lineYears[i];
    if (sum <= 0) {
      zeroInWindowSkipped++;
      return;
    }

    validLinesAggregated++;
    const key = `${w1} ${w2}`;
    let arr = agg.get(key);
    if (!arr) {
      arr = lineYears;
      agg.set(key, arr);
    } else {
      for (let i = 0; i < numYears; i++) arr[i] += lineYears[i];
    }
  });

  // Sort Map-derived keys lexicographically so serialization is 100% deterministic
  const sortedKeys = Array.from(agg.keys()).sort();
  const bigrams: Record<string, number[]> = {};
  for (const key of sortedKeys) {
    bigrams[key] = Array.from(agg.get(key)!);
  }
  const uniqueRetainedKeys = sortedKeys.length;
  const caseFoldedMerges = validLinesAggregated - uniqueRetainedKeys;

  const stopwordAudit = Array.from(stopwordTotals.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 30)
    .map(([k, count]) => {
      const [w1, w2] = k.split(' ');
      return { w1, w2, observedCount: count };
    });

  const accounted =
    emptyLines +
    malformedNoTab +
    posTaggedSkipped +
    nonAlphaSkipped +
    missingMarginalSkipped +
    stopwordRejected +
    nonLexiconSkipped +
    zeroInWindowSkipped +
    validLinesAggregated;
  const reconciliationDelta = telemetry.totalLines - accounted;
  if (reconciliationDelta !== 0) {
    throw new Error(`2-gram line reconciliation failed for ${shard}: delta=${reconciliationDelta}`);
  }

  const result: ObservedBigramStage = {
    shard,
    caseMode,
    startYear,
    endYear,
    gzBytes: telemetry.gzBytes,
    inputGzSha256: telemetry.inputGzSha256,
    totalLines: telemetry.totalLines,
    emptyLines,
    malformedNoTab,
    posTaggedSkipped,
    nonAlphaSkipped,
    missingMarginalSkipped,
    stopwordRejected,
    nonLexiconSkipped,
    zeroInWindowSkipped,
    validLinesAggregated,
    caseFoldedMerges,
    uniqueRetainedKeys,
    reconciliationDelta,
    stopwordAudit,
    bigrams,
  };

  const jsonPayload = JSON.stringify(result);
  atomicWriteFileSync(stageFile, jsonPayload);
  const dataSha256 = sha256Buffer(jsonPayload);

  const meta: StageExecutionMeta = {
    pid: process.pid,
    ppid: process.ppid,
    runId: crypto.randomUUID(),
    shard,
    caseMode,
    startTime: telemetry.startTime,
    endTime: telemetry.endTime,
    elapsedSec: telemetry.elapsedSec,
    cpuUserSec: telemetry.cpuUserSec,
    cpuSystemSec: telemetry.cpuSystemSec,
    peakRssMB: telemetry.peakRssMB,
    peakHeapUsedMB: telemetry.peakHeapUsedMB,
    compressedBytes: telemetry.gzBytes,
    expectedContentLength: telemetry.expectedContentLength,
    decompressedBytes: telemetry.decompressedBytes,
    inputGzSha256: telemetry.inputGzSha256,
    gunzipCompletedWithoutError: telemetry.gunzipCompletedWithoutError,
    dataFile: stageFile,
    dataSizeBytes: Buffer.byteLength(jsonPayload, 'utf8'),
    dataSha256,
    reconciliationDelta,
  };
  atomicWriteFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');

  console.log(
    `  [done] ${shard}: ${(telemetry.gzBytes / 1048576).toFixed(1)} MB in ${telemetry.elapsedSec}s | ` +
      `lines=${telemetry.totalLines.toLocaleString()} | validLexBigrams=${uniqueRetainedKeys.toLocaleString()} | ` +
      `dataSha256=${dataSha256.slice(0, 12)}...`
  );
  return { data: result, meta };
}

async function main() {
  const args = parseArgs();
  const thresholds: CorpusThresholds = {
    minCount: args.minCount,
    minPmi: args.minPmi,
    minTScore: args.minTScore,
  };

  console.log('======================================================================');
  console.log(' Flipit Finder V3 — Milestone 7A.1 Google Books Corpus Pilot Compiler');
  console.log(` Source: Google Books Ngrams English v3 (Release ${GOOGLE_BOOKS_RELEASE})`);
  console.log(` Window: ${args.startYear}-${args.endYear} | CaseMode: ${args.caseMode} | Thresholds: count>=${thresholds.minCount}, PMI>=${thresholds.minPmi}, t>=${thresholds.minTScore}`);
  console.log(` StageDir: ${STAGE_DIR}`);
  console.log('======================================================================\n');

  const { exactLexicon, morphology } = buildGeneralEnglishVocab();
  const lexCache = new Map<string, boolean>();
  console.log(`[1/4] Loaded general English vocabulary: ${exactLexicon.size.toLocaleString()} base tokens`);

  const totals = await fetchTotalCounts(args.startYear, args.endYear);
  const n1Sum = totals.n1ByYear.reduce((a, b) => a + b, 0);
  const n2Sum = totals.n2ByYear.reduce((a, b) => a + b, 0);
  console.log(
    `[2/4] Loaded official corpus denominators (${args.startYear}-${args.endYear}): ` +
      `N1=${Math.round(n1Sum / 1e9)}B, N2=${Math.round(n2Sum / 1e9)}B`
  );

  // Stage 1: Unigram shards
  const target1GramShards = PILOT_1GRAM_SHARDS.filter(
    (s) => !args.shardsFilter || args.shardsFilter.has(s)
  );
  const unigramMetas: Array<Omit<Shard1GramStage, 'counts'>> = [];
  const unigramMap = new Map<string, Float64Array>();
  const numYears = args.endYear - args.startYear + 1;

  const accumulateUnigramStage = (st: Shard1GramStage) => {
    for (const word of Object.keys(st.counts).sort()) {
      const arr = st.counts[word];
      let existing = unigramMap.get(word);
      if (!existing) {
        existing = new Float64Array(numYears);
        unigramMap.set(word, existing);
      }
      for (let i = 0; i < numYears; i++) existing[i] += arr[i];
    }
    const { counts: _c, ...meta } = st;
    unigramMetas.push(meta);
  };

  if (args.stage === 'all' || args.stage === 'unigrams') {
    console.log(`\n[3/4] Processing ${target1GramShards.length} pilot 1-gram shard(s)...`);
    for (const shard of target1GramShards) {
      const { data } = await processUnigramShard(
        shard,
        args.startYear,
        args.endYear,
        args.caseMode,
        exactLexicon,
        morphology,
        lexCache,
        args.noCache
      );
      if (args.stage !== 'unigrams') {
        accumulateUnigramStage(data);
      }
    }
    if (args.stage === 'unigrams') {
      console.log('\n[✓] Unigram staging stage completed.');
      return;
    }
  } else {
    for (const shard of PILOT_1GRAM_SHARDS) {
      const p = path.join(STAGE_DIR, `${shard}.json`);
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Shard1GramStage;
        accumulateUnigramStage(parsed);
      }
    }
  }
  console.log(`  Merged unigram marginal vocabulary size: ${unigramMap.size.toLocaleString()} words`);

  // Stage 2: Bigram shards
  const target2GramShards = PILOT_2GRAM_SHARDS.filter(
    (s) => !args.shardsFilter || args.shardsFilter.has(s)
  );
  const bigramMetas: Array<Omit<ObservedBigramStage, 'bigrams' | 'stopwordAudit'>> = [];
  const bigramStopwordAudits: Array<{ w1: string; w2: string; observedCount: number }> = [];
  const totalCountByKey = new Map<string, number>();
  const prefixCounts = new Map<string, number>();
  const shardPrefixes = new Map<string, Set<string>>();

  console.log(`\n[4/4] Processing ${target2GramShards.length} pilot 2-gram shard(s)...`);
  for (const shard of target2GramShards) {
    const { data } = await processBigramShard(
      shard,
      args.startYear,
      args.endYear,
      args.caseMode,
      unigramMap,
      exactLexicon,
      morphology,
      lexCache,
      args.noCache
    );
    if (!args.shardsFilter) {
      const pSet = new Set<string>();
      for (const [key, arr] of Object.entries(data.bigrams)) {
        let sum = 0;
        for (let i = 0; i < numYears; i++) sum += arr[i];
        totalCountByKey.set(key, (totalCountByKey.get(key) || 0) + sum);
        const prefix = key.slice(0, 2);
        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
        pSet.add(prefix);
      }
      shardPrefixes.set(shard, pSet);
      const { bigrams: _b, stopwordAudit, ...meta } = data;
      bigramMetas.push(meta);
      bigramStopwordAudits.push(...stopwordAudit);
    }
  }

  if (args.shardsFilter) {
    console.log('\n[✓] Partial shard staging completed. Run without --shards to compile partitioned output.');
    return;
  }

  // Group sorted 2-letter prefixes into bounded-memory batches per starting letter,
  // strictly preserving global lexicographical key order while bounding peak Float64Array RSS.
  const MAX_BATCH_KEYS = 200000;
  const sortedPrefixes = Array.from(prefixCounts.keys()).sort();
  const batchesByLetter: Array<{ letter: string; batches: Array<Set<string>> }> = [];
  for (const prefix of sortedPrefixes) {
    const letter = prefix.charAt(0).toLowerCase();
    const count = prefixCounts.get(prefix) || 0;
    let letterGroup = batchesByLetter[batchesByLetter.length - 1];
    if (!letterGroup || letterGroup.letter !== letter) {
      letterGroup = { letter, batches: [] };
      batchesByLetter.push(letterGroup);
    }
    const curBatch = letterGroup.batches[letterGroup.batches.length - 1];
    if (!curBatch) {
      letterGroup.batches.push(new Set([prefix]));
    } else {
      let curCount = 0;
      for (const p of curBatch) curCount += prefixCounts.get(p) || 0;
      if (curCount + count > MAX_BATCH_KEYS && curBatch.size > 0) {
        letterGroup.batches.push(new Set([prefix]));
      } else {
        curBatch.add(prefix);
      }
    }
  }

  let totalEvaluatedBigrams = 0;
  let rejectedLowCount = 0;
  let rejectedLowPmi = 0;
  let rejectedLowTScore = 0;
  let retainedCount = 0;

  const thresholdRejectedSamples: Array<{
    phrase: string;
    observedCount: number;
    pmi: number;
    tScore: number;
    reason: string;
  }> = [];

  const asymmetricSamples: Array<{
    forward: string;
    forwardCount: number;
    reverseCount: number;
    orderRatio: number;
    pmi: number;
  }> = [];

  fs.mkdirSync(PILOT_OUT_DIR, { recursive: true });
  const checksums: Record<string, string> = {};
  const partitionReport: Record<string, { w1Count: number; pairCount: number; sizeBytes: number; sha256: string }> = {};

  for (const { letter, batches } of batchesByLetter) {
    const rawMap: CorpusPartitionData = {};

    for (const batchPrefixes of batches) {
      const mergedBatch = new Map<string, Float64Array>();
      for (const shard of target2GramShards) {
        const sPrefixes = shardPrefixes.get(shard);
        if (!sPrefixes) continue;
        let overlaps = false;
        for (const p of batchPrefixes) {
          if (sPrefixes.has(p)) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) continue;

        const stageFile = path.join(STAGE_DIR, `${shard}.json`);
        const cachedData = JSON.parse(fs.readFileSync(stageFile, 'utf8')) as ObservedBigramStage;
        for (const [key, arr] of Object.entries(cachedData.bigrams)) {
          if (!batchPrefixes.has(key.slice(0, 2))) continue;
          let merged = mergedBatch.get(key);
          if (!merged) {
            merged = new Float64Array(numYears);
            mergedBatch.set(key, merged);
          }
          for (let i = 0; i < numYears; i++) merged[i] += arr[i];
        }
      }

      for (const key of Array.from(mergedBatch.keys()).sort()) {
        const bigramAnnual = mergedBatch.get(key)!;
        totalEvaluatedBigrams++;
        const spaceIdx = key.indexOf(' ');
        const w1 = key.slice(0, spaceIdx);
        const w2 = key.slice(spaceIdx + 1);
        const revKey = `${w2} ${w1}`;
        const reverseCount = totalCountByKey.get(revKey) || 0;

        const w1Annual = unigramMap.get(w1)!;
        const w2Annual = unigramMap.get(w2)!;
        const stats = computeYearStratifiedStats({
          bigramAnnual,
          w1Annual,
          w2Annual,
          totals,
          reverseCount,
        });

        if (!passesCorpusThresholds(stats, thresholds)) {
          if (stats.observedCount < thresholds.minCount) rejectedLowCount++;
          else if (stats.pmi < thresholds.minPmi) rejectedLowPmi++;
          else rejectedLowTScore++;

          if (stats.observedCount >= 100 && thresholdRejectedSamples.length < 40) {
            thresholdRejectedSamples.push({
              phrase: key,
              observedCount: stats.observedCount,
              pmi: stats.pmi,
              tScore: stats.tScore,
              reason:
                stats.observedCount < thresholds.minCount
                  ? 'count < minCount'
                  : stats.pmi < thresholds.minPmi
                    ? 'PMI < minPmi'
                    : 'tScore < minTScore',
            });
          }
          continue;
        }

        retainedCount++;
        const heuristicScore = computeCorpusHeuristicScore(stats);
        if (!rawMap[w1]) {
          rawMap[w1] = {};
        }
        const rec: CorpusPartitionRecord = {
          c: stats.observedCount,
          pmi: stats.pmi,
          t: stats.tScore,
          rc: reverseCount,
          or: stats.orderRatio,
          s: heuristicScore,
        };
        rawMap[w1][w2] = rec;

        if (reverseCount > 0 && asymmetricSamples.length < 50) {
          asymmetricSamples.push({
            forward: key,
            forwardCount: stats.observedCount,
            reverseCount,
            orderRatio: stats.orderRatio,
            pmi: stats.pmi,
          });
        }
      }
      mergedBatch.clear();
    }

    const sortedW1Keys = Object.keys(rawMap).sort();
    if (sortedW1Keys.length === 0) continue;

    const sortedW1: CorpusPartitionData = {};
    let pairCount = 0;
    for (const w1 of sortedW1Keys) {
      const sortedW2: Record<string, CorpusPartitionRecord> = {};
      for (const w2 of Object.keys(rawMap[w1]).sort()) {
        sortedW2[w2] = rawMap[w1][w2];
        pairCount++;
      }
      sortedW1[w1] = sortedW2;
    }

    const fileName = `corpus_${letter}.json`;
    const filePath = path.join(PILOT_OUT_DIR, fileName);
    const jsonText = JSON.stringify(sortedW1);
    atomicWriteFileSync(filePath, jsonText);
    const hash = sha256Buffer(jsonText);
    const relPath = `data/v3/compiled/corpus_pilot/${fileName}`;
    checksums[relPath] = hash;
    partitionReport[fileName] = {
      w1Count: sortedW1Keys.length,
      pairCount,
      sizeBytes: Buffer.byteLength(jsonText, 'utf8'),
      sha256: hash,
    };
  }

  atomicWriteFileSync(
    path.join(PILOT_OUT_DIR, 'checksums.json'),
    JSON.stringify(
      {
        source: `Google Books Ngrams English v3 (${GOOGLE_BOOKS_RELEASE})`,
        license: GOOGLE_BOOKS_LICENSE,
        window: `${args.startYear}-${args.endYear}`,
        caseMode: args.caseMode,
        thresholds,
        checksums,
      },
      null,
      2
    ) + '\n'
  );

  const stopwordSamplesCombined = bigramStopwordAudits
    .sort((a, b) => b.observedCount - a.observedCount || (a.w1 + ' ' + a.w2 < b.w1 + ' ' + b.w2 ? -1 : 1))
    .slice(0, 25);

  const summary = {
    release: GOOGLE_BOOKS_RELEASE,
    baseUrl: GOOGLE_BOOKS_BASE_URL,
    license: GOOGLE_BOOKS_LICENSE,
    yearWindow: { startYear: args.startYear, endYear: args.endYear },
    caseMode: args.caseMode,
    thresholds,
    totalCorpusCounts: {
      n1Total1950To2019: n1Sum,
      n2Total1950To2019: n2Sum,
    },
    shards1Gram: unigramMetas,
    shards2Gram: bigramMetas,
    mergedUnigramVocabSize: unigramMap.size,
    totalEvaluatedLexicalBigrams: totalEvaluatedBigrams,
    filteringCounts: {
      rejectedLowCount,
      rejectedLowPmi,
      rejectedLowTScore,
      retainedCount,
    },
    partitions: partitionReport,
    negativeControlAudits: {
      topStopwordRejectedPairs: stopwordSamplesCombined,
      sampleThresholdRejectedPairs: thresholdRejectedSamples
        .sort((a, b) => b.observedCount - a.observedCount || (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0))
        .slice(0, 25),
      sampleBidirectionalObservedPairs: asymmetricSamples
        .sort((a, b) => b.orderRatio - a.orderRatio || (a.forward < b.forward ? -1 : a.forward > b.forward ? 1 : 0))
        .slice(0, 25),
    },
  };

  atomicWriteFileSync(path.join(PILOT_OUT_DIR, 'pilot_summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log('\n======================================================================');
  console.log(' PILOT COMPILATION COMPLETE');
  console.log('======================================================================');
  console.log(`Evaluated valid lexical bigrams: ${totalEvaluatedBigrams.toLocaleString()}`);
  console.log(`Retained empirical collocations: ${retainedCount.toLocaleString()}`);
  console.log(`Partitions written: ${Object.keys(partitionReport).join(', ')}`);
  console.log('======================================================================\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Corpus pilot compilation failed:', err);
    process.exit(1);
  });
}
