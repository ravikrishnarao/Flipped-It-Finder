/**
 * Flipit Finder V3 — Milestone 7A / 7A.1 Pilot Validation & Reproducibility Audit Harness
 *
 * Strictly scoped to the 8 lowercase 1-gram shards (`1-00016`..`1-00023`) and
 * the O/P 2-gram shards (`2-00478-of-00589.gz`, `2-00493-of-00589.gz`).
 * Does NOT fetch `2-00530`, `2-00543`, or any other shards, and does NOT modify solver
 * or runtime phrase data.
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
  isCorpusStopword,
  isPosTaggedNgram,
  isStrictLowerAlphaBigram,
  parseTotalCountsText,
  passesCorpusThresholds,
  PILOT_DEFAULT_END_YEAR,
  PILOT_DEFAULT_START_YEAR,
  type AnnualTotalCounts,
} from '../../src/solver/v3/corpusStats.ts';

export type CaseMode = 'strict-lowercase' | 'fold-mixed';

const STAGE_DIR = process.env.FLIPIT_STAGE_DIR || '/tmp/flipit_7a_pilot_stage';
const GOOGLE_BOOKS_BASE_URL = 'https://storage.googleapis.com/books/ngrams/books/20200217/eng';

const ALL_8_UNIGRAM_SHARDS = [
  '1-00016-of-00024.gz',
  '1-00017-of-00024.gz',
  '1-00018-of-00024.gz',
  '1-00019-of-00024.gz',
  '1-00020-of-00024.gz',
  '1-00021-of-00024.gz',
  '1-00022-of-00024.gz',
  '1-00023-of-00024.gz',
] as const;

const LEGACY_6_UNIGRAM_SHARDS = [
  '1-00016-of-00024.gz',
  '1-00018-of-00024.gz',
  '1-00020-of-00024.gz',
  '1-00021-of-00024.gz',
  '1-00022-of-00024.gz',
  '1-00023-of-00024.gz',
] as const;

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function atomicWriteFileSync(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
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

function loadMergedUnigrams(shards: readonly string[] = ALL_8_UNIGRAM_SHARDS): {
  totals: AnnualTotalCounts;
  unigramMap: Map<string, Float64Array>;
  shardReports: any[];
  letterCoverage: Record<string, number>;
} {
  const tc1Path = path.join(STAGE_DIR, 'totalcounts-1.txt');
  const tc2Path = path.join(STAGE_DIR, 'totalcounts-2.txt');
  const tc1Text = fs.readFileSync(tc1Path, 'utf8');
  const tc2Text = fs.readFileSync(tc2Path, 'utf8');

  const totals: AnnualTotalCounts = {
    startYear: PILOT_DEFAULT_START_YEAR,
    endYear: PILOT_DEFAULT_END_YEAR,
    n1ByYear: parseTotalCountsText(tc1Text, PILOT_DEFAULT_START_YEAR, PILOT_DEFAULT_END_YEAR),
    n2ByYear: parseTotalCountsText(tc2Text, PILOT_DEFAULT_START_YEAR, PILOT_DEFAULT_END_YEAR),
  };

  const numYears = PILOT_DEFAULT_END_YEAR - PILOT_DEFAULT_START_YEAR + 1;
  const unigramMap = new Map<string, Float64Array>();
  const letterCounts: Record<string, number> = {};
  const shardReports: any[] = [];

  for (const s of shards) {
    const p = path.join(STAGE_DIR, `${s}.json`);
    const metaP = path.join(STAGE_DIR, `${s}.meta.json`);
    const raw = fs.readFileSync(p, 'utf8');
    const sha = crypto.createHash('sha256').update(raw).digest('hex');
    const d = JSON.parse(raw);
    const meta = fs.existsSync(metaP) ? JSON.parse(fs.readFileSync(metaP, 'utf8')) : null;
    const words = Object.keys(d.counts || {}).sort();
    let sumMatches1950_2019 = 0;
    const minWord = words[0] || '';
    const maxWord = words[words.length - 1] || '';

    for (const w of words) {
      const arr = d.counts[w];
      let existing = unigramMap.get(w);
      if (!existing) {
        existing = new Float64Array(numYears);
        unigramMap.set(w, existing);
        const l = w.charAt(0);
        letterCounts[l] = (letterCounts[l] || 0) + 1;
      }
      for (let i = 0; i < numYears; i++) {
        const v = arr[i] || 0;
        existing[i] += v;
        sumMatches1950_2019 += v;
      }
    }

    shardReports.push({
      shard: s,
      caseMode: d.caseMode || 'legacy',
      stageFile: `${s}.json`,
      stageSizeBytes: Buffer.byteLength(raw, 'utf8'),
      stageDataSha256: sha,
      inputGzSha256: d.inputGzSha256 || meta?.inputGzSha256 || null,
      gzBytes: d.gzBytes,
      totalLines: d.totalLines,
      posTaggedSkipped: d.posTaggedSkipped,
      nonAlphaSkipped: d.nonAlphaSkipped,
      nonLexiconSkipped: d.nonLexiconSkipped ?? null,
      zeroInWindowSkipped: d.zeroInWindowSkipped ?? null,
      untaggedAlphaSeen: d.untaggedAlphaSeen,
      retainedWords: d.retainedWords,
      reconciliationDelta: d.reconciliationDelta ?? 0,
      sumMatches1950To2019: sumMatches1950_2019,
      elapsedSec: meta?.elapsedSec ?? d.elapsedSec ?? null,
      pid: meta?.pid ?? null,
      runId: meta?.runId ?? null,
      wordRange: [minWord, maxWord],
    });
  }

  return { totals, unigramMap, shardReports, letterCoverage: letterCounts };
}

async function auditUnigrams() {
  const full = loadMergedUnigrams(ALL_8_UNIGRAM_SHARDS);
  const numYears = PILOT_DEFAULT_END_YEAR - PILOT_DEFAULT_START_YEAR + 1;
  const az: Record<string, number> = {};
  for (let c = 65; c <= 90; c++) {
    const ch = String.fromCharCode(c);
    az[ch] = full.letterCoverage[ch] || 0;
  }

  let hasElapsedInStageJson = false;
  let unsortedKeysInStageJson = false;
  for (const s of ALL_8_UNIGRAM_SHARDS) {
    const raw = JSON.parse(fs.readFileSync(path.join(STAGE_DIR, `${s}.json`), 'utf8'));
    if ('elapsedSec' in raw) hasElapsedInStageJson = true;
    const keys = Object.keys(raw.counts);
    const sorted = [...keys].sort();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== sorted[i]) {
        unsortedKeysInStageJson = true;
        break;
      }
    }
  }

  const probeMarginals: Record<string, { present: boolean; total1950_2019: number; y1950: number; y2019: number }> = {};
  for (const w of [
    'OLD', 'GARMENTS', 'PLASTIC', 'SMILE', 'BAG', 'AGE', 'WORLD', 'MAN',
    'DRY', 'FRUITS', 'DEEP', 'CLEANING', 'INVOCATION', 'JUST', 'KING', 'ICE',
  ]) {
    const arr = full.unigramMap.get(w);
    let sum = 0;
    if (arr) for (let i = 0; i < numYears; i++) sum += arr[i];
    probeMarginals[w] = {
      present: Boolean(arr),
      total1950_2019: sum,
      y1950: arr ? arr[0] : 0,
      y2019: arr ? arr[numYears - 1] : 0,
    };
  }

  console.log(
    JSON.stringify(
      {
        auditMode: 'unigrams-8-shard',
        totalCounts1: {
          bytes: fs.statSync(path.join(STAGE_DIR, 'totalcounts-1.txt')).size,
          sha256: sha256File(path.join(STAGE_DIR, 'totalcounts-1.txt')),
          n1_1950: full.totals.n1ByYear[0],
          n1_2019: full.totals.n1ByYear[numYears - 1],
          n1_sum: full.totals.n1ByYear.reduce((a, b) => a + b, 0),
        },
        totalCounts2: {
          bytes: fs.statSync(path.join(STAGE_DIR, 'totalcounts-2.txt')).size,
          sha256: sha256File(path.join(STAGE_DIR, 'totalcounts-2.txt')),
          n2_1950: full.totals.n2ByYear[0],
          n2_2019: full.totals.n2ByYear[numYears - 1],
          n2_sum: full.totals.n2ByYear.reduce((a, b) => a + b, 0),
        },
        determinismChecks: {
          hasElapsedInStageJson,
          unsortedKeysInStageJson,
        },
        mergedUniqueWords: full.unigramMap.size,
        azCoverage: az,
        missingLetters: Object.entries(az).filter(([, c]) => c === 0).map(([k]) => k),
        probeMarginals,
        shards: full.shardReports,
      },
      null,
      2
    )
  );
}

/**
 * Isolated, sequential single-shard streaming run.
 * Can optionally compare missing-marginal deltas (6-shard vs 8-shard) AND
 * case-mode differences (strict-lowercase vs fold-mixed) without mutating solver data.
 */
const NEW_7A1_STOPWORDS = new Set([
  'WHERE', 'WHEN', 'WHY', 'HOW',
  'WHEREVER', 'WHENEVER', 'WHEREIN', 'WHEREOF', 'WHEREON', 'WHEREBY', 'WHEREUPON', 'WHEREWITH', 'WHENCE',
  'HERE', 'HEREIN', 'HEREOF', 'HERETO', 'HEREBY', 'HEREUPON',
  'THERE', 'THEREIN', 'THEREON', 'THERETO', 'THEREOF', 'THEREBY', 'THEREFORE', 'THEREUPON', 'THENCE',
  'UNDER', 'OVER', 'BENEATH', 'UNDERNEATH', 'THROUGHOUT', 'ALONGSIDE', 'AMID', 'AMIDST',
]);

async function streamSingleBigramIsolated(shard: string, outDir: string, caseMode: CaseMode) {
  fs.mkdirSync(outDir, { recursive: true });
  const { unigramMap: unigramMap8, totals } = loadMergedUnigrams(ALL_8_UNIGRAM_SHARDS);

  // Also load the 6-shard unigram set if present so we can verify exactly what the
  // newly-added 1-00017 & 1-00019 shards recover out of previously missingMarginals!
  const has6Shards = LEGACY_6_UNIGRAM_SHARDS.every((s) => fs.existsSync(path.join(STAGE_DIR, `${s}.json`)));
  const unigramMap6 = has6Shards ? loadMergedUnigrams(LEGACY_6_UNIGRAM_SHARDS).unigramMap : null;

  const numYears = PILOT_DEFAULT_END_YEAR - PILOT_DEFAULT_START_YEAR + 1;
  const runId = crypto.randomUUID();
  const startIso = new Date().toISOString();
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();

  let peakRssBytes = process.memoryUsage().rss;
  let peakHeapUsedBytes = process.memoryUsage().heapUsed;
  const sampleMem = () => {
    const m = process.memoryUsage();
    if (m.rss > peakRssBytes) peakRssBytes = m.rss;
    if (m.heapUsed > peakHeapUsedBytes) peakHeapUsedBytes = m.heapUsed;
  };

  const url = `${GOOGLE_BOOKS_BASE_URL}/${shard}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  const contentLengthHeader = res.headers.get('content-length');
  const expectedGzBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;

  const gzHash = crypto.createHash('sha256');
  const gunzip = zlib.createGunzip();

  const agg = new Map<string, Float64Array>();
  // Full fold-mixed annual aggregation (for exact apples-to-apples 7A vs 7A.1 A/B delta)
  const foldMixedAgg = new Map<string, Float64Array>();
  const strictLowerAgg = new Map<string, Float64Array>();
  const newStopwordHits = new Map<string, { w1: string; w2: string; strictCount: number; foldCount: number; lineCount: number }>();

  let gzBytes = 0;
  let decompressedBytes = 0;
  let totalLines = 0;
  let emptyLines = 0;
  let malformedNoTab = 0;
  let posTaggedSkipped = 0;
  let nonAlphaSkipped = 0;
  let mixedCaseLinesFiltered = 0;
  let missingMarginalSkipped = 0;
  let legacy6MissingMarginalCount = 0;
  let recoveredBy17And19Lines = 0;
  let stopwordRejected = 0;
  let zeroInWindowSkipped = 0;
  let validLinesAggregated = 0;

  // Apples-to-apples fold-mixed 6-vs-8 recovery accounting (matches Milestone 7A line classification order)
  let foldLegacy6MissingLines = 0;
  let foldStillMissing8Lines = 0;
  let foldRecoveredLinesTotal = 0;
  let foldRecoveredMixedCaseLines = 0;
  let foldRecoveredStopwordLines = 0;
  let foldRecoveredZeroWindowLines = 0;
  let foldRecoveredValidStrictLines = 0;
  let foldMissingMarginal8Lines = 0;
  let foldStopwordRejectedLines = 0;
  let foldValidLines = 0;

  let leftover = '';
  let gunzipEnded = false;

  const sumLineYears = (line: string): { lineYears: Float64Array; sum: number } => {
    const parts = line.split('\t');
    const lineYears = new Float64Array(numYears);
    accumulateAnnualTupleCells(parts, 1, lineYears, PILOT_DEFAULT_START_YEAR, PILOT_DEFAULT_END_YEAR);
    let lineSum = 0;
    for (let i = 0; i < numYears; i++) lineSum += lineYears[i];
    return { lineYears, sum: lineSum };
  };

  const processLine = (line: string) => {
    totalLines++;
    if ((totalLines & 0x3ffff) === 0) sampleMem();

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

    const isAnyAlpha = isAnyCaseAlphaBigram(rawNgram);
    if (!isAnyAlpha) {
      nonAlphaSkipped++;
      return;
    }

    const isStrictLower = isStrictLowerAlphaBigram(rawNgram);
    if (!isStrictLower) {
      mixedCaseLinesFiltered++;
    }

    const spaceIdx = rawNgram.indexOf(' ');
    const w1 = rawNgram.slice(0, spaceIdx).toUpperCase();
    const w2 = rawNgram.slice(spaceIdx + 1).toUpperCase();
    const key = `${w1} ${w2}`;
    const in6 = unigramMap6 ? unigramMap6.has(w1) && unigramMap6.has(w2) : true;
    const in8 = unigramMap8.has(w1) && unigramMap8.has(w2);
    const isStop = isCorpusStopword(w1) || isCorpusStopword(w2);

    // Parallel fold-mixed recovery accounting (explains every single one of Milestone 7A's rejected lines)
    if (unigramMap6 && !in6) {
      foldLegacy6MissingLines++;
      if (!in8) {
        foldStillMissing8Lines++;
      } else {
        foldRecoveredLinesTotal++;
        if (!isStrictLower) {
          foldRecoveredMixedCaseLines++;
        } else if (isStop) {
          foldRecoveredStopwordLines++;
        }
      }
    }

    let cachedParsed: { lineYears: Float64Array; sum: number } | null = null;
    const getParsed = () => {
      if (!cachedParsed) cachedParsed = sumLineYears(line);
      return cachedParsed;
    };

    if (!in8) {
      foldMissingMarginal8Lines++;
    } else if (isStop) {
      foldStopwordRejectedLines++;
      if (NEW_7A1_STOPWORDS.has(w1) || NEW_7A1_STOPWORDS.has(w2)) {
        const { sum } = getParsed();
        if (sum > 0) {
          let rec = newStopwordHits.get(key);
          if (!rec) {
            rec = { w1, w2, strictCount: 0, foldCount: 0, lineCount: 0 };
            newStopwordHits.set(key, rec);
          }
          rec.foldCount += sum;
          rec.lineCount++;
          if (isStrictLower) rec.strictCount += sum;
        }
      }
    } else {
      const { lineYears, sum } = getParsed();
      if (unigramMap6 && !in6 && in8 && isStrictLower) {
        if (sum === 0) foldRecoveredZeroWindowLines++;
        else foldRecoveredValidStrictLines++;
      }
      if (sum > 0) {
        foldValidLines++;
        let fArr = foldMixedAgg.get(key);
        if (!fArr) {
          fArr = new Float64Array(lineYears);
          foldMixedAgg.set(key, fArr);
        } else {
          for (let i = 0; i < numYears; i++) fArr[i] += lineYears[i];
        }
        if (isStrictLower) {
          let sArr = strictLowerAgg.get(key);
          if (!sArr) {
            sArr = new Float64Array(lineYears);
            strictLowerAgg.set(key, sArr);
          } else {
            for (let i = 0; i < numYears; i++) sArr[i] += lineYears[i];
          }
        }
      }
    }

    // Primary active caseMode pipeline accounting
    if (caseMode === 'strict-lowercase' && !isStrictLower) {
      nonAlphaSkipped++;
      return;
    }

    if (unigramMap6 && !in6) {
      legacy6MissingMarginalCount++;
      if (in8) {
        recoveredBy17And19Lines++;
      }
    }

    if (!in8) {
      missingMarginalSkipped++;
      return;
    }

    if (isStop) {
      stopwordRejected++;
      return;
    }

    const { lineYears, sum } = getParsed();
    if (sum === 0) {
      zeroInWindowSkipped++;
      return;
    }

    validLinesAggregated++;
    let existing = agg.get(key);
    if (!existing) {
      existing = lineYears;
      agg.set(key, existing);
    } else {
      for (let i = 0; i < numYears; i++) existing[i] += lineYears[i];
    }
  };

  const consumePromise = new Promise<void>((resolve, reject) => {
    gunzip.on('data', (chunk: Buffer) => {
      decompressedBytes += chunk.byteLength;
      leftover += chunk.toString('utf8');
      let start = 0;
      let nl = leftover.indexOf('\n', start);
      while (nl !== -1) {
        processLine(leftover.slice(start, nl));
        start = nl + 1;
        nl = leftover.indexOf('\n', start);
      }
      leftover = leftover.slice(start);
    });
    gunzip.on('end', () => {
      if (leftover.length > 0) {
        processLine(leftover);
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
        const ok = gunzip.write(value);
        if (!ok) await new Promise<void>((r) => gunzip.once('drain', r));
      }
    }
    gunzip.end();
  } catch (err) {
    gunzip.destroy(err as Error);
    throw err;
  }

  await consumePromise;
  if (!gunzipEnded) {
    throw new Error(`Gunzip stream for ${shard} did not terminate cleanly`);
  }
  if (expectedGzBytes !== null && gzBytes !== expectedGzBytes) {
    throw new Error(`Compressed size mismatch for ${shard}: got ${gzBytes}, expected ${expectedGzBytes}`);
  }

  const inputGzSha256 = gzHash.digest('hex');

  // Sort keys deterministically and write atomically via .tmp -> fsync -> rename
  const sortedKeys = Array.from(agg.keys()).sort();
  const dataFile = path.join(outDir, `${shard}.${caseMode}.sorted.json`);
  const tmpDataFile = `${dataFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmpDataFile, 'w');
  const outHash = crypto.createHash('sha256');
  try {
    const writeChunk = (s: string) => {
      outHash.update(s);
      const buf = Buffer.from(s, 'utf8');
      let off = 0;
      while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    };
    writeChunk('{');
    for (let i = 0; i < sortedKeys.length; i++) {
      const k = sortedKeys[i];
      const arr = Array.from(agg.get(k)!);
      writeChunk(`${i > 0 ? ',' : ''}${JSON.stringify(k)}:${JSON.stringify(arr)}`);
    }
    writeChunk('}');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpDataFile, dataFile);

  // Statistical summary across sorted keys with revised 8-shard marginals & stopwords
  let passingCount = 0;
  let rejectedLowCount = 0;
  let rejectedLowPmi = 0;
  let rejectedLowTScore = 0;
  const topPassing: any[] = [];
  const recoveredPassing: any[] = [];

  for (const key of sortedKeys) {
    const sp = key.indexOf(' ');
    const w1 = key.slice(0, sp);
    const w2 = key.slice(sp + 1);
    const arr = agg.get(key)!;
    const stats = computeYearStratifiedStats({
      bigramAnnual: arr,
      w1Annual: unigramMap8.get(w1)!,
      w2Annual: unigramMap8.get(w2)!,
      totals,
      reverseCount: 0,
    });
    if (passesCorpusThresholds(stats, DEFAULT_PILOT_THRESHOLDS)) {
      passingCount++;
      const entry = {
        phrase: key,
        O: stats.observedCount,
        EStrat: Math.round(stats.expectedCount * 100) / 100,
        EPool: Math.round(stats.pooledExpectedCount * 100) / 100,
        pmi: stats.pmi,
        pooledPmi: stats.pooledPmi,
        tScore: stats.tScore,
        heuristicScore: computeCorpusHeuristicScore(stats),
      };
      topPassing.push(entry);
      if (unigramMap6 && (!unigramMap6.has(w1) || !unigramMap6.has(w2))) {
        recoveredPassing.push(entry);
      }
    } else if (stats.observedCount < DEFAULT_PILOT_THRESHOLDS.minCount) {
      rejectedLowCount++;
    } else if (stats.pmi < DEFAULT_PILOT_THRESHOLDS.minPmi) {
      rejectedLowPmi++;
    } else {
      rejectedLowTScore++;
    }
  }

  topPassing.sort((a, b) => b.tScore - a.tScore || (a.phrase < b.phrase ? -1 : 1));
  recoveredPassing.sort((a, b) => b.tScore - a.tScore || (a.phrase < b.phrase ? -1 : 1));

  // Case-normalization A/B delta: compare foldMixedAgg vs strictLowerAgg directly
  let foldPassingCount = 0;
  let strictPassingCount = 0;
  let passingWithCaseInflationCount = 0;
  let onlyFoldPassingCount = 0;
  const caseDeltaSamples: any[] = [];
  const foldOnlyPassingSamples: any[] = [];

  for (const key of Array.from(foldMixedAgg.keys()).sort()) {
    const sp = key.indexOf(' ');
    const w1 = key.slice(0, sp);
    const w2 = key.slice(sp + 1);
    const w1Arr = unigramMap8.get(w1)!;
    const w2Arr = unigramMap8.get(w2)!;
    const fArr = foldMixedAgg.get(key)!;
    const sArr = strictLowerAgg.get(key);

    const fStats = computeYearStratifiedStats({ bigramAnnual: fArr, w1Annual: w1Arr, w2Annual: w2Arr, totals });
    const fPass = passesCorpusThresholds(fStats, DEFAULT_PILOT_THRESHOLDS);
    if (fPass) foldPassingCount++;

    const sStats = sArr
      ? computeYearStratifiedStats({ bigramAnnual: sArr, w1Annual: w1Arr, w2Annual: w2Arr, totals })
      : null;
    const sPass = sStats ? passesCorpusThresholds(sStats, DEFAULT_PILOT_THRESHOLDS) : false;
    if (sPass) strictPassingCount++;

    if (fPass && !sPass) {
      onlyFoldPassingCount++;
      foldOnlyPassingSamples.push({
        phrase: key,
        O_fold: fStats.observedCount,
        O_strict: sStats ? sStats.observedCount : 0,
        pmi_fold: fStats.pmi,
        pmi_strict: sStats ? sStats.pmi : null,
        t_fold: fStats.tScore,
        t_strict: sStats ? sStats.tScore : null,
      });
    } else if (fPass && sStats && fStats.observedCount > sStats.observedCount) {
      passingWithCaseInflationCount++;
      const deltaO = fStats.observedCount - sStats.observedCount;
      const pctInflation = Math.round((deltaO / fStats.observedCount) * 10000) / 100;
      const deltaPmi = Math.round((fStats.pmi - sStats.pmi) * 1000) / 1000;
      caseDeltaSamples.push({
        phrase: key,
        O_strict: sStats.observedCount,
        O_fold: fStats.observedCount,
        deltaO,
        pctMixedCaseInFold: pctInflation,
        pmi_strict: sStats.pmi,
        pmi_fold: fStats.pmi,
        deltaPmi,
      });
    }
  }

  caseDeltaSamples.sort((a, b) => b.deltaPmi - a.deltaPmi || b.deltaO - a.deltaO);
  foldOnlyPassingSamples.sort((a, b) => b.O_fold - a.O_fold);

  const topNewStopwords = Array.from(newStopwordHits.values())
    .sort((a, b) => b.strictCount - a.strictCount || b.foldCount - a.foldCount)
    .slice(0, 25);

  sampleMem();
  const endIso = new Date().toISOString();
  const elapsedSec = Math.round(((performance.now() - t0) / 1000) * 100) / 100;
  const cpuDelta = process.cpuUsage(cpu0);
  const dataStat = fs.statSync(dataFile);
  const outputSha256 = outHash.digest('hex');

  const caseFoldedMerges = validLinesAggregated - sortedKeys.length;
  const accountedTotal =
    emptyLines +
    malformedNoTab +
    posTaggedSkipped +
    nonAlphaSkipped +
    missingMarginalSkipped +
    stopwordRejected +
    zeroInWindowSkipped +
    validLinesAggregated;

  const meta = {
    pid: process.pid,
    ppid: process.ppid,
    runId,
    shard,
    caseMode,
    url,
    startTime: startIso,
    endTime: endIso,
    elapsedSec,
    cpuUserSec: Math.round((cpuDelta.user / 1e6) * 100) / 100,
    cpuSystemSec: Math.round((cpuDelta.system / 1e6) * 100) / 100,
    peakRssMB: Math.round((peakRssBytes / 1048576) * 100) / 100,
    peakHeapUsedMB: Math.round((peakHeapUsedBytes / 1048576) * 100) / 100,
    compressedBytes: gzBytes,
    expectedContentLength: expectedGzBytes,
    decompressedBytes,
    inputGzSha256,
    gunzipCompletedWithoutError: gunzipEnded,
    outputDataFile: dataFile,
    outputSizeBytes: dataStat.size,
    outputDataSha256: outputSha256,
    reconciliation: {
      totalLines,
      emptyLines,
      malformedNoTab,
      posTaggedSkipped,
      nonAlphaSkipped,
      mixedCaseLinesFiltered,
      missingMarginalSkipped,
      legacy6MissingMarginalCount,
      recoveredBy17And19Lines,
      stopwordRejected,
      zeroInWindowSkipped,
      validLinesAggregated,
      caseFoldedMerges,
      uniqueRetainedKeys: sortedKeys.length,
      reconciliationDelta: totalLines - accountedTotal,
    },
    foldMixedVsStrictComparison: {
      foldLegacy6MissingLines,
      foldStillMissing8Lines,
      foldRecoveredLinesTotal,
      foldRecoveredMixedCaseLines,
      foldRecoveredStopwordLines,
      foldRecoveredZeroWindowLines,
      foldRecoveredValidStrictLines,
      foldMissingMarginal8Lines,
      foldStopwordRejectedLines,
      foldValidLines,
      foldUniqueKeys: foldMixedAgg.size,
      strictUniqueKeys: strictLowerAgg.size,
      foldPassingCount,
      strictPassingCount,
      onlyFoldPassingCount,
      passingWithCaseInflationCount,
      topFoldOnlyPassing: foldOnlyPassingSamples.slice(0, 15),
      topDeltaPmiPassing: caseDeltaSamples.slice(0, 15),
    },
    new7a1StopwordAudit: {
      uniquePairsCaught: newStopwordHits.size,
      top25ByStrictCount: topNewStopwords,
    },
    statisticalSummary: {
      passingCount,
      rejectedLowCount,
      rejectedLowPmi,
      rejectedLowTScore,
      recoveredPassingCount: recoveredPassing.length,
      top15ByTScore: topPassing.slice(0, 15),
      top10RecoveredBy17And19: recoveredPassing.slice(0, 10),
    },
  };

  const metaFile = path.join(outDir, `${shard}.${caseMode}.meta.json`);
  atomicWriteFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify(meta, null, 2));
}

async function main() {
  const mode = process.argv[2] || 'audit-unigrams';
  if (mode === 'audit-unigrams') {
    await auditUnigrams();
  } else if (mode === 'stream-isolated') {
    const shard = process.argv[3];
    const outDir = process.argv[4];
    const caseMode = (process.argv[5] as CaseMode) || 'strict-lowercase';
    if (!shard || !outDir) {
      throw new Error('Usage: stream-isolated <shard> <outDir> [strict-lowercase|fold-mixed]');
    }
    if (shard !== '2-00478-of-00589.gz' && shard !== '2-00493-of-00589.gz') {
      throw new Error(`Milestone 7A.1 guard: refusing disallowed shard ${shard}`);
    }
    if (caseMode !== 'strict-lowercase' && caseMode !== 'fold-mixed') {
      throw new Error(`Invalid caseMode: ${caseMode}`);
    }
    await streamSingleBigramIsolated(shard, outDir, caseMode);
  } else {
    throw new Error(`Unsupported mode: ${mode}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
