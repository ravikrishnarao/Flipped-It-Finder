/**
 * Flipit Finder - Lexical Relationship Provider (WordNet 3.0)
 * Implements RelationshipProvider interface using offline WordNet 3.0 lexical relations.
 * Distinguishes relation types with explicit priority and calibrated score bounds.
 */

import wordnetData from '../../data/wordnet_relationships.json' with { type: 'json' };
import { evaluateWordConstraint } from './constraintSafety.ts';
import { Morphology } from './morphology.ts';
import type {
  RelationshipLexicon,
  RelationshipProvider,
  RelationType,
  WordConstraint,
  WordRelationshipsDefinition,
  WordTransformation,
} from './types.ts';

/**
 * Strict priority mapping ensuring strong semantic links outrank loose associations:
 * antonym (6) > counterpart (5) > synonym (4) > morphological (3) > hierarchical (2) > associated / contextual (1)
 */
export const RELATION_PRIORITY: Record<RelationType, number> = {
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

export class LexicalRelationshipProvider implements RelationshipProvider {
  private lexicon: Map<string, WordRelationshipsDefinition> = new Map();

  constructor(customData?: RelationshipLexicon) {
    const source: RelationshipLexicon = customData || (wordnetData as unknown as RelationshipLexicon);
    this.loadLexicon(source);
    this.inferReciprocalRelations();
  }

  public normalizeWord(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  public loadLexicon(data: RelationshipLexicon): void {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('_')) continue; // Skip metadata
      const normalizedKey = this.normalizeWord(key);
      if (!normalizedKey) continue;
      const existing = this.lexicon.get(normalizedKey) || {};
      this.lexicon.set(normalizedKey, {
        synonyms: [...(existing.synonyms || []), ...(value.synonyms || [])],
        antonyms: [...(existing.antonyms || []), ...(value.antonyms || [])],
        counterparts: [...(existing.counterparts || []), ...(value.counterparts || [])],
        contextual: [...(existing.contextual || []), ...(value.contextual || [])],
        associated: [...(existing.associated || []), ...(value.associated || [])],
        hierarchical: [...(existing.hierarchical || []), ...(value.hierarchical || [])],
        morphological: [...(existing.morphological || []), ...(value.morphological || [])],
      });
    }
  }

  public addWordRelations(word: string, relations: WordRelationshipsDefinition): void {
    const normalized = this.normalizeWord(word);
    if (!normalized) return;
    const existing = this.lexicon.get(normalized) || {};
    this.lexicon.set(normalized, {
      synonyms: [...(existing.synonyms || []), ...(relations.synonyms || [])],
      antonyms: [...(existing.antonyms || []), ...(relations.antonyms || [])],
      counterparts: [...(existing.counterparts || []), ...(relations.counterparts || [])],
      contextual: [...(existing.contextual || []), ...(relations.contextual || [])],
      associated: [...(existing.associated || []), ...(relations.associated || [])],
      hierarchical: [...(existing.hierarchical || []), ...(relations.hierarchical || [])],
      morphological: [...(existing.morphological || []), ...(relations.morphological || [])],
    });
  }

  /**
   * Reciprocal relation inference for symmetric pairings (antonyms and counterparts).
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
          if (!targetDef.counterparts.some((c) => this.normalizeWord(c.word) === clue)) {
            targetDef.counterparts.push({
              word: clue,
              score: Math.max(0.75, Math.round(entry.score * 0.95 * 100) / 100),
              reason: `WordNet reciprocal counterpart of ${clue}`,
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
          if (!targetDef.antonyms.some((a) => this.normalizeWord(a.word) === clue)) {
            targetDef.antonyms.push({
              word: clue,
              score: Math.max(0.75, Math.round(entry.score * 0.95 * 100) / 100),
              reason: `WordNet reciprocal antonym of ${clue}`,
            });
          }
        }
      }
    }
  }

  public hasClue(word: string): boolean {
    const normalized = this.normalizeWord(word);
    if (this.lexicon.has(normalized)) return true;
    const lemmas = Morphology.getCandidateLemmas(normalized);
    return lemmas.some((l) => this.lexicon.has(l));
  }

  public matchesConstraint(word: string, constraint?: WordConstraint): boolean {
    return evaluateWordConstraint(word, constraint).matches;
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const normalizedClue = this.normalizeWord(clue);
    if (!normalizedClue) return [];

    let entry = this.lexicon.get(normalizedClue);
    let resolvedClue = normalizedClue;

    if (!entry) {
      const lemmas = Morphology.getCandidateLemmas(normalizedClue);
      for (const l of lemmas) {
        if (this.lexicon.has(l)) {
          entry = this.lexicon.get(l);
          resolvedClue = l;
          break;
        }
      }
    }

    if (!entry) return [];

    const bestByWord = new Map<string, WordTransformation>();

    const considerTransformation = (
      word: string,
      relationType: RelationType,
      score: number,
      reason: string
    ) => {
      const targetWord = this.normalizeWord(word);
      if (!targetWord || targetWord === normalizedClue) return;

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

    if (entry.antonyms) {
      for (const a of entry.antonyms) considerTransformation(a.word, 'antonym', a.score, a.reason);
    }
    if (entry.counterparts) {
      for (const c of entry.counterparts) considerTransformation(c.word, 'counterpart', c.score, c.reason);
    }
    if (entry.synonyms) {
      for (const s of entry.synonyms) considerTransformation(s.word, 'synonym', s.score, s.reason);
    }
    if (entry.morphological) {
      for (const m of entry.morphological) considerTransformation(m.word, 'morphological', m.score, m.reason);
    }
    if (entry.hierarchical) {
      for (const h of entry.hierarchical) considerTransformation(h.word, 'hierarchical', h.score, h.reason);
    }
    if (entry.associated) {
      for (const as of entry.associated) considerTransformation(as.word, 'associated', as.score, as.reason);
    }
    if (entry.contextual) {
      for (const cx of entry.contextual) considerTransformation(cx.word, 'contextual', cx.score, cx.reason);
    }

    return Array.from(bestByWord.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (RELATION_PRIORITY[b.relationType] !== RELATION_PRIORITY[a.relationType]) {
        return RELATION_PRIORITY[b.relationType] - RELATION_PRIORITY[a.relationType];
      }
      return a.word.localeCompare(b.word);
    });
  }
}
