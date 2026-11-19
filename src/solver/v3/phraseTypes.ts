/**
 * Flipit Finder V3 — Phrase Discovery Types & Provider Interfaces
 * Defines granular match types (open, closed, hyphenated), provenance metadata,
 * score decomposition, and asynchronous partition loading interfaces for phrase validation.
 */

import type { PhraseProvider, PhraseRecord } from '../types.ts';
import type { PartitionLoadStats } from './types.ts';

export type PhraseMatchType = 'open' | 'closed' | 'hyphenated';

/**
 * Extended phrase match record with transparent provenance, match type,
 * and explicit distinction between empirical frequency and project heuristic score.
 */
export interface V3PhraseMatch extends PhraseRecord {
  normalizedPhrase: string; // e.g. "FAST FOOD"
  originalPhraseForm: string; // e.g. "fast food", "fast-food", or "fastfood"
  phraseCategory: string; // e.g. "compound", "collocation", "idiom", "benchmark"
  sourceDataset: string; // e.g. "Moby Compound Words", "Princeton WordNet 3.0", "Curated Phrase Repository"
  empiricalFrequency?: number | null; // Raw corpus frequency count only when provided by source; null otherwise
  heuristicScore: number; // Project heuristic score (0.0 to 1.0), clearly labeled
  pmi?: number | null; // Pointwise mutual information (log2 O/E) when sourced from empirical corpus
  tScore?: number | null; // Collocation t-score ((O - E) / sqrt(O)) when sourced from empirical corpus
  orderRatio?: number | null; // Forward-to-reverse directional frequency ratio C(w1,w2) / (C(w2,w1) + 1)
  reverseCount?: number | null; // Empirical corpus frequency of reversed bigram (w2, w1)
  explanation: string;
  matchType: PhraseMatchType;
  isReversed?: boolean; // Set to true if matched in reverse order (word2 word1)
}

export interface V3PhraseLookupDiagnostics {
  word1: string;
  word2: string;
  normalizedQuery: string;
  providerQueried: string;
  found: boolean;
  matchType?: PhraseMatchType;
  sourceProvenance?: string;
  heuristicScore?: number;
  empiricalFrequency?: number | null;
  pmi?: number | null;
  tScore?: number | null;
  orderRatio?: number | null;
  lookupLatencyMs: number;
  loadingLatencyMs: number;
  partitionUsed?: string;
  partitionLoadedFromDisk?: boolean;
}

/**
 * Asynchronous phrase provider interface supporting on-demand letter partition loading.
 */
export interface AsyncPhraseProvider extends PhraseProvider {
  readonly providerName: string;

  /** Check if word1 and word2 form an established phrase or compound asynchronously */
  matchPhraseAsync(
    word1: string,
    word2: string,
    allowCompound?: boolean
  ): Promise<V3PhraseMatch | null>;

  /** Check if word1 and word2 are recognized as a valid collocation asynchronously */
  isRecognizedPhraseAsync(word1: string, word2: string): Promise<boolean>;

  /** Preload letter partition(s) into memory cache */
  preloadPartition?(letter: string): Promise<PartitionLoadStats>;

  /** Execute lookup with full performance, match type, and score diagnostics */
  lookupWithDiagnostics(
    word1: string,
    word2: string,
    allowCompound?: boolean
  ): Promise<{ match: V3PhraseMatch | null; diagnostics: V3PhraseLookupDiagnostics }>;
}
