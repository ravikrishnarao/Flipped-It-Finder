/**
 * Flipit Finder V3 — Offline Intelligence Engine
 * Unified export index for V3 relationship providers, phrase providers, and partition loaders.
 */

// Relationship Engine Components
export * from './types.ts';
export * from './partitionLoader.ts';
export * from './wordnetProvider.ts';
export * from './coordinateProvider.ts';
export * from './mobyThesaurusProvider.ts';
export * from './contextualProvider.ts';
export * from './compositeV3Provider.ts';

// Phrase Discovery Engine Components
export * from './phraseTypes.ts';
export * from './curatedPhraseProvider.ts';
export * from './compoundPhraseProvider.ts';
export * from './collocationPhraseProvider.ts';
export * from './compositeV3PhraseProvider.ts';
export * from './partitionedCorpusPlugin.ts';

// Morphology, Ranking & Integrated Solver (Milestones 3.2 - 4)
export * from './morphology.ts';
export * from './v3Ranker.ts';
export * from './v3Solver.ts';

