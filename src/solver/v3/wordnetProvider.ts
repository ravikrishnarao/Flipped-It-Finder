/**
 * Flipit Finder V3 — Princeton WordNet Relationship Provider
 * Loads partitioned WordNet 3.0 letter files asynchronously on demand.
 * Extracts direct synonyms, direct antonyms, hierarchical hypernyms/hyponyms,
 * and derivational morphology with complete provenance.
 */

import { evaluateWordConstraint } from '../solver.ts';
import { PartitionLoader } from './partitionLoader.ts';
import type {
  AsyncRelationshipProvider,
  PartitionLoadStats,
  WordConstraint,
  WordTransformation,
} from './types.ts';

interface RawWordNetRelation {
  word: string;
  score: number;
  reason: string;
  relationType: string;
  source?: string;
  depth?: number;
}

interface RawWordNetEntry {
  synonyms?: RawWordNetRelation[];
  antonyms?: RawWordNetRelation[];
  coordinates?: RawWordNetRelation[];
  hierarchical?: RawWordNetRelation[];
  derivations?: RawWordNetRelation[];
}

export type WordNetPartition = Record<string, RawWordNetEntry>;

export class WordNetRelationshipProvider implements AsyncRelationshipProvider {
  public readonly providerName = 'WordNetRelationshipProvider';
  private loader: PartitionLoader;
  private basePath: string;

  constructor(loader?: PartitionLoader, basePath = 'data/v3/compiled/wordnet') {
    this.loader = loader || new PartitionLoader();
    this.basePath = basePath;
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
    return Boolean(data && data[norm]);
  }

  public async hasClueAsync(clue: string): Promise<boolean> {
    const norm = this.normalizeClue(clue);
    if (!norm) return false;
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = await this.loader.loadPartition<WordNetPartition>(relPath);
    return Boolean(data && data[norm]);
  }

  public getTransformations(clue: string, constraint?: WordConstraint): WordTransformation[] {
    const norm = this.normalizeClue(clue);
    if (!norm) return [];
    const letter = norm.charAt(0);
    const relPath = this.getPartitionRelativePath(letter);
    const { data } = this.loader.loadPartitionSync<WordNetPartition>(relPath);
    if (!data || !data[norm]) return [];

    return this.extractWordNetTransformations(norm, data[norm], constraint);
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
    if (!data || !data[norm]) return [];

    return this.extractWordNetTransformations(norm, data[norm], constraint);
  }

  private extractWordNetTransformations(
    originalClue: string,
    entry: RawWordNetEntry,
    constraint?: WordConstraint
  ): WordTransformation[] {
    const results: WordTransformation[] = [];
    const seenWords = new Set<string>([originalClue]);

    // 1. Direct Antonyms (Score 0.99, highest priority)
    if (entry.antonyms && Array.isArray(entry.antonyms)) {
      for (const a of entry.antonyms) {
        const target = this.normalizeClue(a.word);
        if (!target || seenWords.has(target)) continue;
        if (evaluateWordConstraint(target, constraint).matches) {
          seenWords.add(target);
          results.push({
            originalClue,
            word: target,
            relationType: 'antonym',
            score: a.score ?? 0.99,
            reason: a.reason || `WordNet direct antonym of ${originalClue}`,
            source: 'Princeton WordNet 3.0',
          });
        }
      }
    }

    // 2. Direct Synonyms (Score 0.95)
    if (entry.synonyms && Array.isArray(entry.synonyms)) {
      for (const s of entry.synonyms) {
        const target = this.normalizeClue(s.word);
        if (!target || seenWords.has(target)) continue;
        if (evaluateWordConstraint(target, constraint).matches) {
          seenWords.add(target);
          results.push({
            originalClue,
            word: target,
            relationType: 'synonym',
            score: s.score ?? 0.95,
            reason: s.reason || `WordNet synset synonym of ${originalClue}`,
            source: 'Princeton WordNet 3.0',
          });
        }
      }
    }

    // 3. Derivations & Functional Coordinate-Derivations
    if (entry.derivations && Array.isArray(entry.derivations)) {
      for (const d of entry.derivations) {
        const target = this.normalizeClue(d.word);
        if (!target || seenWords.has(target)) continue;
        if (evaluateWordConstraint(target, constraint).matches) {
          seenWords.add(target);
          const relType = d.relationType === 'associated' ? 'associated' : 'derivation';
          results.push({
            originalClue,
            word: target,
            relationType: relType,
            score: d.score ?? (relType === 'associated' ? 0.82 : 0.88),
            reason: d.reason || `WordNet derivationally related form (${originalClue} ↔ ${target})`,
            source: 'Princeton WordNet 3.0',
          });
        }
      }
    }

    // 4. Direct Hierarchical (Hypernyms / Hyponyms) (Score 0.86)
    if (entry.hierarchical && Array.isArray(entry.hierarchical)) {
      for (const h of entry.hierarchical) {
        const target = this.normalizeClue(h.word);
        if (!target || seenWords.has(target)) continue;
        if (evaluateWordConstraint(target, constraint).matches) {
          seenWords.add(target);
          results.push({
            originalClue,
            word: target,
            relationType: 'hypernym',
            score: h.score ?? 0.86,
            reason: h.reason || `WordNet direct hypernym of ${originalClue}`,
            source: 'Princeton WordNet 3.0',
            depth: h.depth,
          });
        }
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
