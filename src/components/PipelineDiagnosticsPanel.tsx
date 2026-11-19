import React from 'react';
import { Info } from 'lucide-react';
import type {
  V3ClueDiagnostic,
  V3SolveDiagnostic,
} from '../types/v3Api.ts';

interface PipelineDiagnosticsPanelProps {
  diagnostic: V3SolveDiagnostic;
  solveTimeMs: number;
}

const ClueDiagnosticColumn: React.FC<{ label: string; clueDiag: V3ClueDiagnostic }> = ({
  label,
  clueDiag,
}) => {
  const providerEntries = Object.entries(clueDiag.providerCounts || {});

  return (
    <div className="p-4 rounded-lg bg-white border border-stone-200 space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 pb-2">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {label}
          </span>
          <h4 className="font-mono text-sm font-bold text-stone-900">
            {clueDiag.normalizedClue || clueDiag.clue || '—'}
          </h4>
        </div>
        <div className="text-right text-xs text-stone-600 tabular-nums">
          <div>
            <strong>{clueDiag.postConstraintCount}</strong> / {clueDiag.preConstraintCount} surviving
          </div>
          {clueDiag.rejectedByConstraintCount > 0 && (
            <div className="text-[11px] text-rose-700">
              {clueDiag.rejectedByConstraintCount} rejected by constraints
            </div>
          )}
        </div>
      </div>

      {/* Morphology trace */}
      <div className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded p-2.5 space-y-1">
        <div className="font-semibold text-stone-800">Morphology Normalization</div>
        <div className="tabular-nums">
          Inflected:{' '}
          <span className="font-mono font-semibold">
            {clueDiag.morphology.isInflected
              ? `Yes (${clueDiag.morphology.inflectionType || 'detected'})`
              : 'No'}
          </span>{' '}
          · Lemmas:{' '}
          <span className="font-mono">
            {clueDiag.morphology.baseLemmas.length > 0
              ? clueDiag.morphology.baseLemmas.join(', ')
              : '—'}
          </span>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Raw Provider Recall
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {providerEntries.map(([name, count]) => (
            <div
              key={name}
              className="flex items-center justify-between px-2 py-1 rounded bg-stone-50 border border-stone-200"
            >
              <span className="truncate text-stone-600" title={name}>
                {name.replace('RelationshipProvider', '').replace('Provider', '')}
              </span>
              <span className="font-mono font-semibold text-stone-900 tabular-nums ml-2">
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Surviving Candidates */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
          Surviving Transformations ({clueDiag.survivingTransformations.length})
        </div>
        {clueDiag.survivingTransformations.length > 0 ? (
          <div className="max-h-44 overflow-y-auto border border-stone-200 rounded divide-y divide-stone-100">
            {clueDiag.survivingTransformations.slice(0, 30).map((t, idx) => (
              <div
                key={`${t.word}-${idx}`}
                className="px-2.5 py-1.5 text-xs flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-stone-900">{t.word}</span>
                  <span className="text-stone-500 ml-2">
                    {t.relationType} · {t.source || 'V3'}
                  </span>
                </div>
                <span className="font-mono text-stone-700 tabular-nums shrink-0">
                  {t.score.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-stone-500 italic">No surviving transformations.</div>
        )}
      </div>

      {/* Constraint Rejections */}
      {clueDiag.rejections.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-800">
            Constraint Rejections ({clueDiag.rejections.length})
          </div>
          <div className="max-h-28 overflow-y-auto border border-rose-200 bg-rose-50/40 rounded divide-y divide-rose-100">
            {clueDiag.rejections.slice(0, 25).map((rej, idx) => (
              <div key={`${rej.word}-${idx}`} className="px-2.5 py-1 text-[11px] text-stone-700">
                <span className="font-mono font-semibold text-rose-900">{rej.word}</span> —{' '}
                {rej.reason}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const PipelineDiagnosticsPanel: React.FC<PipelineDiagnosticsPanelProps> = ({
  diagnostic,
  solveTimeMs,
}) => {
  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-700 shrink-0" />
          <h3 className="text-sm font-semibold text-stone-900">
            Transformation & Constraint Details
          </h3>
        </div>
        <div className="text-xs font-mono text-stone-600 tabular-nums">
          Mode: <strong className="text-stone-900">{diagnostic.knowledgeConfig}</strong> ·{' '}
          <strong className="text-stone-900">{solveTimeMs.toFixed(1)} ms</strong>
        </div>
      </div>

      {/* Funnel Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
        <div className="p-2.5 rounded bg-white border border-stone-200">
          <div className="text-[11px] text-stone-500">Pre-Constraint Pairs</div>
          <div className="font-mono font-bold text-stone-900 tabular-nums mt-0.5">
            {diagnostic.totalCombinationsBeforeConstraints.toLocaleString()}
          </div>
        </div>
        <div className="p-2.5 rounded bg-white border border-stone-200">
          <div className="text-[11px] text-stone-500">Post-Constraint Pairs</div>
          <div className="font-mono font-bold text-stone-900 tabular-nums mt-0.5">
            {diagnostic.totalCombinationsAfterConstraints.toLocaleString()}
          </div>
        </div>
        <div className="p-2.5 rounded bg-white border border-stone-200">
          <div className="text-[11px] text-stone-500">Combinations Checked</div>
          <div className="font-mono font-bold text-stone-900 tabular-nums mt-0.5">
            {diagnostic.totalCombinationsEvaluated.toLocaleString()}
          </div>
        </div>
        <div className="p-2.5 rounded bg-white border border-stone-200">
          <div className="text-[11px] text-stone-500">Phrases Recognized</div>
          <div className="font-mono font-bold text-stone-900 tabular-nums mt-0.5">
            {diagnostic.phraseMatchesCount}
          </div>
        </div>
        <div className="p-2.5 rounded bg-white border border-stone-200">
          <div className="text-[11px] text-stone-500">Ranked Outputs</div>
          <div className="font-mono font-bold text-stone-900 tabular-nums mt-0.5">
            {diagnostic.rankedCandidatesCount}
          </div>
        </div>
      </div>

      {/* Clue-by-clue breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClueDiagnosticColumn label="Clue 1 Transformations" clueDiag={diagnostic.clue1} />
        <ClueDiagnosticColumn label="Clue 2 Transformations" clueDiag={diagnostic.clue2} />
      </div>
    </section>
  );
};
