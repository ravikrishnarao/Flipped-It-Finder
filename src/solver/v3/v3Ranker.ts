/**
 * Flipit Finder V3 — Transparent Semantic Ranking Engine (Milestone 4)
 *
 * Scores candidate two-word answers using a deterministic, explainable heuristic formula:
 *   - Semantic relationship quality & tier priority (antonym/counterpart/synonym > derivation/hypernym > coordinate/contextual > thesaurus)
 *   - Pair balance (penalizes severely lopsided pairs where one side is weak noise)
 *   - Phrase recognition evidence (exact WordNet collocation > Moby open compound > closed/hyphenated > morphological fallback)
 *   - Morphological compatibility (inflectional parity between inflected clues and candidates)
 *   - POS / word-shape plausibility & polysemy/ambiguity penalties
 *   - Reversed phrase order penalty
 *   - Constraint satisfaction confirmation
 *
 * NOTE: All scores produced by this engine are deterministic heuristic ranking metrics (0.0 to 1.0),
 * NOT calibrated statistical probabilities or empirical bigram likelihoods.
 */

import type { CluePairConstraints, RelationType, WordTransformation } from '../types.ts';
import { defaultMorphologyEngine, type MorphologyResult } from './morphology.ts';
import type { V3PhraseMatch } from './phraseTypes.ts';

export type RelationProvenanceCategory =
  | 'direct-lexical'
  | 'morphological'
  | 'hierarchical-coordinate'
  | 'thesaurus'
  | 'contextual'
  | 'curated';

export type PhraseProvenanceCategory =
  | 'wordnet-collocation'
  | 'moby-compound'
  | 'curated'
  | 'corpus-plugin';

export interface V3RankingBreakdown {
  /** Weighted quality score for Clue 1 -> Word 1 (after relation-tier calibration) */
  relationship1Quality: number;
  /** Weighted quality score for Clue 2 -> Word 2 (after relation-tier calibration) */
  relationship2Quality: number;
  /** Harmonic/minimum balance factor rewarding pairs strong on both clues */
  relationBalance: number;
  /** Weighted contribution from semantic relationship quality + balance */
  relationshipComponent: number;
  /** Weighted contribution from phrase recognition evidence */
  phraseEvidenceScore: number;
  /** Bonus/penalty for inflectional parity with inflected clues */
  morphologicalCompatibility: number;
  /** Word-shape and part-of-speech compatibility adjustment */
  posCompatibility: number;
  /** Penalty for polysemy/high clue fanout, shallow taxonomy, or noisy thesaurus-only pairs */
  ambiguityPenalty: number;
  /** Penalty applied when phrase matched only in reversed word order (word2 word1) */
  reversedOrderPenalty: number;
  /** Confirmation bonus when puzzle constraints were supplied and satisfied */
  constraintSatisfactionScore: number;
  /** Final bounded heuristic ranking score (0.0 to 1.0) */
  totalScore: number;
  /** Explicit disclaimer clarifying heuristic semantics */
  scoreIsHeuristicNote: string;
}

export interface V3CandidateAnswer {
  targetPhrase: string;
  word1: string;
  word2: string;
  relation1: WordTransformation;
  relation2: WordTransformation;
  relation1ProvenanceCategory: RelationProvenanceCategory;
  relation2ProvenanceCategory: RelationProvenanceCategory;
  phraseMatch: V3PhraseMatch;
  phraseProvenanceCategory: PhraseProvenanceCategory;
  phraseScore: number;
  /** Heuristic ranking score (0.0 to 1.0), NOT a statistical probability */
  matchScore: number;
  rankingBreakdown: V3RankingBreakdown;
  explanation: string;
  matchesConstraints: boolean;
  category?: string;
}

export interface V3EvaluateCandidateParams {
  clue1: string;
  clue2: string;
  clue1Morph?: MorphologyResult;
  clue2Morph?: MorphologyResult;
  clue1Fanout?: number;
  clue2Fanout?: number;
  relation1: WordTransformation;
  relation2: WordTransformation;
  phraseMatch: V3PhraseMatch;
  constraints?: CluePairConstraints;
}

/**
 * Calibrated relationship tier multipliers.
 * Direct lexical relations (antonym, counterpart, synonym) hold the highest prior,
 * while broad thesaurus associations and shallow coordinates are conservative.
 */
export const V3_RELATION_TIER_MULTIPLIER: Record<RelationType, number> = {
  antonym: 1.0,
  counterpart: 0.96,
  synonym: 0.93,
  derivation: 0.86,
  morphological: 0.84,
  hypernym: 0.79,
  hyponym: 0.77,
  hierarchical: 0.76,
  coordinate: 0.74,
  contextual: 0.68,
  associated: 0.66,
  thesaurus: 0.58,
};

const HEURISTIC_SCORE_NOTE =
  'Heuristic ranking index (0.0-1.0) combining lexical relation tier, phrase evidence, and morphology; NOT a statistical probability.';

export function classifyRelationProvenance(rel: WordTransformation): RelationProvenanceCategory {
  const src = (rel.source || '').toLowerCase();
  if (src.includes('curated')) {
    if (rel.relationType === 'contextual' || rel.relationType === 'associated') {
      return 'contextual';
    }
    return 'curated';
  }
  if (rel.relationType === 'contextual' || rel.relationType === 'associated') {
    return 'contextual';
  }
  if (rel.relationType === 'thesaurus' || src.includes('moby')) {
    return 'thesaurus';
  }
  if (
    rel.relationType === 'coordinate' ||
    rel.relationType === 'hypernym' ||
    rel.relationType === 'hyponym' ||
    rel.relationType === 'hierarchical'
  ) {
    return 'hierarchical-coordinate';
  }
  if (
    rel.relationType === 'morphological' ||
    rel.relationType === 'derivation' ||
    rel.reason.includes('[inflection projected')
  ) {
    return 'morphological';
  }
  return 'direct-lexical';
}

export function classifyPhraseProvenance(match: V3PhraseMatch): PhraseProvenanceCategory {
  const src = (match.sourceDataset || '').toLowerCase();
  if (src.includes('curated')) return 'curated';
  if (src.includes('wordnet')) return 'wordnet-collocation';
  if (src.includes('moby')) return 'moby-compound';
  return 'corpus-plugin';
}

export class V3Ranker {
  /**
   * Compute calibrated single-clue transformation quality in [0, 1].
   */
  public computeRelationQuality(rel: WordTransformation): number {
    const baseMultiplier = V3_RELATION_TIER_MULTIPLIER[rel.relationType] ?? 0.7;
    let depthAdjustment = 0;

    if (rel.relationType === 'coordinate' && typeof rel.depth === 'number') {
      if (rel.depth >= 8) depthAdjustment = 0.04;
      else if (rel.depth >= 6) depthAdjustment = 0.02;
      else if (rel.depth <= 4) depthAdjustment = -0.05;
    } else if (
      (rel.relationType === 'hypernym' || rel.relationType === 'hyponym') &&
      typeof rel.depth === 'number' &&
      rel.depth <= 1
    ) {
      depthAdjustment = 0.02;
    }

    const raw = rel.score * baseMultiplier + depthAdjustment;
    return Math.max(0, Math.min(1, Math.round(raw * 10000) / 10000));
  }

  /**
   * Evaluate morphological inflection compatibility between an input clue and its candidate word.
   */
  private computeMorphologicalDelta(
    clueMorph: MorphologyResult,
    targetWord: string,
    rel: WordTransformation
  ): number {
    const targetMorph = defaultMorphologyEngine.lemmatize(targetWord);

    if (clueMorph.isInflected && clueMorph.inflectionType) {
      const projectedMatch = rel.reason.includes('[inflection projected');
      if (projectedMatch) {
        return 0.035;
      }

      if (
        clueMorph.inflectionType === 'plural-noun' &&
        (targetMorph.inflectionType === 'plural-noun' || targetMorph.inflectionType === 'irregular')
      ) {
        return 0.035;
      }
      if (
        clueMorph.inflectionType === 'gerund-verb' &&
        targetMorph.inflectionType === 'gerund-verb'
      ) {
        return 0.035;
      }
      if (
        clueMorph.inflectionType === 'past-verb' &&
        (targetMorph.inflectionType === 'past-verb' || targetMorph.inflectionType === 'irregular')
      ) {
        return 0.035;
      }

      // Mild penalty if clue was inflected and transformation dropped inflection via lemma lookup
      if (
        (clueMorph.inflectionType === 'plural-noun' || clueMorph.inflectionType === 'gerund-verb') &&
        !targetMorph.isInflected &&
        rel.reason.includes('[via lemma')
      ) {
        return -0.015;
      }
      return 0;
    }

    // Uninflected clue paired with clean uninflected base word
    if (!targetMorph.isInflected) {
      return 0.01;
    }
    return 0;
  }

  /**
   * Evaluate general English word-shape / POS plausibility without puzzle-specific rules.
   */
  private computePosCompatibilityAndAmbiguity(params: {
    clue1: string;
    clue2: string;
    word1: string;
    word2: string;
    rel1: WordTransformation;
    rel2: WordTransformation;
    clue1Fanout: number;
    clue2Fanout: number;
  }): { posCompatibility: number; ambiguityPenalty: number } {
    const { clue1, clue2, word1, word2, rel1, rel2, clue1Fanout, clue2Fanout } = params;
    let posCompatibility = 0;
    let ambiguityPenalty = 0;

    // Clean standard lexical token shape bonus
    const isStandardShape = (w: string) => /^[A-Z]+$/.test(w) && w.length >= 3 && w.length <= 12;
    if (isStandardShape(word1)) posCompatibility += 0.008;
    if (isStandardShape(word2)) posCompatibility += 0.008;

    // Overly long rare compounds or clipped 1-2 char abbreviations carry noise risk
    if (word1.length > 14 || (word1.length <= 2 && clue1.length >= 4)) {
      ambiguityPenalty += 0.025;
    }
    if (word2.length > 14 || (word2.length <= 2 && clue2.length >= 4)) {
      ambiguityPenalty += 0.025;
    }

    // Polysemy / high fanout penalty when relation comes from broad/weak tier
    const isWeakTier = (r: WordTransformation) =>
      r.relationType === 'thesaurus' ||
      r.relationType === 'contextual' ||
      r.relationType === 'associated' ||
      (r.relationType === 'coordinate' && (r.depth ?? 6) <= 5) ||
      r.relationType === 'hypernym';

    if (clue1Fanout > 80 && isWeakTier(rel1)) {
      ambiguityPenalty += 0.02;
    }
    if (clue2Fanout > 80 && isWeakTier(rel2)) {
      ambiguityPenalty += 0.02;
    }

    // Dual-weak or non-lexical pair penalty (when neither clue has a direct lexical/taxonomic anchor)
    if (rel1.relationType === 'thesaurus' && rel2.relationType === 'thesaurus') {
      ambiguityPenalty += 0.03;
    } else if (
      (rel1.relationType === 'contextual' || rel1.relationType === 'associated' || rel1.relationType === 'thesaurus') &&
      (rel2.relationType === 'contextual' || rel2.relationType === 'associated' || rel2.relationType === 'thesaurus')
    ) {
      ambiguityPenalty += 0.02;
    }

    return {
      posCompatibility: Math.round(posCompatibility * 10000) / 10000,
      ambiguityPenalty: Math.round(ambiguityPenalty * 10000) / 10000,
    };
  }

  /**
   * Evaluate phrase evidence strength distinguishing WordNet collocations, Moby compounds,
   * open vs. closed/hyphenated forms, morphological fallback variants, and curated sources.
   */
  private computePhraseEvidence(phraseMatch: V3PhraseMatch): number {
    let base = phraseMatch.heuristicScore ?? phraseMatch.frequencyScore ?? 0.85;

    // Slight preference for open two-word expressions in two-word Flip-It puzzles
    if (phraseMatch.matchType === 'open') {
      base = Math.min(1.0, base + 0.02);
    } else if (phraseMatch.matchType === 'closed') {
      base = Math.max(0.0, base - 0.02);
    } else if (phraseMatch.matchType === 'hyphenated') {
      base = Math.max(0.0, base - 0.01);
    }

    // WordNet multi-word collocations are stronger phrase evidence than general compound listings
    const src = (phraseMatch.sourceDataset || '').toLowerCase();
    if (src.includes('wordnet')) {
      base = Math.min(1.0, base + 0.01);
    }

    return Math.round(base * 0.34 * 10000) / 10000;
  }

  public evaluateCandidate(params: V3EvaluateCandidateParams): V3CandidateAnswer {
    const {
      clue1,
      clue2,
      relation1,
      relation2,
      phraseMatch,
      constraints,
      clue1Fanout = 0,
      clue2Fanout = 0,
    } = params;

    const word1 = relation1.word;
    const word2 = relation2.word;
    const clue1Morph = params.clue1Morph || defaultMorphologyEngine.lemmatize(clue1);
    const clue2Morph = params.clue2Morph || defaultMorphologyEngine.lemmatize(clue2);

    const q1 = this.computeRelationQuality(relation1);
    const q2 = this.computeRelationQuality(relation2);
    const avgRel = (q1 + q2) / 2;
    const relationBalance = Math.min(q1, q2);
    const relationshipComponent = Math.round(0.56 * (0.72 * avgRel + 0.28 * relationBalance) * 10000) / 10000;

    const phraseEvidenceScore = this.computePhraseEvidence(phraseMatch);

    const morphDelta1 = this.computeMorphologicalDelta(clue1Morph, word1, relation1);
    const morphDelta2 = this.computeMorphologicalDelta(clue2Morph, word2, relation2);
    const morphologicalCompatibility = Math.round((morphDelta1 + morphDelta2) * 10000) / 10000;

    const { posCompatibility, ambiguityPenalty } = this.computePosCompatibilityAndAmbiguity({
      clue1,
      clue2,
      word1,
      word2,
      rel1: relation1,
      rel2: relation2,
      clue1Fanout,
      clue2Fanout,
    });

    const reversedOrderPenalty = phraseMatch.isReversed ? 0.15 : 0;
    const hasConstraints = Boolean(constraints?.word1 || constraints?.word2);
    const constraintSatisfactionScore = hasConstraints ? 0.02 : 0;

    const rawTotal =
      relationshipComponent +
      phraseEvidenceScore +
      morphologicalCompatibility +
      posCompatibility +
      constraintSatisfactionScore -
      ambiguityPenalty -
      reversedOrderPenalty;

    const totalScore = Math.max(0, Math.min(1, Math.round(rawTotal * 10000) / 10000));

    const rankingBreakdown: V3RankingBreakdown = {
      relationship1Quality: q1,
      relationship2Quality: q2,
      relationBalance: Math.round(relationBalance * 10000) / 10000,
      relationshipComponent,
      phraseEvidenceScore,
      morphologicalCompatibility,
      posCompatibility,
      ambiguityPenalty,
      reversedOrderPenalty,
      constraintSatisfactionScore,
      totalScore,
      scoreIsHeuristicNote: HEURISTIC_SCORE_NOTE,
    };

    const targetPhrase = `${word1} ${word2}`;
    const rel1Prov = classifyRelationProvenance(relation1);
    const rel2Prov = classifyRelationProvenance(relation2);
    const phraseProv = classifyPhraseProvenance(phraseMatch);

    const explanation = this.buildExplanation(
      clue1,
      clue2,
      word1,
      word2,
      relation1,
      relation2,
      phraseMatch
    );

    return {
      targetPhrase,
      word1,
      word2,
      relation1,
      relation2,
      relation1ProvenanceCategory: rel1Prov,
      relation2ProvenanceCategory: rel2Prov,
      phraseMatch,
      phraseProvenanceCategory: phraseProv,
      phraseScore: phraseMatch.heuristicScore ?? phraseMatch.frequencyScore,
      matchScore: totalScore,
      rankingBreakdown,
      explanation,
      matchesConstraints: true,
      category: phraseMatch.phraseCategory || phraseMatch.category,
    };
  }

  public buildExplanation(
    clue1: string,
    clue2: string,
    word1: string,
    word2: string,
    rel1: WordTransformation,
    rel2: WordTransformation,
    phraseMatch: V3PhraseMatch
  ): string {
    const src1 = rel1.source || 'V3 Lexical Engine';
    const src2 = rel2.source || 'V3 Lexical Engine';
    const orderNote = phraseMatch.isReversed ? ' [reversed order fallback]' : '';
    return (
      `"${clue1}" → "${word1}" (${rel1.relationType} via ${src1}: ${rel1.reason}) + ` +
      `"${clue2}" → "${word2}" (${rel2.relationType} via ${src2}: ${rel2.reason}) ` +
      `forms "${word1} ${word2}" (${phraseMatch.matchType} ${phraseMatch.phraseCategory} in ${phraseMatch.sourceDataset}${orderNote}).`
    );
  }

  /**
   * Deterministically sort candidate answers by:
   * 1. totalScore (descending)
   * 2. phraseEvidenceScore (descending)
   * 3. relationBalance (descending)
   * 4. alphabetical targetPhrase (ascending)
   */
  public rankCandidates(candidates: V3CandidateAnswer[], maxResults?: number): V3CandidateAnswer[] {
    const sorted = [...candidates].sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (b.rankingBreakdown.phraseEvidenceScore !== a.rankingBreakdown.phraseEvidenceScore) {
        return b.rankingBreakdown.phraseEvidenceScore - a.rankingBreakdown.phraseEvidenceScore;
      }
      if (b.rankingBreakdown.relationBalance !== a.rankingBreakdown.relationBalance) {
        return b.rankingBreakdown.relationBalance - a.rankingBreakdown.relationBalance;
      }
      return a.targetPhrase.localeCompare(b.targetPhrase);
    });

    if (typeof maxResults === 'number' && maxResults > 0) {
      return sorted.slice(0, maxResults);
    }
    return sorted;
  }
}
