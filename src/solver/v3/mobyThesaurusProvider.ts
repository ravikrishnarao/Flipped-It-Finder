/**
 * Flipit Finder V3 — Moby Thesaurus Relationship Provider
 * Queries Moby Thesaurus II contextual associations asynchronously on demand.
 * Labels relations accurately as thesaurus / associated concepts without
 * conflating them with direct WordNet synonyms or antonyms.
 */

import { evaluateWordConstraint } from '../solver.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncRelationshipProvider,
  PartitionLoadStats,
  WordConstraint,
  WordTransformation,
} from './types.ts';

export interface RawMobyAssoc {
  word: string;
  score: number;
  reason: string;
  relationType: string;
  source: string;
}

export type MobyAssocPartition = Record<string, Array<RawMobyAssoc | string>>;

export class MobyThesaurusProvider implements AsyncRelationshipProvider {
  public readonly providerName = 'MobyThesaurusProvider';
  private loader: PartitionLoader;
  private basePath: string;
  private maxAssociationsPerWord: number;

  constructor(
    loader?: PartitionLoader,
    basePath = 'data/v3/compiled/moby/associations',
    maxAssociationsPerWord = 20
  ) {
    this.loader = loader || new PartitionLoader();
    this.basePath = basePath;
    this.maxAssociationsPerWord = maxAssociationsPerWord;
  }

  public normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  public getPartitionRelativePath(letter: string): string {
    return `${this.basePath}/assoc_${letter.toLowerCase()}.json`;
  }

  public async preloadPartition(letter: string): Promise<PartitionLoadStats> {
    const relPath = this.getPartitionRelativePath(letter);
    const { stats } = await this.loader.loadPartition<MobyAssocPartition>(relPath);
    return stats;
  }

  public hasClue(clue: string): boolean {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<MobyAssocPartition>(relPath);
    return Boolean(data && data[norm] && data[norm].length > 0);
  }

  public async hasClueAsync(clue: string): Promise<boolean> {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<MobyAssocPartition>(relPath);
    return Boolean(data && data[norm] && data[norm].length > 0);
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<MobyAssocPartition>(relPath);
    if (!data || !data[norm]) return [];

    return this.extractAssociations(norm, data[norm], constraint);
  }

  public async getTransformationsAsync(
    clue: string,
    constraint?: WordConstraint
  ): Promise<WordTransformation[]> {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<MobyAssocPartition>(relPath);
    if (!data || !data[norm]) return [];

    return this.extractAssociations(norm, data[norm], constraint);
  }

  private extractAssociations(
    originalClue: string,
    rawList: Array<RawMobyAssoc | string>,
    constraint?: WordConstraint
  ): WordTransformation[] {
    const results: WordTransformation[] = [];
    const seenWords = new Set<string>([originalClue]);

    for (const item of rawList) {
      if (results.length >= this.maxAssociationsPerWord) break;
      const rawWord = typeof item === 'string' ? item : item.word;
      const target = this.normalizeClue(rawWord);
      if (!target || seenWords.has(target)) continue;

      if (evaluateWordConstraint(target, constraint).matches) {
        seenWords.add(target);
        const reason =
          typeof item === 'object' && item.reason
            ? item.reason
            : `Moby Thesaurus II association of ${originalClue}`;
        const score = typeof item === 'object' && item.score !== undefined ? item.score : 0.82;

        results.push({
          originalClue,
          word: target,
          relationType: 'thesaurus',
          score: Math.min(score, 0.82), // Bounded at 0.82 so direct relations take precedence
          reason,
          source: 'Moby Thesaurus II',
        });
      }
    }

    return results;
  }

  public getCacheStats(): { loadedPartitions: string[]; cacheSizeBytes: number } {
    return {
      loadedPartitions: this.loader.getLoadedPartitions(),
      cacheSizeBytes: this.loader.getCacheSizeBytes(),
    };
  }
}
