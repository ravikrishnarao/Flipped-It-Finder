/**
 * Flipit Finder - Lexical Phrase Provider (Moby Public Domain Collocations)
 * Implements PhraseProvider interface using verified open English idioms,
 * compound words, and high-frequency bigrams.
 */

import mobyData from '../../data/moby_phrases.json' with { type: 'json' };
import { Morphology } from './morphology.ts';
import type { PhraseProvider, PhraseRecord } from './types.ts';

export class LexicalPhraseProvider implements PhraseProvider {
  private exactMap: Map<string, PhraseRecord> = new Map();
  private compoundMap: Map<string, PhraseRecord> = new Map();
  private word1Index: Map<string, PhraseRecord[]> = new Map();
  private word2Index: Map<string, PhraseRecord[]> = new Map();

  constructor(customPhrases?: PhraseRecord[]) {
    const list: PhraseRecord[] = customPhrases || (mobyData.phrases as PhraseRecord[]);
    for (const item of list) {
      this.addPhrase(item);
    }
  }

  private cleanToken(token: string): string {
    if (!token) return '';
    return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  public addPhrase(item: PhraseRecord): void {
    const w1 = this.cleanToken(item.word1);
    const w2 = this.cleanToken(item.word2);
    if (!w1 || !w2) return;

    const normalizedKey = `${w1} ${w2}`;

    const record: PhraseRecord = {
      ...item,
      phrase: item.phrase.trim().toUpperCase(),
      word1: w1,
      word2: w2,
      alternateForms: item.alternateForms?.map((f) => f.trim().toUpperCase()) || [],
    };

    this.exactMap.set(normalizedKey, record);

    const compoundKey = `${w1}${w2}`;
    this.compoundMap.set(compoundKey, record);

    if (record.alternateForms) {
      for (const alt of record.alternateForms) {
        const cleanAlt = this.cleanToken(alt);
        if (cleanAlt) {
          this.compoundMap.set(cleanAlt, record);
        }
      }
    }

    if (!this.word1Index.has(w1)) this.word1Index.set(w1, []);
    this.word1Index.get(w1)!.push(record);

    if (!this.word2Index.has(w2)) this.word2Index.set(w2, []);
    this.word2Index.get(w2)!.push(record);
  }

  public matchPhrase(word1: string, word2: string, allowCompound = true): PhraseRecord | null {
    const w1 = this.cleanToken(word1);
    const w2 = this.cleanToken(word2);
    if (!w1 || !w2) return null;

    const directKey = `${w1} ${w2}`;
    if (this.exactMap.has(directKey)) {
      return this.exactMap.get(directKey)!;
    }

    if (allowCompound) {
      const compoundKey = `${w1}${w2}`;
      if (this.compoundMap.has(compoundKey)) {
        return this.compoundMap.get(compoundKey)!;
      }
    }

    // 3. Morphological lemma-aware matching (e.g. WORK <-> WORKS, FIRE WORK <-> FIRE WORKS)
    const lemmas1 = Morphology.getCandidateLemmas(w1);
    const lemmas2 = Morphology.getCandidateLemmas(w2);

    for (const l1 of lemmas1) {
      for (const l2 of lemmas2) {
        if (l1 === w1 && l2 === w2) continue;

        const lemDirectKey = `${l1} ${l2}`;
        if (this.exactMap.has(lemDirectKey)) {
          return this.exactMap.get(lemDirectKey)!;
        }

        if (allowCompound) {
          const lemCompoundKey = `${l1}${l2}`;
          if (this.compoundMap.has(lemCompoundKey)) {
            return this.compoundMap.get(lemCompoundKey)!;
          }
        }
      }
    }

    return null;
  }

  public isRecognizedPhrase(word1: string, word2: string): boolean {
    return this.matchPhrase(word1, word2) !== null;
  }

  public findPhrasesForWord1(word1: string): PhraseRecord[] {
    const w1 = this.cleanToken(word1);
    return this.word1Index.get(w1) || [];
  }

  public findPhrasesForWord2(word2: string): PhraseRecord[] {
    const w2 = this.cleanToken(word2);
    return this.word2Index.get(w2) || [];
  }

  public getPhraseCount(): number {
    return this.exactMap.size;
  }
}
