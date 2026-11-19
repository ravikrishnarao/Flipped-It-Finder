/**
 * Flipit Finder V3 — Reconciled Milestone 3.2 Evaluation Harness
 * Evaluates the current V3 relationship, morphology, and phrase engines on:
 *   1) Original 8-puzzle frozen core set (v3-01 .. v3-08)
 *   2) Additional 2 challenge puzzles (v3-09 .. v3-10)
 * Run cleanly with CuratedPhraseProvider disabled vs. enabled.
 * Strictly read-only against runtime datasets; verifies V2.2.4 SHA-256 hashes.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CompositeV3PhraseProvider } from '../src/solver/v3/compositeV3PhraseProvider.ts';
import { CompositeV3RelationshipProvider } from '../src/solver/v3/compositeV3Provider.ts';

interface ReconciledPuzzle {
  id: string;
  tier: 'core-8' | 'challenge-2';
  clue1: string;
  clue2: string;
  expectedWord1: string;
  expectedWord2: string;
  expectedPhrase: string;
}

const FROZEN_V2_FILES = [
  'data/relationships.json',
  'data/phrases.json',
  'data/wordnet_relationships.json',
  'data/moby_phrases.json',
  'data/contextual_associations.json',
];

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function evaluateTier(
  label: string,
  puzzles: ReconciledPuzzle[],
  enableCurated: boolean
) {
  const relProvider = new CompositeV3RelationshipProvider();
  const phraseProvider = new CompositeV3PhraseProvider({ enableCurated });

  let t1Count = 0;
  let t2Count = 0;
  let bothCount = 0;
  let phraseRecCount = 0;
  let ansGenCount = 0;
  let top1Count = 0;
  let top5Count = 0;
  let curatedContribCount = 0;

  console.log(`\n----------------------------------------------------------------------`);
  console.log(` ${label} | CuratedPhraseProvider=${enableCurated ? 'ENABLED' : 'DISABLED'}`);
  console.log(`----------------------------------------------------------------------`);

  for (const p of puzzles) {
    const r1 = await relProvider.lookupWithDiagnostics(p.clue1);
    const r2 = await relProvider.lookupWithDiagnostics(p.clue2);

    const w1Idx = r1.transformations.findIndex((t) => t.word === p.expectedWord1);
    const w2Idx = r2.transformations.findIndex((t) => t.word === p.expectedWord2);
    const t1Recall = w1Idx >= 0;
    const t2Recall = w2Idx >= 0;
    if (t1Recall) t1Count++;
    if (t2Recall) t2Count++;
    if (t1Recall && t2Recall) bothCount++;

    const directPhrase = await phraseProvider.lookupWithDiagnostics(
      p.expectedWord1,
      p.expectedWord2
    );
    const phraseRecognized = Boolean(directPhrase.match);
    if (phraseRecognized) phraseRecCount++;

    // Cross-product matching and deterministic scoring
    const rawMatches: Array<{ phrase: string; score: number; source: string }> = [];
    for (const c1 of r1.transformations) {
      for (const c2 of r2.transformations) {
        const m = await phraseProvider.matchPhraseAsync(c1.word, c2.word, true);
        if (m) {
          const score = Number(
            (c1.score * 0.35 + c2.score * 0.35 + m.heuristicScore * 0.3).toFixed(4)
          );
          rawMatches.push({
            phrase: `${c1.word} ${c2.word}`,
            score,
            source: m.sourceDataset,
          });
        }
      }
    }

    rawMatches.sort((a, b) => b.score - a.score);
    const deduped: typeof rawMatches = [];
    const seen = new Set<string>();
    for (const item of rawMatches) {
      if (!seen.has(item.phrase)) {
        seen.add(item.phrase);
        deduped.push(item);
      }
    }

    const ansIdx = deduped.findIndex((m) => m.phrase === p.expectedPhrase);
    const answerGenerated = ansIdx >= 0;
    const rank = answerGenerated ? ansIdx + 1 : null;
    if (answerGenerated) ansGenCount++;
    if (rank === 1) top1Count++;
    if (rank !== null && rank <= 5) top5Count++;

    // Check if curated data contributed either to relationship or phrase recognition
    const src1 = t1Recall ? (r1.transformations[w1Idx].source || '') : '';
    const src2 = t2Recall ? (r2.transformations[w2Idx].source || '') : '';
    const rel1FromCurated = src1.toLowerCase().includes('curated');
    const rel2FromCurated = src2.toLowerCase().includes('curated');
    const phraseFromCurated = Boolean(
      (directPhrase.match && directPhrase.match.sourceDataset === 'Curated Phrase Repository') ||
      (answerGenerated && deduped[ansIdx].source === 'Curated Phrase Repository')
    );
    const curatedContributed = rel1FromCurated || rel2FromCurated || phraseFromCurated;
    if (curatedContributed) curatedContribCount++;

    const t1Detail = t1Recall
      ? `YES (#${w1Idx + 1}, ${r1.transformations[w1Idx].relationType}, ${r1.transformations[w1Idx].source})`
      : 'NO';
    const t2Detail = t2Recall
      ? `YES (#${w2Idx + 1}, ${r2.transformations[w2Idx].relationType}, ${r2.transformations[w2Idx].source})`
      : 'NO';
    const phrDetail = phraseRecognized
      ? `YES (${directPhrase.match!.sourceDataset})`
      : 'NO';

    console.log(
      `${p.id} | ${p.clue1} + ${p.clue2} -> ${p.expectedPhrase}\n` +
        `   T1: ${t1Detail} | T2: ${t2Detail}\n` +
        `   PhraseRec: ${phrDetail} | AnsGen: ${answerGenerated ? 'YES' : 'NO'} | ` +
        `Rank: ${rank !== null ? `#${rank}/${deduped.length}` : `N/A (${deduped.length} pairs)`} | ` +
        `CuratedContrib: ${curatedContributed ? 'YES' : 'NO'} | Top1: ${deduped[0]?.phrase ?? 'NONE'}`
    );
  }

  const n = puzzles.length;
  console.log(`\nAGGREGATE [${label} | curated=${enableCurated}]:`);
  console.log(`  - Clue 1 Recall:      ${t1Count}/${n} (${((t1Count / n) * 100).toFixed(1)}%)`);
  console.log(`  - Clue 2 Recall:      ${t2Count}/${n} (${((t2Count / n) * 100).toFixed(1)}%)`);
  console.log(`  - Both Clues Recall:  ${bothCount}/${n} (${((bothCount / n) * 100).toFixed(1)}%)`);
  console.log(`  - Phrase Recognized:  ${phraseRecCount}/${n} (${((phraseRecCount / n) * 100).toFixed(1)}%)`);
  console.log(`  - Answer Generated:   ${ansGenCount}/${n} (${((ansGenCount / n) * 100).toFixed(1)}%)`);
  console.log(`  - Top-1 Accuracy:     ${top1Count}/${n} (${((top1Count / n) * 100).toFixed(1)}%)`);
  console.log(`  - Top-5 Accuracy:     ${top5Count}/${n} (${((top5Count / n) * 100).toFixed(1)}%)`);
  console.log(`  - Curated Contributed:${curatedContribCount}/${n}`);
}

async function main() {
  const frozenChecksums = JSON.parse(
    fs.readFileSync(path.resolve('eval/reports/frozen_checksums.json'), 'utf8')
  );

  console.log('======================================================================');
  console.log(' FLIPIT FINDER V3 — MILESTONE 3.2 RECONCILED EVALUATION');
  console.log('======================================================================');
  console.log('[Integrity] Verifying frozen V2.2.4 SHA-256 checksums...');
  for (const f of FROZEN_V2_FILES) {
    const actual = sha256(f);
    const expected = frozenChecksums.datasets?.[f] ?? frozenChecksums[f];
    if (expected && actual !== expected) {
      throw new Error(`Frozen V2.2.4 checksum mismatch for ${f}`);
    }
    console.log(`  ✓ ${f}: ${actual.slice(0, 16)}...`);
  }

  const allPuzzles: ReconciledPuzzle[] = JSON.parse(
    fs.readFileSync(path.resolve('eval/dataset/v3_reconciled_puzzles.json'), 'utf8')
  );
  const core8 = allPuzzles.filter((p) => p.tier === 'core-8');
  const challenge2 = allPuzzles.filter((p) => p.tier === 'challenge-2');

  await evaluateTier('ORIGINAL 8 FROZEN CORE', core8, false);
  await evaluateTier('ORIGINAL 8 FROZEN CORE', core8, true);
  await evaluateTier('ADDITIONAL 2 CHALLENGE', challenge2, false);
  await evaluateTier('ADDITIONAL 2 CHALLENGE', challenge2, true);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
