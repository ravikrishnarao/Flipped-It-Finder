/**
 * Flipit Finder V3 — WordNet Coordinate Relationship Provider
 * Queries bounded sister-synset coordinates (sharing specific hypernyms at depth >= 4).
 * Enforces strict ranking discipline to ensure coordinate terms complement
 * but never overwhelm direct antonyms or synonyms.
 */

import { evaluateWordConstraint } from '../solver.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncRelationshipProvider,
  PartitionLoadStats,
  WordConstraint,
  WordTransformation,
} from './types.ts';
import type { WordNetPartition } from './wordnetProvider.ts';

export class CoordinateRelationshipProvider implements AsyncRelationshipProvider {
  public readonly providerName = 'CoordinateRelationshipProvider';
  private loader: PartitionLoader;
  private basePath: string;
  private maxCoordinatesPerWord: number;

  constructor(
    loader?: PartitionLoader,
    basePath = 'data/v3/compiled/wordnet',
    maxCoordinatesPerWord = 12
  ) {
    this.loader = loader || new PartitionLoader();
    this.basePath = basePath;
    this.maxCoordinatesPerWord = maxCoordinatesPerWord;
  }

  public normalizeClue(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  }

  public getPartitionRelativePath(letter: string): string {
    return `${this.basePath}/wn_${letter.toLowerCase()}.json`;
  }

  public async preloadPartition(letter: string): Promise<PartitionLoadStats> {
    const relPath = this.getPartitionRelativePath(letter);
    const { stats } = await this.loader.loadPartition<WordNetPartition>(relPath);
    return stats;
  }

  public hasClue(clue: string): boolean {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<WordNetPartition>(relPath);
    return Boolean(data && data[norm]?.coordinates && data[norm].coordinates!.length > 0);
  }

  public async hasClueAsync(clue: string): Promise<boolean> {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<WordNetPartition>(relPath);
    return Boolean(data && data[norm]?.coordinates && data[norm].coordinates!.length > 0);
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<WordNetPartition>(relPath);
    if (!data || !data[norm] || !data[norm].coordinates) return [];

    return this.extractCoordinates(norm, data[norm].coordinates!, constraint);
  }

  public async getTransformationsAsync(
    clue: string,
    constraint?: WordConstraint
  ): Promise<WordTransformation[]> {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<WordNetPartition>(relPath);
    if (!data || !data[norm] || !data[norm].coordinates) return [];

    return this.extractCoordinates(norm, data[norm].coordinates!, constraint);
  }

  private extractCoordinates(
    originalClue: string,
    rawCoordinates: Array<{ word: string; score: number; reason: string; depth?: number }>,
    constraint?: WordConstraint
  ): WordTransformation[] {
    const results: WordTransformation[] = [];
    const seenWords = new Set<string>([originalClue]);

    for (const c of rawCoordinates) {
      if (results.length >= this.maxCoordinatesPerWord) break;
      const target = this.normalizeClue(c.word);
      if (!target || seenWords.has(target)) continue;

      if (evaluateWordConstraint(target, constraint).matches) {
        seenWords.add(target);

        // Parse hierarchy depth from reason if present (e.g. "at depth 8")
        let depth = c.depth;
        if (!depth && c.reason) {
          const depthMatch = c.reason.match(/depth\s+(\d+)/i);
          if (depthMatch) {
            depth = parseInt(depthMatch[1], 10);
          }
        }

        results.push({
          originalClue,
          word: target,
          relationType: 'coordinate',
          score: Math.min(c.score ?? 0.85, 0.88), // Bounded below direct synonyms (0.95) and antonyms (0.99)
          reason: c.reason || `WordNet coordinate term (shares specific parent synset with ${originalClue})`,
          source: 'Princeton WordNet 3.0',
          depth,
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
