import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  BookOpen,
  Scale,
} from 'lucide-react';
import type { CluePairConstraints, KnowledgeConfig, V3CandidateAnswer } from '../types/v3Api.ts';

interface CandidateCardProps {
  candidate: V3CandidateAnswer;
  rank: number;
  clue1: string;
  clue2: string;
  knowledgeConfig: KnowledgeConfig;
  constraints?: CluePairConstraints;
  defaultExpanded?: boolean;
}

function formatRelationLabel(type: string): string {
  switch (type) {
    case 'antonym':
      return 'Antonym';
    case 'counterpart':
      return 'Counterpart';
    case 'synonym':
      return 'Synonym';
    case 'derivation':
      return 'Derivation';
    case 'morphological':
      return 'Morphological';
    case 'hypernym':
      return 'Direct Hypernym';
    case 'hyponym':
      return 'Direct Hyponym';
    case 'hierarchical':
      return 'Hierarchical';
    case 'coordinate':
      return 'Coordinate Term';
    case 'contextual':
      return 'Contextual Assoc.';
    case 'associated':
      return 'Associated Pair';
    case 'thesaurus':
      return 'Moby Thesaurus';
    default:
      return type;
  }
}

function getRelationTone(type: string): string {
  switch (type) {
    case 'antonym':
    case 'counterpart':
      return 'text-emerald-800 bg-emerald-50 border-emerald-300';
    case 'synonym':
      return 'text-blue-800 bg-blue-50 border-blue-300';
    case 'derivation':
    case 'morphological':
      return 'text-violet-800 bg-violet-50 border-violet-300';
    case 'hypernym':
    case 'hyponym':
    case 'hierarchical':
    case 'coordinate':
      return 'text-cyan-800 bg-cyan-50 border-cyan-300';
    case 'contextual':
    case 'associated':
      return 'text-amber-900 bg-amber-50 border-amber-300';
    default:
      return 'text-stone-700 bg-stone-100 border-stone-300';
  }
}

function formatConstraintSummary(word: string, c?: CluePairConstraints['word1']): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.startsWith) parts.push(`starts "${c.startsWith}"`);
  if (c.length) parts.push(`len ${c.length}`);
  if (parts.length === 0) return null;
  return `${word} (${parts.join(', ')})`;
}

export const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate,
  rank,
  clue1,
  clue2,
  knowledgeConfig,
  constraints,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const b = candidate.rankingBreakdown;
  const isTop = rank === 1;

  const hasConstraints = Boolean(
    constraints?.word1?.startsWith ||
      constraints?.word1?.length ||
      constraints?.word2?.startsWith ||
      constraints?.word2?.length
  );

  const c1Summary = formatConstraintSummary(candidate.word1, constraints?.word1);
  const c2Summary = formatConstraintSummary(candidate.word2, constraints?.word2);

  return (
    <article
      className={`rounded-lg border bg-white ${
        isTop ? 'border-blue-700/70' : 'border-stone-200'
      }`}
    >
      {/* Primary Header Row */}
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-200">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500">
            <span className="font-mono font-semibold text-stone-900 tabular-nums">
              #{rank}
            </span>
            <span>·</span>
            <span className="uppercase tracking-wide font-semibold text-stone-700">
              {candidate.phraseMatch.sourceDataset}
            </span>
            <span>·</span>
            <span className="capitalize">
              {candidate.phraseMatch.matchType} {candidate.phraseMatch.phraseCategory}
            </span>
            {candidate.phraseMatch.isReversed && (
              <>
                <span>·</span>
                <span className="text-amber-800 font-medium inline-flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Reversed order match
                </span>
              </>
            )}
            {knowledgeConfig === 'full-compatibility' &&
              (candidate.phraseProvenanceCategory === 'curated' ||
                candidate.relation1ProvenanceCategory === 'curated' ||
                candidate.relation2ProvenanceCategory === 'curated') && (
                <>
                  <span>·</span>
                  <span className="text-amber-800 font-medium">Legacy V2.2.4 Assisted</span>
                </>
              )}
          </div>

          <h3
            className={`font-editorial font-bold tracking-tight text-stone-900 ${
              isTop ? 'text-2xl sm:text-3xl' : 'text-xl'
            }`}
          >
            {candidate.targetPhrase}
          </h3>

          <div className="text-xs text-stone-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              <strong className="font-mono text-stone-800">{clue1}</strong> →{' '}
              <strong className="font-mono text-blue-800">{candidate.word1}</strong> (
              {formatRelationLabel(candidate.relation1.relationType)})
            </span>
            <span className="text-stone-300">|</span>
            <span>
              <strong className="font-mono text-stone-800">{clue2}</strong> →{' '}
              <strong className="font-mono text-blue-800">{candidate.word2}</strong> (
              {formatRelationLabel(candidate.relation2.relationType)})
            </span>
          </div>
        </div>

        {/* Heuristic Score Block */}
        <div className="flex sm:flex-col items-baseline sm:items-end justify-between gap-1 shrink-0">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">
              Heuristic Score
            </div>
            <div className="font-mono text-2xl font-bold text-stone-900 tabular-nums">
              {b.totalScore.toFixed(3)}
            </div>
          </div>
          <div className="text-[11px] text-stone-500 text-right">
            Index 0.00–1.00 (not a probability)
          </div>
        </div>
      </div>

      {/* Transformations & Phrase Evidence Grid */}
      <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Clue 1 Transformation */}
          <div className="p-3.5 rounded-md bg-stone-50 border border-stone-200 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-stone-600 uppercase tracking-wide">
                Clue 1 Transformation
              </span>
              <span
                className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${getRelationTone(
                  candidate.relation1.relationType
                )}`}
              >
                {formatRelationLabel(candidate.relation1.relationType)}
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono text-sm font-bold text-stone-900">
              <span>{clue1}</span>
              <ArrowRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <span className="text-blue-800">{candidate.word1}</span>
              <span className="ml-auto text-xs font-normal text-stone-600 tabular-nums">
                raw {candidate.relation1.score.toFixed(2)} · q {b.relationship1Quality.toFixed(3)}
              </span>
            </div>

            <div className="text-xs text-stone-600 leading-relaxed">
              {candidate.relation1.reason}
            </div>

            <div className="text-[11px] text-stone-500 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-200/80">
              <span>Source: {candidate.relation1.source || 'V3 Lexical Engine'}</span>
              {typeof candidate.relation1.depth === 'number' && (
                <span className="font-mono tabular-nums">Depth {candidate.relation1.depth}</span>
              )}
            </div>
          </div>

          {/* Clue 2 Transformation */}
          <div className="p-3.5 rounded-md bg-stone-50 border border-stone-200 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-stone-600 uppercase tracking-wide">
                Clue 2 Transformation
              </span>
              <span
                className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${getRelationTone(
                  candidate.relation2.relationType
                )}`}
              >
                {formatRelationLabel(candidate.relation2.relationType)}
              </span>
            </div>

            <div className="flex items-center gap-2 font-mono text-sm font-bold text-stone-900">
              <span>{clue2}</span>
              <ArrowRight className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <span className="text-blue-800">{candidate.word2}</span>
              <span className="ml-auto text-xs font-normal text-stone-600 tabular-nums">
                raw {candidate.relation2.score.toFixed(2)} · q {b.relationship2Quality.toFixed(3)}
              </span>
            </div>

            <div className="text-xs text-stone-600 leading-relaxed">
              {candidate.relation2.reason}
            </div>

            <div className="text-[11px] text-stone-500 flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-200/80">
              <span>Source: {candidate.relation2.source || 'V3 Lexical Engine'}</span>
              {typeof candidate.relation2.depth === 'number' && (
                <span className="font-mono tabular-nums">Depth {candidate.relation2.depth}</span>
              )}
            </div>
          </div>
        </div>

        {/* Phrase Evidence + Constraint Verification Row */}
        <div className="p-3.5 rounded-md bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-start gap-2 text-stone-700">
            <BookOpen className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-stone-900">Phrase Evidence:</span>{' '}
              {candidate.phraseMatch.explanation} · Matched form:{' '}
              <span className="font-mono font-semibold text-stone-900">
                {candidate.phraseMatch.originalPhraseForm}
              </span>{' '}
              ({candidate.phraseMatch.matchType})
            </div>
          </div>

          {hasConstraints && (
            <div className="inline-flex items-center gap-1.5 text-emerald-800 font-medium shrink-0">
              <Check className="w-3.5 h-3.5" />
              <span>
                Matches {[c1Summary, c2Summary].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
        </div>

        {/* Toggle Ranking Breakdown */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Scale className="w-3.5 h-3.5" />
            {expanded ? 'Hide Ranking Score Breakdown' : 'Inspect Ranking Score Breakdown'}
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          <span className="text-[11px] text-stone-500">
            Provenance: {candidate.relation1ProvenanceCategory} + {candidate.relation2ProvenanceCategory} → {candidate.phraseProvenanceCategory}
          </span>
        </div>

        {expanded && (
          <div className="pt-3 border-t border-stone-200 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded bg-stone-50 border border-stone-200">
                <div className="text-[11px] text-stone-500">Relationship Component</div>
                <div className="font-mono font-semibold text-stone-900 tabular-nums mt-0.5">
                  +{b.relationshipComponent.toFixed(4)}
                </div>
                <div className="text-[10px] text-stone-500 tabular-nums">
                  balance {b.relationBalance.toFixed(3)}
                </div>
              </div>

              <div className="p-2.5 rounded bg-stone-50 border border-stone-200">
                <div className="text-[11px] text-stone-500">Phrase Evidence</div>
                <div className="font-mono font-semibold text-stone-900 tabular-nums mt-0.5">
                  +{b.phraseEvidenceScore.toFixed(4)}
                </div>
                <div className="text-[10px] text-stone-500 tabular-nums">
                  base {candidate.phraseScore.toFixed(2)} ({candidate.phraseMatch.matchType})
                </div>
              </div>

              <div className="p-2.5 rounded bg-stone-50 border border-stone-200">
                <div className="text-[11px] text-stone-500">Morphology & Shape</div>
                <div className="font-mono font-semibold text-stone-900 tabular-nums mt-0.5">
                  {b.morphologicalCompatibility + b.posCompatibility >= 0 ? '+' : ''}
                  {(b.morphologicalCompatibility + b.posCompatibility).toFixed(4)}
                </div>
                <div className="text-[10px] text-stone-500 tabular-nums">
                  morph {b.morphologicalCompatibility >= 0 ? '+' : ''}
                  {b.morphologicalCompatibility.toFixed(3)} · pos +{b.posCompatibility.toFixed(3)}
                </div>
              </div>

              <div className="p-2.5 rounded bg-stone-50 border border-stone-200">
                <div className="text-[11px] text-stone-500">Constraints & Penalties</div>
                <div className="font-mono font-semibold text-stone-900 tabular-nums mt-0.5">
                  {b.constraintSatisfactionScore - b.ambiguityPenalty - b.reversedOrderPenalty >= 0 ? '+' : ''}
                  {(b.constraintSatisfactionScore - b.ambiguityPenalty - b.reversedOrderPenalty).toFixed(4)}
                </div>
                <div className="text-[10px] text-stone-500 tabular-nums">
                  cstr +{b.constraintSatisfactionScore.toFixed(2)} · amb -{b.ambiguityPenalty.toFixed(3)} · rev -{b.reversedOrderPenalty.toFixed(2)}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-stone-500">
              {b.scoreIsHeuristicNote}
            </p>
          </div>
        )}
      </div>
    </article>
  );
};
