/**
 * Flipit Finder V3 — Composite V3 Relationship Provider
 * Orchestrates WordNet, Coordinate, Moby Thesaurus, and Contextual providers.
 * Manages concurrent asynchronous letter-partition lazy loading, in-memory caching,
 * strict multi-tier relationship priority deduplication, and detailed diagnostics.
 */

import { ContextualAssociationProvider as LegacyContextualProvider } from '../contextualAssociationProvider.ts';
import { RelationshipEngine as LegacyRelationshipEngine } from '../relationshipEngine.ts';
import { evaluateWordConstraint } from '../solver.ts';
import { ContextualAssociationProvider } from './contextualProvider.ts';
import { CoordinateRelationshipProvider } from './coordinateProvider.ts';
import { MobyThesaurusProvider } from './mobyThesaurusProvider.ts';
import { defaultMorphologyEngine, type MorphologyResult } from './morphology.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncRelationshipProvider,
  KnowledgeConfig,
  PartitionLoadStats,
  RelationType,
  V3LookupResult,
  V3RelationshipLookupDiagnostics,
  WordConstraint,
  WordTransformation,
} from './types.ts';
import { WordNetRelationshipProvider } from './wordnetProvider.ts';

export const V3_RELATION_PRIORITY: Record<RelationType, number> = {
  antonym: 6.0,
  counterpart: 5.0,
  synonym: 4.0,
  derivation: 3.5,
  morphological: 3.0,
  hypernym: 2.8,
  hyponym: 2.6,
  hierarchical: 2.5,
  coordinate: 2.0,
  contextual: 1.2,
  associated: 1.0,
  thesaurus: 0.9,
};

export interface CompositeV3Options {
  maxCandidatesPerClue?: number;
  wordnetBaseDir?: string;
  mobyBaseDir?: string;
  partitionLoader?: PartitionLoader;
  knowledgeConfig?: KnowledgeConfig;
  includeContextual?: boolean;
  includeLegacyCurated?: boolean;
}

export class CompositeV3RelationshipProvider implements AsyncRelationshipProvider {
  public readonly providerName = 'CompositeV3RelationshipProvider';

  public readonly wordnetProvider: WordNetRelationshipProvider;
  public readonly coordinateProvider: CoordinateRelationshipProvider;
  public readonly mobyThesaurusProvider: MobyThesaurusProvider;
  public readonly contextualProvider: ContextualAssociationProvider;
  public readonly legacyRelationshipEngine?: LegacyRelationshipEngine;
  public readonly legacyContextualProvider?: LegacyContextualProvider;

  public readonly knowledgeConfig: KnowledgeConfig;
  public readonly includeContextual: boolean;
  public readonly includeLegacyCurated: boolean;

  private loader: PartitionLoader;
  private maxCandidatesPerClue: number;

  constructor(options?: CompositeV3Options) {
    this.loader = options?.partitionLoader || new PartitionLoader();
    this.maxCandidatesPerClue = options?.maxCandidatesPerClue ?? 80;

    const config: KnowledgeConfig = options?.knowledgeConfig ?? 'hybrid';
    this.knowledgeConfig = config;

    const defaultContextual = config !== 'pure-v3';
    const defaultLegacy = config === 'full-compatibility';

    this.includeContextual = options?.includeContextual ?? defaultContextual;
    this.includeLegacyCurated = options?.includeLegacyCurated ?? defaultLegacy;

    const wnDir = options?.wordnetBaseDir || 'data/v3/compiled/wordnet';
    const mobyDir = options?.mobyBaseDir || 'data/v3/compiled/moby/associations';

    this.wordnetProvider = new WordNetRelationshipProvider(this.loader, wnDir);
    this.coordinateProvider = new CoordinateRelationshipProvider(this.loader, wnDir, 28);
    this.mobyThesaurusProvider = new MobyThesaurusProvider(this.loader, mobyDir, 60);
    this.contextualProvider = new ContextualAssociationProvider();

    if (this.includeLegacyCurated) {
      this.legacyRelationshipEngine = new LegacyRelationshipEngine();
      this.legacyContextualProvider = new LegacyContextualProvider();
    }
  }

  public normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  /**
   * Preload letter partitions across all underlying providers concurrently.
   */
  public async preloadPartitions(letter: string): Promise<PartitionLoadStats[]> {
    const cleanLetter = letter.trim().toUpperCase().charAt(0);
    if (!cleanLetter || !/[A-Z]/.test(cleanLetter)) return [];

    const statsList: PartitionLoadStats[] = await Promise.all([
      this.wordnetProvider.preloadPartition(cleanLetter),
      this.mobyThesaurusProvider.preloadPartition(cleanLetter),
    ]);

    return statsList;
  }

  public hasClue(clue: string): boolean {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;

    const morph = defaultMorphologyEngine.lemmatize(norm);
    for (const form of morph.baseLemmas) {
      if (
        (this.includeContextual && this.contextualProvider.hasClue(form)) ||
        (this.includeLegacyCurated &&
          (this.legacyRelationshipEngine?.hasClue(form) ||
            this.legacyContextualProvider?.hasClue(form))) ||
        this.wordnetProvider.hasClue(form) ||
        this.coordinateProvider.hasClue(form) ||
        this.mobyThesaurusProvider.hasClue(form)
      ) {
        return true;
      }
    }
    return false;
  }

  public async hasClueAsync(clue: string): Promise<boolean> {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;

    const morph = defaultMorphologyEngine.lemmatize(norm);
    const letters = new Set(morph.baseLemmas.map((l) => l.charAt(0)).filter((c) => /[A-Z]/.test(c)));
    await Promise.all(Array.from(letters).map((l) => this.preloadPartitions(l)));

    for (const form of morph.baseLemmas) {
      const [hasContextual, hasWordnet, hasCoord, hasMoby] = await Promise.all([
        this.includeContextual ? this.contextualProvider.hasClueAsync(form) : Promise.resolve(false),
        this.wordnetProvider.hasClueAsync(form),
        this.coordinateProvider.hasClueAsync(form),
        this.mobyThesaurusProvider.hasClueAsync(form),
      ]);
      const hasLegacy = this.includeLegacyCurated
        ? Boolean(
            this.legacyRelationshipEngine?.hasClue(form) ||
              this.legacyContextualProvider?.hasClue(form)
          )
        : false;
      if (hasContextual || hasLegacy || hasWordnet || hasCoord || hasMoby) {
        return true;
      }
    }
    return false;
  }

  private getLegacyTransformations(form: string): WordTransformation[] {
    if (!this.includeLegacyCurated) return [];
    const results: WordTransformation[] = [];
    if (this.legacyRelationshipEngine) {
      for (const item of this.legacyRelationshipEngine.getTransformations(form)) {
        results.push({
          ...item,
          source: item.source || 'Curated V2.2.4 Relationship Lexicon',
        });
      }
    }
    if (this.legacyContextualProvider) {
      for (const item of this.legacyContextualProvider.getTransformations(form)) {
        results.push({
          ...item,
          source: item.source || 'Curated Contextual Associations Repository',
        });
      }
    }
    return results;
  }

  /**
   * Synchronous transformation retrieval (works on preloaded or cached partitions).
   */
  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];

    const morph = defaultMorphologyEngine.lemmatize(norm);
    const rawAll: WordTransformation[] = [];

    for (const form of morph.baseLemmas) {
      const contextual = this.includeContextual ? this.contextualProvider.getTransformations(form) : [];
      const legacy = this.getLegacyTransformations(form);
      const wordnet = this.wordnetProvider.getTransformations(form);
      const coordinates = this.coordinateProvider.getTransformations(form);
      const moby = this.mobyThesaurusProvider.getTransformations(form);

      const batch = [...legacy, ...contextual, ...wordnet, ...coordinates, ...moby];
      for (const item of batch) {
        this.collectWithMorphologyProjection(norm, form, morph, item, constraint, rawAll);
      }
    }

    return this.mergeAndRankTransformations(norm, rawAll);
  }

  /**
   * Asynchronous transformation retrieval with on-demand letter partition preloading.
   */
  public async getTransformationsAsync(
    clue: string,
    constraint?: WordConstraint
  ): Promise<WordTransformation[]> {
    const res = await this.lookupWithDiagnostics(clue, constraint);
    return res.transformations;
  }

  /**
   * Execute relationship lookup with full performance, loading, and provenance diagnostics.
   */
  public async lookupWithDiagnostics(
    clue: string,
    constraint?: WordConstraint
  ): Promise<V3LookupResult> {
    const norm = this.normalizeClue(clue);
    if (!norm) {
      return {
        clue,
        transformations: [],
        diagnostics: {
          clue,
          normalizedClue: '',
          providerCandidatesCount: {},
          totalRawCandidates: 0,
          uniqueCandidatesCount: 0,
          candidatesByRelationType: {},
          survivingCandidatesCount: 0,
          loadingLatencyMs: 0,
          lookupLatencyMs: 0,
          loadedPartitions: [],
          missingPartitions: [],
          missingInProviders: [],
        },
      };
    }

    const morph = defaultMorphologyEngine.lemmatize(norm);
    const letters = new Set<string>([norm.charAt(0)]);
    for (const lemma of morph.baseLemmas) {
      if (lemma.length > 0 && /[A-Z]/.test(lemma.charAt(0))) {
        letters.add(lemma.charAt(0));
      }
    }

    // 1. Measure Partition Loading Latency
    const loadStart = performance.now();
    const partitionStatsNested = await Promise.all(
      Array.from(letters).map((l) => this.preloadPartitions(l))
    );
    const loadedPartitionStats = partitionStatsNested.flat();
    const loadEnd = performance.now();
    const loadingLatencyMs = Math.round((loadEnd - loadStart) * 100) / 100;

    // 2. Measure Provider Lookup Latency across exact form & normalized lemmas
    const lookupStart = performance.now();

    const providerCounts: Record<string, number> = {
      WordNetRelationshipProvider: 0,
      CoordinateRelationshipProvider: 0,
      MobyThesaurusProvider: 0,
    };
    if (this.includeContextual) {
      providerCounts.ContextualAssociationProvider = 0;
    }
    if (this.includeLegacyCurated) {
      providerCounts.LegacyCuratedProviders = 0;
    }

    const rawExpanded: WordTransformation[] = [];

    for (const form of morph.baseLemmas) {
      const [contextual, wordnet, coordinates, moby] = await Promise.all([
        this.includeContextual
          ? this.contextualProvider.getTransformationsAsync(form)
          : Promise.resolve([]),
        this.wordnetProvider.getTransformationsAsync(form),
        this.coordinateProvider.getTransformationsAsync(form),
        this.mobyThesaurusProvider.getTransformationsAsync(form),
      ]);
      const legacy = this.getLegacyTransformations(form);

      if (this.includeContextual) {
        providerCounts.ContextualAssociationProvider += contextual.length;
      }
      if (this.includeLegacyCurated) {
        providerCounts.LegacyCuratedProviders += legacy.length;
      }
      providerCounts.WordNetRelationshipProvider += wordnet.length;
      providerCounts.CoordinateRelationshipProvider += coordinates.length;
      providerCounts.MobyThesaurusProvider += moby.length;

      const batch = [...legacy, ...contextual, ...wordnet, ...coordinates, ...moby];
      for (const item of batch) {
        this.collectWithMorphologyProjection(norm, form, morph, item, constraint, rawExpanded);
      }
    }

    const missingInProviders: string[] = [];
    for (const [name, count] of Object.entries(providerCounts)) {
      if (count === 0) missingInProviders.push(name);
    }

    const totalRawCandidates = Object.values(providerCounts).reduce((a, b) => a + b, 0);

    // 3. Merge, Deduplicate, and Deterministically Rank
    const merged = this.mergeAndRankTransformations(norm, rawExpanded);

    const lookupEnd = performance.now();
    const lookupLatencyMs = Math.round((lookupEnd - lookupStart) * 100) / 100;

    // 4. Compute Counts by Relation Type
    const candidatesByRelationType: Record<string, number> = {};
    for (const t of merged) {
      candidatesByRelationType[t.relationType] = (candidatesByRelationType[t.relationType] || 0) + 1;
    }

    const missingPartitions: string[] = [];
    for (const stat of loadedPartitionStats) {
      if (stat.sizeBytes === 0) {
        missingPartitions.push(stat.filePath);
      }
    }

    const diagnostics: V3RelationshipLookupDiagnostics = {
      clue,
      normalizedClue: norm,
      providerCandidatesCount: providerCounts,
      totalRawCandidates,
      uniqueCandidatesCount: merged.length,
      candidatesByRelationType,
      survivingCandidatesCount: merged.length,
      loadingLatencyMs,
      lookupLatencyMs,
      loadedPartitions: loadedPartitionStats,
      missingPartitions,
      missingInProviders,
      morphology: {
        isInflected: morph.isInflected,
        inflectionType: morph.inflectionType,
        baseLemmas: morph.baseLemmas,
        projectedForms: morph.projectedForms.slice(0, 6),
      },
    };

    return {
      clue,
      transformations: merged,
      diagnostics,
    };
  }

  /**
   * Expand a transformation item with constraint evaluation and inflectional projection
   * when the source clue is inflected (e.g., LEAVING -> LEAVE -> COME -> COMING).
   */
  private collectWithMorphologyProjection(
    originalNorm: string,
    queriedForm: string,
    morph: MorphologyResult,
    item: WordTransformation,
    constraint: WordConstraint | undefined,
    out: WordTransformation[]
  ): void {
    const isLemmaLookup = queriedForm !== originalNorm;
    const baseWord = this.normalizeClue(item.word);
    if (!baseWord || baseWord === originalNorm || baseWord === queriedForm) return;

    const baseReason = isLemmaLookup
      ? `${item.reason} [via lemma ${queriedForm}]`
      : item.reason;
    const baseScore = isLemmaLookup
      ? Math.round(item.score * 0.99 * 10000) / 10000
      : item.score;

    // 1. Add base candidate if it satisfies constraints
    if (evaluateWordConstraint(baseWord, constraint).matches) {
      out.push({
        ...item,
        originalClue: originalNorm,
        word: baseWord,
        score: baseScore,
        reason: baseReason,
      });
    }

    // 2. If original clue is inflected and lookup traversed a base lemma, also project matching inflected target forms
    if (isLemmaLookup && morph.isInflected && morph.inflectionType) {
      const projected = defaultMorphologyEngine.projectForInflection(
        baseWord,
        morph.inflectionType
      );
      for (const projWord of projected) {
        if (!projWord || projWord === originalNorm) continue;
        if (evaluateWordConstraint(projWord, constraint).matches) {
          out.push({
            ...item,
            originalClue: originalNorm,
            word: projWord,
            score: Math.round(baseScore * 0.99 * 10000) / 10000,
            reason: `${baseReason} [inflection projected → ${projWord}]`,
          });
        }
      }
    }
  }

  /**
   * Deduplicates candidates by normalized target word, preserving the strongest relationship
   * and its exact provenance, while bounding total candidates.
   */
  private mergeAndRankTransformations(
    originalClue: string,
    rawList: WordTransformation[]
  ): WordTransformation[] {
    const bestByTarget = new Map<string, WordTransformation>();

    for (const t of rawList) {
      const target = this.normalizeClue(t.word);
      if (!target || target === originalClue) continue;

      const existing = bestByTarget.get(target);
      if (!existing) {
        bestByTarget.set(target, t);
      } else {
        // Enforce strict priority hierarchy:
        // Priority first, then Score, then Alphabetical determinism
        const tPriority = V3_RELATION_PRIORITY[t.relationType] ?? 1.0;
        const ePriority = V3_RELATION_PRIORITY[existing.relationType] ?? 1.0;

        if (tPriority > ePriority) {
          bestByTarget.set(target, t);
        } else if (tPriority === ePriority && t.score > existing.score) {
          bestByTarget.set(target, t);
        }
      }
    }

    const sorted = Array.from(bestByTarget.values()).sort((a, b) => {
      // 1. Semantic Priority (Antonym > Synonym > Derivation > Hypernym > Coordinate > Thesaurus)
      const pA = V3_RELATION_PRIORITY[a.relationType] ?? 1.0;
      const pB = V3_RELATION_PRIORITY[b.relationType] ?? 1.0;
      if (pB !== pA) return pB - pA;

      // 2. Relationship Strength Score
      if (b.score !== a.score) return b.score - a.score;

      // 3. Deterministic Alphabetical Order
      return a.word.localeCompare(b.word);
    });

    if (sorted.length <= this.maxCandidatesPerClue) {
      return sorted;
    }

    // Reserve up to 20 slots for top thesaurus entries so high-fanout taxonomic/lemma expansions
    // never completely starve Moby Thesaurus II to zero under the maxCandidatesPerClue cap.
    const headLimit = Math.max(0, this.maxCandidatesPerClue - 20);
    const head = sorted.slice(0, headLimit);
    const tail = sorted.slice(headLimit);
    const tailNonThesaurus = tail.filter((t) => t.relationType !== 'thesaurus');
    const tailThesaurus = tail.filter((t) => t.relationType === 'thesaurus');

    const reservedThesaurus = tailThesaurus.slice(0, 20);
    const remainingCapacity = this.maxCandidatesPerClue - head.length - reservedThesaurus.length;
    const fillNonThesaurus = tailNonThesaurus.slice(0, Math.max(0, remainingCapacity));
    const finalFillThesaurus =
      head.length + fillNonThesaurus.length + reservedThesaurus.length < this.maxCandidatesPerClue
        ? tailThesaurus.slice(
            reservedThesaurus.length,
            reservedThesaurus.length +
              (this.maxCandidatesPerClue - head.length - fillNonThesaurus.length - reservedThesaurus.length)
          )
        : [];

    return [
      ...head,
      ...fillNonThesaurus,
      ...reservedThesaurus,
      ...finalFillThesaurus,
    ].slice(0, this.maxCandidatesPerClue);
  }

  public getCacheStats(): { loadedPartitions: string[]; cacheSizeBytes: number } {
    return {
      loadedPartitions: this.loader.getLoadedPartitions(),
      cacheSizeBytes: this.loader.getCacheSizeBytes(),
    };
  }
}
