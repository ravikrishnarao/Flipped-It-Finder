/**
 * Flipit Finder - Composite Relationship Provider
 * Combines curated domain relationships with broad WordNet 3.0 lexical relations.
 * Enforces strict relation priority and deduplication.
 */

import { ContextualAssociationProvider } from './contextualAssociationProvider.ts';
import { LexicalRelationshipProvider, RELATION_PRIORITY } from './lexicalRelationshipProvider.ts';
import { RelationshipEngine } from './relationshipEngine.ts';
import type {
  RelationshipProvider,
  WordConstraint,
  WordRelationshipsDefinition,
  WordTransformation,
} from './types.ts';

export class CompositeRelationshipProvider implements RelationshipProvider {
  private providers: RelationshipProvider[];

  constructor(providers?: RelationshipProvider[]) {
    this.providers = providers && providers.length > 0
      ? providers
      : [
          new RelationshipEngine(),
          new LexicalRelationshipProvider(),
          new ContextualAssociationProvider(),
        ];
  }

  public hasClue(clue: string): boolean {
    return this.providers.some((p) => p.hasClue(clue));
  }

  public addWordRelations(word: string, relations: WordRelationshipsDefinition): void {
    for (const p of this.providers) {
      if (typeof p.addWordRelations === 'function') {
        p.addWordRelations(word, relations);
        break;
      }
    }
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const bestByWord = new Map<string, WordTransformation>();

    for (const provider of this.providers) {
      const transforms = provider.getTransformations(clue, constraint);
      for (const t of transforms) {
        const cleanWord = t.word.trim().toUpperCase();
        const existing = bestByWord.get(cleanWord);

        if (!existing) {
          bestByWord.set(cleanWord, t);
        } else {
          const isHigherScore = t.score > existing.score;
          const isSameScoreHigherPriority =
            t.score === existing.score &&
            RELATION_PRIORITY[t.relationType] > RELATION_PRIORITY[existing.relationType];

          if (isHigherScore || isSameScoreHigherPriority) {
            bestByWord.set(cleanWord, t);
          }
        }
      }
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
