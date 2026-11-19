/**
 * Flipit Finder V3 — Curated Phrase Provider
 * Serves verified core benchmark phrases and curated idioms from in-memory repositories.
 * Matches open, closed, and hyphenated expressions with clear heuristic labeling.
 */

import mobyPhrasesData from '../../../data/moby_phrases.json' with { type: 'json' };
import phrasesData from '../../../data/phrases.json' with { type: 'json' };
import type { PhraseRecord } from '../types.ts';
import type {
  AsyncPhraseProvider,
  PhraseMatchType,
  V3PhraseLookupDiagnostics,
  V3PhraseMatch,
} from './phraseTypes.ts';

export class CuratedPhraseProvider implements AsyncPhraseProvider {
  public readonly providerName = 'CuratedPhraseProvider';

  private exactPhraseMap = new Map<string, PhraseRecord>();
  private closedCompoundMap = new Map<string, PhraseRecord>();
  private hyphenatedMap = new Map<string, PhraseRecord>();

  constructor(customPhrases?: PhraseRecord[]) {
    this.loadCatalog(customPhrases);
  }

  private normalizeToken(token: string): string {
    if (!token) return '';
    return token.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private loadCatalog(customPhrases?: PhraseRecord[]): void {
    const list: PhraseRecord[] = [];

    if (customPhrases) {
      list.push(...customPhrases);
    } else {
      const rawPhrases = (phrasesData as any).phrases || phrasesData;
      if (Array.isArray(rawPhrases)) list.push(...rawPhrases);

      const rawMoby = (mobyPhrasesData as any).phrases || mobyPhrasesData;
      if (Array.isArray(rawMoby)) list.push(...rawMoby);
    }

    for (const record of list) {
      const w1 = this.normalizeToken(record.word1);
      const w2 = this.normalizeToken(record.word2);
      if (!w1 || !w2) continue;

      const normalizedOpen = `${w1} ${w2}`;
      this.exactPhraseMap.set(normalizedOpen, record);

      const closed = `${w1}${w2}`;
      this.closedCompoundMap.set(closed, record);

      const hyphenated = `${w1}-${w2}`;
      this.hyphenatedMap.set(hyphenated, record);

      if (record.alternateForms && Array.isArray(record.alternateForms)) {
        for (const alt of record.alternateForms) {
          const cleanAlt = alt.trim().toUpperCase();
          if (cleanAlt.includes('-')) {
            this.hyphenatedMap.set(cleanAlt, record);
          } else {
            this.closedCompoundMap.set(cleanAlt.replace(/[^A-Z0-9]/g, ''), record);
          }
        }
      }
    }
  }

  public matchPhrase(
    word1: string,
    word2: string,
    allowCompound = true
  ): V3PhraseMatch | null {
    const w1 = this.normalizeToken(word1);
    const w2 = this.normalizeToken(word2);
    if (!w1 || !w2) return null;

    // 1. Open Phrase Match ("WORD1 WORD2")
    const openKey = `${w1} ${w2}`;
    const openRecord = this.exactPhraseMap.get(openKey);
    if (openRecord) {
      return this.toV3Match(openRecord, 'open', openKey);
    }

    if (allowCompound) {
      // 2. Closed Compound Match ("WORD1WORD2")
      const closedKey = `${w1}${w2}`;
      const closedRecord = this.closedCompoundMap.get(closedKey);
      if (closedRecord) {
        return this.toV3Match(closedRecord, 'closed', closedKey);
      }

      // 3. Hyphenated Match ("WORD1-WORD2")
      const hyphenKey = `${w1}-${w2}`;
      const hyphenRecord = this.hyphenatedMap.get(hyphenKey);
      if (hyphenRecord) {
        return this.toV3Match(hyphenRecord, 'hyphenated', hyphenKey);
      }
    }

    return null;
  }

  public async matchPhraseAsync(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<V3PhraseMatch | null> {
    return this.matchPhrase(word1, word2, allowCompound);
  }

  public isRecognizedPhrase(word1: string, word2: string): boolean {
    return this.matchPhrase(word1, word2) !== null;
  }

  public async isRecognizedPhraseAsync(word1: string, word2: string): Promise<boolean> {
    return this.isRecognizedPhrase(word1, word2);
  }

  public async lookupWithDiagnostics(
    word1: string,
    word2: string,
    allowCompound = true
  ): Promise<{ match: V3PhraseMatch | null; diagnostics: V3PhraseLookupDiagnostics }> {
    const startTime = performance.now();
    const match = this.matchPhrase(word1, word2, allowCompound);
    const endTime = performance.now();

    const diagnostics: V3PhraseLookupDiagnostics = {
      word1,
      word2,
      normalizedQuery: `${this.normalizeToken(word1)} ${this.normalizeToken(word2)}`,
      providerQueried: this.providerName,
      found: match !== null,
      matchType: match?.matchType,
      sourceProvenance: match?.sourceDataset,
      heuristicScore: match?.heuristicScore,
      empiricalFrequency: match?.empiricalFrequency ?? null,
      lookupLatencyMs: Math.round((endTime - startTime) * 100) / 100,
      loadingLatencyMs: 0.0,
      partitionUsed: 'in-memory',
      partitionLoadedFromDisk: false,
    };

    return { match, diagnostics };
  }

  private toV3Match(
    record: PhraseRecord,
    matchType: PhraseMatchType,
    form: string
  ): V3PhraseMatch {
    const norm = `${this.normalizeToken(record.word1)} ${this.normalizeToken(record.word2)}`;
    return {
      phrase: record.phrase || norm,
      word1: record.word1,
      word2: record.word2,
      frequencyScore: record.frequencyScore ?? 0.98,
      category: record.category || 'curated',
      alternateForms: record.alternateForms || [],
      normalizedPhrase: norm,
      originalPhraseForm: form,
      phraseCategory: record.category || 'curated',
      sourceDataset: 'Curated Phrase Repository',
      empiricalFrequency: null, // Empirical frequency not provided by curated static files
      heuristicScore: record.frequencyScore ?? 0.98,
      explanation: `Verified as ${matchType} expression in Curated Phrase Repository`,
      matchType,
    };
  }

  public getPhraseCount(): number {
    return this.exactPhraseMap.size;
  }
}
