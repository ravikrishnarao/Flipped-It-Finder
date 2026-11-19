# Flipit Finder V3 — Dataset Provenance & Licensing Documentation

This document records the exact sources, download locations, versions, licences, permissions, and redistribution requirements for all external datasets ingested into the Flipit Finder V3 offline compilation pipeline.

---

## 1. Princeton WordNet 3.0

- **Dataset Name**: Princeton WordNet 3.0
- **Authors / Custodian**: Cognitive Science Laboratory, Princeton University (George A. Miller, Christiane Fellbaum, et al.)
- **Release Date**: 2006 (Version 3.0)
- **Official Download URL**: `https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz`
- **Official Website**: `https://wordnet.princeton.edu/`
- **Licence**: WordNet 3.0 License (Permissive BSD-style)
- **Licence Text & Terms**:
  ```text
  WordNet Release 3.0

  This software and database is being provided to you, the LICENSEE, by Princeton
  University under the following license.  By obtaining, using and/or copying this
  software and database, you agree that you have read, understood, and will comply
  with these terms and conditions.:

  Permission to use, copy, modify and distribute this software and database and its
  documentation for any purpose and without fee or royalty is hereby granted,
  provided that you agree to comply with the following copyright notice and statements,
  including the disclaimer, and that the same appear on ALL copies of the software,
  database and documentation, including modifications that you make for internal
  use or for distribution.

  WordNet 3.0 Copyright 2006 by Princeton University.  All rights reserved.

  THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY
  MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED.  BY WAY OF EXAMPLE,
  BUT NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES
  OF MERCHANT- ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF THE
  LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD PARTY
  PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
  ```
- **Commercial Use Permissions**: Explicitly permitted without fee or royalty.
- **Redistribution Requirements**: 
  1. The copyright notice (*"WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved."*) must appear on all copies of the software, database, and documentation.
  2. The disclaimer must be retained.
  3. The name of Princeton University may not be used in advertising or publicity without prior written permission.
- **Artifacts Ingested**:
  - `dict/data.noun`, `dict/data.verb`, `dict/data.adj`, `dict/data.adv` (synsets, pointers, glosses)
  - `dict/index.noun`, `dict/index.verb`, `dict/index.adj`, `dict/index.adv` (lemmas, sense counts)
  - `dict/noun.exc`, `dict/verb.exc`, `dict/adj.exc` (morphological exception lists)
- **Role in Flipit Finder V3**:
  - **Lexical Relationships**: Primary source for direct synonyms, direct antonyms, derivational morphology, hypernym/hyponym hierarchies, and bounded coordinate terms (sister synsets sharing specific parents).
  - **Collocations & Multi-Word Expressions**: Extracted from WordNet index files (`index.noun`, `index.adj`, `index.verb`) providing 60,468 verified two-word collocations, dictionary idioms, and decomposed closed compound words partitioned across 26 letter files (`collocations_a.json` .. `collocations_z.json`, 9.62 MB total).

---

## 2. Moby Thesaurus II

- **Dataset Name**: Moby Thesaurus II (part of the Moby Lexicon Project)
- **Author / Compiler**: Grady Ward
- **Release Date**: 1996; Dedicated to the Public Domain in January 2001
- **Official Download URL**: Project Gutenberg eBook #3202 (`https://www.gutenberg.org/files/3202/files/mthesaur.txt`)
- **Licence**: Public Domain (Author Grant, January 2001)
- **Licence Grant Statement**:
  ```text
  The Moby lexicon project is complete and has been placed in the public domain.
  There are no restrictions on its use of any kind.
  Grady Ward, January 2001.
  ```
- **Commercial Use Permissions**: Permitted without royalty, fee, or copyright restriction.
- **Redistribution Requirements**: Raw data is unencumbered. When distributed outside Project Gutenberg, Project Gutenberg trademark/wrapper text is removed.
- **Artifacts Ingested**: `mthesaur.txt` (30,259 root words, ~2.5 million comma-separated association links).
- **Role in Flipit Finder V3**: Contextual associations, functional tool pairings, common activities, and complementary concepts not explicitly captured by formal WordNet synset pointers.

---

## 3. Moby Compound Words

- **Dataset Name**: Moby Words II / Compound Words (`compound.txt`)
- **Author / Compiler**: Grady Ward (Moby Lexicon Project)
- **Release Date**: 1996; Dedicated to the Public Domain in January 2001
- **Official Download URL**: Project Gutenberg eBook #3201 (`https://www.gutenberg.org/files/3201/files/compound.txt`)
- **Licence**: Public Domain (Author Grant, January 2001)
- **Commercial Use Permissions**: Permitted without restriction.
- **Redistribution Requirements**: None for raw word lists.
- **Artifacts Ingested**: `compound.txt` (256,772 multi-word expressions, hyphenated terms, and compounds).
- **Role in Flipit Finder V3**: Recognition of open compounds, hyphenated phrases, and compound nouns.

---

## 4. Deferred Datasets (Subject to Future Verification)

In strict accordance with the user's architectural instructions, the following datasets are **NOT downloaded, packaged, or ingested** in Milestone 1:

1. **USF Free Association Norms (Nelson, McEvoy, & Schreiber 1998/2004)**:
   - *Status*: **DEFERRED**.
   - *Rationale*: Requires primary source archive verification to confirm whether commercial redistribution terms permit bundling inside a production application without academic-only restrictions.
2. **Google Web Trillion Word Corpus 2-Gram Frequency Data**:
   - *Status*: **DEFERRED**.
   - *Rationale*: Requires direct verification of the underlying Google Books / Web 1T dataset licensing terms and secondary curation rights before packaging corpus statistics.

---

## 5. Offline Operation & Caching Strategy

The V3 engine distinguishes between three operational tiers:
1. **Offline Dataset Compilation**: Build-time scripts execute locally, ingesting raw files and emitting compact, indexed JSON partitions into `data/v3/compiled/`.
2. **Static Web Asset Loading**: The client application loads partitioned JSON chunks on-demand via standard browser `fetch` or dynamic import based on clue starting letters.
3. **Genuine Offline Browser Operation**: A Service Worker caches the partitioned chunks in the browser's Cache API upon initial access, enabling 100% offline solving thereafter without internet connectivity.
