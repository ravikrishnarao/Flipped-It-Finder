/**
 * Flipit Finder - Answer Ranking and Explanation Engine (V2)
 * Scores candidates using a deterministic heuristic formula combining relation strengths
 * and phrase popularity.
 * NOTE: The matchScore represents a heuristic collocation ranking score (0.0 to 1.0),
 * NOT a statistical or Bayesian probability.
 */

import type {
  CandidateAnswer,
  CluePairConstraints,
  PhraseRecord,
  WordTransformation,
} from './types.ts';

export interface ScoredCandidateParams {
  clue1: string;
  clue2: string;
  word1: string;
  word2: string;
  relation1: WordTransformation;
  relation2: WordTransformation;
  phraseRecord: PhraseRecord;
  constraints?: CluePairConstraints;
}

export class AnswerRanker {
  private weightRelation1: number;
  private weightRelation2: number;
  private weightPhraseFreq: number;

  constructor(weights = { relation1: 0.35, relation2: 0.35, phraseFreq: 0.30 }) {
    this.weightRelation1 = weights.relation1;
    this.weightRelation2 = weights.relation2;
    this.weightPhraseFreq = weights.phraseFreq;
  }

  /**
   * Calculate deterministic heuristic matchScore between 0.0 and 1.0.
   * This is a ranking index based on curated relation strength and collocation frequency,
   * NOT a statistical probability distribution.
   */
  public calculateMatchScore(
    rel1Score: number,
    rel2Score: number,
    phraseFreqScore: number,
    penalties = 0
  ): number {
    const rawScore =
      rel1Score * this.weightRelation1 +
      rel2Score * this.weightRelation2 +
      phraseFreqScore * this.weightPhraseFreq -
      penalties;

    // Clamp score to [0, 1] range and round to 3 decimals
    const clamped = Math.max(0, Math.min(1, rawScore));
    return Math.round(clamped * 1000) / 1000;
  }

  /**
   * @deprecated Backward compatibility alias for calculateMatchScore.
   */
  public calculateConfidence(
    rel1Score: number,
    rel2Score: number,
    phraseFreqScore: number,
    penalties = 0
  ): number {
    return this.calculateMatchScore(rel1Score, rel2Score, phraseFreqScore, penalties);
  }

  /**
   * Format a clear, natural-language explanation of a transformation relation,
   * distinguishing relationship types and indicating dataset provenance.
   */
  public formatRelationExplanation(rel: WordTransformation): string {
    let typeName: string = rel.relationType;
    switch (rel.relationType) {
      case 'synonym':
        typeName = 'synonym';
        break;
      case 'antonym':
        typeName = 'antonym';
        break;
      case 'counterpart':
        typeName = 'counterpart';
        break;
      case 'associated':
        typeName = 'associated concept/activity';
        break;
      case 'contextual':
        typeName = 'contextual association';
        break;
      case 'hierarchical':
        typeName = 'hierarchical relationship';
        break;
      case 'morphological':
        typeName = 'morphological variation';
        break;
    }

    const isWordNet =
      rel.reason.toLowerCase().includes('wordnet') ||
      Boolean(rel.source && rel.source.toLowerCase().includes('wordnet'));
    const isContextual =
      Boolean(rel.source && rel.source.toLowerCase().includes('contextual')) ||
      rel.reason.toLowerCase().includes('contextual');

    const sourceLabel = isWordNet
      ? 'WordNet 3.0'
      : isContextual
        ? 'Contextual Associations Repository'
        : 'Curated Benchmark';

    const cleanReason = rel.reason
      .replace(/^direct\s+wordnet\s+/i, '')
      .replace(/^wordnet\s+/i, '')
      .replace(/^project-curated\s+/i, '')
      .replace(/^contextual\s+/i, '')
      .trim();

    return `${typeName} via ${sourceLabel}: ${cleanReason}`;
  }

  /**
   * Format a clear, natural-language explanation of why this answer is valid.
   */
  public buildExplanation(
    clue1: string,
    clue2: string,
    word1: string,
    word2: string,
    rel1: WordTransformation,
    rel2: WordTransformation,
    phraseName: string
  ): string {
    const part1 = `"${clue1}" flips to "${word1}" (${this.formatRelationExplanation(rel1)})`;
    const part2 = `"${clue2}" flips to "${word2}" (${this.formatRelationExplanation(rel2)})`;
    return `${part1} and ${part2}, together forming the phrase "${phraseName}".`;
  }

  /**
   * Evaluate a single candidate pair into a CandidateAnswer.
   * Applies conservative depth penalty only when meaningful taxonomic or associative depth exists,
   * guaranteeing that direct antonyms, counterparts, and synonyms outrank abstract hierarchical categories
   * or loose contextual associations.
   */
  public evaluateCandidate(params: ScoredCandidateParams): CandidateAnswer {
    const { clue1, clue2, word1, word2, relation1, relation2, phraseRecord } = params;

    let depthPenalty = 0;
    // Hierarchical relations (hypernyms/hyponyms) have semantic distance
    if (relation1.relationType === 'hierarchical') depthPenalty += 0.02;
    if (relation2.relationType === 'hierarchical') depthPenalty += 0.02;
    // Loose associations have contextual distance
    if (relation1.relationType === 'associated' || relation1.relationType === 'contextual') depthPenalty += 0.03;
    if (relation2.relationType === 'associated' || relation2.relationType === 'contextual') depthPenalty += 0.03;

    const matchScore = this.calculateMatchScore(
      relation1.score,
      relation2.score,
      phraseRecord.frequencyScore,
      depthPenalty
    );

    const explanation = this.buildExplanation(
      clue1,
      clue2,
      word1,
      word2,
      relation1,
      relation2,
      phraseRecord.phrase
    );

    return {
      targetPhrase: phraseRecord.phrase,
      word1,
      word2,
      relation1,
      relation2,
      phraseScore: phraseRecord.frequencyScore,
      matchScore,
      confidence: matchScore, // deprecated alias retained for backward compatibility
      explanation,
      matchesConstraints: true,
      category: phraseRecord.category,
    };
  }

  /**
   * Deterministically rank candidate answers:
   * 1. matchScore (descending)
   * 2. phraseScore (descending)
   * 3. combined relation strength (descending)
   * 4. alphabetical tie-break on targetPhrase
   */
  public rankCandidates(candidates: CandidateAnswer[], maxResults?: number): CandidateAnswer[] {
    const sorted = [...candidates].sort((a, b) => {
      // Primary: matchScore
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      // Secondary: phrase collocation frequency
      if (b.phraseScore !== a.phraseScore) {
        return b.phraseScore - a.phraseScore;
      }
      // Tertiary: sum of relational transformation strengths
      const relSumB = b.relation1.score + b.relation2.score;
      const relSumA = a.relation1.score + a.relation2.score;
      if (relSumB !== relSumA) {
        return relSumB - relSumA;
      }
      // Quaternary: strictly deterministic alphabetical tie-break
      return a.targetPhrase.localeCompare(b.targetPhrase);
    });

    if (typeof maxResults === 'number' && maxResults > 0) {
      return sorted.slice(0, maxResults);
    }

    return sorted;
  }
}
