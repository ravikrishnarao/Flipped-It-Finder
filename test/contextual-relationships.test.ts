/**
 * Flipit Finder - Contextual & Activity Relationship Test Suite (V2.2.4)
 * Validates contextual association discovery, activity counterparts, functional pairings,
 * phrase recognition for CLEAN SWEEP, and ranking discipline between lexical and contextual layers.
 */

import { FlipitSolver } from '../src/solver/solver.ts';
import { CompositeRelationshipProvider } from '../src/solver/compositeRelationshipProvider.ts';
import { CompositePhraseProvider } from '../src/solver/compositePhraseProvider.ts';
import { ContextualAssociationProvider } from '../src/solver/contextualAssociationProvider.ts';
import type { TestResult } from './unit.test.ts';

export function runContextualRelationshipTests(): TestResult[] {
  const results: TestResult[] = [];

  function test(name: string, fn: () => void) {
    try {
      fn();
      results.push({ suite: 'Contextual Relationship Tests', name, passed: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ suite: 'Contextual Relationship Tests', name, passed: false, error: msg });
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

  // A. DRY independently generates CLEAN
  test('A. DRY independently generates CLEAN with accurately labelled contextual relationship', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('DRY');
    const clean = transforms.find((t) => t.word === 'CLEAN');

    assert(Boolean(clean), 'DRY must generate CLEAN as a transformation candidate');
    assertEqual(clean?.relationType, 'contextual', 'Relationship type must be contextual');
    assert((clean?.score || 0) >= 0.85, 'Contextual score must be >= 0.85');
    assert(
      Boolean(clean?.reason.toLowerCase().includes('dry-clean') || clean?.reason.toLowerCase().includes('laundry')),
      'Reason must describe dry-cleaning or laundry context'
    );
    assert(
      !clean?.reason.toLowerCase().includes('wordnet synset'),
      'Must NOT claim WordNet synset provenance for curated contextual relation'
    );
  });

  // B. MOP independently generates SWEEP
  test('B. MOP independently generates SWEEP with accurately labelled associated-action relationship', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('MOP');
    const sweep = transforms.find((t) => t.word === 'SWEEP');

    assert(Boolean(sweep), 'MOP must generate SWEEP as a transformation candidate');
    assertEqual(sweep?.relationType, 'associated', 'Relationship type must be associated');
    assert((sweep?.score || 0) >= 0.85, 'Associated activity score must be >= 0.85');
    assert(
      Boolean(sweep?.reason.toLowerCase().includes('floor-cleaning') || sweep?.reason.toLowerCase().includes('sweep')),
      'Reason must explain floor-cleaning activity'
    );
    assert(
      !sweep?.reason.toLowerCase().includes('wordnet synset'),
      'Must NOT claim WordNet synset provenance for curated associated activity'
    );
  });

  // C. CLEAN SWEEP is independently recognised
  test('C. CLEAN SWEEP is independently recognised by PhraseProvider with alternate forms', () => {
    const phraseProvider = new CompositePhraseProvider();
    const phrase = phraseProvider.matchPhrase('CLEAN', 'SWEEP');

    assert(Boolean(phrase), 'PhraseProvider must match CLEAN SWEEP');
    assertEqual(phrase?.phrase, 'CLEAN SWEEP', 'Target phrase must be CLEAN SWEEP');
    assert((phrase?.frequencyScore || 0) >= 0.95, 'Phrase frequency score must be >= 0.95');

    // Test indexed lookup and alternate forms
    const phrasesForClean = phraseProvider.findPhrasesForWord1?.('CLEAN') || [];
    assert(phrasesForClean.some((p) => p.phrase === 'CLEAN SWEEP'), 'findPhrasesForWord1 must find CLEAN SWEEP');
    assert(Boolean(phrase?.alternateForms?.includes('CLEANSWEEP')), 'Alternate forms must include CLEANSWEEP');
  });

  // D. DRY + MOP generates CLEAN SWEEP
  test('D. DRY + MOP generates CLEAN SWEEP unconstrained with valid explanation', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('DRY', 'MOP');

    assert(Boolean(result.bestMatch), 'Solver must find a solution for DRY + MOP');
    assertEqual(result.bestMatch?.targetPhrase, 'CLEAN SWEEP', 'Best match must be CLEAN SWEEP');
    assertEqual(result.bestMatch?.word1, 'CLEAN', 'Word 1 must be CLEAN');
    assertEqual(result.bestMatch?.word2, 'SWEEP', 'Word 2 must be SWEEP');
    assert((result.bestMatch?.matchScore || 0) >= 0.80, 'Match score should be strong (>= 0.80)');
    assert(
      Boolean(result.bestMatch?.explanation.includes('Contextual Associations Repository')),
      'Explanation must acknowledge Contextual Associations Repository source'
    );
  });

  test('D2. DRY + MOP solves correctly with letter and length constraints', () => {
    const solver = new FlipitSolver();
    const result = solver.solve('DRY', 'MOP', {
      word1: { length: 5, startsWith: 'C' },
      word2: { length: 5, startsWith: 'S' },
    });

    assert(Boolean(result.bestMatch), 'Constrained solver must find a match');
    assertEqual(result.bestMatch?.targetPhrase, 'CLEAN SWEEP', 'Target must be CLEAN SWEEP');
    assertEqual(result.bestMatch?.matchesConstraints, true, 'Result must satisfy constraints');
    assertEqual(result.totalCombinationsEvaluated, 1, 'Only 1 valid combination survives constraints');
  });

  // E. Ranking Discipline: Synonyms & Antonyms outrank contextual associations
  test('E. Ranking Hierarchy: Direct lexical antonyms/synonyms outrank weak contextual associations', () => {
    const solver = new FlipitSolver();

    // Direct antonym benchmark: SLOW + MEAL -> FAST FOOD
    const lexicalRes = solver.solve('SLOW', 'MEAL');
    // Contextual association: DRY + MOP -> CLEAN SWEEP
    const contextualRes = solver.solve('DRY', 'MOP');

    const lexicalScore = lexicalRes.bestMatch?.matchScore || 0;
    const contextualScore = contextualRes.bestMatch?.matchScore || 0;

    assert(
      lexicalScore > contextualScore,
      `Direct antonym score (${lexicalScore}) must outrank contextual association score (${contextualScore})`
    );
  });

  // Additional Contextual & Activity Examples
  test('Additional Activity 1: BRUSH -> COMB (grooming activity)', () => {
    const ctx = new ContextualAssociationProvider();
    const transforms = ctx.getTransformations('BRUSH');
    const comb = transforms.find((t) => t.word === 'COMB');
    assert(Boolean(comb), 'BRUSH must generate COMB as associated activity');
    assertEqual(comb?.relationType, 'associated', 'Type must be associated');
  });

  test('Additional Activity 2: HAMMER -> NAIL (functional tool pairing)', () => {
    const ctx = new ContextualAssociationProvider();
    const transforms = ctx.getTransformations('HAMMER');
    const nail = transforms.find((t) => t.word === 'NAIL');
    assert(Boolean(nail), 'HAMMER must generate NAIL as functional pairing');
    assertEqual(nail?.relationType, 'associated', 'Type must be associated');
  });

  test('Additional Activity 3: NEEDLE -> THREAD (functional sewing pairing)', () => {
    const ctx = new ContextualAssociationProvider();
    const transforms = ctx.getTransformations('NEEDLE');
    const thread = transforms.find((t) => t.word === 'THREAD');
    assert(Boolean(thread), 'NEEDLE must generate THREAD as functional pairing');
  });

  test('Additional Activity 4: LOCK -> KEY (security mechanism pairing)', () => {
    const ctx = new ContextualAssociationProvider();
    const transforms = ctx.getTransformations('LOCK');
    const key = transforms.find((t) => t.word === 'KEY');
    assert(Boolean(key), 'LOCK must generate KEY as functional pairing');
  });

  test('Additional Activity 5: BREAD -> BUTTER (culinary conceptual pairing)', () => {
    const ctx = new ContextualAssociationProvider();
    const transforms = ctx.getTransformations('BREAD');
    const butter = transforms.find((t) => t.word === 'BUTTER');
    assert(Boolean(butter), 'BREAD must generate BUTTER as contextual pairing');
    assertEqual(butter?.relationType, 'contextual', 'Type must be contextual');
  });

  test('Additional Activity 6: Symmetric action pairs (COOK <-> BAKE, CHOP <-> SLICE, CUT <-> PASTE)', () => {
    const ctx = new ContextualAssociationProvider();
    const cookTransforms = ctx.getTransformations('COOK');
    assert(cookTransforms.some((t) => t.word === 'BAKE'), 'COOK -> BAKE');

    const chopTransforms = ctx.getTransformations('CHOP');
    assert(chopTransforms.some((t) => t.word === 'SLICE'), 'CHOP -> SLICE');

    const cutTransforms = ctx.getTransformations('CUT');
    assert(cutTransforms.some((t) => t.word === 'PASTE'), 'CUT -> PASTE');
  });

  // Water + Rest -> Fire Works
  test('Water + Rest: WATER independently generates FIRE', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('WATER');
    const fire = transforms.find((t) => t.word === 'FIRE');
    assert(Boolean(fire), 'WATER must generate FIRE');
    assertEqual(fire?.relationType, 'counterpart', 'Relation type must be counterpart');
  });

  test('Water + Rest: REST independently generates WORK', () => {
    const provider = new CompositeRelationshipProvider();
    const transforms = provider.getTransformations('REST');
    const work = transforms.find((t) => t.word === 'WORK');
    assert(Boolean(work), 'REST must generate WORK');
    assertEqual(work?.relationType, 'antonym', 'Relation type must be antonym');
  });

  test('Water + Rest: PhraseProvider recognizes FIRE WORKS with alternate forms', () => {
    const phraseProvider = new CompositePhraseProvider();
    const match = phraseProvider.matchPhrase('FIRE', 'WORKS');
    assert(Boolean(match), 'FIRE WORKS must be recognized by PhraseProvider');
    assertEqual(match?.phrase, 'FIRE WORKS', 'Phrase must match canonical FIRE WORKS');
    assert(Boolean(match?.alternateForms?.includes('FIREWORKS')), 'Alternate forms must include FIREWORKS');
  });

  test('Water + Rest: FlipitSolver solves WATER + REST -> FIRE WORKS unconstrained', () => {
    const solver = new FlipitSolver();
    const res = solver.solve('WATER', 'REST');
    assert(Boolean(res.bestMatch), 'Must find best match for WATER + REST');
    assertEqual(res.bestMatch?.targetPhrase, 'FIRE WORKS', 'Target phrase must be FIRE WORKS');
    assert((res.bestMatch?.matchScore || 0) >= 0.95, 'Match score must be >= 0.95');
  });

  test('Water + Rest: FlipitSolver solves with length constraints (4 letters + 5 letters)', () => {
    const solver = new FlipitSolver();
    const res = solver.solve('WATER', 'REST', {
      word1: { length: 4, startsWith: 'F' },
      word2: { length: 5, startsWith: 'W' },
    });
    assert(Boolean(res.bestMatch), 'Must find match with length constraints');
    assertEqual(res.bestMatch?.targetPhrase, 'FIRE WORKS', 'Must resolve to FIRE WORKS');
    assertEqual(res.bestMatch?.word1, 'FIRE', 'Word 1 must be FIRE');
    assertEqual(res.bestMatch?.word2, 'WORKS', 'Word 2 must be WORKS');
  });

  return results;
}
