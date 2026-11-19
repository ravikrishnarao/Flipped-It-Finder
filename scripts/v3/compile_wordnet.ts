/**
 * Flipit Finder V3 — Princeton WordNet 3.0 Compiler
 * Ingests raw WordNet 3.0 dict files (noun, verb, adj, adv), parses synsets,
 * extracts direct antonyms, synonyms, derivations, and bounded coordinate terms
 * (sister synsets with depth and specificity constraints), and emits compact
 * letter-partitioned JSON files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface SynsetPointer {
  symbol: string;
  targetOffset: string;
  pos: string;
  sourceTarget: string; // 4 hex digits: ss tt (source word index, target word index)
}

interface Synset {
  offset: string;
  pos: string; // 'n', 'v', 'a', 's', 'r'
  words: string[];
  rawWords: string[];
  pointers: SynsetPointer[];
  gloss: string;
  depth?: number;
  hypernymOffsets: string[];
  hyponymOffsets: string[];
}

export interface WordRelationEntry {
  word: string;
  score: number;
  reason: string;
  relationType:
    | 'antonym'
    | 'synonym'
    | 'counterpart'
    | 'coordinate'
    | 'derivation'
    | 'hierarchical'
    | 'associated';
  source: string;
}

export interface CompiledWordEntry {
  synonyms: WordRelationEntry[];
  antonyms: WordRelationEntry[];
  coordinates: WordRelationEntry[];
  hierarchical: WordRelationEntry[];
  derivations: WordRelationEntry[];
}

const ROOT_DIR = path.resolve(process.cwd());
const WORDNET_DICT_DIR = path.join(ROOT_DIR, 'data/v3/raw/wordnet/dict');
const OUTPUT_DIR = path.join(ROOT_DIR, 'data/v3/compiled/wordnet');

function cleanLemma(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').replace(/_/g, ' ').trim().toUpperCase();
}

function isValidSingleWord(lemma: string): boolean {
  return /^[A-Z]{2,20}$/.test(lemma);
}

function extractCleanHeadWords(syn: Synset, allowTwoWordHeads: boolean): string[] {
  const result = new Set<string>();
  for (let i = 0; i < syn.words.length; i++) {
    const w = syn.words[i];
    if (isValidSingleWord(w)) {
      result.add(w);
    } else if (allowTwoWordHeads) {
      const raw = syn.rawWords[i] || '';
      // Exclude capitalized proper nouns and Latin taxonomic binomials (e.g., Felis_silvestris)
      if (/[A-Z]/.test(raw)) continue;
      const parts = raw.split('_');
      if (parts.length === 2) {
        const head = parts[1].replace(/[^a-zA-Z]/g, '').toUpperCase();
        if (isValidSingleWord(head)) {
          result.add(head);
        }
      }
    }
  }
  return Array.from(result);
}

export async function compileWordNet() {
  console.log('======================================================================');
  console.log(' Flipit Finder V3: Compiling Princeton WordNet 3.0');
  console.log('======================================================================');

  if (!fs.existsSync(WORDNET_DICT_DIR)) {
    throw new Error(`WordNet dict directory not found at ${WORDNET_DICT_DIR}. Run download script first.`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const synsetMap = new Map<string, Synset>(); // key: `${offset}_${pos}`
  const lemmaToSynsetKeys = new Map<string, Set<string>>();
  const nounSynsetCount = new Map<string, number>();
  const adjSynsetCount = new Map<string, number>();

  const posFiles: Array<{ pos: string; file: string }> = [
    { pos: 'n', file: 'data.noun' },
    { pos: 'v', file: 'data.verb' },
    { pos: 'a', file: 'data.adj' },
    { pos: 'r', file: 'data.adv' },
  ];

  console.log('[1/5] Ingesting and parsing WordNet synset data files...');
  let totalRawSynsets = 0;

  for (const { pos, file } of posFiles) {
    const filePath = path.join(WORDNET_DICT_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: Missing ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line || line.startsWith('  ')) continue; // Skip header comments

      const pipeIdx = line.indexOf('|');
      const dataPart = pipeIdx !== -1 ? line.slice(0, pipeIdx).trim() : line.trim();
      const gloss = pipeIdx !== -1 ? line.slice(pipeIdx + 1).trim() : '';

      const tokens = dataPart.split(/\s+/);
      if (tokens.length < 4) continue;

      const offset = tokens[0];
      const wCnt = parseInt(tokens[3], 16);
      if (isNaN(wCnt) || wCnt <= 0) continue;

      const words: string[] = [];
      const rawWords: string[] = [];
      let tokenIdx = 4;
      for (let i = 0; i < wCnt; i++) {
        if (tokenIdx >= tokens.length) break;
        const lemma = tokens[tokenIdx];
        tokenIdx += 2; // skip lex_id
        const clean = cleanLemma(lemma);
        if (clean) {
          words.push(clean);
          rawWords.push(lemma);
        }
      }

      if (tokenIdx >= tokens.length) continue;
      const pCnt = parseInt(tokens[tokenIdx], 10);
      tokenIdx++;

      const pointers: SynsetPointer[] = [];
      const hypernymOffsets: string[] = [];
      const hyponymOffsets: string[] = [];

      for (let i = 0; i < pCnt; i++) {
        if (tokenIdx + 3 >= tokens.length) break;
        const symbol = tokens[tokenIdx];
        const targetOffset = tokens[tokenIdx + 1];
        const targetPos = tokens[tokenIdx + 2];
        const sourceTarget = tokens[tokenIdx + 3];
        tokenIdx += 4;

        pointers.push({ symbol, targetOffset, pos: targetPos, sourceTarget });

        if (symbol === '@' || symbol === '@i') {
          hypernymOffsets.push(`${targetOffset}_${targetPos}`);
        } else if (symbol === '~' || symbol === '~i') {
          hyponymOffsets.push(`${targetOffset}_${targetPos}`);
        }
      }

      const key = `${offset}_${pos}`;
      const synset: Synset = {
        offset,
        pos,
        words,
        rawWords,
        pointers,
        gloss,
        hypernymOffsets,
        hyponymOffsets,
      };

      synsetMap.set(key, synset);
      totalRawSynsets++;

      for (const w of words) {
        if (isValidSingleWord(w)) {
          if (!lemmaToSynsetKeys.has(w)) {
            lemmaToSynsetKeys.set(w, new Set());
          }
          lemmaToSynsetKeys.get(w)!.add(key);
          if (pos === 'n') {
            nounSynsetCount.set(w, (nounSynsetCount.get(w) ?? 0) + 1);
          } else if (pos === 'a' || pos === 's') {
            adjSynsetCount.set(w, (adjSynsetCount.get(w) ?? 0) + 1);
          }
        }
      }
    }
  }

  console.log(`[✓] Parsed ${totalRawSynsets} raw synsets covering ${lemmaToSynsetKeys.size} unique single-word lemmas.`);

  // [2/5] Compute tree depths for noun AND verb hypernym specificity calculation (memoized)
  console.log('[2/5] Computing synset hierarchical depths for noun & verb coordinate bounding...');
  const depthMemo = new Map<string, number>();
  function getDepth(key: string, visiting = new Set<string>()): number {
    const cached = depthMemo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0; // prevent cycles
    visiting.add(key);
    const syn = synsetMap.get(key);
    if (!syn || syn.hypernymOffsets.length === 0) {
      visiting.delete(key);
      depthMemo.set(key, 1);
      return 1;
    }
    let maxParentDepth = 0;
    for (const hKey of syn.hypernymOffsets) {
      const d = getDepth(hKey, visiting);
      if (d > maxParentDepth) maxParentDepth = d;
    }
    visiting.delete(key);
    const result = maxParentDepth + 1;
    depthMemo.set(key, result);
    return result;
  }

  for (const [key, syn] of synsetMap.entries()) {
    if (syn.pos === 'n' || syn.pos === 'v') {
      syn.depth = getDepth(key);
    }
  }

  // Precompute structural adjacency maps (hypernym->children, whole->parts, head->satellites)
  const hypernymToHyponyms = new Map<string, Set<string>>();
  const wholeToPartKeys = new Map<string, Set<string>>();
  const headToSatelliteCount = new Map<string, number>();

  for (const [key, syn] of synsetMap.entries()) {
    for (const parentKey of syn.hypernymOffsets) {
      if (!hypernymToHyponyms.has(parentKey)) {
        hypernymToHyponyms.set(parentKey, new Set());
      }
      hypernymToHyponyms.get(parentKey)!.add(key);
    }
    for (const ptr of syn.pointers) {
      const targetKey = `${ptr.targetOffset}_${ptr.pos}`;
      if (ptr.symbol === '%p') {
        if (!wholeToPartKeys.has(key)) {
          wholeToPartKeys.set(key, new Set());
        }
        wholeToPartKeys.get(key)!.add(targetKey);
      } else if (ptr.symbol === '&') {
        headToSatelliteCount.set(targetKey, (headToSatelliteCount.get(targetKey) ?? 0) + 1);
      }
    }
  }

  // [3/5] Extract Lexical Relations
  console.log('[3/5] Extracting antonyms, adjective clusters, synonyms, derivations, meronyms, and bounded coordinates...');
  const wordStore = new Map<string, CompiledWordEntry>();

  interface CoordCandidate {
    entry: WordRelationEntry;
    groupKey: string;
    priority: number;
    centrality: number;
  }
  const coordPool = new Map<string, CoordCandidate[]>();
  const adjSimCount = new Map<string, number>();
  const dumbbellAntCount = new Map<string, number>();
  const assocDerivCount = new Map<string, number>();

  function getOrCreateWord(w: string): CompiledWordEntry {
    let entry = wordStore.get(w);
    if (!entry) {
      entry = { synonyms: [], antonyms: [], coordinates: [], hierarchical: [], derivations: [] };
      wordStore.set(w, entry);
    }
    return entry;
  }

  function addCoordCandidate(word: string, candidate: CoordCandidate) {
    if (!coordPool.has(word)) {
      coordPool.set(word, []);
    }
    coordPool.get(word)!.push(candidate);
  }

  let antonymCount = 0;
  let synonymCount = 0;
  let derivationCount = 0;
  let coordinateCount = 0;
  let hierarchicalCount = 0;

  // A. Direct Synonyms, Antonyms, Adjective Clusters (&, ^, dumbbell &+!), Derivations, Hypernyms, and Meronyms (#p/%p)
  for (const [synKey, syn] of synsetMap.entries()) {
    const validWords = syn.words.filter(isValidSingleWord);
    if (validWords.length > 1) {
      for (let i = 0; i < validWords.length; i++) {
        for (let j = 0; j < validWords.length; j++) {
          if (i === j) continue;
          const w1 = validWords[i];
          const w2 = validWords[j];
          const entry = getOrCreateWord(w1);
          if (!entry.synonyms.some((e) => e.word === w2)) {
            entry.synonyms.push({
              word: w2,
              score: 0.95,
              reason: `WordNet synset synonym (${syn.gloss.slice(0, 70)})`,
              relationType: 'synonym',
              source: 'WordNet 3.0',
            });
            synonymCount++;
          }
        }
      }
    }

    for (const ptr of syn.pointers) {
      const targetKey = `${ptr.targetOffset}_${ptr.pos}`;
      const targetSyn = synsetMap.get(targetKey);
      if (!targetSyn) continue;

      if (ptr.symbol === '!') {
        const srcIdx = parseInt(ptr.sourceTarget.slice(0, 2), 16);
        const tgtIdx = parseInt(ptr.sourceTarget.slice(2, 4), 16);

        if (srcIdx > 0 && tgtIdx > 0 && srcIdx <= syn.words.length && tgtIdx <= targetSyn.words.length) {
          const w1 = syn.words[srcIdx - 1];
          const w2 = targetSyn.words[tgtIdx - 1];
          if (isValidSingleWord(w1) && isValidSingleWord(w2)) {
            const entry1 = getOrCreateWord(w1);
            if (!entry1.antonyms.some((e) => e.word === w2)) {
              entry1.antonyms.push({
                word: w2,
                score: 0.99,
                reason: `WordNet direct antonym of ${w1}`,
                relationType: 'antonym',
                source: 'WordNet 3.0',
              });
              antonymCount++;
            }

            for (let k = 0; k < targetSyn.words.length; k++) {
              if (k === tgtIdx - 1) continue;
              const wOther = targetSyn.words[k];
              if (isValidSingleWord(wOther) && wOther !== w1) {
                if (!entry1.antonyms.some((e) => e.word === wOther)) {
                  entry1.antonyms.push({
                    word: wOther,
                    score: 0.97,
                    reason: `WordNet antonymous synset counterpart of ${w1}`,
                    relationType: 'antonym',
                    source: 'WordNet 3.0',
                  });
                  antonymCount++;
                }
                const entryOther = getOrCreateWord(wOther);
                if (!entryOther.antonyms.some((e) => e.word === w1)) {
                  entryOther.antonyms.push({
                    word: w1,
                    score: 0.97,
                    reason: `WordNet antonymous synset counterpart of ${wOther}`,
                    relationType: 'antonym',
                    source: 'WordNet 3.0',
                  });
                  antonymCount++;
                }
              }
            }

            const entry2 = getOrCreateWord(w2);
            if (!entry2.antonyms.some((e) => e.word === w1)) {
              entry2.antonyms.push({
                word: w1,
                score: 0.99,
                reason: `WordNet direct antonym of ${w2}`,
                relationType: 'antonym',
                source: 'WordNet 3.0',
              });
              antonymCount++;
            }
          }
        } else {
          for (const w1 of validWords) {
            for (const w2 of targetSyn.words.filter(isValidSingleWord)) {
              if (w1 === w2) continue;
              const entry = getOrCreateWord(w1);
              if (!entry.antonyms.some((e) => e.word === w2)) {
                entry.antonyms.push({
                  word: w2,
                  score: 0.98,
                  reason: `WordNet synset-level antonym of ${w1}`,
                  relationType: 'antonym',
                  source: 'WordNet 3.0',
                });
                antonymCount++;
              }
            }
          }
        }
      } else if (ptr.symbol === '&') {
        // Adjective "similar to" (&) restricted to non-noun adjectives with tight per-word cap
        // Prevents noun-dominant words (e.g., LIVER, SALT, ORANGE) from picking up obscure adjective-satellite senses
        const targetWords = targetSyn.words.filter(isValidSingleWord);

        for (const w1 of validWords) {
          if ((nounSynsetCount.get(w1) ?? 0) > 0 || (adjSynsetCount.get(w1) ?? 0) === 0) continue;
          const curSim = adjSimCount.get(w1) ?? 0;
          if (curSim >= 16) continue;

          const entry = getOrCreateWord(w1);
          for (const w2 of targetWords) {
            if ((adjSimCount.get(w1) ?? 0) >= 16) break;
            if (w1 === w2) continue;
            if (!entry.synonyms.some((e) => e.word === w2)) {
              entry.synonyms.push({
                word: w2,
                score: 0.88,
                reason: `WordNet adjective similar-to (&) link (${w1} ↔ ${w2})`,
                relationType: 'synonym',
                source: 'WordNet 3.0',
              });
              synonymCount++;
              adjSimCount.set(w1, (adjSimCount.get(w1) ?? 0) + 1);
            }
          }
        }

        // Dumbbell adjective cluster antonym propagation (satellite -> opposite head only):
        // Restricted to non-noun adjectives on tight clusters (<= 6 satellites) with <= 3 per word
        const headName = targetSyn.words[0] || 'HEAD';
        const satCountOnHead = headToSatelliteCount.get(targetKey) ?? 0;
        if (satCountOnHead <= 6) {
          for (const hPtr of targetSyn.pointers) {
            if (hPtr.symbol !== '!') continue;
            const oppKey = `${hPtr.targetOffset}_${hPtr.pos}`;
            const oppSyn = synsetMap.get(oppKey);
            if (!oppSyn) continue;

            const oppWords = oppSyn.words.filter(isValidSingleWord);
            for (const wSat of validWords) {
              if ((nounSynsetCount.get(wSat) ?? 0) > 0 || (adjSynsetCount.get(wSat) ?? 0) === 0) continue;
              if ((dumbbellAntCount.get(wSat) ?? 0) >= 3) continue;

              const satEntry = getOrCreateWord(wSat);
              for (const wOpp of oppWords) {
                if ((dumbbellAntCount.get(wSat) ?? 0) >= 3) break;
                if (wSat === wOpp) continue;
                if (!satEntry.antonyms.some((e) => e.word === wOpp)) {
                  satEntry.antonyms.push({
                    word: wOpp,
                    score: 0.91,
                    reason: `WordNet adjective satellite antonym (via cluster head ${headName})`,
                    relationType: 'antonym',
                    source: 'WordNet 3.0',
                  });
                  antonymCount++;
                  dumbbellAntCount.set(wSat, (dumbbellAntCount.get(wSat) ?? 0) + 1);
                }
              }
            }
          }
        }
      } else if (ptr.symbol === '+') {
        const srcIdx = parseInt(ptr.sourceTarget.slice(0, 2), 16);
        const tgtIdx = parseInt(ptr.sourceTarget.slice(2, 4), 16);

        if (srcIdx > 0 && tgtIdx > 0 && srcIdx <= syn.words.length && tgtIdx <= targetSyn.words.length) {
          const w1 = syn.words[srcIdx - 1];
          const w2 = targetSyn.words[tgtIdx - 1];
          if (isValidSingleWord(w1) && isValidSingleWord(w2) && w1 !== w2) {
            const entry1 = getOrCreateWord(w1);
            if (!entry1.derivations.some((e) => e.word === w2)) {
              entry1.derivations.push({
                word: w2,
                score: 0.88,
                reason: `WordNet derivationally related form (${w1} ↔ ${w2})`,
                relationType: 'derivation',
                source: 'WordNet 3.0',
              });
              derivationCount++;
            }
          }
        }
      } else if (ptr.symbol === '@' || ptr.symbol === '@i') {
        for (const w1 of validWords) {
          for (const w2 of targetSyn.words.filter(isValidSingleWord)) {
            if (w1 === w2) continue;
            const entry = getOrCreateWord(w1);
            if (entry.hierarchical.length < 10 && !entry.hierarchical.some((e) => e.word === w2)) {
              entry.hierarchical.push({
                word: w2,
                score: 0.86,
                reason: `WordNet direct hypernym of ${w1} (${targetSyn.gloss.slice(0, 60)})`,
                relationType: 'hierarchical',
                source: 'WordNet 3.0',
              });
              hierarchicalCount++;
            }
          }
        }

        // 1-hop hypernym co-part-meronym bridge (e.g., WEEKDAY @ DAY_OF_THE_WEEK, WEEK %p WEEKEND)
        for (const hPtr of targetSyn.pointers) {
          if (hPtr.symbol !== '#p') continue;
          const wholeKey = `${hPtr.targetOffset}_${hPtr.pos}`;
          const wholeSyn = synsetMap.get(wholeKey);
          const partKeys = wholeToPartKeys.get(wholeKey);
          if (!wholeSyn || !partKeys || partKeys.size < 2 || partKeys.size > 8) continue;

          const wholeName = wholeSyn.words[0] || 'WHOLE';
          const hyperName = targetSyn.words[0] || 'PARENT';
          for (const pk of partKeys) {
            if (pk === targetKey) continue;
            const partSyn = synsetMap.get(pk);
            if (!partSyn) continue;
            for (const w1 of syn.words.filter(isValidSingleWord)) {
              for (const w2 of partSyn.words.filter(isValidSingleWord)) {
                if (w1 === w2) continue;
                addCoordCandidate(w1, {
                  groupKey: `hmp_${wholeKey}`,
                  priority: 750 - partKeys.size * 5,
                  centrality: partSyn.hyponymOffsets.length,
                  entry: {
                    word: w2,
                    score: 0.84,
                    reason: `WordNet co-part-meronym via ${hyperName} (parts of "${wholeName}" at depth 7)`,
                    relationType: 'coordinate',
                    source: 'WordNet 3.0',
                  },
                });
              }
            }
          }
        }
      } else if (ptr.symbol === '#p' || ptr.symbol === '%p') {
        // Direct Part Holonyms (#p, <= 8 parts) and Part Meronyms (%p, <= 6 parts) with tight cap
        const wholeKey = ptr.symbol === '#p' ? targetKey : synKey;
        const partCount = wholeToPartKeys.get(wholeKey)?.size ?? 0;
        const maxParts = ptr.symbol === '#p' ? 8 : 6;
        const maxHier = ptr.symbol === '#p' ? 8 : 6;
        if (partCount <= maxParts) {
          const roleLabel = ptr.symbol === '#p' ? 'part holonym (#p)' : 'part meronym (%p)';
          for (const w1 of validWords) {
            for (const w2 of targetSyn.words.filter(isValidSingleWord)) {
              if (w1 === w2) continue;
              const entry = getOrCreateWord(w1);
              if (entry.hierarchical.length < maxHier && !entry.hierarchical.some((e) => e.word === w2)) {
                entry.hierarchical.push({
                  word: w2,
                  score: 0.84,
                  reason: `WordNet ${roleLabel} of ${w1} (${targetSyn.gloss.slice(0, 55)})`,
                  relationType: 'hierarchical',
                  source: 'WordNet 3.0',
                });
                hierarchicalCount++;
              }
            }
          }
        }
      } else if (ptr.symbol === '~' || ptr.symbol === '~i') {
        // Bounded hyponym -> part holonym bridge (e.g., WEEKDAY ~ SATURDAY #p WEEKEND)
        const myChildCount = hypernymToHyponyms.get(synKey)?.size ?? 0;
        if (myChildCount <= 12) {
          for (const cPtr of targetSyn.pointers) {
            if (cPtr.symbol !== '#p') continue;
            const wKey = `${cPtr.targetOffset}_${cPtr.pos}`;
            const wSyn = synsetMap.get(wKey);
            const wPartCount = wholeToPartKeys.get(wKey)?.size ?? 0;
            if (!wSyn || wPartCount > 8) continue;
            const childName = targetSyn.words[0] || 'MEMBER';
            for (const w1 of syn.words.filter(isValidSingleWord)) {
              for (const w2 of wSyn.words.filter(isValidSingleWord)) {
                if (w1 === w2) continue;
                addCoordCandidate(w1, {
                  groupKey: `hypo_holo_${wKey}`,
                  priority: 720,
                  centrality: wSyn.hyponymOffsets.length,
                  entry: {
                    word: w2,
                    score: 0.83,
                    reason: `WordNet co-part holonym via hyponym "${childName}" (at depth 7)`,
                    relationType: 'coordinate',
                    source: 'WordNet 3.0',
                  },
                });
              }
            }
          }
        }
      }
    }
  }

  // Co-part-meronyms sharing a tightly bounded whole (%p siblings, 2..15 parts)
  for (const [wholeKey, partSet] of wholeToPartKeys.entries()) {
    if (partSet.size < 2 || partSet.size > 15) continue;
    const wholeSyn = synsetMap.get(wholeKey);
    if (!wholeSyn) continue;
    const wholeName = wholeSyn.words[0] || 'WHOLE';
    const partArr = Array.from(partSet);

    for (let i = 0; i < partArr.length; i++) {
      const synA = synsetMap.get(partArr[i]);
      if (!synA) continue;
      const wordsA = synA.words.filter(isValidSingleWord);
      for (let j = 0; j < partArr.length; j++) {
        if (i === j) continue;
        const synB = synsetMap.get(partArr[j]);
        if (!synB) continue;
        const wordsB = synB.words.filter(isValidSingleWord);
        for (const wA of wordsA) {
          for (const wB of wordsB) {
            if (wA === wB) continue;
            addCoordCandidate(wA, {
              groupKey: `mer_${wholeKey}`,
              priority: 820 - partSet.size * 5,
              centrality: synB.hyponymOffsets.length,
              entry: {
                word: wB,
                score: 0.85,
                reason: `WordNet co-part-meronym (parts of "${wholeName}" at depth 8)`,
                relationType: 'coordinate',
                source: 'WordNet 3.0',
              },
            });
          }
        }
      }
    }
  }

  // B. WordNet Coordinate Terms (Noun depth >= 4 & childCount 2..35; Verb depth >= 2 & childCount 2..12)
  // Plus bounded deep artifact coordinate -> derivation functional verb bridge (depth >= 7, childCount 2..8)
  console.log('[4/5] Extracting balanced multi-sense coordinates (nouns depth>=4, verbs depth>=2) & functional bridges...');

  for (const [parentKey, childSet] of hypernymToHyponyms.entries()) {
    const parentSyn = synsetMap.get(parentKey);
    if (!parentSyn) continue;

    const childCount = childSet.size;
    const depth = parentSyn.depth ?? 0;

    const isNounCoord = parentSyn.pos === 'n' && depth >= 4 && childCount >= 2 && childCount <= 35;
    const isVerbCoord = parentSyn.pos === 'v' && depth >= 4 && childCount >= 2 && childCount <= 6;
    if (!isNounCoord && !isVerbCoord) continue;

    const parentName = parentSyn.words[0] || 'category';
    const childArray = Array.from(childSet);
    const tightSiblingBonus = childCount <= 8 ? 250 : 0;
    const nounPriorityBoost = parentSyn.pos === 'n' ? 150 : 0;
    const specificityPriority = depth * 100 - childCount * 2 + tightSiblingBonus + nounPriorityBoost;

    for (let i = 0; i < childArray.length; i++) {
      const synA = synsetMap.get(childArray[i]);
      if (!synA) continue;
      const wordsA = extractCleanHeadWords(synA, parentSyn.pos === 'n' && childCount <= 8);

      for (let j = 0; j < childArray.length; j++) {
        if (i === j) continue;
        const synB = synsetMap.get(childArray[j]);
        if (!synB) continue;
        const wordsB = extractCleanHeadWords(synB, parentSyn.pos === 'n').slice(0, 2);

        for (const wA of wordsA) {
          for (let idxB = 0; idxB < wordsB.length; idxB++) {
            const wB = wordsB[idxB];
            if (wA === wB) continue;
            addCoordCandidate(wA, {
              groupKey: `hyp_${parentKey}`,
              priority: specificityPriority,
              centrality: synB.hyponymOffsets.length * 10 + (idxB === 0 ? 3 : 0) + (wB.length <= 6 ? 2 : 0),
              entry: {
                word: wB,
                score: 0.88,
                reason: `WordNet coordinate term (shares specific hypernym "${parentName}" at depth ${depth})`,
                relationType: 'coordinate',
                source: 'WordNet 3.0',
              },
            });
          }
        }

        // Deep functional noun coordinate -> direct (+) verb derivation bridge (e.g., MOP -> BROOM -> SWEEP)
        if (parentSyn.pos === 'n' && depth >= 7 && childCount <= 8) {
          const coordName = synB.words[0] || 'COORDINATE';
          for (const cPtr of synB.pointers) {
            if (cPtr.symbol !== '+' || cPtr.pos !== 'v') continue;
            const verbSyn = synsetMap.get(`${cPtr.targetOffset}_${cPtr.pos}`);
            if (!verbSyn) continue;

            const tgtIdx = parseInt(cPtr.sourceTarget.slice(2, 4), 16);
            const derivedVerbs: string[] = [];
            if (tgtIdx > 0 && tgtIdx <= verbSyn.words.length) {
              const vWord = verbSyn.words[tgtIdx - 1];
              if (isValidSingleWord(vWord)) derivedVerbs.push(vWord);
            }
            if (derivedVerbs.length === 0) {
              for (const vWord of verbSyn.words) {
                if (isValidSingleWord(vWord)) derivedVerbs.push(vWord);
              }
            }

            for (const wA of wordsA) {
              if ((assocDerivCount.get(wA) ?? 0) >= 4) continue;
              const entryA = getOrCreateWord(wA);
              for (const vWord of derivedVerbs) {
                if ((assocDerivCount.get(wA) ?? 0) >= 4) break;
                if (wA === vWord) continue;
                if (entryA.derivations.length < 24 && !entryA.derivations.some((e) => e.word === vWord)) {
                  entryA.derivations.push({
                    word: vWord,
                    score: 0.82,
                    reason: `WordNet functional coordinate derivation (${parentName} → ${coordName} → ${vWord})`,
                    relationType: 'associated',
                    source: 'WordNet 3.0',
                  });
                  assocDerivCount.set(wA, (assocDerivCount.get(wA) ?? 0) + 1);
                }
              }
            }
          }
        }
      }
    }
  }

  // Round-robin balanced selection across distinct parent synset groups (with tight-group 2-per-pass yield)
  const MAX_COORDS_PER_WORD = 40;
  for (const [word, candidates] of coordPool.entries()) {
    const entry = getOrCreateWord(word);
    const bestPerTarget = new Map<string, CoordCandidate>();
    for (const c of candidates) {
      const prev = bestPerTarget.get(c.entry.word);
      if (!prev || c.priority > prev.priority) {
        bestPerTarget.set(c.entry.word, c);
      }
    }

    const byGroup = new Map<string, CoordCandidate[]>();
    for (const c of bestPerTarget.values()) {
      if (!byGroup.has(c.groupKey)) {
        byGroup.set(c.groupKey, []);
      }
      byGroup.get(c.groupKey)!.push(c);
    }

    const groups = Array.from(byGroup.values())
      .map((grp) => grp.sort((a, b) => b.centrality - a.centrality))
      .sort((a, b) => b[0].priority - a[0].priority);
    const seenWords = new Set<string>(entry.coordinates.map((c) => c.word));
    const groupCursors = new Array<number>(groups.length).fill(0);

    let added = true;
    while (entry.coordinates.length < MAX_COORDS_PER_WORD && added) {
      added = false;
      for (let g = 0; g < groups.length && entry.coordinates.length < MAX_COORDS_PER_WORD; g++) {
        const grp = groups[g];
        const quota = 1;
        let taken = 0;
        while (groupCursors[g] < grp.length && taken < quota && entry.coordinates.length < MAX_COORDS_PER_WORD) {
          const item = grp[groupCursors[g]++];
          if (!seenWords.has(item.entry.word)) {
            seenWords.add(item.entry.word);
            entry.coordinates.push(item.entry);
            coordinateCount++;
            taken++;
            added = true;
          }
        }
      }
    }
  }

  // [5/5] Partition by letter and write compact JSON
  console.log('[5/5] Emitting compact letter-partitioned JSON files into data/v3/compiled/wordnet/...');

  const letterBuckets = new Map<string, Record<string, CompiledWordEntry>>();
  for (let c = 65; c <= 90; c++) {
    letterBuckets.set(String.fromCharCode(c), {});
  }

  let totalEmittedWords = 0;
  for (const [word, entry] of wordStore.entries()) {
    if (
      entry.synonyms.length === 0 &&
      entry.antonyms.length === 0 &&
      entry.coordinates.length === 0 &&
      entry.hierarchical.length === 0 &&
      entry.derivations.length === 0
    ) {
      continue;
    }

    const firstChar = word.charAt(0).toUpperCase();
    const bucket = letterBuckets.get(firstChar);
    if (bucket) {
      bucket[word] = entry;
      totalEmittedWords++;
    }
  }

  let totalByteSize = 0;
  for (const [letter, entries] of letterBuckets.entries()) {
    const filename = `wn_${letter.toLowerCase()}.json`;
    const filePath = path.join(OUTPUT_DIR, filename);
    const jsonStr = JSON.stringify(entries);
    fs.writeFileSync(filePath, jsonStr, 'utf-8');
    totalByteSize += Buffer.byteLength(jsonStr, 'utf-8');
  }

  const summary = {
    compiledAt: new Date().toISOString(),
    totalRawSynsets,
    totalEmittedWords,
    antonymCount,
    synonymCount,
    derivationCount,
    coordinateCount,
    hierarchicalCount,
    totalCompiledBytes: totalByteSize,
    totalCompiledMB: Math.round((totalByteSize / (1024 * 1024)) * 100) / 100,
  };

  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

  console.log('======================================================================');
  console.log(' WordNet 3.0 Compilation Complete!');
  console.log(` - Total words compiled: ${totalEmittedWords}`);
  console.log(` - Direct Antonyms:      ${antonymCount}`);
  console.log(` - Direct Synonyms:      ${synonymCount}`);
  console.log(` - Derivations:          ${derivationCount}`);
  console.log(` - Bounded Coordinates:  ${coordinateCount}`);
  console.log(` - Direct Hierarchical:  ${hierarchicalCount}`);
  console.log(` - Compiled JSON size:   ${summary.totalCompiledMB} MB across 26 letter partitions`);
  console.log('======================================================================');

  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  compileWordNet().catch((err) => {
    console.error('Compilation failed:', err);
    process.exit(1);
  });
}
