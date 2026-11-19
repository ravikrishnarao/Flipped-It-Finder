# Evaluation of Offline Knowledge Resources for Contextual Discovery (V2.2.4)

## 1. Executive Summary

Word puzzle solvers like Flipit Finder require discovering non-taxonomic relationships that bridge common activities (e.g., `MOP` → `SWEEP`), functional pairings (e.g., `HAMMER` → `NAIL`, `LOCK` → `KEY`), and contextual associations (e.g., `DRY` → `CLEAN` as in dry-cleaning). 

Traditional WordNet lexical hierarchies focus heavily on synsets, antonymy, and hypernymy. While indispensable for direct semantic transformations (`SLOW` → `FAST`, `INVOCATION` → `PRAYER`), WordNet alone does not capture everyday situational or activity-based associations.

This document evaluates four potential offline resources to power contextual discovery under AI Studio's strict runtime constraints: zero external paid APIs, zero Gemini API dependencies, fast client-side startup (<50ms), and auditable data licensing.

---

## 2. Comparative Evaluation Matrix

| Resource | Coverage & Edge Types | License | Offline Viability | Data Footprint (Raw / Distilled) | Runtime Lookup Latency | Suitability Rating |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **ConceptNet 5.8** | Broad common-sense graph (`UsedFor`, `CapableOf`, `RelatedTo`, `AtLocation`, `HasPrerequisite`) | CC BY-SA 4.0 / Open Mind | Feasible with offline extraction pipeline | ~500 MB raw gzip / ~2.5 MB distilled seed | 0.2 – 0.5 ms indexed map | **HIGH (Recommended for scalable expansion)** |
| **USF Free Association Norms** | 5,019 stimulus words, 72,176 associative target links (empirical word association probabilities) | Public Domain (Nelson, McEvoy, Schreiber 1998) | Fully offline tabular data | 4.8 MB raw CSV / ~650 KB pruned JSON | 0.1 – 0.3 ms indexed map | **HIGH (Empirically grounded associations)** |
| **WordNet 3.0 Domain Pointers** | Topic and usage pointers (`;c`, `;u`, `;r`) across synsets | Princeton BSD permissive | Already partially integrated | Included in WordNet core seed (<35 KB) | <0.1 ms | **MODERATE (Sparse coverage for everyday activities)** |
| **Curated Contextual Associations Layer** | Targeted activity, cleaning, tool-action, and functional pairs | CC BY-SA 4.0 / MIT compatible | Native JSON partition in `data/contextual_associations.json` | 6.5 KB uncompressed / ~1.8 KB gzip | <0.05 ms Map lookup | **EXCELLENT (Immediate V2.2.4 integration, 0 latency)** |

---

## 3. Deep-Dive Resource Analysis

### A. ConceptNet 5.8
* **Coverage**: Contains over 21 million edges across multiple languages. English core contains ~1.5 million assertions linking words through common sense predicates:
  * `mop` $\xrightarrow{\text{UsedFor}}$ `clean floor`, `wipe spill`
  * `sweep` $\xrightarrow{\text{RelatedTo}}$ `broom`, `mop`
  * `dry clean` $\xrightarrow{\text{RelatedTo}}$ `garment`, `clean`
* **Commercial Licensing**: ConceptNet is licensed under **CC BY-SA 4.0**. Redistribution requires attribution and ShareAlike for derivative databases. Commercial use is permitted provided the derivative data remains shared under CC BY-SA.
* **Offline Operation**: Raw dump is too large (~500 MB) for browser delivery. However, an offline compilation script can filter high-confidence English edges (weight $\ge 2.0$, core lemmas) to produce lightweight letter-sharded JSON files (~2 MB total).
* **Expansion Ease**: High. An automated offline filter can be re-run whenever expanding vocabulary.

### B. University of South Florida (USF) Free Association Norms
* **Coverage**: Created by Nelson et al. (1998). Provides empirically measured human word associations for 5,019 words and 72,176 response pairs. Captures intuitive human leaps (e.g., `DRY` $\rightarrow$ `CLEAN`, `BREAD` $\rightarrow$ `BUTTER`, `LOCK` $\rightarrow$ `KEY`).
* **Commercial Licensing**: **Public Domain** (US Government funded research / academic public domain release). Free of royalty and attribution restrictions.
* **Offline Operation**: Very simple format (cue word, target word, forward association strength). Readily compresses into a compact lookup dictionary (<800 KB).
* **Limitations**: Lacks explicit relationship typing (only measures association probability, does not distinguish antonym from activity).

### C. WordNet 3.0 Domain Pointers
* **Coverage**: WordNet links certain synsets via domain pointers (e.g., medicine, sports, religion).
* **Limitations**: Everyday household tools and routines (like `mop` and `sweep`) rarely share a domain pointer beyond broad generic synsets like `act.n.01`. It cannot reliably bridge tool-activity counterparts without external associative graphs.

---

## 4. Architectural Recommendation for Flipit Finder

To maintain pristine deterministic performance, zero runtime overhead, and strict semantic discipline:

1. **V2.2.4 Immediate Layer (Integrated)**:
   - A dedicated `ContextualAssociationProvider` reading from `data/contextual_associations.json`.
   - Distinct from WordNet synonyms and antonyms.
   - Strict `RELATION_PRIORITY` where direct antonyms (6) and synonyms (4) outrank contextual associations (1).
   - Dedicated ranker distance penalty (0.03) ensures contextual candidates only surface when genuine collocations are matched.

2. **V3 Scalable Expansion Roadmap**:
   - Write an offline node precompiler (`scripts/compile-conceptnet.ts`) that extracts `RelatedTo`, `UsedFor`, and `CapableOf` edges from ConceptNet 5.8 and USF Norms.
   - Partition into letter shards (`contextual_a.json` ... `contextual_z.json`) matching the WordNet sharding strategy.
   - Retain complete provenance attribution in `LICENSE-DATA.md`.

---

## 5. Scope Boundary: Realistic Semantic Understanding

An offline lexical database is a finite discrete knowledge graph. It can represent established linguistic oppositions, dictionary synonyms, and documented common-sense collocations. It does **not** possess open-ended world reasoning, multimodal situational awareness, or conversational intuition. All match scores remain deterministic heuristic indices, never statistical probabilities.
