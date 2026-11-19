/**
 * Flipit Finder V3 — Runtime Types & Provider Abstractions
 * Extends core solver types with asynchronous letter-partition loading,
 * granular relationship typing, and comprehensive diagnostic metrics.
 */

import type {
  RelationType,
  RelationshipProvider,
  WordConstraint,
  WordTransformation,
} from '../types.ts';

export type {
  RelationType,
  RelationshipProvider,
  WordConstraint,
  WordTransformation,
};

export type KnowledgeConfig = 'pure-v3' | 'hybrid' | 'full-compatibility';

export interface PartitionLoadStats {
  partition: string;
  filePath: string;
  sizeBytes: number;
  loadTimeMs: number;
  cached: boolean;
}

export interface V3RelationshipLookupDiagnostics {
  clue: string;
  normalizedClue: string;
  providerCandidatesCount: Record<string, number>;
  totalRawCandidates: number;
  uniqueCandidatesCount: number;
  candidatesByRelationType: Record<string, number>;
  survivingCandidatesCount: number;
  loadingLatencyMs: number;
  lookupLatencyMs: number;
  loadedPartitions: PartitionLoadStats[];
  missingPartitions: string[];
  missingInProviders: string[];
  morphology?: {
    isInflected: boolean;
    inflectionType?: string;
    baseLemmas: string[];
    projectedForms?: string[];
  };
}

export interface V3LookupResult {
  clue: string;
  transformations: WordTransformation[];
  diagnostics: V3RelationshipLookupDiagnostics;
}

/**
 * Async Relationship Provider interface supporting on-demand partition loading
 * without loading the entire 250MB dataset into browser/server memory.
 */
export interface AsyncRelationshipProvider extends RelationshipProvider {
  /** Name of the provider for provenance and diagnostic telemetry */
  readonly providerName: string;

  /** Check if clue is present in loaded or lazily queryable index */
  hasClueAsync(clue: string): Promise<boolean>;

  /** Retrieve transformations asynchronously with on-demand partition loading */
  getTransformationsAsync(clue: string, constraint?: WordConstraint): Promise<WordTransformation[]>;

  /** Preload letter partition(s) into memory cache */
  preloadPartition?(letter: string): Promise<PartitionLoadStats>;

  /** Retrieve memory and cache diagnostics */
  getCacheStats?(): { loadedPartitions: string[]; cacheSizeBytes: number };
}
