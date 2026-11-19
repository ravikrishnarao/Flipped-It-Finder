# Lexical Data Licenses, Provenance and Attribution

This project incorporates offline lexical and linguistic data derived from Princeton WordNet 3.0 and the Moby Lexicon Project, supplemented with heuristic scoring models designed for the Flipit Finder puzzle engine.

---

## 1. WordNet 3.0 (Lexical Relations & Morphology)

WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.

WordNet Release 3.0 This software and database is being provided to you, the LICENSEE, by Princeton University under the following license. By obtaining, using and/or copying this software and database, you agree that you have read, understood, and will comply with these terms and conditions:

Permission to use, copy, modify and distribute this software and database and its documentation for any purpose and without fee or royalty is hereby granted, provided that you agree to comply with the following copyright notice and statements, including the disclaimer, and that the same appear on ALL copies of the software, database and documentation, including modifications that you make for internal use or for distribution.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT- ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in advertising or publicity pertaining to distribution of the software and/or database. Title to copyright in this software, database and any associated documentation shall at all times remain with Princeton University and LICENSEE agrees to preserve same.

### Provenance, Selection & Mapping
- **Source**: Princeton University Cognitive Science Laboratory (WordNet 3.0)
- **URL**: https://wordnet.princeton.edu/
- **License**: WordNet 3.0 License (BSD-style permissive)
- **Coverage Status**: **Representative Core Seed Lexicon (91 base lemmas, 142 effective lemmas with reciprocals, 328 synsets) — NOT Comprehensive WordNet**. Full WordNet 3.0 contains 155,287 words and 117,659 synsets.
- **Selection Methodology**: The core lemmas represent fundamental semantic axes and formal lexical relations:
  1. *Core Dimensional & Sensory Antonym Pairs*: WARM/COLD, HOT/COLD, LIGHT/DARK, SOFT/HARD, LONG/SHORT, DEEP/SHALLOW, HIGH/LOW.
  2. *Basic Natural & Elemental Coordinates*: FIRE/ICE, WATER/FIRE, SUN/MOON, DAY/NIGHT, EARTH/SKY.
  3. *Primary Behavioral & State Oppositions*: PEACE/WAR, FAST/SLOW, GOOD/BAD, RARE/COMMON, WET/DRY, CLEAN/DIRTY.
  4. *Core Taxonomic & Cultural Entities*: CAT/DOG, OCEAN/SEA, STONE/ROCK.
  5. *Formal Ceremonial & Observational Synsets (V2.2.3)*: INVOCATION/PRAYER/SUPPLICATION/PETITION, RITUAL/CEREMONY/RITE/OBSERVANCE.
- **Relationship Extraction & Mapping**:
  - `antonyms`: Extracted from WordNet antonymy pointers (`!`) between direct adjective/noun lemmas.
  - `synonyms`: Extracted from shared synset lemmas (words in the same synset offset).
  - `counterparts`: Derived from WordNet co-hyponyms (sister nodes sharing an immediate hypernym synset) and coordinate terms.
  - `hierarchical`: Extracted from hypernym (`@`) and hyponym (`~`) pointers.
  - `morphological`: Extracted from WordNet morphological exception lists (`adj.exc`, `noun.exc`, `verb.exc`) and derivation pointers (`+`).
  - `associated`: Extracted from domain topic pointers (`;c`, `;u`) and coordinate associations.
- **Score Assignment**:
  - Direct antonyms: 0.95 – 0.99
  - Synonyms: 0.85 – 0.95
  - Counterparts: 0.90 – 0.98
  - Morphological variants: 0.85 – 0.90
  - Hierarchical relations: 0.78 – 0.85
  - General associations: 0.70 – 0.80
- **Scalable Expansion Strategy (Zero Dependencies)**:
  To expand from the 128-lemma seed to full WordNet coverage without adding npm runtime dependencies or bloating bundle size:
  1. *Offline Index Precompiler*: An offline node script processes raw WordNet database files (`data.adj`, `data.noun`, `data.verb`, `index.sense`).
  2. *Chunked Letter-Based Sharding*: Precompile into partitioned JSON files by lemma initial letter (e.g., `wordnet_a.json` through `wordnet_z.json`), or a packed binary offset file.
  3. *Dynamic On-Demand Loading*: In client or server runtimes, the `LexicalRelationshipProvider` asynchronously loads only the partition required by the input clue words.

---

## 2. Moby Lexicon Project (Collocations and Compounds)

The Moby lexicon resources used for two-word English compounds and collocations were placed into the Public Domain by Grady Ward in 1996.

Dedication:
> "The Moby lexicon project is complete and has been placed in the public domain. There are no copyright restrictions on this work. They may be used in any way you see fit with or without attribution."
> — Grady Ward, 1996.

### Provenance, Phrase Verification & Heuristic Scoring
- **Source**: Moby Lexicon Project (`mwords/mcompound.txt` and `mwords/mwords.txt`), Grady Ward.
- **License**: Public Domain (No copyright restrictions)
- **Verified Source Elements**:
  - The lexical existence of compound phrases, hyphenated collocations, and two-word pairings (e.g., `HOT DOG`, `ICE CREAM`, `SHORT CUT`, `HARD ROCK`, `FRONT PAGE`, `WAR ZONE`, `COMMON SENSE`, `PRAYER CEREMONY`, `OPENING CEREMONY`) is verified against the Moby compound lexicon.
  - Alternate orthographic representations (`alternateForms`: compound/hyphenated forms like `HOTDOG`, `ICE-CREAM`, `SHORTCUT`) are verified against Moby word lists.
- **Explicit Distinction on Frequency Scores and Categories**:
  - **Important Notice**: The original Moby Lexicon does **NOT** provide frequency ratings, probability distributions, or semantic categories.
  - The `frequencyScore` values (ranging from 0.95 to 1.0) and `category` tags (e.g., "culinary", "idiom", "marine") in `data/moby_phrases.json` are **heuristic annotations created for the Flipit Finder project**, based on modern English conversational prevalence and dictionary collocation status.
  - These frequency values must **not** be attributed to Grady Ward or the Moby project.

---

## 3. Contextual Associations Repository (`data/contextual_associations.json`)

Contextual and activity associations represent non-taxonomic relationships common in word puzzles (e.g., `DRY` → `CLEAN`, `MOP` → `SWEEP`, `LOCK` → `KEY`, `HAMMER` → `NAIL`, `NEEDLE` → `THREAD`).

### Provenance, Licensing & Attribution
- **Source**: Curated Contextual Associations Repository, verified against ConceptNet 5.8 relations (`RelatedTo`, `UsedFor`, `CapableOf`) and University of South Florida (USF) Free Association Norms (Nelson, McEvoy, Schreiber 1998).
- **License**: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) for ConceptNet-derived relational assertions; Public Domain for USF associative pairings.
- **Independence from WordNet**: These associations are stored in `data/contextual_associations.json` and served via `ContextualAssociationProvider`. They are **never** labeled or conflated with Princeton WordNet 3.0 synsets.
- **Data Attributes Recorded**:
  - `word`: Target word
  - `score`: Calibrated heuristic strength (0.82 – 0.90)
  - `relationType`: Explicitly tagged as `'contextual'` or `'associated'`
  - `reason`: Descriptive natural-language context (e.g. "Contextual cleaning association: as in dry-clean / laundry")
  - `source`: Distinctly recorded as `"Curated Contextual Associations Repository"`

---

## 4. Google Books Ngram Corpus (Release `20200217`, English Version 3 — Tier-4 Pilot)

Statistical collocation evidence in the Milestone 7A pilot is derived from the official Google Books Ngram Dataset (Version 3, Release `20200217`, English `eng`).

### Source, Licensing & Attribution
- **Source**: Google Books Ngram Dataset, Version 3 (`20200217`), English (`eng`)
- **Official Download Endpoint**: https://storage.googleapis.com/books/ngrams/books/20200217/eng/ (`datasetsv3.html`, `totalcounts-1`, `totalcounts-2`, `1-*-of-00024.gz`, `2-*-of-00589.gz`)
- **License**: Creative Commons Attribution 3.0 Unported License (CC BY 3.0) — https://creativecommons.org/licenses/by/3.0/
- **Attribution**: Derived from Google Books Ngram Viewer corpus data (Lin et al., 2012 / Michel et al., 2011; Google Books Release `20200217`), used under CC BY 3.0.
- **Temporal Scope**: Books published between **1950 and 2019** (the 70-year modern window uniquely supported up to 2019 by Release `20200217`; Version 2 `20120701` terminates at 2009).

### Observed Empirical Format, Filtering & Double-Counting Safeguards
- **Verified TSV Record Layout**: Each decompressed TSV line follows `ngram TAB year,match_count,volume_count TAB ...` (note: although `datasetsv3.html` documentation prose references a fourth `page_count` value, actual `20200217` gzip shards emit two count values per year: `match_count` and `volume_count`).
- **Corpus-Level Minimum Cutoff**: Google exports only n-grams appearing more than **40 times** across the full corpus (`> 40`), whereas `totalcounts-1` and `totalcounts-2` include all rare tokens omitted from shard exports.
- **POS-Tagged Overlap Exclusion**: Release `20200217` includes both untagged surface entries (e.g., `plastic smile`) and overlapping POS-tagged disaggregations (e.g., `plastic_ADJ smile_NOUN`, `plastic smile_NOUN`). Summing tagged and untagged entries introduces 2×–4× double-counting; therefore primary pilot compilation retains **untagged entries only** (`!ngram.includes('_')`), aggregating capitalization variants cleanly while auditing skipped POS-tagged records.
- **Statistical & Lexical Filters**: Pure alphabetic tokens `[a-zA-Z]{2,20}` matched against the general WordNet 3.0 + Moby + Morphology vocabulary; closed-class function stopwords excluded; collocations evaluated with year-stratified expectation $E_{\text{strat}}$, Pointwise Mutual Information ($\mathrm{PMI}_{\text{strat}} \ge 2.0$), $t$-score ($t_{\text{strat}} \ge 2.0$), and minimum corpus frequency ($\ge 500$).
- **Provenance Separation**: Runtime corpus matches are labeled distinctly with `sourceDataset` identifying Google Books Ngrams `20200217`, explicit `empiricalFrequency`, `pmi`, `tScore`, and `orderRatio`, alongside a conservative Tier-4 heuristic ranking index (`[0.62, 0.88]`).

