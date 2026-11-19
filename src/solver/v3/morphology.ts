/**
 * Flipit Finder V3 — Offline Morphological Normalization Engine
 * Handles singular/plural noun inflections, verb conjugations (-ing, -ed, -s),
 * irregular English morphology from Princeton WordNet 3.0 exception lists,
 * and inflectional projection with complete diagnostic provenance.
 */

import exceptionsData from '../../../data/v3/compiled/wordnet/morphology_exceptions.json' with { type: 'json' };

export interface MorphologyResult {
  originalWord: string;
  isInflected: boolean;
  inflectionType?: 'plural-noun' | 'gerund-verb' | 'past-verb' | 'comparative' | 'superlative' | 'irregular';
  baseLemmas: string[];
  projectedForms: string[];
}

export class OfflineMorphologyEngine {
  private exceptions: Record<string, string[]>;
  private reverseExceptions: Map<string, string[]>;

  constructor(customExceptions?: Record<string, string[]>) {
    this.exceptions = customExceptions || (exceptionsData as any).exceptions || {};
    this.reverseExceptions = new Map<string, string[]>();
    for (const [inflected, bases] of Object.entries(this.exceptions)) {
      for (const b of bases) {
        if (!this.reverseExceptions.has(b)) {
          this.reverseExceptions.set(b, []);
        }
        const list = this.reverseExceptions.get(b)!;
        if (!list.includes(inflected)) {
          list.push(inflected);
        }
      }
    }
  }

  public normalizeToken(word: string): string {
    if (!word) return '';
    return word.trim().toUpperCase().replace(/[^A-Z]/g, '');
  }

  /**
   * Lemmatize an inflected word into potential base dictionary lemmas.
   * Does NOT blindly assume stripping a suffix creates a valid word;
   * returns candidate base lemmas ordered from most specific rule to general.
   */
  public lemmatize(word: string): MorphologyResult {
    const clean = this.normalizeToken(word);
    if (!clean || clean.length < 3) {
      return {
        originalWord: clean,
        isInflected: false,
        baseLemmas: [clean],
        projectedForms: [clean],
      };
    }

    const lemmas = new Set<string>();
    let inflectionType: MorphologyResult['inflectionType'];

    // 1. Irregular Exception List (Princeton WordNet .exc data)
    if (this.exceptions[clean] && this.exceptions[clean].length > 0) {
      for (const base of this.exceptions[clean]) {
        lemmas.add(base);
      }
      inflectionType = 'irregular';
    }

    // 2. Noun Plural Rules
    if (clean.endsWith('IES') && clean.length > 4) {
      lemmas.add(clean.slice(0, -3) + 'Y');
      inflectionType = inflectionType || 'plural-noun';
    } else if (clean.endsWith('VES') && clean.length > 4) {
      lemmas.add(clean.slice(0, -3) + 'F');
      lemmas.add(clean.slice(0, -3) + 'FE');
      inflectionType = inflectionType || 'plural-noun';
    } else if (
      (clean.endsWith('SES') || clean.endsWith('XES') || clean.endsWith('ZES') || clean.endsWith('CHES') || clean.endsWith('SHES')) &&
      clean.length > 4
    ) {
      lemmas.add(clean.slice(0, -2));
      inflectionType = inflectionType || 'plural-noun';
    } else if (clean.endsWith('S') && !clean.endsWith('SS') && !clean.endsWith('US') && !clean.endsWith('IS') && clean.length > 3) {
      const stripped = clean.slice(0, -1);
      lemmas.add(stripped);
      if (clean === 'CLOTHES') {
        lemmas.add('CLOTHING');
        lemmas.add('CLOTH');
      }
      inflectionType = inflectionType || 'plural-noun';
    }

    // 3. Verb Gerund / Participle (-ING) Rules
    if (clean.endsWith('ING') && clean.length > 4) {
      const stem = clean.slice(0, -3);
      lemmas.add(stem + 'E');
      lemmas.add(stem);
      if (stem.length >= 3) {
        const lastChar = stem.charAt(stem.length - 1);
        const secondLast = stem.charAt(stem.length - 2);
        if (lastChar === secondLast) {
          lemmas.add(stem.slice(0, -1));
        }
      }
      inflectionType = inflectionType || 'gerund-verb';
    }

    // 4. Past Tense / Participle (-ED) Rules
    if (clean.endsWith('ED') && clean.length > 4) {
      if (clean.endsWith('IED')) {
        lemmas.add(clean.slice(0, -3) + 'Y');
      } else {
        const stem = clean.slice(0, -2);
        lemmas.add(stem + 'E');
        lemmas.add(stem);
        if (stem.length >= 3) {
          const lastChar = stem.charAt(stem.length - 1);
          const secondLast = stem.charAt(stem.length - 2);
          if (lastChar === secondLast) {
            lemmas.add(stem.slice(0, -1));
          }
        }
      }
      inflectionType = inflectionType || 'past-verb';
    }

    // 5. Comparative (-ER) / Superlative (-EST) Adjective Rules
    if (clean.endsWith('IER') && clean.length > 4) {
      lemmas.add(clean.slice(0, -3) + 'Y');
      inflectionType = 'comparative';
    } else if (clean.endsWith('IEST') && clean.length > 5) {
      lemmas.add(clean.slice(0, -4) + 'Y');
      inflectionType = 'superlative';
    } else if (clean.endsWith('ER') && clean.length > 4 && (this.exceptions[clean]?.length ?? 0) > 0) {
      inflectionType = 'comparative';
    } else if (clean.endsWith('EST') && clean.length > 4 && (this.exceptions[clean]?.length ?? 0) > 0) {
      inflectionType = 'superlative';
    }

    // 6. Always retain the original un-inflected form
    const baseLemmas = Array.from(lemmas).filter(Boolean);
    if (!baseLemmas.includes(clean)) {
      baseLemmas.push(clean);
    }

    const isInflected = Boolean(inflectionType);
    const projectedForms = this.generateInflections(clean, baseLemmas);

    return {
      originalWord: clean,
      isInflected,
      inflectionType,
      baseLemmas,
      projectedForms,
    };
  }

  /**
   * Project targeted inflections onto a candidate target word matching a source clue's inflection type.
   */
  public projectForInflection(
    targetBaseWord: string,
    inflectionType?: MorphologyResult['inflectionType']
  ): string[] {
    const clean = this.normalizeToken(targetBaseWord);
    if (!clean || clean.length < 2 || !inflectionType) return [];

    const out = new Set<string>();

    // Check reverse irregular forms first
    const irregulars = this.reverseExceptions.get(clean);

    if (inflectionType === 'plural-noun') {
      if (irregulars) {
        for (const irr of irregulars) {
          if (irr.endsWith('S') || irr === 'MEN' || irr === 'WOMEN' || irr === 'CHILDREN' || irr === 'FEET' || irr === 'MICE' || irr === 'TEETH') {
            out.add(irr);
          }
        }
      }
      if (!clean.endsWith('ING') && !clean.endsWith('NESS') && !clean.endsWith('ITY')) {
        if (clean.endsWith('Y') && !/[AEIOU]Y$/.test(clean) && clean.length > 2) {
          out.add(clean.slice(0, -1) + 'IES');
        } else if (
          clean.endsWith('S') ||
          clean.endsWith('X') ||
          clean.endsWith('Z') ||
          clean.endsWith('CH') ||
          clean.endsWith('SH')
        ) {
          if (!clean.endsWith('S')) {
            out.add(clean + 'ES');
          }
        } else {
          out.add(clean + 'S');
        }
      }
    } else if (inflectionType === 'gerund-verb') {
      const skipIng =
        clean.endsWith('ING') ||
        clean.endsWith('TION') ||
        clean.endsWith('SION') ||
        clean.endsWith('MENT') ||
        clean.endsWith('NESS') ||
        clean.endsWith('ITY') ||
        clean.endsWith('URE') ||
        clean.endsWith('ED');
      if (!skipIng) {
        if (clean.endsWith('IE')) {
          out.add(clean.slice(0, -2) + 'YING');
        } else if (clean.endsWith('E') && clean.length > 2 && !clean.endsWith('EE')) {
          out.add(clean.slice(0, -1) + 'ING');
        } else {
          out.add(clean + 'ING');
        }
      }
    } else if (inflectionType === 'past-verb') {
      if (irregulars) {
        for (const irr of irregulars) out.add(irr);
      }
      const skipEd =
        clean.endsWith('ED') ||
        clean.endsWith('ING') ||
        clean.endsWith('TION') ||
        clean.endsWith('NESS');
      if (!skipEd) {
        if (clean.endsWith('E')) {
          out.add(clean + 'D');
        } else if (clean.endsWith('Y') && !/[AEIOU]Y$/.test(clean)) {
          out.add(clean.slice(0, -1) + 'IED');
        } else {
          out.add(clean + 'ED');
        }
      }
    } else if (inflectionType === 'irregular') {
      if (irregulars) {
        for (const irr of irregulars) out.add(irr);
      }
    }

    out.delete(clean);
    return Array.from(out);
  }

  /**
   * Generate common inflectional projections from a base word.
   */
  public generateInflections(word: string, knownLemmas?: string[]): string[] {
    const clean = this.normalizeToken(word);
    const projected = new Set<string>([clean]);
    const seeds = knownLemmas ? [clean, ...knownLemmas] : [clean];

    for (const seed of seeds) {
      if (!seed || seed.length < 2) continue;

      const irregulars = this.reverseExceptions.get(seed);
      if (irregulars) {
        for (const irr of irregulars) projected.add(irr);
      }

      if (seed.endsWith('Y') && !/[AEIOU]Y$/.test(seed) && seed.length > 2) {
        projected.add(seed.slice(0, -1) + 'IES');
      } else if (
        seed.endsWith('S') ||
        seed.endsWith('X') ||
        seed.endsWith('Z') ||
        seed.endsWith('CH') ||
        seed.endsWith('SH')
      ) {
        projected.add(seed + 'ES');
      } else {
        projected.add(seed + 'S');
      }

      if (seed.endsWith('IE')) {
        projected.add(seed.slice(0, -2) + 'YING');
      } else if (seed.endsWith('E') && seed.length > 2 && !seed.endsWith('EE')) {
        projected.add(seed.slice(0, -1) + 'ING');
      } else {
        projected.add(seed + 'ING');
      }

      if (seed.endsWith('E')) {
        projected.add(seed + 'D');
      } else if (seed.endsWith('Y') && !/[AEIOU]Y$/.test(seed)) {
        projected.add(seed.slice(0, -1) + 'IED');
      } else {
        projected.add(seed + 'ED');
      }
    }

    return Array.from(projected);
  }
}

export const defaultMorphologyEngine = new OfflineMorphologyEngine();
