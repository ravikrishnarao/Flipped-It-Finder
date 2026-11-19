/**
 * Flipit Finder - Frozen Evaluation Harness Types (V2.2.4)
 */

import type { CluePairConstraints, RelationType, SolveResult, WordTransformation } from '../src/solver/types.ts';

export interface BlindPuzzleInput {
  id: string;
  date: string;
  clue1: string;
  clue2: string;
  constraints?: CluePairConstraints;
}

export interface PuzzleAnswerKey {
  id: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
  expectedRelation1?: RelationType;
  expectedRelation2?: RelationType;
  notes?: string;
}

export type FailureCategory =
  | 'F1: Missing first transformation'
  | 'F2: Missing second transformation'
  | 'F3: Constraint rejection'
  | 'F4: Phrase recognition failure'
  | 'F5: Ranking failure'
  | 'F6: Solver integration failure'
  | 'F7: Other';

export interface PuzzleEvaluationResult {
  id: string;
  date: string;
  clue1: string;
  clue2: string;
  constraints?: CluePairConstraints;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
  
  // Phase 1: Blind Solver Outputs
  topCandidates: Array<{
    rank: number;
    phrase: string;
    word1: string;
    word2: string;
    matchScore: number;
    relation1Type: RelationType;
    relation2Type: RelationType;
    explanation: string;
  }>;
  bestMatchPhrase: string | null;
  bestMatchScore: number | null;
  solveLatencyMs: number;
  combinationsEvaluated: number;
  clue1RawTransformations: WordTransformation[];
  clue2RawTransformations: WordTransformation[];
  clue1SurvivingTransformations: WordTransformation[];
  clue2SurvivingTransformations: WordTransformation[];
  clue1Rejections: Array<{ word: string; reason: string }>;
  clue2Rejections: Array<{ word: string; reason: string }>;
  
  // Phase 2: Independent Scoring Audit
  isTop1Match: boolean;
  isTop5Match: boolean;
  word1Recall: boolean;
  word2Recall: boolean;
  bothWordsRecall: boolean;
  phraseRecognized: boolean;
  constraintsSatisfied: boolean;
  
  primaryFailure: FailureCategory | 'NONE (Solved)';
  contributingFailures: FailureCategory[];
  auditNotes: string;
}

export interface EvaluationScorecard {
  evaluationDate: string;
  engineVersion: string;
  totalPuzzles: number;
  datasetChecksums: Record<string, string>;
  checksumsVerified: boolean;
  
  accuracy: {
    top1Count: number;
    top1AccuracyPercent: number;
    top5Count: number;
    top5AccuracyPercent: number;
  };
  
  recall: {
    word1RecallCount: number;
    word1RecallPercent: number;
    word2RecallCount: number;
    word2RecallPercent: number;
    bothWordsRecallCount: number;
    bothWordsRecallPercent: number;
    phraseRecognitionCount: number;
    phraseRecognitionPercent: number;
  };
  
  performance: {
    meanLatencyMs: number;
    p95LatencyMs: number;
    totalCombinationsEvaluated: number;
  };
  
  failureDistribution: Record<string, number>;
}
