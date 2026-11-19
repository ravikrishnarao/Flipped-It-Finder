/**
 * Browser-safe type definitions for Flipit Finder V3 Server API.
 * Uses type-only imports so no Node.js filesystem modules enter the client bundle.
 */

import type { CluePairConstraints } from '../solver/types.ts';
import type { PartitionCacheStats } from '../solver/v3/partitionLoader.ts';
import type { PhraseMatchType } from '../solver/v3/phraseTypes.ts';
import type { KnowledgeConfig } from '../solver/v3/types.ts';
import type { V3CandidateAnswer } from '../solver/v3/v3Ranker.ts';
import type { V3ClueDiagnostic, V3SolveDiagnostic, V3SolveResult } from '../solver/v3/v3Solver.ts';

export type {
  CluePairConstraints,
  KnowledgeConfig,
  PartitionCacheStats,
  PhraseMatchType,
  V3CandidateAnswer,
  V3ClueDiagnostic,
  V3SolveDiagnostic,
  V3SolveResult,
};

export interface ServerMemoryStats {
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
}

export interface SolveV3Request {
  clue1: string;
  clue2: string;
  constraints?: CluePairConstraints;
  knowledgeConfig: KnowledgeConfig;
  enableCompoundMatching: boolean;
  allowedMatchTypes?: PhraseMatchType[];
  maxCandidates?: number;
}

export interface SolveV3Response {
  result: V3SolveResult;
  cacheStats?: PartitionCacheStats;
  memory?: ServerMemoryStats;
}
