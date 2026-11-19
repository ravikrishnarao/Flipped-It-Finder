/**
 * Flipit Finder - Morphological Analyzer & Lemmatizer
 * Uses WordNet morphological exception tables combined with conservative rule-based stemming.
 * Explicitly guards against over-stemming invariant English words.
 */

/**
 * WordNet 3.0 Morphological Exception Tables (noun.exc, verb.exc, adj.exc)
 */
export const WORDNET_EXCEPTIONS: Record<string, string> = {
  // Irregular noun plurals
  CHILDREN: 'CHILD',
  FEET: 'FOOT',
  TEETH: 'TOOTH',
  GEESE: 'GOOSE',
  MICE: 'MOUSE',
  LICE: 'LOUSE',
  OXEN: 'OX',
  MEN: 'MAN',
  WOMEN: 'WOMAN',
  PEOPLE: 'PERSON',
  CACTI: 'CACTUS',
  FOCI: 'FOCUS',
  FUNGI: 'FUNGUS',
  NUCLEI: 'NUCLEUS',
  SYLLABI: 'SYLLABUS',
  ANALYSES: 'ANALYSIS',
  BASES: 'BASIS',
  CRISES: 'CRISIS',
  DIAGNOSES: 'DIAGNOSIS',
  OASES: 'OASIS',
  THESES: 'THESIS',
  CRITERIA: 'CRITERION',
  PHENOMENA: 'PHENOMENON',
  CURRICULA: 'CURRICULUM',
  DATA: 'DATUM',
  MEDIA: 'MEDIUM',

  // Irregular verb past / participles
  WENT: 'GO',
  GONE: 'GO',
  RAN: 'RUN',
  RUNNING: 'RUN',
  BEGAN: 'BEGIN',
  BEGUN: 'BEGIN',
  BROKE: 'BREAK',
  BROKEN: 'BREAK',
  BROUGHT: 'BRING',
  BOUGHT: 'BUY',
  CAUGHT: 'CATCH',
  CHOSE: 'CHOOSE',
  CHOSEN: 'CHOOSE',
  CAME: 'COME',
  DREW: 'DRAW',
  DRAWN: 'DRAW',
  DRANK: 'DRINK',
  DRUNK: 'DRINK',
  DROVE: 'DRIVE',
  DRIVEN: 'DRIVE',
  ATE: 'EAT',
  EATEN: 'EAT',
  FELL: 'FALL',
  FALLEN: 'FALL',
  FLEW: 'FLY',
  FLOWN: 'FLY',
  FORGAVE: 'FORGIVE',
  FORGIVEN: 'FORGIVE',
  FROZE: 'FREEZE',
  FROZEN: 'FREEZE',
  GAVE: 'GIVE',
  GIVEN: 'GIVE',
  GREW: 'GROW',
  GROWN: 'GROW',
  HUNG: 'HANG',
  HID: 'HIDE',
  HIDDEN: 'HIDE',
  HELD: 'HOLD',
  KNEW: 'KNOW',
  KNOWN: 'KNOW',
  LAID: 'LAY',
  LED: 'LEAD',
  LEFT: 'LEAVE',
  MADE: 'MAKE',
  MET: 'MEET',
  PAID: 'PAY',
  RODE: 'RIDE',
  RIDDEN: 'RIDE',
  RANG: 'RING',
  RUNG: 'RING',
  ROSE: 'RISE',
  RISEN: 'RISE',
  SAID: 'SAY',
  SAW: 'SEE',
  SEEN: 'SEE',
  SOLD: 'SELL',
  SENT: 'SEND',
  SHANK: 'SHAKE',
  SHAKEN: 'SHAKE',
  SHOT: 'SHOOT',
  SANG: 'SING',
  SUNG: 'SING',
  SANK: 'SINK',
  SUNK: 'SINK',
  SAT: 'SIT',
  SLEPT: 'SLEEP',
  SPOKE: 'SPEAK',
  SPOKEN: 'SPEAK',
  SPENT: 'SPEND',
  STOOD: 'STAND',
  STOLE: 'STEAL',
  STOLEN: 'STEAL',
  SWAM: 'SWIM',
  SWUM: 'SWIM',
  TOOK: 'TAKE',
  TAKEN: 'TAKE',
  TAUGHT: 'TEACH',
  TORE: 'TEAR',
  TORN: 'TEAR',
  TOLD: 'TELL',
  THOUGHT: 'THINK',
  THREW: 'THROW',
  THROWN: 'THROW',
  WORE: 'WEAR',
  WORN: 'WEAR',
  WON: 'WIN',
  WROTE: 'WRITE',
  WRITTEN: 'WRITE',

  // Irregular adjectives degrees
  BETTER: 'GOOD',
  BEST: 'GOOD',
  WORSE: 'BAD',
  WORST: 'BAD',
  FARTHER: 'FAR',
  FARTHEST: 'FAR',
  FURTHER: 'FAR',
  FURTHEST: 'FAR',
  LESS: 'LITTLE',
  LEAST: 'LITTLE',
  MORE: 'MUCH',
  MOST: 'MUCH',
};

/**
 * Invariant words that end in common inflection suffixes (-s, -ing, -ed) but MUST NOT be stripped.
 */
export const DO_NOT_STEM: Set<string> = new Set([
  'NEWS',
  'SERIES',
  'SPECIES',
  'MATE',
  'CLASS',
  'RING',
  'WING',
  'KING',
  'SING',
  'THING',
  'SPRING',
  'STRING',
  'BRING',
  'SWING',
  'CLING',
  'STING',
  'FLING',
  'SLING',
  'WRING',
  'BED',
  'RED',
  'FEED',
  'SEED',
  'NEED',
  'WEED',
  'DEED',
  'BLEED',
  'BREED',
  'SPEED',
  'SLED',
  'SHED',
  'BLED',
  'BRASS',
  'GRASS',
  'GLASS',
  'CHESS',
  'PRESS',
  'DRESS',
  'STRESS',
  'BLESS',
  'MESS',
  'LESS',
  'BOSS',
  'LOSS',
  'CROSS',
  'MOSS',
  'TOSS',
  'BASS',
  'MASS',
  'PASS',
  'GAS',
  'YES',
  'BUS',
  'PLUS',
]);

export class Morphology {
  /**
   * Check if a word is an invariant term that must never be stripped.
   */
  public static isInvariant(word: string): boolean {
    const clean = word.trim().toUpperCase();
    return DO_NOT_STEM.has(clean);
  }

  /**
   * Return candidate base lemmas for a word, strictly preventing over-stemming.
   */
  public static getCandidateLemmas(word: string): string[] {
    const clean = word.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (!clean || clean.length < 3) return [clean];

    // If invariant, return only the original word
    if (this.isInvariant(clean)) {
      return [clean];
    }

    const candidates = new Set<string>();
    candidates.add(clean);

    // 1. WordNet exception lookup (highest precision)
    if (WORDNET_EXCEPTIONS[clean]) {
      candidates.add(WORDNET_EXCEPTIONS[clean]);
      return Array.from(candidates);
    }

    // 2. Regular adjective comparison (-EST, -ER)
    if (clean.endsWith('EST') && clean.length > 5) {
      if (clean.endsWith('IEST')) candidates.add(clean.slice(0, -4) + 'Y');
      else candidates.add(clean.slice(0, -3));
    }
    if (clean.endsWith('ER') && clean.length > 4) {
      if (clean.endsWith('IER')) candidates.add(clean.slice(0, -3) + 'Y');
      else candidates.add(clean.slice(0, -2));
    }

    // 3. Regular gerund / participle (-ING)
    if (clean.endsWith('ING') && clean.length > 5) {
      const stem = clean.slice(0, -3);
      candidates.add(stem);
      candidates.add(stem + 'E');
      // Doubled consonant: RUNNING -> RUN, SWIMMING -> SWIM, STOPPING -> STOP
      if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
        candidates.add(stem.slice(0, -1));
      }
    }

    // 4. Regular past tense (-ED)
    if (clean.endsWith('ED') && clean.length > 4) {
      if (clean.endsWith('IED')) {
        candidates.add(clean.slice(0, -3) + 'Y');
      } else {
        candidates.add(clean.slice(0, -2));
        candidates.add(clean.slice(0, -1)); // e.g. CLOSED -> CLOSE
      }
    }

    // 5. Regular plurals (-S, -ES, -IES, -VES)
    if (clean.endsWith('VES') && clean.length > 4) {
      candidates.add(clean.slice(0, -3) + 'F');
      candidates.add(clean.slice(0, -3) + 'FE');
    } else if (clean.endsWith('IES') && clean.length > 4) {
      candidates.add(clean.slice(0, -3) + 'Y');
    } else if (clean.endsWith('ES') && clean.length > 4) {
      // e.g. BOXES -> BOX, WATCHES -> WATCH
      if (
        clean.endsWith('SHES') ||
        clean.endsWith('CHES') ||
        clean.endsWith('XES') ||
        clean.endsWith('SSES') ||
        clean.endsWith('ZZES')
      ) {
        candidates.add(clean.slice(0, -2));
      } else {
        candidates.add(clean.slice(0, -1));
      }
    } else if (clean.endsWith('S') && !clean.endsWith('SS') && clean.length > 3) {
      candidates.add(clean.slice(0, -1));
    }

    return Array.from(candidates);
  }

  /**
   * Generate standard English morphological inflections for a word lemma:
   * - regular plural / 3rd-person singular (-S, -ES, -IES)
   * - present participle / gerund (-ING)
   * - past tense / participle (-ED)
   */
  public static getInflections(lemma: string): string[] {
    const clean = lemma.trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (!clean || clean.length < 2) return [];

    const inflections = new Set<string>();

    // 1. Regular plural / 3rd-person singular
    if (clean.endsWith('Y') && clean.length > 2 && !/[AEIOU]Y$/.test(clean)) {
      inflections.add(clean.slice(0, -1) + 'IES');
    } else if (
      clean.endsWith('S') ||
      clean.endsWith('SH') ||
      clean.endsWith('CH') ||
      clean.endsWith('X') ||
      clean.endsWith('Z')
    ) {
      inflections.add(clean + 'ES');
    } else {
      inflections.add(clean + 'S');
    }

    // 2. Gerund / present participle (-ING)
    if (clean.endsWith('E') && !clean.endsWith('EE') && clean.length > 2) {
      inflections.add(clean.slice(0, -1) + 'ING');
    } else {
      inflections.add(clean + 'ING');
    }

    // 3. Past tense / participle (-ED)
    if (clean.endsWith('E')) {
      inflections.add(clean + 'D');
    } else if (clean.endsWith('Y') && clean.length > 2 && !/[AEIOU]Y$/.test(clean)) {
      inflections.add(clean.slice(0, -1) + 'IED');
    } else {
      inflections.add(clean + 'ED');
    }

    return Array.from(inflections);
  }
}
