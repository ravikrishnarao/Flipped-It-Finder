/**
 * Flipit Finder V3 — Compound Phrase Provider
 * Queries Moby Compound Words letter partitions (137,852 phrases) asynchronously on demand.
 * Validates open compound expressions, closed compound nouns, and hyphenated terms.
 */

import type { PhraseRecord } from '../types.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncPhraseProvider,
  PhraseMatchType,
  V3PhraseLookupDiagnostics,
  V3PhraseMatch,
} from './phraseTypes.ts';
import type { PartitionLoadStats } from './types.ts';

export class CompoundPhraseProvider implements AsyncPhraseProvider {
  public readonly providerName = 'CompoundPhraseProvider';

  private loader: PartitionLoader;
  private basePath: string;
  private partitionIndex = new Map<string, Map<string, PhraseRecord[]>>();

  constructor(loader?: PartitionLoader, basePath = 'data/v3/compiled/moby/phrases') {
    this.loader = loader || new PartitionLoader();
    this.basePath = basePath;
    this.loader.onEvict((relPath) => {
      const m = relPath.match(/phrases_([a-z0-9])\.json$/i);
      if (m) {
        this.partitionIndex.delete(m[1].toUpperCase());
      }
    });
  }

  private normalizeToken(token: string): string {
    if (!token) return '';
    return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  public getPartitionRelativePath(letter: string): string {
    return `${this.basePath}/phrases_${letter.toLowerCase()}.json`;
  }

  public async preloadPartition(letter: string): Promise<PartitionLoadStats> {
    const relPath = this.getPartitionRelativePath(letter);
    const { stats } = await this.loader.loadPartition<PhraseRecord[]>(relPath);
    return stats;
  }

  public matchPhrase(
    word1: string,
    word2: string,
    allowCompound = true
  ): V3PhraseMatch | null {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    const letter = w1.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<PhraseRecord[]>(relPath);
    if (!data || !Array.isArray(data)) return null;

    return this.searchPartition(w1, w2, data, allowCompound);
  }

  public async matchPhraseAsync(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<V3PhraseMatch | null> {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    const letter = w1.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<PhraseRecord[]>(relPath);
    if (!data || !Array.isArray(data)) return null;

    return this.searchPartition(w1, w2, data, allowCompound);
  }

  public isRecognizedPhrase(word1: string, word2: string): boolean {
    return this.matchPhrase(word1, word2) !== null;
  }

  public async isRecognizedPhraseAsync(word1: string, word2: string): Promise<boolean> {
    const match = await this.matchPhraseAsync(word1, word2);
    return match !== null;
  }

  public async lookupWithDiagnostics(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<{ match: V3PhraseMatch | null; diagnostics: V3PhraseLookupDiagnostics }> {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    const letter = w1.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);

    const loadStart = performance.now();
    const { data, stats } = await this.loader.loadPartition<PhraseRecord[]>(relPath);
    const loadEnd = performance.now();
    const loadingLatencyMs = Math.round((loadEnd - loadStart) * 100) / 100;

    const lookupStart = performance.now();
    const match = data ? this.searchPartition(w1, w2, data, allowCompound) : null;
    const lookupEnd = performance.now();
    const lookupLatencyMs = Math.round((lookupEnd - lookupStart) * 100) / 100;

    const diagnostics: V3PhraseLookupDiagnostics = {
      word1,
      word2,
      normalizedQuery: `${w1} ${w2}`,
      providerQueried: this.providerName,
      found: match !== null,
      matchType: match?.matchType,
      sourceProvenance: match?.sourceDataset,
      heuristicScore: match?.heuristicScore,
      empiricalFrequency: match?.empiricalFrequency ?? null,
      lookupLatencyMs,
      loadingLatencyMs,
      partitionUsed: stats.partition,
      partitionLoadedFromDisk: !stats.cached,
    };

    return { match, diagnostics };
  }

  private getOrBuildIndex(letter: string, partition: PhraseRecord[]): Map<string, PhraseRecord[]> {
    let index = this.partitionIndex.get(letter);
    if (!index) {
      index = new Map<string, PhraseRecord[]>();
      for (const record of partition) {
        const rw1 = this.normalizeToken(record.word1);
        let list = index.get(rw1);
        if (!list) {
          list = [];
          index.set(rw1, list);
        }
        list.push(record);
      }
      this.partitionIndex.set(letter, index);
    }
    return index;
  }

  private searchPartition(
    w1: string,
    w2: string,
    partition: PhraseRecord[],
    allowCompound: boolean
  ): V3PhraseMatch | null {
    const letter = w1.charAt(0);
    const index = this.getOrBuildIndex(letter, partition);
    const candidates = index.get(w1);
    if (!candidates) return null;

    const targetOpen = `${w1} ${w2}`;
    const targetClosed = `${w1}${w2}`;
    const targetHyphen = `${w1}-${w2}`;

    for (const record of candidates) {
      const rw2 = this.normalizeToken(record.word2);

      // 1. Direct Open Compound Match
      if (rw2 === w2) {
        return this.toV3Match(record, 'open', targetOpen);
      }

      // 2. Closed & Hyphenated Alternate Forms Check
      if (allowCompound && record.alternateForms && Array.isArray(record.alternateForms)) {
        for (const alt of record.alternateForms) {
          const cleanAlt = alt.trim().toUpperCase();
          if (cleanAlt === targetClosed) {
            return this.toV3Match(record, 'closed', cleanAlt);
          }
          if (cleanAlt === targetHyphen) {
            return this.toV3Match(record, 'hyphenated', cleanAlt);
          }
        }
      }
    }

    return null;
  }

  private toV3Match(
    record: PhraseRecord,
    matchType: PhraseMatchType,
    form: string
  ): V3PhraseMatch {
    const norm = `${this.normalizeToken(record.word1)} ${this.normalizeToken(record.word2)}`;
    return {
      phrase: record.phrase || norm,
      word1: record.word1,
      word2: record.word2,
      frequencyScore: 0.94,
      category: record.category || 'moby-compound',
      alternateForms: record.alternateForms || [],
      normalizedPhrase: norm,
      originalPhraseForm: form,
      phraseCategory: 'compound',
      sourceDataset: 'Moby Compound Words (Grady Ward)',
      empiricalFrequency: null, // Moby provides structural lexicalization, not empirical counts
      heuristicScore: 0.94,
      explanation: `Verified as established ${matchType} expression in Moby Compound Lexicon`,
      matchType,
    };
  }

  public getCacheStats(): { loadedPartitions: string[]; cacheSizeBytes: number } {
    return {
      loadedPartitions: this.loader.getLoadedPartitions(),
      cacheSizeBytes: this.loader.getCacheSizeBytes(),
    };
  }
}
