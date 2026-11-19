/**
 * Flipit Finder - Main Puzzle Solving Engine (V2)
 * Orchestrates relationship generation, constraint filtering, phrase matching, candidate deduplication,
 * and deterministic ranking via RelationshipProvider and PhraseProvider interfaces.
 */

import { AnswerRanker } from './ranker.ts';
import { CompositePhraseProvider } from './compositePhraseProvider.ts';
import { CompositeRelationshipProvider } from './compositeRelationshipProvider.ts';
import {
  evaluateWordConstraint,
  isSafeConstraintPattern,
} from './constraintSafety.ts';
import { Morphology } from './morphology.ts';
import type {
  CandidateAnswer,
  ClueDiagnostic,
  CluePairConstraints,
  ConstraintRejection,
  PhraseProvider,
  RelationshipProvider,
  SolveDiagnostic,
  SolveResult,
  SolverOptions,
  WordTransformation,
} from './types.ts';

export { evaluateWordConstraint, isSafeConstraintPattern };

/**
 * Expands candidate transformations with standard English morphological inflections
 * (plurals, participles, past forms), assigning them the 'morphological' relation type.
 */
function expandWithMorphology(transformations: WordTransformation[]): WordTransformation[] {
  const result: WordTransformation[] = [...transformations];
  const seenWords = new Set<string>(transformations.map((t) => t.word.toUpperCase()));

  for (const t of transformations) {
    if (t.relationType === 'antonym' || t.relationType === 'counterpart' || t.relationType === 'synonym') {
      const inflections = Morphology.getInflections(t.word);
      for (const inf of inflections) {
        if (!seenWords.has(inf)) {
          seenWords.add(inf);
          result.push({
            originalClue: t.originalClue,
            word: inf,
            relationType: 'morphological',
            score: Math.round(t.score * 0.94 * 100) / 100,
            reason: `Morphological variation of ${t.word} (${t.relationType} of ${t.originalClue})`,
            source: t.source || 'morphology',
          });
        }
      }
    }
  }

  return result;
}

export class FlipitSolver {
  public readonly relationshipProvider: RelationshipProvider;
  public readonly phraseProvider: PhraseProvider;
  public readonly ranker: AnswerRanker;

  // Backward compatibility accessors
  public get relationshipEngine(): RelationshipProvider {
    return this.relationshipProvider;
  }
  public get phraseMatcher(): PhraseProvider {
    return this.phraseProvider;
  }

  constructor(
    relationshipProvider?: RelationshipProvider,
    phraseProvider?: PhraseProvider,
    ranker?: AnswerRanker
  ) {
    this.relationshipProvider = relationshipProvider || new CompositeRelationshipProvider();
    this.phraseProvider = phraseProvider || new CompositePhraseProvider();
    this.ranker = ranker || new AnswerRanker();
  }

  private normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  /**
   * Solve a Flipit clue pair with optional first-letter, word-length, and pattern constraints.
   * Provides structured diagnostic instrumentation for pipeline tracing and failure analysis.
   */
  public solve(
    clue1: string,
    clue2: string,
    constraints?: CluePairConstraints,
    options?: SolverOptions
  ): SolveResult {
    const startTime = performance.now();
    const c1 = this.normalizeClue(clue1);
    const c2 = this.normalizeClue(clue2);

    if (!c1 || !c2) {
      const endTime = performance.now();
      const diagnostic: SolveDiagnostic = {
        clue1: {
          clue: clue1,
          rawCount: 0,
          rawTransformations: [],
          survivingCount: 0,
          survivingTransformations: [],
          rejectedCount: 0,
          rejections: [],
        },
        clue2: {
          clue: clue2,
          rawCount: 0,
          rawTransformations: [],
          survivingCount: 0,
          survivingTransformations: [],
          rejectedCount: 0,
          rejections: [],
        },
        totalCombinationsGenerated: 0,
        totalCombinationsEvaluated: 0,
        phraseMatchesCount: 0,
        rankedCandidatesCount: 0,
        failureReason: 'INPUT_EMPTY',
        failureDescription: 'One or both clue words are empty or contain only non-alphanumeric characters.',
      };

      return {
        clue1,
        clue2,
        constraints,
        candidates: [],
        bestMatch: null,
        solveTimeMs: Math.round((endTime - startTime) * 100) / 100,
        totalCombinationsEvaluated: 0,
        diagnostic,
      };
    }

    // 1. Generate unconstrained raw transformations from relationship providers and expand with morphology
    const rawTransforms1 = expandWithMorphology(this.relationshipProvider.getTransformations(c1));
    const rawTransforms2 = expandWithMorphology(this.relationshipProvider.getTransformations(c2));

    // 2. Apply word-level constraints with explicit rejection auditing
    const rejections1: ConstraintRejection[] = [];
    const transforms1: WordTransformation[] = [];
    for (const t of rawTransforms1) {
      const evalRes = evaluateWordConstraint(t.word, constraints?.word1);
      if (evalRes.matches) {
        transforms1.push(t);
      } else if (constraints?.word1) {
        rejections1.push({
          word: t.word,
          constraint: constraints.word1,
          reason: evalRes.reason || 'Failed word constraint',
        });
      }
    }

    const rejections2: ConstraintRejection[] = [];
    const transforms2: WordTransformation[] = [];
    for (const t of rawTransforms2) {
      const evalRes = evaluateWordConstraint(t.word, constraints?.word2);
      if (evalRes.matches) {
        transforms2.push(t);
      } else if (constraints?.word2) {
        rejections2.push({
          word: t.word,
          constraint: constraints.word2,
          reason: evalRes.reason || 'Failed word constraint',
        });
      }
    }

    const totalCombinationsGenerated = transforms1.length * transforms2.length;
    let combinationsEvaluated = 0;
    let phraseMatchesCount = 0;

    // Map of unique candidate phrases to prevent duplicate final phrases
    const candidateMap = new Map<string, CandidateAnswer>();
    const minThreshold = options?.minMatchScore ?? options?.minConfidence ?? 0.0;
    const allowCompound = options?.enableCompoundMatching ?? true;

    // 3. Cross-evaluate pairs against known phrases
    for (const t1 of transforms1) {
      for (const t2 of transforms2) {
        combinationsEvaluated++;

        const matchedPhrase = this.phraseProvider.matchPhrase(t1.word, t2.word, allowCompound);
        if (!matchedPhrase) {
          continue;
        }

        phraseMatchesCount++;

        const candidate = this.ranker.evaluateCandidate({
          clue1: c1,
          clue2: c2,
          word1: t1.word,
          word2: t2.word,
          relation1: t1,
          relation2: t2,
          phraseRecord: matchedPhrase,
          constraints,
        });

        if (candidate.matchScore >= minThreshold) {
          // Normalize phrase key to prevent duplicate final phrases (e.g. CLASS MATE vs CLASSMATE)
          const dedupeKey = matchedPhrase.phrase.replace(/[^A-Z0-9]/g, '');
          const existing = candidateMap.get(dedupeKey);

          if (!existing || candidate.matchScore > existing.matchScore) {
            candidateMap.set(dedupeKey, candidate);
          }
        }
      }
    }

    // 4. Deterministically rank and limit results
    const uniqueCandidates = Array.from(candidateMap.values());
    const rankedCandidates = this.ranker.rankCandidates(uniqueCandidates, options?.maxCandidates);
    const endTime = performance.now();

    // 5. Build structured diagnostic telemetry
    let failureReason: SolveDiagnostic['failureReason'] = undefined;
    let failureDescription: string | undefined = undefined;

    if (rankedCandidates.length === 0) {
      if (rawTransforms1.length === 0) {
        failureReason = 'NO_CLUE1_TRANSFORMATIONS';
        failureDescription = `No transformations found in any relationship provider for Clue 1 "${c1}".`;
      } else if (rawTransforms2.length === 0) {
        failureReason = 'NO_CLUE2_TRANSFORMATIONS';
        failureDescription = `No transformations found in any relationship provider for Clue 2 "${c2}".`;
      } else if (transforms1.length === 0) {
        failureReason = 'ALL_CLUE1_FILTERED_BY_CONSTRAINTS';
        failureDescription = `All ${rawTransforms1.length} transformation candidates for Clue 1 "${c1}" were eliminated by word constraints.`;
      } else if (transforms2.length === 0) {
        failureReason = 'ALL_CLUE2_FILTERED_BY_CONSTRAINTS';
        failureDescription = `All ${rawTransforms2.length} transformation candidates for Clue 2 "${c2}" were eliminated by word constraints.`;
      } else if (phraseMatchesCount === 0) {
        failureReason = 'NO_RECOGNIZED_PHRASES';
        failureDescription = `Evaluated ${combinationsEvaluated} candidate pairs (${transforms1.length} × ${transforms2.length}); none formed a recognized phrase or compound in the phrase database.`;
      } else {
        failureReason = 'BELOW_SCORE_THRESHOLD';
        failureDescription = `Found ${phraseMatchesCount} phrase matches, but none met the minimum match score threshold (${minThreshold}).`;
      }
    }

    const diagnostic: SolveDiagnostic = {
      clue1: {
        clue: c1,
        rawCount: rawTransforms1.length,
        rawTransformations: rawTransforms1,
        survivingCount: transforms1.length,
        survivingTransformations: transforms1,
        rejectedCount: rejections1.length,
        rejections: rejections1,
      },
      clue2: {
        clue: c2,
        rawCount: rawTransforms2.length,
        rawTransformations: rawTransforms2,
        survivingCount: transforms2.length,
        survivingTransformations: transforms2,
        rejectedCount: rejections2.length,
        rejections: rejections2,
      },
      totalCombinationsGenerated,
      totalCombinationsEvaluated: combinationsEvaluated,
      phraseMatchesCount,
      rankedCandidatesCount: rankedCandidates.length,
      failureReason,
      failureDescription,
    };

    return {
      clue1: c1,
      clue2: c2,
      constraints,
      candidates: rankedCandidates,
      bestMatch: rankedCandidates.length > 0 ? rankedCandidates[0] : null,
      solveTimeMs: Math.round((endTime - startTime) * 100) / 100,
      totalCombinationsEvaluated: combinationsEvaluated,
      diagnostic,
    };
  }

  /**
   * Solve multiple puzzle items in batch.
   */
  public solveBatch(
    items: Array<{ clue1: string; clue2: string; constraints?: CluePairConstraints }>,
    options?: SolverOptions
  ): SolveResult[] {
    return items.map((item) => this.solve(item.clue1, item.clue2, item.constraints, options));
  }

  /**
   * Diagnostic helper: inspect all available transformations for a single word.
   */
  public inspectWord(word: string, constraint?: CluePairConstraints['word1']) {
    return this.relationshipProvider.getTransformations(this.normalizeClue(word), constraint);
  }
}

