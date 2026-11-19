/**
 * Flipit Finder V3 — Partitioned Tier-4 External Corpus Plugin (Milestone 7A)
 *
 * Queries offline letter-partitioned empirical bigram tables compiled from
 * Google Books English Ngrams (Release 20200217, CC BY 3.0, 1950–2019 window).
 *
 * Key architectural guarantees:
 *   - Dedicated bounded PartitionLoader (maxPartitions: 8, maxCacheBytes: 16 MiB)
 *     completely isolated from Lexical/Moby/WordNet PartitionLoader caches.
 *   - Zero runtime network calls; reads only local compiled JSON partitions.
 *   - Strict zero-disk-I/O in querySync(): returns null on uncached partitions so
 *     the solver cross-product loop never blocks on filesystem reads.
 *   - Explicit statistical provenance: empiricalFrequency (raw count), PMI,
 *     t-score, reverseCount, orderRatio, and corpus source label.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExternalCorpusPhraseResult, ExternalCorpusPlugin } from './collocationPhraseProvider.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type { PhraseMatchType } from './phraseTypes.ts';
import type { PartitionLoadStats } from './types.ts';

export const CORPUS_PLUGIN_MAX_PARTITIONS = 8;
export const CORPUS_PLUGIN_MAX_CACHE_BYTES = 16 * 1024 * 1024; // 16 MiB dedicated cap

/**
 * Compact serialized bigram entry stored in `corpus_{letter}.json`:
 * Tuple layout: [count, pmi, tScore, reverseCount, orderRatio, heuristicScore]
 * OR object layout for readability/extensibility.
 */
export interface CorpusPartitionRecord {
  c: number; // Stratified/aggregated 1950-2019 raw count O
  pmi: number; // Year-stratified PMI = log2(O / E)
  t: number; // Year-stratified t-score = (O - E) / sqrt(O)
  rc: number; // Reverse bigram count C(w2, w1) in same window (0 if below export cutoff or unobserved in pilot)
  or: number; // Directional order ratio C(w1, w2) / (C(w2, w1) + 1)
  s: number; // Conservative Tier-4 heuristic score in [0.62, 0.88]
}

export type CorpusPartitionData = Record<string, Record<string, CorpusPartitionRecord>>;

export interface PartitionedCorpusPluginOptions {
  basePath?: string;
  sourceName?: string;
  partitionLoader?: PartitionLoader;
  maxPartitions?: number;
  maxCacheBytes?: number;
  minCount?: number;
  minPmi?: number;
  minTScore?: number;
}

export class PartitionedCorpusPlugin implements ExternalCorpusPlugin {
  public readonly name: string;

  private readonly basePath: string;
  private readonly loader: PartitionLoader;
  private readonly missingPartitions = new Set<string>();
  private readonly minCount: number;
  private readonly minPmi: number;
  private readonly minTScore: number;

  constructor(options?: PartitionedCorpusPluginOptions) {
    this.basePath = options?.basePath ?? 'data/v3/compiled/corpus_pilot';
    this.name = options?.sourceName ?? 'Google Books Ngrams English 20200217 (Pilot, 1950-2019)';
    this.minCount = options?.minCount ?? 0;
    this.minPmi = options?.minPmi ?? -Infinity;
    this.minTScore = options?.minTScore ?? -Infinity;

    this.loader =
      options?.partitionLoader ??
      new PartitionLoader({
        maxPartitions: options?.maxPartitions ?? CORPUS_PLUGIN_MAX_PARTITIONS,
        maxCacheBytes: options?.maxCacheBytes ?? CORPUS_PLUGIN_MAX_CACHE_BYTES,
      });
  }

  private normalizeToken(token: string): string {
    if (!token) return '';
    return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  public getPartitionRelativePath(letter: string): string {
    return `${this.basePath}/corpus_${letter.toLowerCase()}.json`;
  }

  public getLoader(): PartitionLoader {
    return this.loader;
  }

  public isPartitionMissing(letter: string): boolean {
    const clean = letter.trim().toUpperCase().charAt(0);
    return this.missingPartitions.has(clean);
  }

  public getMissingPartitions(): string[] {
    return Array.from(this.missingPartitions).sort();
  }

  /**
   * Asynchronously preload a corpus letter partition into the dedicated 16 MiB / 8-partition LRU cache.
   */
  public async preloadPartition(letter: string): Promise<PartitionLoadStats> {
    const clean = letter.trim().toUpperCase().charAt(0);
    if (!clean || !/[A-Z]/.test(clean)) {
      return {
        partition: 'invalid',
        filePath: '',
        sizeBytes: 0,
        loadTimeMs: 0,
        cached: false,
      };
    }

    const relPath = this.getPartitionRelativePath(clean);
    if (this.loader.isCached(relPath)) {
      const { stats } = this.loader.loadPartitionSync<CorpusPartitionData>(relPath);
      return stats;
    }

    const fullPath = this.loader.resolvePath(relPath);
    if (!fs.existsSync(fullPath)) {
      this.missingPartitions.add(clean);
      return {
        partition: path.basename(relPath),
        filePath: relPath,
        sizeBytes: 0,
        loadTimeMs: 0,
        cached: false,
      };
    }

    this.missingPartitions.delete(clean);
    const { stats } = await this.loader.loadPartition<CorpusPartitionData>(relPath);
    return stats;
  }

  private lookupInData(
    data: CorpusPartitionData | null,
    w1: string,
    w2: string,
    allowCompound: boolean
  ): ExternalCorpusPhraseResult | null {
    if (!data) return null;

    // 1. Open bigram lookup (w1, w2)
    const row = data[w1];
    const rec = row ? row[w2] : undefined;
    if (rec && rec.c >= this.minCount && rec.pmi >= this.minPmi && rec.t >= this.minTScore) {
      return {
        count: rec.c,
        score: rec.s,
        pmi: rec.pmi,
        tScore: rec.t,
        orderRatio: rec.or,
        reverseCount: rec.rc,
        sourceDataset: this.name,
        matchType: 'open',
        originalPhraseForm: `${w1.toLowerCase()} ${w2.toLowerCase()}`,
        category: 'corpus-collocation',
        isReversed: false,
      };
    }

    // 2. Closed compound unigram check when allowed: future hook if unigram partition stores fused compounds
    void allowCompound;
    return null;
  }

  /**
   * Deterministic synchronous cache-only lookup.
   * NEVER reads from disk; returns null if the partition is missing or was evicted.
   */
  public querySync(
    word1: string,
    word2: string,
    allowCompound = true
  ): ExternalCorpusPhraseResult | null {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    const letter = w1.charAt(0);
    if (!/[A-Z]/.test(letter) || this.missingPartitions.has(letter)) return null;

    const relPath = this.getPartitionRelativePath(letter);
    if (!this.loader.isCached(relPath)) {
      return null;
    }

    const { data } = this.loader.loadPartitionSync<CorpusPartitionData>(relPath);
    return this.lookupInData(data, w1, w2, allowCompound);
  }

  /**
   * Asynchronous query with lazy partition loading and LRU caching.
   */
  public async query(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<ExternalCorpusPhraseResult | null> {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    const letter = w1.charAt(0);
    if (!/[A-Z]/.test(letter)) return null;

    await this.preloadPartition(letter);
    if (this.missingPartitions.has(letter)) return null;

    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<CorpusPartitionData>(relPath);
    return this.lookupInData(data, w1, w2, allowCompound);
  }

  public getCacheStats() {
    const stats = this.loader.getDetailedCacheStats();
    return {
      loadedPartitions: stats.loadedPartitions,
      partitionCount: stats.partitionCount,
      cacheSizeBytes: stats.cacheSizeBytes,
      maxPartitions: stats.maxPartitions,
      maxCacheBytes: stats.maxCacheBytes,
      hits: stats.hits,
      misses: stats.misses,
      evictions: stats.evictions,
    };
  }
}

export type { PhraseMatchType };
