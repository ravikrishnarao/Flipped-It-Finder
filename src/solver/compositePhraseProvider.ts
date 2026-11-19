/**
 * Flipit Finder - Composite Phrase Provider
 * Combines curated puzzle phrases with open Moby public-domain collocations
 * into a single unified phrase validator.
 */

import { LexicalPhraseProvider } from './lexicalPhraseProvider.ts';
import { PhraseMatcher } from './phraseMatcher.ts';
import type { PhraseProvider, PhraseRecord } from './types.ts';

export class CompositePhraseProvider implements PhraseProvider {
  private providers: PhraseProvider[];

  constructor(providers?: PhraseProvider[]) {
    this.providers = providers && providers.length > 0
      ? providers
      : [new PhraseMatcher(), new LexicalPhraseProvider()];
  }

  public addPhrase(phrase: PhraseRecord): void {
    for (const p of this.providers) {
      if (typeof p.addPhrase === 'function') {
        p.addPhrase(phrase);
        break;
      }
    }
  }

  public matchPhrase(word1: string, word2: string, allowCompound = true): PhraseRecord | null {
    let bestMatch: PhraseRecord | null = null;

    for (const provider of this.providers) {
      const match = provider.matchPhrase(word1, word2, allowCompound);
      if (match) {
        if (!bestMatch || match.frequencyScore > bestMatch.frequencyScore) {
          bestMatch = match;
        }
      }
    }

    return bestMatch;
  }

  public isRecognizedPhrase(word1: string, word2: string): boolean {
    return this.providers.some((p) => p.isRecognizedPhrase(word1, word2));
  }

  public findPhrasesForWord1(word1: string): PhraseRecord[] {
    const seen = new Set<string>();
    const results: PhraseRecord[] = [];

    for (const p of this.providers) {
      if (typeof p.findPhrasesForWord1 === 'function') {
        for (const item of p.findPhrasesForWord1(word1)) {
          const key = item.phrase.replace(/[^A-Z0-9]/g, '');
          if (!seen.has(key)) {
            seen.add(key);
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  public findPhrasesForWord2(word2: string): PhraseRecord[] {
    const seen = new Set<string>();
    const results: PhraseRecord[] = [];

    for (const p of this.providers) {
      if (typeof p.findPhrasesForWord2 === 'function') {
        for (const item of p.findPhrasesForWord2(word2)) {
          const key = item.phrase.replace(/[^A-Z0-9]/g, '');
          if (!seen.has(key)) {
            seen.add(key);
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  public getPhraseCount(): number {
    let total = 0;
    for (const p of this.providers) {
      if (typeof p.getPhraseCount === 'function') {
        total += p.getPhraseCount();
      }
    }
    return total;
  }
}
