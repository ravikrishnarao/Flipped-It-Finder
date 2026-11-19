/**
 * Flipit Finder - Word Relationship Engine (V2)
 * Implements RelationshipProvider interface.
 * Generates deduplicated transformed words (antonyms, counterparts, synonyms, contextual)
 * retaining the strongest relation, and enforces constraints.
 */

import defaultRelationshipsData from '../../data/relationships.json' with { type: 'json' };
import { evaluateWordConstraint } from './constraintSafety.ts';
import type {
  RelationshipLexicon,
  RelationshipProvider,
  RelationType,
  WordConstraint,
  WordRelationshipsDefinition,
  WordTransformation,
} from './types.ts';

const RELATION_PRIORITY: Record<RelationType, number> = {
  antonym: 6,
  counterpart: 5,
  synonym: 4,
  derivation: 3.5,
  morphological: 3,
  hierarchical: 2.5,
  hypernym: 2.5,
  hyponym: 2.2,
  coordinate: 2,
  associated: 1,
  thesaurus: 1,
  contextual: 1,
};

export class RelationshipEngine implements RelationshipProvider {
  private lexicon: Map<string, WordRelationshipsDefinition> = new Map();

  constructor(initialData?: RelationshipLexicon) {
    const sourceData: RelationshipLexicon = initialData || (defaultRelationshipsData as RelationshipLexicon);
    this.loadLexicon(sourceData);
    this.inferReciprocalRelations();
  }

  /**
   * Normalize an input word (trim, uppercase, remove edge punctuation).
   */
  public normalizeWord(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  /**
   * Load dictionary entries into the internal map.
   */
  public loadLexicon(data: RelationshipLexicon): void {
    for (const [key, value] of Object.entries(data)) {
      const normalizedKey = this.normalizeWord(key);
      if (!normalizedKey) continue;
      const existing = this.lexicon.get(normalizedKey) || {};
      this.lexicon.set(normalizedKey, {
        synonyms: [...(existing.synonyms || []), ...(value.synonyms || [])],
        antonyms: [...(existing.antonyms || []), ...(value.antonyms || [])],
        counterparts: [...(existing.counterparts || []), ...(value.counterparts || [])],
        contextual: [...(existing.contextual || []), ...(value.contextual || [])],
      });
    }
  }

  /**
   * Add or update word relations dynamically.
   */
  public addWordRelations(word: string, relations: WordRelationshipsDefinition): void {
    const normalized = this.normalizeWord(word);
    if (!normalized) return;
    const existing = this.lexicon.get(normalized) || {};
    this.lexicon.set(normalized, {
      synonyms: [...(existing.synonyms || []), ...(relations.synonyms || [])],
      antonyms: [...(existing.antonyms || []), ...(relations.antonyms || [])],
      counterparts: [...(existing.counterparts || []), ...(relations.counterparts || [])],
      contextual: [...(existing.contextual || []), ...(relations.contextual || [])],
    });
  }

  /**
   * Automatically infer reciprocal counterparts and antonyms where symmetric,
   * avoiding duplicates and preserving explicit higher-scoring relations.
   */
  public inferReciprocalRelations(): void {
    for (const [clue, def] of this.lexicon.entries()) {
      if (def.counterparts) {
        for (const entry of def.counterparts) {
          const target = this.normalizeWord(entry.word);
          if (!target || target === clue) continue;
          if (!this.lexicon.has(target)) {
            this.lexicon.set(target, {});
          }
          const targetDef = this.lexicon.get(target)!;
          targetDef.counterparts = targetDef.counterparts || [];
          const exists = targetDef.counterparts.some(
            (c) => this.normalizeWord(c.word) === clue
          );
          if (!exists) {
            targetDef.counterparts.push({
              word: clue,
              score: Math.max(0.7, Math.round(entry.score * 0.95 * 100) / 100),
              reason: `Reciprocal counterpart of ${clue}`,
            });
          }
        }
      }

      if (def.antonyms) {
        for (const entry of def.antonyms) {
          const target = this.normalizeWord(entry.word);
          if (!target || target === clue) continue;
          if (!this.lexicon.has(target)) {
            this.lexicon.set(target, {});
          }
          const targetDef = this.lexicon.get(target)!;
          targetDef.antonyms = targetDef.antonyms || [];
          const exists = targetDef.antonyms.some(
            (a) => this.normalizeWord(a.word) === clue
          );
          if (!exists) {
            targetDef.antonyms.push({
              word: clue,
              score: Math.max(0.7, Math.round(entry.score * 0.95 * 100) / 100),
              reason: `Reciprocal antonym of ${clue}`,
            });
          }
        }
      }
    }
  }

  /**
   * Check if a clue exists in the relationship engine.
   */
  public hasClue(word: string): boolean {
    return this.lexicon.has(this.normalizeWord(word));
  }

  /**
   * Verify if a candidate word satisfies constraint rules.
   */
  public matchesConstraint(word: string, constraint?: WordConstraint): boolean {
    return evaluateWordConstraint(word, constraint).matches;
  }

  /**
   * Get all valid transformations for a clue word, filtered by optional constraints.
   * Deduplicates by target word, retaining the strongest relationship and score.
   */
  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const normalizedClue = this.normalizeWord(clue);
    if (!normalizedClue) return [];

    const entry = this.lexicon.get(normalizedClue);
    if (!entry) return [];

    // Map each target word to its best transformation
    const bestByWord = new Map<string, WordTransformation>();

    const considerTransformation = (
      word: string,
      relationType: RelationType,
      score: number,
      reason: string
    ) => {
      const targetWord = this.normalizeWord(word);
      if (!targetWord) return;

      // Check constraints immediately
      if (constraint && !this.matchesConstraint(targetWord, constraint)) {
        return;
      }

      const existing = bestByWord.get(targetWord);
      if (!existing) {
        bestByWord.set(targetWord, {
          originalClue: normalizedClue,
          word: targetWord,
          relationType,
          score,
          reason,
        });
      } else {
        // Retain the strongest relationship
        const isHigherScore = score > existing.score;
        const isSameScoreHigherPriority =
          score === existing.score &&
          RELATION_PRIORITY[relationType] > RELATION_PRIORITY[existing.relationType];

        if (isHigherScore || isSameScoreHigherPriority) {
          bestByWord.set(targetWord, {
            originalClue: normalizedClue,
            word: targetWord,
            relationType,
            score,
            reason,
          });
        }
      }
    };

    // Process all categories
    if (entry.antonyms) {
      for (const a of entry.antonyms) considerTransformation(a.word, 'antonym', a.score, a.reason);
    }
    if (entry.counterparts) {
      for (const c of entry.counterparts) considerTransformation(c.word, 'counterpart', c.score, c.reason);
    }
    if (entry.synonyms) {
      for (const s of entry.synonyms) considerTransformation(s.word, 'synonym', s.score, s.reason);
    }
    if (entry.contextual) {
      for (const cx of entry.contextual) considerTransformation(cx.word, 'contextual', cx.score, cx.reason);
    }

    // Convert to array and sort deterministically:
    // 1. Score descending
    // 2. Relation priority descending
    // 3. Alphabetical tie-break
    return Array.from(bestByWord.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (RELATION_PRIORITY[b.relationType] !== RELATION_PRIORITY[a.relationType]) {
        return RELATION_PRIORITY[b.relationType] - RELATION_PRIORITY[a.relationType];
      }
      return a.word.localeCompare(b.word);
    });
  }
}
