/**
 * Flipit Finder V3 — Composite Phrase Provider
 * Orchestrates CuratedPhraseProvider, CollocationPhraseProvider, and CompoundPhraseProvider.
 * Manages concurrent asynchronous letter-partition lazy loading, in-memory caching,
 * open/closed/hyphenated multi-format matching, reversed-order detection, and detailed diagnostics.
 */

import { CollocationPhraseProvider, type ExternalCorpusPhraseResult, type ExternalCorpusPlugin } from './collocationPhraseProvider.ts';
import { CompoundPhraseProvider } from './compoundPhraseProvider.ts';
import { CuratedPhraseProvider } from './curatedPhraseProvider.ts';
import { defaultMorphologyEngine } from './morphology.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncPhraseProvider,
  PhraseMatchType,
  V3PhraseLookupDiagnostics,
  V3PhraseMatch,
} from './phraseTypes.ts';
import type { PartitionLoadStats } from './types.ts';

export interface CompositeV3PhraseOptions {
  mobyPhrasesDir?: string;
  wordnetCollocationsDir?: string;
  partitionLoader?: PartitionLoader;
  checkReversedOrder?: boolean;
  enableCurated?: boolean;
  /** Optional Tier-4 statistical corpus plugin queried strictly after Curated -> WordNet -> Moby */
  corpusPlugin?: ExternalCorpusPlugin;
}

export class CompositeV3PhraseProvider implements AsyncPhraseProvider {
  public readonly providerName = 'CompositeV3PhraseProvider';

  public readonly curatedProvider: CuratedPhraseProvider;
  public readonly collocationProvider: CollocationPhraseProvider;
  public readonly compoundProvider: CompoundPhraseProvider;
  public readonly corpusPlugin?: ExternalCorpusPlugin;

  private loader: PartitionLoader;
  private checkReversedOrder: boolean;
  private enableCurated: boolean;
  private morphFormCache = new Map<string, string[]>();

  constructor(options?: CompositeV3PhraseOptions) {
    this.loader = options?.partitionLoader || new PartitionLoader();
    this.checkReversedOrder = options?.checkReversedOrder ?? true;
    this.enableCurated = options?.enableCurated ?? true;
    this.corpusPlugin = options?.corpusPlugin;

    const mobyDir = options?.mobyPhrasesDir || 'data/v3/compiled/moby/phrases';
    const wnCollocDir = options?.wordnetCollocationsDir || 'data/v3/compiled/wordnet/collocations';

    this.curatedProvider = new CuratedPhraseProvider();
    this.collocationProvider = new CollocationPhraseProvider(this.loader, wnCollocDir);
    this.compoundProvider = new CompoundPhraseProvider(this.loader, mobyDir);
  }

  private normalizeToken(token: string): string {
    if (!token) return '';
    return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private getMorphologicalForms(token: string): string[] {
    const cached = this.morphFormCache.get(token);
    if (cached) return cached;

    const morph = defaultMorphologyEngine.lemmatize(token);
    // Do NOT strip comparative/superlative (-IER/-ER/-IEST/-EST) to match fixed compounds
    // (prevents false collocation matches like "DRIER CLEANER" -> "DRY CLEANER" or "DRIER MOPPING" -> "DRY MOP").
    const forms =
      morph.inflectionType === 'comparative' || morph.inflectionType === 'superlative'
        ? new Set<string>([token])
        : new Set<string>([token, ...morph.baseLemmas]);

    // For uninflected adjectives/verbs ending in Y or E, include participial form (e.g., DRY -> DRIED)
    if (!morph.isInflected) {
      for (const base of morph.baseLemmas) {
        if (base.length >= 3) {
          if (base.endsWith('Y') && !/[AEIOU]Y$/.test(base)) {
            forms.add(base.slice(0, -1) + 'IED');
          } else if (base.endsWith('E')) {
            forms.add(base + 'D');
          }
        }
      }
    }
    const list = Array.from(forms);
    if (this.morphFormCache.size > 5000) {
      this.morphFormCache.clear();
    }
    this.morphFormCache.set(token, list);
    return list;
  }

  /**
   * Preload letter partitions across all underlying providers concurrently.
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

    const preloadTasks: Promise<PartitionLoadStats>[] = [
      this.collocationProvider.preloadPartition(clean),
      this.compoundProvider.preloadPartition(clean),
    ];
    if (this.corpusPlugin?.preloadPartition) {
      preloadTasks.push(this.corpusPlugin.preloadPartition(clean));
    }

    const [collocStats, compoundStats] = await Promise.all(preloadTasks);

    return compoundStats || collocStats;
  }

  private toCorpusV3Match(
    w1: string,
    w2: string,
    pluginRes: ExternalCorpusPhraseResult,
    isReversed: boolean
  ): V3PhraseMatch {
    const matchType: PhraseMatchType = pluginRes.matchType ?? 'open';
    const sourceDataset = pluginRes.sourceDataset ?? this.corpusPlugin?.name ?? 'External Empirical Corpus';
    const pmiStr = typeof pluginRes.pmi === 'number' ? pluginRes.pmi.toFixed(2) : 'N/A';
    const tStr = typeof pluginRes.tScore === 'number' ? pluginRes.tScore.toFixed(2) : 'N/A';
    const orderStr = typeof pluginRes.orderRatio === 'number' ? pluginRes.orderRatio.toFixed(2) : 'N/A';
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
      sourceDataset,
      empiricalFrequency: pluginRes.count,
      heuristicScore: pluginRes.score,
      pmi: pluginRes.pmi ?? null,
      tScore: pluginRes.tScore ?? null,
      orderRatio: pluginRes.orderRatio ?? null,
      reverseCount: pluginRes.reverseCount ?? null,
      isReversed: isReversed || pluginRes.isReversed || false,
      explanation: `Verified in ${sourceDataset} (count=${pluginRes.count.toLocaleString()}, PMI=${pmiStr}, t=${tStr}, orderRatio=${orderStr})`,
      matchType,
    };
  }

  private tryDirectSync(
    w1: string,
    w2: string,
    allowCompound: boolean
  ): V3PhraseMatch | null {
    if (this.enableCurated) {
      const curatedMatch = this.curatedProvider.matchPhrase(w1, w2, allowCompound);
      if (curatedMatch) return curatedMatch;
    }

    const collocMatch = this.collocationProvider.matchPhrase(w1, w2, allowCompound);
    if (collocMatch) return collocMatch;

    const compoundMatch = this.compoundProvider.matchPhrase(w1, w2, allowCompound);
    if (compoundMatch) return compoundMatch;

    return null;
  }

  /**
   * Synchronous phrase match (evaluates in-memory and cached partitions).
   */
  public matchPhrase(
    word1: string,
    word2: string,
    allowCompound = true
  ): V3PhraseMatch | null {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    // 1. Exact Direct Match
    const direct = this.tryDirectSync(w1, w2, allowCompound);
    if (direct) return direct;

    // 2. Reversed Exact Match
    if (this.checkReversedOrder) {
      const revDirect = this.tryDirectSync(w2, w1, allowCompound);
      if (revDirect) return { ...revDirect, isReversed: true };
    }

    // 3. Morphological Lemma / Inflectional Fallback (WordNet collocations first, then Moby compounds)
    const forms1 = this.getMorphologicalForms(w1);
    const forms2 = this.getMorphologicalForms(w2);

    for (const provider of [this.collocationProvider, this.compoundProvider]) {
      for (const f1 of forms1) {
        for (const f2 of forms2) {
          if (f1 === w1 && f2 === w2) continue;
          const morphMatch = provider.matchPhrase(f1, f2, allowCompound);
          if (morphMatch) {
            return {
              ...morphMatch,
              heuristicScore: Math.round(morphMatch.heuristicScore * 0.94 * 100) / 100,
              explanation: `${morphMatch.explanation} (matched via morphological variant "${f1} ${f2}" for "${w1} ${w2}")`,
            };
          }
        }
      }
    }

    if (this.checkReversedOrder) {
      for (const provider of [this.collocationProvider, this.compoundProvider]) {
        for (const f2 of forms2) {
          for (const f1 of forms1) {
            if (f1 === w1 && f2 === w2) continue;
            const revMorphMatch = provider.matchPhrase(f2, f1, allowCompound);
            if (revMorphMatch) {
              return {
                ...revMorphMatch,
                isReversed: true,
                heuristicScore: Math.round(revMorphMatch.heuristicScore * 0.94 * 100) / 100,
                explanation: `${revMorphMatch.explanation} (matched reversed morphological variant "${f2} ${f1}")`,
              };
            }
          }
        }
      }
    }

    // 4. Tier-4 External Empirical Corpus Plugin (strictly after Curated -> WordNet -> Moby)
    if (this.corpusPlugin?.querySync) {
      const forwardCorpus = this.corpusPlugin.querySync(w1, w2, allowCompound);
      if (forwardCorpus) {
        return this.toCorpusV3Match(w1, w2, forwardCorpus, false);
      }
      if (this.checkReversedOrder) {
        const revCorpus = this.corpusPlugin.querySync(w2, w1, allowCompound);
        if (revCorpus) {
          return this.toCorpusV3Match(w2, w1, revCorpus, true);
        }
      }
    }

    return null;
  }

  /**
   * Asynchronous phrase match with on-demand letter partition lazy loading.
   */
  public async matchPhraseAsync(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<V3PhraseMatch | null> {
    const { match } = await this.lookupWithDiagnostics(word1, word2, allowCompound);
    return match;
  }

  public isRecognizedPhrase(word1: string, word2: string): boolean {
    return this.matchPhrase(word1, word2) !== null;
  }

  public async isRecognizedPhraseAsync(word1: string, word2: string): Promise<boolean> {
    const match = await this.matchPhraseAsync(word1, word2);
    return match !== null;
  }

  private async tryDirectAsync(
    w1: string,
    w2: string,
    allowCompound: boolean,
    includeCurated: boolean
  ): Promise<{ match: V3PhraseMatch | null; winningProvider: string }> {
    if (includeCurated) {
      const m = this.curatedProvider.matchPhrase(w1, w2, allowCompound);
      if (m) return { match: m, winningProvider: this.curatedProvider.providerName };
    }

    const colloc = await this.collocationProvider.matchPhraseAsync(w1, w2, allowCompound);
    if (colloc) return { match: colloc, winningProvider: this.collocationProvider.providerName };

    const comp = await this.compoundProvider.matchPhraseAsync(w1, w2, allowCompound);
    if (comp) return { match: comp, winningProvider: this.compoundProvider.providerName };

    return { match: null, winningProvider: '' };
  }

  /**
   * Execute lookup with full performance, match type, and score diagnostics.
   */
  public async lookupWithDiagnostics(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<{ match: V3PhraseMatch | null; diagnostics: V3PhraseLookupDiagnostics }> {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);

    if (!w1 || !w2) {
      return {
        match: null,
        diagnostics: {
          word1,
          word2,
          normalizedQuery: '',
          providerQueried: this.providerName,
          found: false,
          lookupLatencyMs: 0,
          loadingLatencyMs: 0,
        },
      };
    }

    const letter1 = w1.charAt(0);

    // 1. Lazy load partitions for word1 initial letter
    const loadStart = performance.now();
    await this.preloadPartition(letter1);
    const loadEnd = performance.now();
    const loadingLatencyMs = Math.round((loadEnd - loadStart) * 100) / 100;

    // 2. Perform Priority Search
    const lookupStart = performance.now();

    let { match, winningProvider } = await this.tryDirectAsync(
      w1,
      w2,
      allowCompound,
      this.enableCurated
    );

    // D. Reversed Exact Order Check
    if (!match && this.checkReversedOrder) {
      const letter2 = w2.charAt(0);
      if (letter2 !== letter1) {
        await this.preloadPartition(letter2);
      }

      const rev = await this.tryDirectAsync(w2, w1, allowCompound, this.enableCurated);
      if (rev.match) {
        match = { ...rev.match, isReversed: true };
        winningProvider = `${rev.winningProvider} (Reversed)`;
      }
    }

    // E. Morphological Lemma / Inflectional Fallback (WordNet collocations first, then Moby compounds)
    if (!match) {
      const forms1 = this.getMorphologicalForms(w1);
      const forms2 = this.getMorphologicalForms(w2);

      for (const provider of [this.collocationProvider, this.compoundProvider]) {
        for (const f1 of forms1) {
          for (const f2 of forms2) {
            if (f1 === w1 && f2 === w2) continue;
            const m = await provider.matchPhraseAsync(f1, f2, allowCompound);
            if (m) {
              match = {
                ...m,
                heuristicScore: Math.round(m.heuristicScore * 0.94 * 100) / 100,
                explanation: `${m.explanation} (matched via morphological variant "${f1} ${f2}" for "${w1} ${w2}")`,
              };
              winningProvider = `${provider.providerName} (Morphological)`;
              break;
            }
          }
          if (match) break;
        }
        if (match) break;
      }

      if (!match && this.checkReversedOrder) {
        for (const provider of [this.collocationProvider, this.compoundProvider]) {
          for (const f2 of forms2) {
            for (const f1 of forms1) {
              if (f1 === w1 && f2 === w2) continue;
              const m = await provider.matchPhraseAsync(f2, f1, allowCompound);
              if (m) {
                match = {
                  ...m,
                  isReversed: true,
                  heuristicScore: Math.round(m.heuristicScore * 0.94 * 100) / 100,
                  explanation: `${m.explanation} (matched reversed morphological variant "${f2} ${f1}")`,
                };
                winningProvider = `${provider.providerName} (Reversed Morphological)`;
                break;
              }
            }
            if (match) break;
          }
          if (match) break;
        }
      }
    }

    // F. Tier-4 External Empirical Corpus Plugin (strictly after Curated -> WordNet -> Moby)
    if (!match && this.corpusPlugin) {
      const forwardCorpus = await this.corpusPlugin.query(w1, w2, allowCompound);
      if (forwardCorpus) {
        match = this.toCorpusV3Match(w1, w2, forwardCorpus, false);
        winningProvider = this.corpusPlugin.name;
      } else if (this.checkReversedOrder) {
        const letter2 = w2.charAt(0);
        if (letter2 !== letter1 && this.corpusPlugin.preloadPartition) {
          await this.corpusPlugin.preloadPartition(letter2);
        }
        const revCorpus = await this.corpusPlugin.query(w2, w1, allowCompound);
        if (revCorpus) {
          match = this.toCorpusV3Match(w2, w1, revCorpus, true);
          winningProvider = `${this.corpusPlugin.name} (Reversed)`;
        }
      }
    }

    const lookupEnd = performance.now();
    const lookupLatencyMs = Math.round((lookupEnd - lookupStart) * 100) / 100;

    const diagnostics: V3PhraseLookupDiagnostics = {
      word1,
      word2,
      normalizedQuery: `${w1} ${w2}`,
      providerQueried: match ? winningProvider : this.providerName,
      found: match !== null,
      matchType: match?.matchType,
      sourceProvenance: match?.sourceDataset,
      heuristicScore: match?.heuristicScore,
      empiricalFrequency: match?.empiricalFrequency ?? null,
      pmi: match?.pmi ?? null,
      tScore: match?.tScore ?? null,
      orderRatio: match?.orderRatio ?? null,
      lookupLatencyMs,
      loadingLatencyMs,
      partitionUsed: `phrases_${letter1.toLowerCase()}.json`,
      partitionLoadedFromDisk: loadingLatencyMs > 5.0,
    };

    return { match, diagnostics };
  }

  public getCacheStats(): {
    loadedPartitions: string[];
    cacheSizeBytes: number;
    corpusPluginCache?: ReturnType<NonNullable<ExternalCorpusPlugin['getCacheStats']>>;
  } {
    return {
      loadedPartitions: this.loader.getLoadedPartitions(),
      cacheSizeBytes: this.loader.getCacheSizeBytes(),
      corpusPluginCache: this.corpusPlugin?.getCacheStats?.(),
    };
  }
}
