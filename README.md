# Flipit Finder — Word Puzzle Solving Engine (V2.2)

A modular, framework-agnostic JavaScript and Node.js word puzzle solving engine for clue-pair transformations and common phrase discovery.

---

## 1. Overview

In **Flipit Finder**, the player is presented with two clue words. Each word must be transformed through semantic relationships (synonyms, antonyms, counterparts, contextual flips, or morphological lemmas) into a new word such that the combined pair forms an established English phrase or compound word.

### Examples
- `SLOW` + `MEAL` $\rightarrow$ **`FAST FOOD`** (`SLOW` antonym $\rightarrow$ `FAST`, `MEAL` synonym $\rightarrow$ `FOOD`)
- `GRADE` + `FRIEND` $\rightarrow$ **`CLASS MATE`** (`GRADE` synonym $\rightarrow$ `CLASS`, `FRIEND` synonym $\rightarrow$ `MATE`)
- `LOW` + `WAVE` $\rightarrow$ **`HIGH TIDE`** (`LOW` antonym $\rightarrow$ `HIGH`, `WAVE` counterpart $\rightarrow$ `TIDE`)
- `WARM` + `CAT` $\rightarrow$ **`HOT DOG`** (`WARM` synonym $\rightarrow$ `HOT`, `CAT` coordinate $\rightarrow$ `DOG`)
- `FIRE` + `MILK` $\rightarrow$ **`ICE CREAM`** (`FIRE` counterpart $\rightarrow$ `ICE`, `MILK` coordinate $\rightarrow$ `CREAM`)
- `LONG` + `PATH` $\rightarrow$ **`SHORT CUT`** (`LONG` antonym $\rightarrow$ `SHORT`, `PATH` synonym $\rightarrow$ `CUT`)

---

## 2. Architecture & Provider Interfaces

The engine is decoupled into modular components designed around TypeScript interfaces:

```
src/solver/
├── types.ts                         # Provider interfaces, constraint interfaces, and data models
├── morphology.ts                    # WordNet exception tables and conservative lemmatizer
├── relationshipEngine.ts            # Curated domain relationships provider
├── lexicalRelationshipProvider.ts   # WordNet 3.0 lexical relationship provider
├── compositeRelationshipProvider.ts # Unified provider composing curated + lexical sources
├── phraseMatcher.ts                 # Curated puzzle phrase provider
├── lexicalPhraseProvider.ts         # Moby public-domain collocations & compounds provider
├── compositePhraseProvider.ts       # Unified phrase provider composing curated + Moby phrases
├── ranker.ts                        # Heuristic scoring engine with deterministic tie-breaking
├── solver.ts                        # FlipitSolver orchestrator; deduplicates final phrases
└── index.ts                         # Public library exports
```

### Provider Hierarchy
- **`RelationshipProvider`**: Decouples transformation generation from storage.
  - `RelationshipEngine`: High-precision domain curated relationships (counterparts, contextual pairs).
  - `LexicalRelationshipProvider`: Princeton WordNet 3.0 offline lexical relations (antonyms, synonyms, coordinates, hypernyms, derivations).
  - `CompositeRelationshipProvider`: Queries all providers, deduplicating target words by score and relationship priority.
- **`PhraseProvider`**: Decouples collocation validation from static files.
  - `PhraseMatcher`: Curated puzzle benchmark phrases.
  - `LexicalPhraseProvider`: Moby public-domain English collocations, idioms, and compound words.
  - `CompositePhraseProvider`: Evaluates both dictionaries with fallback matching.

---

## 3. Heuristic Ranking & Scoring (`matchScore`)

Candidates are scored using a deterministic heuristic ranking formula:

$$\text{matchScore} = 0.35 \cdot S(\text{rel}_1) + 0.35 \cdot S(\text{rel}_2) + 0.30 \cdot F(\text{phrase}) - \text{penalties}$$

> **Important Note on Calibration**:
> `matchScore` is a **heuristic similarity and collocation index** ($0.0$ to $1.0$), **not a statistical or Bayesian probability**. It ranks candidate pairs based on semantic fit and collocation frequency.

### Relationship Priority Hierarchy
1. `antonym` ($0.98 - 1.0$)
2. `counterpart` ($0.95 - 0.98$)
3. `synonym` ($0.92 - 0.96$)
4. `morphological` ($0.85 - 0.90$)
5. `hierarchical` ($0.80 - 0.85$)
6. `associated` / `contextual` ($0.75 - 0.82$)

Tied scores are resolved deterministically:
1. Higher phrase frequency score (`phraseScore`)
2. Higher combined transformation strength ($S(\text{rel}_1) + S(\text{rel}_2)$)
3. Lexicographical alphabetical comparison on `targetPhrase`

---

## 4. Datasets & Provenance

All offline datasets are permissively licensed or public domain. Full notices and disclaimers are in `LICENSE-DATA.md`.

- **`data/puzzles.json`**: The 17 initial benchmark regression puzzles.
- **`data/relationships.json`**: Curated domain relationship dataset.
- **`data/phrases.json`**: Curated benchmark phrase dataset.
- **`data/wordnet_relationships.json`**: Extracted from Princeton WordNet 3.0 (WordNet 3.0 License).
- **`data/moby_phrases.json`**: Moby Lexicon Project compound words and collocations (Public Domain).
- **`data/generalization_eval.json`**: Independent unseen puzzle dataset for generalization evaluation (zero overlap with curated data).

---

## 5. Development & Test Commands

All scripts run via Node.js and `tsx`:

```bash
# Run unit tests, 17-puzzle regression tests, and generalization tests (86 tests)
npm test

# Run audit validation suite (sizes, leakage audit, generalization accuracy, ambiguity)
npm run validate

# Verify TypeScript compilation and type safety
npm run lint

# Build the project
npm run build
```

---

## 6. Dependencies & Runtime Environment

### Runtime Dependencies
- `node` / `tsx`: TypeScript execution engine.
- `react`, `react-dom` (^19.0.1): React framework.
- `express` (^4.21.2): Server runtime support.
- `motion` (^12.23.24): UI animation library.
- `lucide-react` (^0.546.0): UI iconography.
- `@google/genai` (^2.4.0): SDK for future Gemini AI integration (not utilized in V2 solver engine).

### Dev Dependencies
- `typescript` (^7.0.2): Static typing.
- `vite` (^8.3.0): Build tool and dev server.
- `@tailwindcss/vite` (^4.3.3) & `tailwindcss` (^4.3.3): Utility-first styling.
