/**
 * Flipit Finder - Public API Entry Point (V2.2)
 */

export * from './types.ts';
export { Morphology, WORDNET_EXCEPTIONS, DO_NOT_STEM } from './morphology.ts';
export { RelationshipEngine } from './relationshipEngine.ts';
export { LexicalRelationshipProvider, RELATION_PRIORITY } from './lexicalRelationshipProvider.ts';
export { CompositeRelationshipProvider } from './compositeRelationshipProvider.ts';
export { PhraseMatcher } from './phraseMatcher.ts';
export { LexicalPhraseProvider } from './lexicalPhraseProvider.ts';
export { CompositePhraseProvider } from './compositePhraseProvider.ts';
export { AnswerRanker } from './ranker.ts';
export { FlipitSolver } from './solver.ts';

// Default singleton instance for convenience
import { FlipitSolver } from './solver.ts';
export const flipitSolver = new FlipitSolver();
