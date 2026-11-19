/**
 * Flipit Finder V3 — Collocation Phrase Provider
 * Queries Princeton WordNet 3.0 multi-word expressions and dictionary collocations (51,435 phrases).
 * Designed with extensible hooks to accept external licensed bigram corpora in future phases.
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

export interface ExternalCorpusPhraseResult {
  count: number;
  score: number;
  pmi?: number | null;
  tScore?: number | null;
  orderRatio?: number | null;
  reverseCount?: number | null;
  sourceDataset?: string;
  matchType?: PhraseMatchType;
  originalPhraseForm?: string;
  category?: string;
  isReversed?: boolean;
}

export interface ExternalCorpusPlugin {
  name: string;
  query(w1: string, w2: string, allowCompound?: boolean): Promise<ExternalCorpusPhraseResult | null>;
  querySync?(w1: string, w2: string, allowCompound?: boolean): ExternalCorpusPhraseResult | null;
  preloadPartition?(letter: string): Promise<PartitionLoadStats>;
  getCacheStats?(): {
    loadedPartitions: string[];
    partitionCount: number;
    cacheSizeBytes: number;
    maxPartitions: number;
    maxCacheBytes: number;
    hits: number;
    misses: number;
    evictions: number;
  };
}

export class CollocationPhraseProvider implements AsyncPhraseProvider {
  public readonly providerName = 'CollocationPhraseProvider';

  private loader: PartitionLoader;
  private basePath: string;
  private corpusPlugin?: ExternalCorpusPlugin;
  private partitionIndex = new Map<string, Map<string, PhraseRecord[]>>();

  constructor(
    loader?: PartitionLoader,
    basePath = 'data/v3/compiled/wordnet/collocations',
    corpusPlugin?: ExternalCorpusPlugin
  ) {
    this.loader = loader || new PartitionLoader();
    this.basePath = basePath;
    this.corpusPlugin = corpusPlugin;
    this.loader.onEvict((relPath) => {
      const m = relPath.match(/collocations_([a-z0-9])\.json$/i);
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
    return `${this.basePath}/collocations_${letter.toLowerCase()}.json`;
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

    const match = this.searchPartition(w1, w2, data, allowCompound);
    if (match) return match;

    // Optional pluggable corpus query (if an approved licensed corpus is connected)
    if (this.corpusPlugin) {
      const pluginRes = await this.corpusPlugin.query(w1, w2, allowCompound);
      if (pluginRes) {
        const matchType: PhraseMatchType = pluginRes.matchType ?? 'open';
        return {
          phrase: `${w1} ${w2}`,
          word1: w1,
          word2: w2,
          frequencyScore: pluginRes.score,
          category: pluginRes.category ?? 'corpus-collocation',
          alternateForms: matchType === 'closed' ? [`${w1}${w2}`] : [],
          normalizedPhrase: `${w1} ${w2}`,
          originalPhraseForm: pluginRes.originalPhraseForm ?? `${w1.toLowerCase()} ${w2.toLowerCase()}`,
          phraseCategory: 'collocation',
          sourceDataset: pluginRes.sourceDataset ?? this.corpusPlugin.name,
          empiricalFrequency: pluginRes.count,
          heuristicScore: pluginRes.score,
          pmi: pluginRes.pmi ?? null,
          tScore: pluginRes.tScore ?? null,
          orderRatio: pluginRes.orderRatio ?? null,
          reverseCount: pluginRes.reverseCount ?? null,
          isReversed: pluginRes.isReversed,
          explanation: `Verified in ${pluginRes.sourceDataset ?? this.corpusPlugin.name} (count=${pluginRes.count.toLocaleString()}, PMI=${pluginRes.pmi?.toFixed(2) ?? 'N/A'}, t=${pluginRes.tScore?.toFixed(2) ?? 'N/A'})`,
          matchType,
        };
      }
    }

    return null;
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

      if (rw2 === w2) {
        if (record.category === 'wordnet-compound') {
          if (!allowCompound) return null;
          const closedForm = record.alternateForms?.[0] || targetClosed;
          return this.toV3Match(record, 'closed', closedForm);
        }
        return this.toV3Match(record, 'open', targetOpen);
      }

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
      frequencyScore: 0.96,
      category: record.category || 'wordnet-collocation',
      alternateForms: record.alternateForms || [],
      normalizedPhrase: norm,
      originalPhraseForm: form,
      phraseCategory: 'collocation',
      sourceDataset: 'Princeton WordNet 3.0 Collocations',
      empiricalFrequency: null,
      heuristicScore: 0.96,
      explanation: `Verified as dictionary collocation (${matchType}) in Princeton WordNet 3.0`,
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
