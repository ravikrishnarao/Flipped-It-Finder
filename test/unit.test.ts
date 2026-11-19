/**
 * Flipit Finder - Unit Test Suite (V2)
 * Validates individual modules: RelationshipEngine, PhraseMatcher, AnswerRanker, and FlipitSolver.
 */

import { AnswerRanker } from '../src/solver/ranker.ts';
import { PhraseMatcher } from '../src/solver/phraseMatcher.ts';
import { RelationshipEngine } from '../src/solver/relationshipEngine.ts';
import { FlipitSolver } from '../src/solver/solver.ts';
import { Morphology } from '../src/solver/morphology.ts';
import { LexicalRelationshipProvider, RELATION_PRIORITY } from '../src/solver/lexicalRelationshipProvider.ts';

export interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
}

export function runUnitTests(): TestResult[] {
  const results: TestResult[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ suite: 'Unit Tests', name, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Unit Tests', name, passed: false, error: msg });
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  function assertEqual<T>(actual: T, expected: T, msg: string) {
    if (actual !== expected) {
      throw new Error(`${msg} (Expected: ${String(expected)}, Got: ${String(actual)})`);
    }
  }

  // =========================================================================
  // 1. RelationshipEngine Tests
  // =========================================================================
  test('RelationshipEngine: retrieves antonyms correctly', () => {
    const engine = new RelationshipEngine();
    const transforms = engine.getTransformations('SLOW');
    const fast = transforms.find((t) => t.word === 'FAST');
    assert(!!fast, 'Should find FAST as transformation for SLOW');
    assertEqual(fast?.relationType, 'antonym', 'Relation type should be antonym');
    assert((fast?.score || 0) > 0.9, 'Confidence should be high for FAST');
  });

  test('RelationshipEngine: retrieves synonyms correctly', () => {
    const engine = new RelationshipEngine();
    const transforms = engine.getTransformations('MEAL');
    const food = transforms.find((t) => t.word === 'FOOD');
    assert(!!food, 'Should find FOOD as transformation for MEAL');
    assertEqual(food?.relationType, 'synonym', 'Relation type should be synonym');
  });

  test('RelationshipEngine: retrieves counterparts correctly', () => {
    const engine = new RelationshipEngine();
    const transforms = engine.getTransformations('MOON');
    const sun = transforms.find((t) => t.word === 'SUN');
    assert(!!sun, 'Should find SUN as counterpart of MOON');
    assertEqual(sun?.relationType, 'counterpart', 'Relation type should be counterpart');
  });

  test('RelationshipEngine: deduplicates relationships and retains the strongest score', () => {
    const engine = new RelationshipEngine();
    // Add multiple relations for the same target word with different scores and types
    engine.addWordRelations('TESTWORD', {
      synonyms: [{ word: 'TARGET', score: 0.7, reason: 'Weak synonym' }],
      antonyms: [{ word: 'TARGET', score: 0.95, reason: 'Strong antonym' }],
      contextual: [{ word: 'TARGET', score: 0.8, reason: 'Moderate contextual' }],
    });
    const transforms = engine.getTransformations('TESTWORD');
    const targetMatches = transforms.filter((t) => t.word === 'TARGET');
    assertEqual(targetMatches.length, 1, 'Target word must be deduplicated to exactly 1 entry');
    assertEqual(targetMatches[0].score, 0.95, 'Should retain highest score');
    assertEqual(targetMatches[0].relationType, 'antonym', 'Should retain relation with highest score');
  });

  test('RelationshipEngine: handles ambiguous words with multiple distinct transformations', () => {
    const engine = new RelationshipEngine();
    const transforms = engine.getTransformations('SLOW');
    const words = transforms.map((t) => t.word);
    assert(words.includes('FAST'), 'Must include FAST');
    assert(words.includes('QUICK'), 'Must include QUICK');
    assert(words.includes('RAPID'), 'Must include RAPID');
    // Verify no duplicates
    const uniqueWords = new Set(words);
    assertEqual(words.length, uniqueWords.size, 'All transformation words must be unique');
  });

  test('RelationshipEngine: normalizes input with edge punctuation and whitespace', () => {
    const engine = new RelationshipEngine();
    const normalTransforms = engine.getTransformations('SLOW');
    const messyTransforms = engine.getTransformations(' -SLOW! ');
    assertEqual(messyTransforms.length, normalTransforms.length, 'Should normalize messy input');
    assertEqual(messyTransforms[0]?.word, normalTransforms[0]?.word, 'Top word should match');
  });

  test('RelationshipEngine: safely handles empty, whitespace, and special characters', () => {
    const engine = new RelationshipEngine();
    assertEqual(engine.getTransformations('').length, 0, 'Empty string should yield 0 transformations');
    assertEqual(engine.getTransformations('   ').length, 0, 'Whitespace should yield 0 transformations');
    assertEqual(engine.getTransformations('!@#$%^').length, 0, 'Punctuation should yield 0 transformations');
  });

  test('RelationshipEngine: enforces word-length constraint', () => {
    const engine = new RelationshipEngine();
    const constrained = engine.getTransformations('SLOW', { length: 4 });
    assert(constrained.length > 0, 'Should have 4-letter results');
    for (const t of constrained) {
      assertEqual(t.word.length, 4, `Word "${t.word}" must have length 4`);
    }
    assert(constrained.some((t) => t.word === 'FAST'), 'FAST has length 4');
    assert(!constrained.some((t) => t.word === 'SLUGGISH'), 'SLUGGISH should be excluded');
  });

  test('RelationshipEngine: enforces first-letter constraint (case-insensitive)', () => {
    const engine = new RelationshipEngine();
    const constrainedUpper = engine.getTransformations('SLOW', { startsWith: 'F' });
    const constrainedLower = engine.getTransformations('SLOW', { startsWith: 'f' });
    assertEqual(constrainedUpper.length, constrainedLower.length, 'Constraint must be case-insensitive');
    for (const t of constrainedUpper) {
      assert(t.word.startsWith('F'), `Word "${t.word}" must start with F`);
    }
    assert(constrainedUpper.some((t) => t.word === 'FAST'), 'FAST starts with F');
    assert(!constrainedUpper.some((t) => t.word === 'QUICK'), 'QUICK does not start with F');
  });

  // =========================================================================
  // 2. PhraseMatcher Tests (Dedicated Phrase Matching Suite)
  // =========================================================================
  test('PhraseMatcher: recognizes direct two-word phrases', () => {
    const matcher = new PhraseMatcher();
    const match = matcher.matchPhrase('FAST', 'FOOD');
    assert(!!match, 'Should match FAST FOOD');
    assertEqual(match?.phrase, 'FAST FOOD', 'Phrase name should be FAST FOOD');
  });

  test('PhraseMatcher: recognizes compound words without spaces', () => {
    const matcher = new PhraseMatcher();
    const matchClassmate = matcher.matchPhrase('CLASS', 'MATE');
    assert(!!matchClassmate, 'Should match CLASS MATE / CLASSMATE');

    const matchBookshelf = matcher.matchPhrase('BOOK', 'SHELF');
    assert(!!matchBookshelf, 'Should match BOOK SHELF / BOOKSHELF');

    const matchEyelid = matcher.matchPhrase('EYE', 'LID');
    assert(!!matchEyelid, 'Should match EYE LID / EYELID');

    const matchWholesale = matcher.matchPhrase('WHOLE', 'SALE');
    assert(!!matchWholesale, 'Should match WHOLE SALE / WHOLESALE');
  });

  test('PhraseMatcher: recognizes hyphenated / alternate forms', () => {
    const matcher = new PhraseMatcher();
    const matchCloseUp = matcher.matchPhrase('CLOSE', 'UP');
    assert(!!matchCloseUp, 'Should match CLOSE UP / CLOSE-UP');

    const matchHighRise = matcher.matchPhrase('HIGH', 'RISE');
    assert(!!matchHighRise, 'Should match HIGH RISE / HIGH-RISE');
  });

  test('PhraseMatcher: normalizes case, whitespace and edge punctuation in words', () => {
    const matcher = new PhraseMatcher();
    const match = matcher.matchPhrase(' fast ', 'food.');
    assert(!!match, 'Should match despite messy casing and punctuation');
    assertEqual(match?.phrase, 'FAST FOOD', 'Should resolve to canonical phrase');
  });

  test('PhraseMatcher: rejects unrecognized word combinations', () => {
    const matcher = new PhraseMatcher();
    assertEqual(matcher.matchPhrase('PURPLE', 'BANANA'), null, 'Nonsense pair should return null');
    assertEqual(matcher.matchPhrase('', 'FOOD'), null, 'Empty word1 should return null');
    assertEqual(matcher.matchPhrase('FAST', ''), null, 'Empty word2 should return null');
  });

  test('PhraseMatcher: supports indexing lookups for word1 and word2', () => {
    const matcher = new PhraseMatcher();
    const fastPhrases = matcher.findPhrasesForWord1('FAST');
    assert(fastPhrases.some((p) => p.phrase === 'FAST FOOD'), 'Should find FAST FOOD for word1 FAST');

    const foodPhrases = matcher.findPhrasesForWord2('FOOD');
    assert(foodPhrases.some((p) => p.phrase === 'FAST FOOD'), 'Should find FAST FOOD for word2 FOOD');
  });

  // =========================================================================
  // 3. AnswerRanker Tests
  // =========================================================================
  test('AnswerRanker: calculates bounded matchScore between 0 and 1', () => {
    const ranker = new AnswerRanker();
    const score = ranker.calculateMatchScore(0.98, 0.96, 1.0);
    assert(score >= 0 && score <= 1, 'Match score must be between 0 and 1');
    assert(score > 0.9, 'High-matching items should have matchScore > 0.9');
  });

  test('AnswerRanker: generates explanatory text with reasons', () => {
    const ranker = new AnswerRanker();
    const explanation = ranker.buildExplanation(
      'SLOW',
      'MEAL',
      'FAST',
      'FOOD',
      { originalClue: 'SLOW', word: 'FAST', relationType: 'antonym', score: 0.98, reason: 'Opposite of SLOW' },
      { originalClue: 'MEAL', word: 'FOOD', relationType: 'synonym', score: 0.96, reason: 'Synonym of MEAL' },
      'FAST FOOD'
    );
    assert(explanation.includes('SLOW'), 'Should mention clue SLOW');
    assert(explanation.includes('FAST'), 'Should mention word FAST');
    assert(explanation.includes('MEAL'), 'Should mention clue MEAL');
    assert(explanation.includes('FOOD'), 'Should mention word FOOD');
    assert(explanation.includes('antonym'), 'Should mention relation type antonym');
    assert(explanation.includes('FAST FOOD'), 'Should mention target phrase');
  });

  test('AnswerRanker: provides deterministic tie-breaking for equal scores', () => {
    const ranker = new AnswerRanker();
    const candidates = [
      {
        targetPhrase: 'ZEBRA CROSSING',
        word1: 'ZEBRA',
        word2: 'CROSSING',
        relation1: { originalClue: 'C1', word: 'ZEBRA', relationType: 'synonym' as const, score: 0.8, reason: 'r' },
        relation2: { originalClue: 'C2', word: 'CROSSING', relationType: 'synonym' as const, score: 0.8, reason: 'r' },
        phraseScore: 0.8,
        matchScore: 0.8,
        confidence: 0.8,
        explanation: 'exp Z',
        matchesConstraints: true,
      },
      {
        targetPhrase: 'APPLE PIE',
        word1: 'APPLE',
        word2: 'PIE',
        relation1: { originalClue: 'C1', word: 'APPLE', relationType: 'synonym' as const, score: 0.8, reason: 'r' },
        relation2: { originalClue: 'C2', word: 'PIE', relationType: 'synonym' as const, score: 0.8, reason: 'r' },
        phraseScore: 0.8,
        matchScore: 0.8,
        confidence: 0.8,
        explanation: 'exp A',
        matchesConstraints: true,
      },
    ];

    const ranked = ranker.rankCandidates(candidates);
    assertEqual(ranked[0].targetPhrase, 'APPLE PIE', 'Alphabetical tie-break should place APPLE PIE before ZEBRA CROSSING');
    assertEqual(ranked[1].targetPhrase, 'ZEBRA CROSSING', 'Second place should be ZEBRA CROSSING');
  });

  // =========================================================================
  // 4. FlipitSolver Integration Tests
  // =========================================================================
  test('FlipitSolver: prevents duplicate candidate phrases', () => {
    const solver = new FlipitSolver();
    const res = solver.solve('GRADE', 'FRIEND');
    const phraseCount = res.candidates.filter(
      (c) => c.targetPhrase.replace(/[^A-Z]/g, '') === 'CLASSMATE'
    ).length;
    assertEqual(phraseCount, 1, 'Should never output duplicate variations of CLASS MATE / CLASSMATE');
  });

  test('FlipitSolver: safely handles invalid clue inputs without errors', () => {
    const solver = new FlipitSolver();
    const resEmpty = solver.solve('', '');
    assertEqual(resEmpty.candidates.length, 0, 'Empty strings should yield 0 candidates');
    assertEqual(resEmpty.bestMatch, null, 'Empty strings should have null bestMatch');

    const resSymbols = solver.solve('???', '###');
    assertEqual(resSymbols.candidates.length, 0, 'Symbols should yield 0 candidates');
  });

  // =========================================================================
  // 5. Morphology & Lemmatization Tests (Amendment 4)
  // =========================================================================
  test('Morphology: resolves regular plurals correctly', () => {
    assert(Morphology.getCandidateLemmas('CATS').includes('CAT'), 'CATS -> CAT');
    assert(Morphology.getCandidateLemmas('BOXES').includes('BOX'), 'BOXES -> BOX');
    assert(Morphology.getCandidateLemmas('HOUSES').includes('HOUSE'), 'HOUSES -> HOUSE');
  });

  test('Morphology: resolves WordNet irregular plurals correctly', () => {
    assert(Morphology.getCandidateLemmas('CHILDREN').includes('CHILD'), 'CHILDREN -> CHILD');
    assert(Morphology.getCandidateLemmas('FEET').includes('FOOT'), 'FEET -> FOOT');
    assert(Morphology.getCandidateLemmas('TEETH').includes('TOOTH'), 'TEETH -> TOOTH');
    assert(Morphology.getCandidateLemmas('MICE').includes('MOUSE'), 'MICE -> MOUSE');
    assert(Morphology.getCandidateLemmas('MEN').includes('MAN'), 'MEN -> MAN');
    assert(Morphology.getCandidateLemmas('WOMEN').includes('WOMAN'), 'WOMAN -> WOMAN');
  });

  test('Morphology: resolves past tense inflections correctly', () => {
    assert(Morphology.getCandidateLemmas('WALKED').includes('WALK'), 'WALKED -> WALK');
    assert(Morphology.getCandidateLemmas('WENT').includes('GO'), 'WENT -> GO');
    assert(Morphology.getCandidateLemmas('RAN').includes('RUN'), 'RAN -> RUN');
  });

  test('Morphology: resolves gerunds / participles correctly', () => {
    assert(Morphology.getCandidateLemmas('WALKING').includes('WALK'), 'WALKING -> WALK');
    assert(Morphology.getCandidateLemmas('RUNNING').includes('RUN'), 'RUNNING -> RUN');
    assert(Morphology.getCandidateLemmas('SWIMMING').includes('SWIM'), 'SWIMMING -> SWIM');
  });

  test('Morphology: strictly guards invariant words against incorrect over-stemming', () => {
    const invariants = ['NEWS', 'SERIES', 'SPECIES', 'MATE', 'CLASS', 'RING', 'WING', 'KING', 'SING', 'BED', 'RED', 'FEED', 'SEED'];
    for (const word of invariants) {
      const lemmas = Morphology.getCandidateLemmas(word);
      assertEqual(lemmas.length, 1, `Invariant word ${word} must have exactly 1 lemma`);
      assertEqual(lemmas[0], word, `Invariant word ${word} must not be altered`);
    }
  });

  // =========================================================================
  // 6. Relationship Scoring & Priority Tests (Amendment 5)
  // =========================================================================
  test('Relationship Priority: strong antonyms/synonyms outrank weak associations', () => {
    assert(RELATION_PRIORITY.antonym > RELATION_PRIORITY.synonym, 'Antonym must outrank synonym');
    assert(RELATION_PRIORITY.synonym > RELATION_PRIORITY.hierarchical, 'Synonym must outrank hierarchical');
    assert(RELATION_PRIORITY.hierarchical > RELATION_PRIORITY.associated, 'Hierarchical must outrank associated');
  });

  return results;
}
