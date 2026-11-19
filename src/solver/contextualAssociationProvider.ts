/**
 * Flipit Finder - Contextual Association Provider (V2.2.4)
 * Implements RelationshipProvider interface for offline contextual, functional,
 * and activity-based relationships.
 * Distinct from WordNet synonyms and antonyms.
 */

import contextualData from '../../data/contextual_associations.json' with { type: 'json' };
import { evaluateWordConstraint } from './solver.ts';
import type {
  RelationshipLexicon,
  RelationshipProvider,
  RelationType,
  WordConstraint,
  WordRelationshipsDefinition,
  WordTransformation,
} from './types.ts';

export class ContextualAssociationProvider implements RelationshipProvider {
  private lexicon: Map<string, WordRelationshipsDefinition> = new Map();

  constructor(customData?: RelationshipLexicon) {
    const source: RelationshipLexicon = customData || (contextualData as unknown as RelationshipLexicon);
    this.loadLexicon(source);
    this.inferReciprocalAssociations();
  }

  public normalizeWord(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  public loadLexicon(data: RelationshipLexicon): void {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('_')) continue;
      const normalizedKey = this.normalizeWord(key);
      if (!normalizedKey) continue;
      const existing = this.lexicon.get(normalizedKey) || {};
      this.lexicon.set(normalizedKey, {
        contextual: [...(existing.contextual || []), ...(value.contextual || [])],
        associated: [...(existing.associated || []), ...(value.associated || [])],
      });
    }
  }

  public addWordRelations(word: string, relations: WordRelationshipsDefinition): void {
    const normalized = this.normalizeWord(word);
    if (!normalized) return;
    const existing = this.lexicon.get(normalized) || {};
    this.lexicon.set(normalized, {
      contextual: [...(existing.contextual || []), ...(relations.contextual || [])],
      associated: [...(existing.associated || []), ...(relations.associated || [])],
    });
  }

  /**
   * Reciprocally infer symmetric associated activities and tool pairings
   */
  public inferReciprocalAssociations(): void {
    for (const [clue, def] of this.lexicon.entries()) {
      if (def.associated) {
        for (const entry of def.associated) {
          const target = this.normalizeWord(entry.word);
          if (!target || target === clue) continue;
          if (!this.lexicon.has(target)) {
            this.lexicon.set(target, {});
          }
          const targetDef = this.lexicon.get(target)!;
          targetDef.associated = targetDef.associated || [];
          if (!targetDef.associated.some((a) => this.normalizeWord(a.word) === clue)) {
            targetDef.associated.push({
              word: clue,
              score: Math.max(0.78, Math.round(entry.score * 0.96 * 100) / 100),
              reason: `Reciprocal association with ${clue}`,
            });
          }
        }
      }
    }
  }

  public hasClue(word: string): boolean {
    const normalized = this.normalizeWord(word);
    return this.lexicon.has(normalized);
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const normalizedClue = this.normalizeWord(clue);
    if (!normalizedClue) return [];

    const entry = this.lexicon.get(normalizedClue);
    if (!entry) return [];

    const bestByWord = new Map<string, WordTransformation>();

    const consider = (
      targetRaw: string,
      relationType: RelationType,
      score: number,
      reason: string,
      source = 'Curated Contextual Associations Repository'
    ) => {
      const targetWord = this.normalizeWord(targetRaw);
      if (!targetWord || targetWord === normalizedClue) return;

      if (constraint) {
        const evalRes = evaluateWordConstraint(targetWord, constraint);
        if (!evalRes.matches) return;
      }

      const existing = bestByWord.get(targetWord);
      if (!existing || score > existing.score) {
        bestByWord.set(targetWord, {
          originalClue: normalizedClue,
          word: targetWord,
          relationType,
          score,
          reason,
          source,
        });
      }
    };

    if (entry.associated) {
      for (const a of entry.associated) {
        consider(a.word, 'associated', a.score, a.reason, (a as any).source);
      }
    }

    if (entry.contextual) {
      for (const c of entry.contextual) {
        consider(c.word, 'contextual', c.score, c.reason, (c as any).source);
      }
    }

    return Array.from(bestByWord.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.word.localeCompare(b.word);
    });
  }
}
