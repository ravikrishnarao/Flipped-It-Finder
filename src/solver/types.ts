/**
 * Flipit Finder - Core Type Definitions & Provider Interfaces (V2.2)
 * Defines clue pairs, transformations, constraints, candidate phrases, and provider abstractions.
 */

export type RelationType =
  | 'antonym'
  | 'counterpart'
  | 'synonym'
  | 'morphological'
  | 'hierarchical'
  | 'hypernym'
  | 'hyponym'
  | 'coordinate'
  | 'derivation'
  | 'associated'
  | 'thesaurus'
  | 'contextual';

export interface WordTransformation {
  originalClue: string;
  word: string;
  relationType: RelationType;
  score: number;
  reason: string;
  source?: string;
  depth?: number;
  semanticDistance?: number;
}

export interface WordConstraint {
  length?: number;
  startsWith?: string;
  endsWith?: string;
  pattern?: string | RegExp;
}

export interface CluePairConstraints {
  word1?: WordConstraint;
  word2?: WordConstraint;
}

export interface RawRelationEntry {
  word: string;
  score: number;
  reason: string;
  source?: string;
}

export interface WordRelationshipsDefinition {
  synonyms?: RawRelationEntry[];
  antonyms?: RawRelationEntry[];
  counterparts?: RawRelationEntry[];
  contextual?: RawRelationEntry[];
  associated?: RawRelationEntry[];
  hierarchical?: RawRelationEntry[];
  morphological?: RawRelationEntry[];
}

export type RelationshipLexicon = Record<string, WordRelationshipsDefinition>;

export interface PhraseRecord {
  phrase: string;
  word1: string;
  word2: string;
  frequencyScore: number;
  category?: string;
  alternateForms?: string[];
}

/**
 * Candidate answer evaluated by the solver.
 * Note: matchScore is a heuristic ranking metric (0.0 to 1.0) based on relation strengths
 * and collocation frequency. It is NOT a statistical probability.
 */
export interface CandidateAnswer {
  targetPhrase: string;
  word1: string;
  word2: string;
  relation1: WordTransformation;
  relation2: WordTransformation;
  phraseScore: number;
  /** Heuristic score representing clue transformation fit and phrase quality (0.0 - 1.0). */
  matchScore: number;
  /** @deprecated Kept for backward compatibility. Use matchScore instead. */
  confidence?: number;
  explanation: string;
  matchesConstraints: boolean;
  category?: string;
}

export interface ConstraintRejection {
  word: string;
  constraint: WordConstraint;
  reason: string;
}

export interface ClueDiagnostic {
  clue: string;
  rawCount: number;
  rawTransformations: WordTransformation[];
  survivingCount: number;
  survivingTransformations: WordTransformation[];
  rejectedCount: number;
  rejections: ConstraintRejection[];
}

export interface SolveDiagnostic {
  clue1: ClueDiagnostic;
  clue2: ClueDiagnostic;
  totalCombinationsGenerated: number;
  totalCombinationsEvaluated: number;
  phraseMatchesCount: number;
  rankedCandidatesCount: number;
  failureReason?:
    | 'NO_CLUE1_TRANSFORMATIONS'
    | 'NO_CLUE2_TRANSFORMATIONS'
    | 'ALL_CLUE1_FILTERED_BY_CONSTRAINTS'
    | 'ALL_CLUE2_FILTERED_BY_CONSTRAINTS'
    | 'NO_RECOGNIZED_PHRASES'
    | 'BELOW_SCORE_THRESHOLD'
    | 'INPUT_EMPTY';
  failureDescription?: string;
}

export interface SolverOptions {
  /** Minimum match score threshold for candidates to be returned (0.0 - 1.0) */
  minMatchScore?: number;
  /** @deprecated Backward compatibility alias for minMatchScore */
  minConfidence?: number;
  /** Maximum number of candidate answers to return */
  maxCandidates?: number;
  /** Whether to match compound and hyphenated words (e.g. CLASS MATE -> CLASSMATE) */
  enableCompoundMatching?: boolean;
  /** Whether to populate detailed diagnostic instrumentation */
  enableDiagnostic?: boolean;
}

export interface PuzzleBenchmarkItem {
  id: string;
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
  relationType1?: RelationType;
  relationType2?: RelationType;
  sampleConstraints?: CluePairConstraints;
}

export interface SolveResult {
  clue1: string;
  clue2: string;
  constraints?: CluePairConstraints;
  candidates: CandidateAnswer[];
  bestMatch: CandidateAnswer | null;
  solveTimeMs: number;
  totalCombinationsEvaluated: number;
  diagnostic?: SolveDiagnostic;
}

/**
 * Provider Interface: Abstract relationship lookup source.
 * Decouples the solver engine from static JSON files (supports WordNet, composite providers, etc.).
 */
export interface RelationshipProvider {
  /** Check if a clue word is known to this provider */
  hasClue(clue: string): boolean;
  /** Retrieve all valid transformations for a clue word matching constraints, retaining the strongest relation */
  getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[];
  /** Optional: Add word relationships dynamically */
  addWordRelations?(word: string, relations: WordRelationshipsDefinition): void;
}

/**
 * Provider Interface: Abstract phrase validation and collocation source.
 * Decouples the solver engine from static JSON files (supports Moby, bigram corpora, etc.).
 */
export interface PhraseProvider {
  /** Check if word1 and word2 form an established phrase or compound word */
  matchPhrase(word1: string, word2: string, allowCompound?: boolean): PhraseRecord | null;
  /** Check if word1 and word2 are recognized as a valid collocation */
  isRecognizedPhrase(word1: string, word2: string): boolean;
  /** Optional: Add a phrase dynamically */
  addPhrase?(phrase: PhraseRecord): void;
  /** Optional: Find phrases beginning with word1 */
  findPhrasesForWord1?(word1: string): PhraseRecord[];
  /** Optional: Find phrases ending with word2 */
  findPhrasesForWord2?(word2: string): PhraseRecord[];
  /** Optional: Return total indexed phrase count */
  getPhraseCount?(): number;
}
