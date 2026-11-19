/**
 * Flipit Finder V3 — Corpus Statistical Estimator & Stopword Filtering (Milestone 7A)
 *
 * Implements year-stratified collocation statistics for Google Books Ngrams (1950–2019),
 * eliminating corpus-growth Simpson's paradox bias caused by pooling counts across decades
 * whose annual book volumes vary by >3.3× (8.6B tokens in 1950 vs 28.8B tokens in 2008).
 */

export const PILOT_DEFAULT_START_YEAR = 1950;
export const PILOT_DEFAULT_END_YEAR = 2019;

export interface AnnualTotalCounts {
  startYear: number;
  endYear: number;
  n1ByYear: Float64Array; // totalcounts-1 annual match totals N_{1,y}
  n2ByYear: Float64Array; // totalcounts-2 annual match totals N_{2,y}
}

export interface StratifiedCollocationStats {
  observedCount: number;
  expectedCount: number;
  pmi: number;
  tScore: number;
  reverseCount: number;
  orderRatio: number;
  activeYears: number;
  pooledExpectedCount: number;
  pooledPmi: number;
}

export interface CorpusThresholds {
  minCount: number;
  minPmi: number;
  minTScore: number;
}

export const DEFAULT_PILOT_THRESHOLDS: CorpusThresholds = {
  minCount: 500,
  minPmi: 2.0,
  minTScore: 2.0,
};

/**
 * Pure closed-class English function words excluded from Tier-4 collocations.
 * Deliberately excludes polysemous content words (e.g., OLD, NEW, LONG, SHORT, WELL, WORK, RIGHT, BACK, HOME)
 * so adjective-noun and verb-noun idioms are never wrongly discarded.
 */
export const CORPUS_FUNCTION_STOPWORDS = new Set<string>([
  // Articles & Demonstratives
  'A', 'AN', 'THE', 'THIS', 'THAT', 'THESE', 'THOSE', 'SUCH', 'EACH', 'EVERY',
  'EITHER', 'NEITHER', 'BOTH', 'ANOTHER',
  // Pronouns
  'I', 'ME', 'MY', 'MINE', 'MYSELF',
  'WE', 'US', 'OUR', 'OURS', 'OURSELVES',
  'YOU', 'YOUR', 'YOURS', 'YOURSELF', 'YOURSELVES',
  'HE', 'HIM', 'HIS', 'HIMSELF',
  'SHE', 'HER', 'HERS', 'HERSELF',
  'IT', 'ITS', 'ITSELF',
  'THEY', 'THEM', 'THEIR', 'THEIRS', 'THEMSELVES',
  'WHO', 'WHOM', 'WHOSE', 'WHICH', 'WHAT', 'WHATEVER', 'WHICHEVER', 'WHOEVER',
  // Wh-relatives, Pro-adverbs & Deictic Function Words
  'WHERE', 'WHEN', 'WHY', 'HOW',
  'WHEREVER', 'WHENEVER', 'WHEREIN', 'WHEREOF', 'WHEREON', 'WHEREBY', 'WHEREUPON', 'WHEREWITH', 'WHENCE',
  'HERE', 'HEREIN', 'HEREOF', 'HERETO', 'HEREBY', 'HEREUPON',
  'THERE', 'THEREIN', 'THEREON', 'THERETO', 'THEREOF', 'THEREBY', 'THEREFORE', 'THEREUPON', 'THENCE',
  // Closed-Class Prepositions & Infinitive Marker
  'OF', 'IN', 'TO', 'FOR', 'WITH', 'ON', 'AT', 'FROM', 'BY', 'ABOUT', 'AS',
  'INTO', 'THROUGH', 'THROUGHOUT', 'DURING', 'BEFORE', 'AFTER',
  'ABOVE', 'BELOW', 'UNDER', 'OVER', 'BENEATH', 'UNDERNEATH',
  'BETWEEN', 'AMONG', 'AMID', 'AMIDST', 'AGAINST', 'WITHIN', 'WITHOUT',
  'UPON', 'TOWARD', 'TOWARDS', 'UNTO', 'BESIDE', 'BESIDES', 'ALONGSIDE',
  'EXCEPT', 'BEYOND', 'DESPITE', 'PER', 'VIA', 'ONTO',
  // Auxiliaries, Copula & Modals
  'BE', 'AM', 'IS', 'ARE', 'WAS', 'WERE', 'BEEN', 'BEING',
  'HAVE', 'HAS', 'HAD', 'HAVING',
  'DO', 'DOES', 'DID', 'DOING',
  'SHALL', 'SHOULD', 'WILL', 'WOULD', 'CAN', 'COULD', 'MAY', 'MIGHT', 'MUST',
  // Coordinating / Subordinating Conjunctions & Structural Negation/Fillers
  'AND', 'OR', 'NOR', 'BUT', 'YET', 'SO', 'IF', 'BECAUSE', 'ALTHOUGH', 'THOUGH',
  'WHILE', 'WHEREAS', 'UNLESS', 'UNTIL', 'SINCE', 'THAN', 'WHETHER', 'NOT',
  'ALSO', 'VERY', 'TOO', 'QUITE', 'RATHER', 'HOWEVER', 'THUS', 'HENCE',
  'INDEED', 'PERHAPS', 'SAID',
]);

export function isCorpusStopword(word: string): boolean {
  return CORPUS_FUNCTION_STOPWORDS.has(word.trim().toUpperCase());
}

/**
 * Check whether an untagged 1-gram or 2-gram conforms to strict ASCII lowercase
 * (`[a-z]{2,20}` / `[a-z]{2,20} [a-z]{2,20}`), matching Google Books `1-00016..00023`
 * lowercase-partitioned marginals and preventing Titlecase/proper-noun numerator asymmetry.
 */
export function isStrictLowerAlphaToken(raw: string): boolean {
  return /^[a-z]{2,20}$/.test(raw);
}

export function isStrictLowerAlphaBigram(raw: string): boolean {
  return /^[a-z]{2,20} [a-z]{2,20}$/.test(raw);
}

export function isAnyCaseAlphaToken(raw: string): boolean {
  return /^[a-zA-Z]{2,20}$/.test(raw);
}

export function isAnyCaseAlphaBigram(raw: string): boolean {
  return /^[a-zA-Z]{2,20} [a-zA-Z]{2,20}$/.test(raw);
}

/**
 * Parse Google Books `totalcounts-1` or `totalcounts-2` tab-separated payload:
 * Format: `\t1500,123,45,6\t1950,8628456789,2500000,12345\t...`
 */
export function parseTotalCountsText(text: string, startYear: number, endYear: number): Float64Array {
  const numYears = endYear - startYear + 1;
  const totals = new Float64Array(numYears);
  const parts = text.split('\t');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(',');
    if (cols.length < 2) continue;
    const y = Number.parseInt(cols[0], 10);
    if (y >= startYear && y <= endYear) {
      const matchCount = Number.parseFloat(cols[1]);
      if (Number.isFinite(matchCount) && matchCount > 0) {
        totals[y - startYear] += matchCount;
      }
    }
  }
  return totals;
}

/**
 * Determine whether a raw Google Books TSV n-gram key contains POS tags (e.g. `_NOUN`, `_VERB_`).
 * Official `20200217` exports contain BOTH untagged lines and overlapping POS-tagged lines;
 * summing them causes 2x–4x double-counting, so POS-tagged records must be excluded from primary counts.
 */
export function isPosTaggedNgram(rawNgram: string): boolean {
  return rawNgram.includes('_');
}

/**
 * Parse year,match_count,volume_count tuples from a single Google Books TSV line
 * into a pre-allocated annual array covering [startYear, endYear].
 */
export function accumulateAnnualTupleCells(
  tabParts: string[],
  startIndex: number,
  outAnnualCounts: Float64Array,
  startYear: number,
  endYear: number
): void {
  for (let i = startIndex; i < tabParts.length; i++) {
    const cell = tabParts[i];
    if (!cell) continue;
    const c1 = cell.indexOf(',');
    if (c1 <= 0) continue;
    const year = Number.parseInt(cell.slice(0, c1), 10);
    if (year < startYear || year > endYear) continue;
    const c2 = cell.indexOf(',', c1 + 1);
    const countStr = c2 > c1 ? cell.slice(c1 + 1, c2) : cell.slice(c1 + 1);
    const count = Number.parseInt(countStr, 10);
    if (count > 0) {
      outAnnualCounts[year - startYear] += count;
    }
  }
}

/**
 * Year-stratified collocation estimator:
 *
 *   O       = sum_{y=Y0..Y1} C_y(w1, w2)
 *   E_strat = sum_{y=Y0..Y1} N_{2,y} * (C_y(w1) / N_{1,y}) * (C_y(w2) / N_{1,y})
 *   PMI     = log2(O / E_strat)
 *   t-score = (O - E_strat) / sqrt(O)
 *
 * Also computes pooled expectation/PMI for diagnostic comparison and Simpson's-paradox verification.
 */
export function computeYearStratifiedStats(params: {
  bigramAnnual: ArrayLike<number>;
  w1Annual: ArrayLike<number>;
  w2Annual: ArrayLike<number>;
  totals: AnnualTotalCounts;
  reverseCount?: number;
}): StratifiedCollocationStats {
  const { bigramAnnual, w1Annual, w2Annual, totals, reverseCount = 0 } = params;
  const numYears = totals.endYear - totals.startYear + 1;

  let O = 0;
  let EStrat = 0;
  let activeYears = 0;

  let sumW1 = 0;
  let sumW2 = 0;
  let sumN1 = 0;
  let sumN2 = 0;

  for (let i = 0; i < numYears; i++) {
    const cy = bigramAnnual[i] || 0;
    const cw1 = w1Annual[i] || 0;
    const cw2 = w2Annual[i] || 0;
    const n1 = totals.n1ByYear[i] || 0;
    const n2 = totals.n2ByYear[i] || 0;

    if (cy > 0) {
      O += cy;
      activeYears++;
    }
    if (n1 > 0 && n2 > 0) {
      sumW1 += cw1;
      sumW2 += cw2;
      sumN1 += n1;
      sumN2 += n2;
      if (cw1 > 0 && cw2 > 0) {
        EStrat += n2 * (cw1 / n1) * (cw2 / n1);
      }
    }
  }

  const safeE = Math.max(EStrat, 1e-12);
  const pmi = O > 0 ? Math.log2(O / safeE) : -Infinity;
  const tScore = O > 0 ? (O - EStrat) / Math.sqrt(O) : 0;

  const EPooled = sumN1 > 0 ? sumN2 * (sumW1 / sumN1) * (sumW2 / sumN1) : 0;
  const safeEPooled = Math.max(EPooled, 1e-12);
  const pooledPmi = O > 0 ? Math.log2(O / safeEPooled) : -Infinity;

  const orderRatio = O / (Math.max(0, reverseCount) + 1);

  return {
    observedCount: O,
    expectedCount: EStrat,
    pmi: Math.round(pmi * 1000) / 1000,
    tScore: Math.round(tScore * 1000) / 1000,
    reverseCount,
    orderRatio: Math.round(orderRatio * 1000) / 1000,
    activeYears,
    pooledExpectedCount: EPooled,
    pooledPmi: Math.round(pooledPmi * 1000) / 1000,
  };
}

/**
 * Evaluate whether statistical metrics pass configurable thresholds.
 */
export function passesCorpusThresholds(
  stats: StratifiedCollocationStats,
  thresholds: CorpusThresholds = DEFAULT_PILOT_THRESHOLDS
): boolean {
  return (
    Number.isFinite(stats.pmi) &&
    Number.isFinite(stats.tScore) &&
    stats.observedCount >= thresholds.minCount &&
    stats.pmi >= thresholds.minPmi &&
    stats.tScore >= thresholds.minTScore
  );
}

/**
 * Map empirical collocation statistics into a conservative Tier-4 heuristic score in [0.62, 0.88].
 * - Strictly below WordNet (0.96), Moby (0.94), and Curated (0.98-1.0) so dictionaries always outrank Tier-4.
 * - Order asymmetry gently adjusts ranking without hard-rejecting symmetric idioms.
 */
export function computeCorpusHeuristicScore(stats: StratifiedCollocationStats): number {
  const pmiNorm = Math.max(0, Math.min(1, (stats.pmi - 2.0) / 8.0));
  const freqNorm = Math.max(0, Math.min(1, (Math.log10(Math.max(1, stats.observedCount)) - 2.7) / 3.3));
  let orderAdj = 0;
  if (stats.orderRatio >= 2.0) {
    orderAdj = 0.02;
  } else if (stats.orderRatio < 0.5) {
    orderAdj = -0.04;
  }
  const raw = 0.62 + 0.14 * pmiNorm + 0.10 * freqNorm + orderAdj;
  return Math.round(Math.max(0.62, Math.min(0.88, raw)) * 10000) / 10000;
}
