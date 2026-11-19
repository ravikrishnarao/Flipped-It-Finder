/**
 * Flipit Finder V3 — Integrated Offline Puzzle Solver (Milestone 4)
 *
 * Orchestrates:
 *   - CompositeV3RelationshipProvider (WordNet 3.0, Coordinates, Moby Thesaurus II, optional Contextual/Legacy)
 *   - OfflineMorphologyEngine (lemmatization and inflection projection prior to constraint filtering)
 *   - CompositeV3PhraseProvider (WordNet collocations, Moby compounds, optional Curated phrases)
 *   - V3Ranker (transparent, explainable multi-factor heuristic ranking)
 *
 * Supports three cleanly isolated knowledge configurations:
 *   - 'pure-v3': Compiled V3 lexical & phrase knowledge only (no curated phrases, no contextual lexicon)
 *   - 'hybrid': V3 lexical + contextual associations, with curated phrase repository disabled
 *   - 'full-compatibility': V3 + contextual + legacy V2.2.4 curated relationships & phrases
 */

import { evaluateWordConstraint } from '../solver.ts';
import type {
  CluePairConstraints,
  ConstraintRejection,
  SolveDiagnostic,
  WordTransformation,
} from '../types.ts';
import type { ExternalCorpusPlugin } from './collocationPhraseProvider.ts';
import { CompositeV3PhraseProvider } from './compositeV3PhraseProvider.ts';
import { CompositeV3RelationshipProvider } from './compositeV3Provider.ts';
import { defaultMorphologyEngine } from './morphology.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type { PhraseMatchType } from './phraseTypes.ts';
import type { KnowledgeConfig, V3RelationshipLookupDiagnostics } from './types.ts';
import {
  V3Ranker,
  type V3CandidateAnswer,
} from './v3Ranker.ts';

export interface V3SolverConfig {
  knowledgeConfig?: KnowledgeConfig;
  partitionLoader?: PartitionLoader;
  maxCandidatesPerClue?: number;
  relationshipProvider?: CompositeV3RelationshipProvider;
  phraseProvider?: CompositeV3PhraseProvider;
  /** Optional Tier-4 external corpus plugin (e.g. PartitionedCorpusPlugin) */
  corpusPlugin?: ExternalCorpusPlugin;
  ranker?: V3Ranker;
}

export interface V3SolveOptions {
  /** Override knowledge configuration for this solve call */
  knowledgeConfig?: KnowledgeConfig;
  /** Minimum heuristic matchScore threshold (0.0 - 1.0) */
  minMatchScore?: number;
  /** Maximum number of ranked candidates to return */
  maxCandidates?: number;
  /** Allow closed and hyphenated compound matches alongside open phrases (default: true) */
  enableCompoundMatching?: boolean;
  /** Optional restriction on phrase match forms ('open' | 'closed' | 'hyphenated') */
  allowedMatchTypes?: PhraseMatchType[];
}

export interface V3ClueDiagnostic {
  clue: string;
  normalizedClue: string;
  morphology: {
    isInflected: boolean;
    inflectionType?: string;
    baseLemmas: string[];
  };
  totalRawProviderCandidates: number;
  preConstraintCount: number;
  postConstraintCount: number;
  rejectedByConstraintCount: number;
  preConstraintTransformations: WordTransformation[];
  survivingTransformations: WordTransformation[];
  rejections: ConstraintRejection[];
  providerCounts: Record<string, number>;
  relationshipLookupDiagnostics: V3RelationshipLookupDiagnostics;
}

export interface V3SolveDiagnostic {
  knowledgeConfig: KnowledgeConfig;
  clue1: V3ClueDiagnostic;
  clue2: V3ClueDiagnostic;
  totalCombinationsBeforeConstraints: number;
  totalCombinationsAfterConstraints: number;
  totalCombinationsEvaluated: number;
  phraseMatchesCount: number;
  rankedCandidatesCount: number;
  phraseProvenanceBreakdown: Record<string, number>;
  relationProvenanceBreakdown: Record<string, number>;
  partitionLoadingLatencyMs: number;
  relationshipLookupLatencyMs: number;
  phraseMatchingLatencyMs: number;
  rankingLatencyMs: number;
  failureReason?: SolveDiagnostic['failureReason'];
  failureDescription?: string;
}

export interface V3SolveResult {
  clue1: string;
  clue2: string;
  knowledgeConfig: KnowledgeConfig;
  constraints?: CluePairConstraints;
  candidates: V3CandidateAnswer[];
  bestMatch: V3CandidateAnswer | null;
  solveTimeMs: number;
  totalCombinationsEvaluated: number;
  diagnostic: V3SolveDiagnostic;
}

interface ProviderPair {
  relationshipProvider: CompositeV3RelationshipProvider;
  phraseProvider: CompositeV3PhraseProvider;
}

export class FlipitV3Solver {
  public readonly defaultKnowledgeConfig: KnowledgeConfig;
  public readonly partitionLoader: PartitionLoader;
  public readonly ranker: V3Ranker;

  private maxCandidatesPerClue: number;
  private corpusPlugin?: ExternalCorpusPlugin;
  private providerPairs = new Map<KnowledgeConfig, ProviderPair>();

  constructor(config?: V3SolverConfig) {
    this.defaultKnowledgeConfig = config?.knowledgeConfig ?? 'hybrid';
    this.partitionLoader = config?.partitionLoader ?? new PartitionLoader();
    this.maxCandidatesPerClue = config?.maxCandidatesPerClue ?? 80;
    this.corpusPlugin = config?.corpusPlugin;
    this.ranker = config?.ranker ?? new V3Ranker();

    if (config?.relationshipProvider && config?.phraseProvider) {
      this.providerPairs.set(this.defaultKnowledgeConfig, {
        relationshipProvider: config.relationshipProvider,
        phraseProvider: config.phraseProvider,
      });
    } else {
      this.getOrCreateProviders(
        this.defaultKnowledgeConfig,
        config?.relationshipProvider,
        config?.phraseProvider
      );
    }
  }

  private getOrCreateProviders(
    knowledgeConfig: KnowledgeConfig,
    customRel?: CompositeV3RelationshipProvider,
    customPhrase?: CompositeV3PhraseProvider
  ): ProviderPair {
    const existing = this.providerPairs.get(knowledgeConfig);
    if (existing) return existing;

    const relationshipProvider =
      customRel ||
      new CompositeV3RelationshipProvider({
        partitionLoader: this.partitionLoader,
        maxCandidatesPerClue: this.maxCandidatesPerClue,
        knowledgeConfig,
      });

    const phraseProvider =
      customPhrase ||
      new CompositeV3PhraseProvider({
        partitionLoader: this.partitionLoader,
        enableCurated: knowledgeConfig === 'full-compatibility',
        checkReversedOrder: true,
        corpusPlugin: this.corpusPlugin,
      });

    const pair = { relationshipProvider, phraseProvider };
    this.providerPairs.set(knowledgeConfig, pair);
    return pair;
  }

  public getProviders(knowledgeConfig?: KnowledgeConfig): ProviderPair {
    return this.getOrCreateProviders(knowledgeConfig ?? this.defaultKnowledgeConfig);
  }

  public normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  /**
   * Solve a Flip-It clue pair asynchronously with full morphological projection,
   * optional constraints, cross-product phrase discovery, and transparent ranking.
   */
  public async solve(
    clue1: string,
    clue2: string,
    constraints?: CluePairConstraints,
    options?: V3SolveOptions
  ): Promise<V3SolveResult> {
    const startTime = performance.now();
    const knowledgeConfig = options?.knowledgeConfig ?? this.defaultKnowledgeConfig;
    const { relationshipProvider, phraseProvider } = this.getOrCreateProviders(knowledgeConfig);

    const c1 = this.normalizeClue(clue1);
    const c2 = this.normalizeClue(clue2);

    if (!c1 || !c2) {
      const endTime = performance.now();
      return this.buildEmptyInputResult(
        clue1,
        clue2,
        knowledgeConfig,
        constraints,
        Math.round((endTime - startTime) * 100) / 100
      );
    }

    const morph1 = defaultMorphologyEngine.lemmatize(c1);
    const morph2 = defaultMorphologyEngine.lemmatize(c2);

    // 1. Relationship Lookup (unconstrained first for accurate pre-constraint inventory,
    //    then constrained lookup preserving morphology projection before constraint filtering)
    const [unconstrained1, unconstrained2] = await Promise.all([
      relationshipProvider.lookupWithDiagnostics(c1),
      relationshipProvider.lookupWithDiagnostics(c2),
    ]);

    const hasConstraint1 = Boolean(
      constraints?.word1 &&
        (constraints.word1.length !== undefined ||
          constraints.word1.startsWith ||
          constraints.word1.endsWith ||
          constraints.word1.pattern)
    );
    const hasConstraint2 = Boolean(
      constraints?.word2 &&
        (constraints.word2.length !== undefined ||
          constraints.word2.startsWith ||
          constraints.word2.endsWith ||
          constraints.word2.pattern)
    );

    const [constrained1, constrained2] = await Promise.all([
      hasConstraint1
        ? relationshipProvider.lookupWithDiagnostics(c1, constraints!.word1)
        : Promise.resolve(unconstrained1),
      hasConstraint2
        ? relationshipProvider.lookupWithDiagnostics(c2, constraints!.word2)
        : Promise.resolve(unconstrained2),
    ]);

    const preTransforms1 = unconstrained1.transformations;
    const preTransforms2 = unconstrained2.transformations;
    const transforms1 = constrained1.transformations;
    const transforms2 = constrained2.transformations;

    const rejections1: ConstraintRejection[] = [];
    if (hasConstraint1 && constraints?.word1) {
      for (const t of preTransforms1) {
        const evalRes = evaluateWordConstraint(t.word, constraints.word1);
        if (!evalRes.matches) {
          rejections1.push({
            word: t.word,
            constraint: constraints.word1,
            reason: evalRes.reason || 'Failed word constraint',
          });
        }
      }
    }

    const rejections2: ConstraintRejection[] = [];
    if (hasConstraint2 && constraints?.word2) {
      for (const t of preTransforms2) {
        const evalRes = evaluateWordConstraint(t.word, constraints.word2);
        if (!evalRes.matches) {
          rejections2.push({
            word: t.word,
            constraint: constraints.word2,
            reason: evalRes.reason || 'Failed word constraint',
          });
        }
      }
    }

    const relLoadLatency =
      unconstrained1.diagnostics.loadingLatencyMs + unconstrained2.diagnostics.loadingLatencyMs;
    const relLookupLatency =
      unconstrained1.diagnostics.lookupLatencyMs +
      unconstrained2.diagnostics.lookupLatencyMs +
      (hasConstraint1 ? constrained1.diagnostics.lookupLatencyMs : 0) +
      (hasConstraint2 ? constrained2.diagnostics.lookupLatencyMs : 0);

    // 2. Preload relevant phrase partitions concurrently before cross-product evaluation
    const phraseLoadStart = performance.now();
    const collectLetters = (list: WordTransformation[]) => {
      const letters = new Set<string>();
      for (const t of list) {
        const first = t.word.charAt(0);
        if (first && /[A-Z]/.test(first)) letters.add(first);
        const lm = defaultMorphologyEngine.lemmatize(t.word);
        for (const base of lm.baseLemmas) {
          const bf = base.charAt(0);
          if (bf && /[A-Z]/.test(bf)) letters.add(bf);
        }
      }
      return letters;
    };
    const letters2 = collectLetters(transforms2);
    const letters1 = collectLetters(transforms1);
    const revOnlyLetters = Array.from(letters2).filter((l) => !letters1.has(l));
    if (revOnlyLetters.length > 0) {
      await Promise.all(revOnlyLetters.map((l) => phraseProvider.preloadPartition(l)));
    }
    if (letters1.size > 0) {
      await Promise.all(Array.from(letters1).map((l) => phraseProvider.preloadPartition(l)));
    }
    const phraseLoadEnd = performance.now();
    const phraseLoadLatency = Math.round((phraseLoadEnd - phraseLoadStart) * 100) / 100;

    // 3. Cross-product phrase matching & ranking
    const phraseMatchStart = performance.now();
    const allowCompound = options?.enableCompoundMatching ?? true;
    const allowedMatchTypes = options?.allowedMatchTypes
      ? new Set<PhraseMatchType>(options.allowedMatchTypes)
      : null;
    const minThreshold = options?.minMatchScore ?? 0.0;

    const totalCombinationsBeforeConstraints = preTransforms1.length * preTransforms2.length;
    const totalCombinationsAfterConstraints = transforms1.length * transforms2.length;
    let totalCombinationsEvaluated = 0;
    let phraseMatchesCount = 0;

    const candidateMap = new Map<string, V3CandidateAnswer>();

    for (const t1 of transforms1) {
      for (const t2 of transforms2) {
        totalCombinationsEvaluated++;

        const matchedPhrase = phraseProvider.matchPhrase(t1.word, t2.word, allowCompound);
        if (!matchedPhrase) continue;

        if (allowedMatchTypes && !allowedMatchTypes.has(matchedPhrase.matchType)) {
          continue;
        }

        phraseMatchesCount++;

        const evaluated = this.ranker.evaluateCandidate({
          clue1: c1,
          clue2: c2,
          clue1Morph: morph1,
          clue2Morph: morph2,
          clue1Fanout: unconstrained1.diagnostics.totalRawCandidates,
          clue2Fanout: unconstrained2.diagnostics.totalRawCandidates,
          relation1: t1,
          relation2: t2,
          phraseMatch: matchedPhrase,
          constraints,
        });

        if (evaluated.matchScore >= minThreshold) {
          const dedupeKey = `${t1.word} ${t2.word}`;
          const existing = candidateMap.get(dedupeKey);
          if (!existing || evaluated.matchScore > existing.matchScore) {
            candidateMap.set(dedupeKey, evaluated);
          }
        }
      }
    }
    const phraseMatchEnd = performance.now();
    const phraseMatchingLatencyMs = Math.round((phraseMatchEnd - phraseMatchStart) * 100) / 100;

    // 4. Deterministic Ranking
    const rankStart = performance.now();
    const rankedCandidates = this.ranker.rankCandidates(
      Array.from(candidateMap.values()),
      options?.maxCandidates
    );
    const rankEnd = performance.now();
    const rankingLatencyMs = Math.round((rankEnd - rankStart) * 100) / 100;

    // 5. Provenance & Failure Diagnostics
    const phraseProvenanceBreakdown: Record<string, number> = {};
    const relationProvenanceBreakdown: Record<string, number> = {};

    for (const cand of rankedCandidates) {
      phraseProvenanceBreakdown[cand.phraseProvenanceCategory] =
        (phraseProvenanceBreakdown[cand.phraseProvenanceCategory] || 0) + 1;
      relationProvenanceBreakdown[cand.relation1ProvenanceCategory] =
        (relationProvenanceBreakdown[cand.relation1ProvenanceCategory] || 0) + 1;
      relationProvenanceBreakdown[cand.relation2ProvenanceCategory] =
        (relationProvenanceBreakdown[cand.relation2ProvenanceCategory] || 0) + 1;
    }

    let failureReason: SolveDiagnostic['failureReason'];
    let failureDescription: string | undefined;

    if (rankedCandidates.length === 0) {
      if (preTransforms1.length === 0) {
        failureReason = 'NO_CLUE1_TRANSFORMATIONS';
        failureDescription = `No transformations found for Clue 1 "${c1}" under ${knowledgeConfig}.`;
      } else if (preTransforms2.length === 0) {
        failureReason = 'NO_CLUE2_TRANSFORMATIONS';
        failureDescription = `No transformations found for Clue 2 "${c2}" under ${knowledgeConfig}.`;
      } else if (transforms1.length === 0) {
        failureReason = 'ALL_CLUE1_FILTERED_BY_CONSTRAINTS';
        failureDescription = `All ${preTransforms1.length} transformations for Clue 1 "${c1}" were eliminated by constraints.`;
      } else if (transforms2.length === 0) {
        failureReason = 'ALL_CLUE2_FILTERED_BY_CONSTRAINTS';
        failureDescription = `All ${preTransforms2.length} transformations for Clue 2 "${c2}" were eliminated by constraints.`;
      } else if (phraseMatchesCount === 0) {
        failureReason = 'NO_RECOGNIZED_PHRASES';
        failureDescription = `Evaluated ${totalCombinationsEvaluated} pairs (${transforms1.length} × ${transforms2.length}); none matched a recognized phrase or compound.`;
      } else {
        failureReason = 'BELOW_SCORE_THRESHOLD';
        failureDescription = `Found ${phraseMatchesCount} phrase matches, but none met minimum score ${minThreshold}.`;
      }
    }

    const endTime = performance.now();
    const solveTimeMs = Math.round((endTime - startTime) * 100) / 100;

    const diagnostic: V3SolveDiagnostic = {
      knowledgeConfig,
      clue1: {
        clue: clue1,
        normalizedClue: c1,
        morphology: {
          isInflected: morph1.isInflected,
          inflectionType: morph1.inflectionType,
          baseLemmas: morph1.baseLemmas,
        },
        totalRawProviderCandidates: unconstrained1.diagnostics.totalRawCandidates,
        preConstraintCount: preTransforms1.length,
        postConstraintCount: transforms1.length,
        rejectedByConstraintCount: Math.max(0, preTransforms1.length - transforms1.length),
        preConstraintTransformations: preTransforms1,
        survivingTransformations: transforms1,
        rejections: rejections1,
        providerCounts: unconstrained1.diagnostics.providerCandidatesCount,
        relationshipLookupDiagnostics: constrained1.diagnostics,
      },
      clue2: {
        clue: clue2,
        normalizedClue: c2,
        morphology: {
          isInflected: morph2.isInflected,
          inflectionType: morph2.inflectionType,
          baseLemmas: morph2.baseLemmas,
        },
        totalRawProviderCandidates: unconstrained2.diagnostics.totalRawCandidates,
        preConstraintCount: preTransforms2.length,
        postConstraintCount: transforms2.length,
        rejectedByConstraintCount: Math.max(0, preTransforms2.length - transforms2.length),
        preConstraintTransformations: preTransforms2,
        survivingTransformations: transforms2,
        rejections: rejections2,
        providerCounts: unconstrained2.diagnostics.providerCandidatesCount,
        relationshipLookupDiagnostics: constrained2.diagnostics,
      },
      totalCombinationsBeforeConstraints,
      totalCombinationsAfterConstraints,
      totalCombinationsEvaluated,
      phraseMatchesCount,
      rankedCandidatesCount: rankedCandidates.length,
      phraseProvenanceBreakdown,
      relationProvenanceBreakdown,
      partitionLoadingLatencyMs: Math.round((relLoadLatency + phraseLoadLatency) * 100) / 100,
      relationshipLookupLatencyMs: Math.round(relLookupLatency * 100) / 100,
      phraseMatchingLatencyMs,
      rankingLatencyMs,
      failureReason,
      failureDescription,
    };

    return {
      clue1: c1,
      clue2: c2,
      knowledgeConfig,
      constraints,
      candidates: rankedCandidates,
      bestMatch: rankedCandidates.length > 0 ? rankedCandidates[0] : null,
      solveTimeMs,
      totalCombinationsEvaluated,
      diagnostic,
    };
  }

  private buildEmptyInputResult(
    clue1: string,
    clue2: string,
    knowledgeConfig: KnowledgeConfig,
    constraints: CluePairConstraints | undefined,
    solveTimeMs: number
  ): V3SolveResult {
    const emptyDiag = (clue: string): V3ClueDiagnostic => ({
      clue,
      normalizedClue: this.normalizeClue(clue),
      morphology: { isInflected: false, baseLemmas: [] },
      totalRawProviderCandidates: 0,
      preConstraintCount: 0,
      postConstraintCount: 0,
      rejectedByConstraintCount: 0,
      preConstraintTransformations: [],
      survivingTransformations: [],
      rejections: [],
      providerCounts: {},
      relationshipLookupDiagnostics: {
        clue,
        normalizedClue: this.normalizeClue(clue),
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
    });

    return {
      clue1: this.normalizeClue(clue1),
      clue2: this.normalizeClue(clue2),
      knowledgeConfig,
      constraints,
      candidates: [],
      bestMatch: null,
      solveTimeMs,
      totalCombinationsEvaluated: 0,
      diagnostic: {
        knowledgeConfig,
        clue1: emptyDiag(clue1),
        clue2: emptyDiag(clue2),
        totalCombinationsBeforeConstraints: 0,
        totalCombinationsAfterConstraints: 0,
        totalCombinationsEvaluated: 0,
        phraseMatchesCount: 0,
        rankedCandidatesCount: 0,
        phraseProvenanceBreakdown: {},
        relationProvenanceBreakdown: {},
        partitionLoadingLatencyMs: 0,
        relationshipLookupLatencyMs: 0,
        phraseMatchingLatencyMs: 0,
        rankingLatencyMs: 0,
        failureReason: 'INPUT_EMPTY',
        failureDescription: 'One or both clue words are empty or non-alphanumeric.',
      },
    };
  }

  public getCacheStats() {
    const coreStats = this.partitionLoader.getDetailedCacheStats();
    const corpusStats = this.corpusPlugin?.getCacheStats?.();
    return corpusStats ? { ...coreStats, corpusPlugin: corpusStats } : coreStats;
  }
}
