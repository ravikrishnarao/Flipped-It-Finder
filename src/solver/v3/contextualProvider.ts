/**
 * Flipit Finder V3 — Contextual & Activity Relationship Provider
 * Provides high-confidence functional pairings, activity associations, and conceptual
 * counterparts only where the source genuinely supports that interpretation.
 */

import { evaluateWordConstraint } from '../solver.ts';
import type {
  AsyncRelationshipProvider,
  WordConstraint,
  WordTransformation,
} from './types.ts';

interface CuratedContextualEntry {
  word: string;
  score: number;
  reason: string;
  relationType: 'contextual' | 'associated';
}

const CORE_CONTEXTUAL_ASSOCIATIONS: Record<string, CuratedContextualEntry[]> = {
  DRY: [
    { word: 'CLEAN', score: 0.85, reason: 'Contextual association: dry-cleaning / laundry action', relationType: 'contextual' },
    { word: 'WET', score: 0.99, reason: 'Direct moisture antonym', relationType: 'contextual' },
  ],
  MOP: [
    { word: 'SWEEP', score: 0.86, reason: 'Related floor-cleaning activity pair (mop and sweep)', relationType: 'associated' },
    { word: 'BROOM', score: 0.84, reason: 'Associated cleaning implement pair (mop and broom)', relationType: 'associated' },
  ],
  BRUSH: [
    { word: 'COMB', score: 0.86, reason: 'Grooming activity and implement pair (brush and comb)', relationType: 'associated' },
    { word: 'PAINT', score: 0.82, reason: 'Associated creative/trade implement pair', relationType: 'associated' },
  ],
  COMB: [
    { word: 'BRUSH', score: 0.86, reason: 'Grooming activity and implement pair (comb and brush)', relationType: 'associated' },
  ],
  HAMMER: [
    { word: 'NAIL', score: 0.86, reason: 'Functional tool-and-fastener pairing (hammer and nail)', relationType: 'associated' },
  ],
  NAIL: [
    { word: 'HAMMER', score: 0.86, reason: 'Functional tool-and-fastener pairing (nail and hammer)', relationType: 'associated' },
  ],
  NEEDLE: [
    { word: 'THREAD', score: 0.86, reason: 'Functional sewing pairing (needle and thread)', relationType: 'associated' },
  ],
  THREAD: [
    { word: 'NEEDLE', score: 0.86, reason: 'Functional sewing pairing (thread and needle)', relationType: 'associated' },
  ],
  LOCK: [
    { word: 'KEY', score: 0.88, reason: 'Functional security mechanism pairing (lock and key)', relationType: 'associated' },
  ],
  KEY: [
    { word: 'LOCK', score: 0.88, reason: 'Functional security mechanism pairing (key and lock)', relationType: 'associated' },
  ],
  BREAD: [
    { word: 'BUTTER', score: 0.85, reason: 'Culinary conceptual pairing (bread and butter)', relationType: 'associated' },
  ],
  BUTTER: [
    { word: 'BREAD', score: 0.85, reason: 'Culinary conceptual pairing (butter and bread)', relationType: 'associated' },
  ],
  COOK: [
    { word: 'BAKE', score: 0.84, reason: 'Symmetric culinary preparation action', relationType: 'associated' },
  ],
  BAKE: [
    { word: 'COOK', score: 0.84, reason: 'Symmetric culinary preparation action', relationType: 'associated' },
  ],
  CHOP: [
    { word: 'SLICE', score: 0.84, reason: 'Symmetric culinary cutting action', relationType: 'associated' },
  ],
  SLICE: [
    { word: 'CHOP', score: 0.84, reason: 'Symmetric culinary cutting action', relationType: 'associated' },
  ],
  CUT: [
    { word: 'PASTE', score: 0.86, reason: 'Symmetric digital/editing action pair (cut and paste)', relationType: 'associated' },
  ],
  PASTE: [
    { word: 'CUT', score: 0.86, reason: 'Symmetric digital/editing action pair (paste and cut)', relationType: 'associated' },
  ],
  REST: [
    { word: 'WORK', score: 0.94, reason: 'Activity opposite pair: labor vs rest', relationType: 'contextual' },
  ],
  WORK: [
    { word: 'REST', score: 0.94, reason: 'Activity opposite pair: labor vs rest', relationType: 'contextual' },
  ],
};

export class ContextualAssociationProvider implements AsyncRelationshipProvider {
  public readonly providerName = 'ContextualAssociationProvider';
  private associations: Map<string, CuratedContextualEntry[]> = new Map();

  constructor(customAssociations?: Record<string, CuratedContextualEntry[]>) {
    const data = customAssociations || CORE_CONTEXTUAL_ASSOCIATIONS;
    for (const [key, list] of Object.entries(data)) {
      this.associations.set(key.trim().toUpperCase(), list);
    }
  }

  public normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  public hasClue(clue: string): boolean {
    const norm = this.normalizeClue(clue);
    return this.associations.has(norm);
  }

  public async hasClueAsync(clue: string): Promise<boolean> {
    return this.hasClue(clue);
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const norm = this.normalizeClue(clue);
    const list = this.associations.get(norm);
    if (!list) return [];

    const results: WordTransformation[] = [];
    for (const item of list) {
      const target = this.normalizeClue(item.word);
      if (evaluateWordConstraint(target, constraint).matches) {
        results.push({
          originalClue: norm,
          word: target,
          relationType: item.relationType,
          score: item.score,
          reason: item.reason,
          source: 'Curated Contextual Lexicon',
        });
      }
    }

    return results;
  }

  public async getTransformationsAsync(
    clue: string,
    constraint?: WordConstraint
  ): Promise<WordTransformation[]> {
    return this.getTransformations(clue, constraint);
  }
}
