import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eraser,
  Filter,
  Info,
  RotateCcw,
  Search,
} from 'lucide-react';
import { CandidateCard } from './components/CandidateCard.tsx';
import {
  KNOWLEDGE_CONFIG_OPTIONS,
  KnowledgeConfigSelector,
} from './components/KnowledgeConfigSelector.tsx';
import { PipelineDiagnosticsPanel } from './components/PipelineDiagnosticsPanel.tsx';
import type {
  CluePairConstraints,
  KnowledgeConfig,
  SolveV3Response,
  V3SolveResult,
} from './types/v3Api.ts';

interface SamplePreset {
  label: string;
  c1: string;
  c2: string;
  w1S: string;
  w1L: string;
  w2S: string;
  w2L: string;
  tier: 'Core' | 'Challenge' | 'Check';
}

const SAMPLE_PRESETS: SamplePreset[] = [
  { label: 'INVOCATION + RITUAL', c1: 'INVOCATION', c2: 'RITUAL', w1S: 'P', w1L: '6', w2S: 'C', w2L: '8', tier: 'Core' },
  { label: 'DRY + MOP', c1: 'DRY', c2: 'MOP', w1S: 'C', w1L: '5', w2S: 'S', w2L: '5', tier: 'Core' },
  { label: 'SYNTHETIC + FROWN', c1: 'SYNTHETIC', c2: 'FROWN', w1S: 'P', w1L: '7', w2S: 'S', w2L: '5', tier: 'Core' },
  { label: 'WET + VEGETABLES', c1: 'WET', c2: 'VEGETABLES', w1S: 'D', w1L: '3', w2S: 'F', w2L: '6', tier: 'Core' },
  { label: 'ABODE + LEAVING', c1: 'ABODE', c2: 'LEAVING', w1S: 'H', w1L: '4', w2S: 'C', w2L: '6', tier: 'Core' },
  { label: 'NEW + CLOTHES', c1: 'NEW', c2: 'CLOTHES', w1S: 'O', w1L: '3', w2S: 'G', w2L: '8', tier: 'Core' },
  { label: 'SALT + CRATE', c1: 'SALT', c2: 'CRATE', w1S: 'S', w1L: '5', w2S: 'B', w2L: '3', tier: 'Core' },
  { label: 'ANGEL + QUEEN', c1: 'ANGEL', c2: 'QUEEN', w1S: 'D', w1L: '5', w2S: 'K', w2L: '4', tier: 'Core' },
  { label: 'SHORT + WEEKDAY', c1: 'SHORT', c2: 'WEEKDAY', w1S: 'L', w1L: '4', w2S: 'W', w2L: '7', tier: 'Challenge' },
  { label: 'SHALLOW + SOILING', c1: 'SHALLOW', c2: 'SOILING', w1S: 'D', w1L: '4', w2S: 'C', w2L: '8', tier: 'Challenge' },
];

function cleanClueToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
}

function buildConstraintsPayload(
  w1S: string,
  w1L: string,
  w2S: string,
  w2L: string
): CluePairConstraints | undefined {
  const out: CluePairConstraints = {};
  const s1 = w1S.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').charAt(0);
  const l1 = parseInt(w1L, 10);
  if (s1 || (!Number.isNaN(l1) && l1 > 0)) {
    out.word1 = {};
    if (s1) out.word1.startsWith = s1;
    if (!Number.isNaN(l1) && l1 > 0) out.word1.length = l1;
  }

  const s2 = w2S.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').charAt(0);
  const l2 = parseInt(w2L, 10);
  if (s2 || (!Number.isNaN(l2) && l2 > 0)) {
    out.word2 = {};
    if (s2) out.word2.startsWith = s2;
    if (!Number.isNaN(l2) && l2 > 0) out.word2.length = l2;
  }

  return out.word1 || out.word2 ? out : undefined;
}

function getProvenanceBannerMeta(config: KnowledgeConfig) {
  switch (config) {
    case 'pure-v3':
      return {
        label: 'PURE V3',
        tone: 'border-blue-700/40 bg-blue-50/80 text-blue-950',
        detail:
          'Strict compiled V3 datasets only (WordNet 3.0 + Moby Thesaurus II + WordNet Collocations + Moby Compounds). Contextual Lexicon and Legacy V2.2.4 Curated Phrases are DISABLED.',
      };
    case 'hybrid':
      return {
        label: 'HYBRID (V3 + CONTEXTUAL)',
        tone: 'border-emerald-700/40 bg-emerald-50/80 text-emerald-950',
        detail:
          'Compiled V3 datasets plus curated Contextual Associations. Legacy V2.2.4 Curated Phrases and Curated Relationships remain DISABLED.',
      };
    case 'full-compatibility':
      return {
        label: 'FULL COMPATIBILITY (LEGACY-ASSISTED)',
        tone: 'border-amber-700/50 bg-amber-50/90 text-amber-950',
        detail:
          'Includes Legacy V2.2.4 Curated Phrases and Relationships alongside V3 and Contextual engines. Legacy-assisted results are never labeled as Pure V3.',
      };
  }
}

export default function App() {
  const [clue1, setClue1] = useState('ABODE');
  const [clue2, setClue2] = useState('LEAVING');
  const [w1Start, setW1Start] = useState('H');
  const [w1Len, setW1Len] = useState('4');
  const [w2Start, setW2Start] = useState('C');
  const [w2Len, setW2Len] = useState('6');
  const [knowledgeConfig, setKnowledgeConfig] = useState<KnowledgeConfig>('hybrid');
  const [enableCompoundMatching, setEnableCompoundMatching] = useState(true);
  const [applyPresetConstraints, setApplyPresetConstraints] = useState(true);
  const [showConstraints, setShowConstraints] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const [isSolving, setIsSolving] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<V3SolveResult | null>(null);

  const requestCounter = useRef(0);

  const executeSolve = async (params: {
    c1: string;
    c2: string;
    s1: string;
    l1: string;
    s2: string;
    l2: string;
    config: KnowledgeConfig;
    compounds: boolean;
  }) => {
    if (params.c1.length > 64 || params.c2.length > 64) {
      setInputError('Clue inputs must not exceed 64 characters.');
      setResult(null);
      return;
    }

    const clean1 = cleanClueToken(params.c1);
    const clean2 = cleanClueToken(params.c2);

    if (!clean1 || !clean2) {
      setInputError('Enter two alphabetic clue words to run the experimental solver.');
      setResult(null);
      return;
    }

    const reqId = ++requestCounter.current;
    setInputError(null);
    setIsSolving(true);

    try {
      const constraints = buildConstraintsPayload(params.s1, params.l1, params.s2, params.l2);
      const response = await fetch('/api/v3/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clue1: clean1,
          clue2: clean2,
          constraints,
          knowledgeConfig: params.config,
          enableCompoundMatching: params.compounds,
          maxCandidates: 25,
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Solver request failed (${response.status})`);
      }

      const payload = (await response.json()) as SolveV3Response;
      if (reqId !== requestCounter.current) return;

      setResult(payload.result);
    } catch (err) {
      if (reqId !== requestCounter.current) return;
      setInputError(err instanceof Error ? err.message : 'Unable to reach the solver service.');
    } finally {
      if (reqId === requestCounter.current) {
        setIsSolving(false);
      }
    }
  };

  useEffect(() => {
    void executeSolve({
      c1: clue1,
      c2: clue2,
      s1: w1Start,
      l1: w1Len,
      s2: w2Start,
      l2: w2Len,
      config: knowledgeConfig,
      compounds: enableCompoundMatching,
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSolve({
      c1: clue1,
      c2: clue2,
      s1: w1Start,
      l1: w1Len,
      s2: w2Start,
      l2: w2Len,
      config: knowledgeConfig,
      compounds: enableCompoundMatching,
    });
  };

  const handleConfigChange = (nextConfig: KnowledgeConfig) => {
    setKnowledgeConfig(nextConfig);
    if (cleanClueToken(clue1) && cleanClueToken(clue2)) {
      void executeSolve({
        c1: clue1,
        c2: clue2,
        s1: w1Start,
        l1: w1Len,
        s2: w2Start,
        l2: w2Len,
        config: nextConfig,
        compounds: enableCompoundMatching,
      });
    }
  };

  const handleSelectPreset = (p: SamplePreset) => {
    setClue1(p.c1);
    setClue2(p.c2);

    const nextS1 = applyPresetConstraints ? p.w1S : '';
    const nextL1 = applyPresetConstraints ? p.w1L : '';
    const nextS2 = applyPresetConstraints ? p.w2S : '';
    const nextL2 = applyPresetConstraints ? p.w2L : '';

    setW1Start(nextS1);
    setW1Len(nextL1);
    setW2Start(nextS2);
    setW2Len(nextL2);
    if (applyPresetConstraints) {
      setShowConstraints(true);
    }

    void executeSolve({
      c1: p.c1,
      c2: p.c2,
      s1: nextS1,
      l1: nextL1,
      s2: nextS2,
      l2: nextL2,
      config: knowledgeConfig,
      compounds: enableCompoundMatching,
    });
  };

  const handleClearConstraints = () => {
    setW1Start('');
    setW1Len('');
    setW2Start('');
    setW2Len('');
    if (cleanClueToken(clue1) && cleanClueToken(clue2)) {
      void executeSolve({
        c1: clue1,
        c2: clue2,
        s1: '',
        l1: '',
        s2: '',
        l2: '',
        config: knowledgeConfig,
        compounds: enableCompoundMatching,
      });
    }
  };

  const handleReset = () => {
    requestCounter.current++;
    setClue1('');
    setClue2('');
    setW1Start('');
    setW1Len('');
    setW2Start('');
    setW2Len('');
    setResult(null);
    setInputError(null);
    setIsSolving(false);
  };

  const activeOption = KNOWLEDGE_CONFIG_OPTIONS.find((o) => o.id === knowledgeConfig)!;
  const resultBanner = result ? getProvenanceBannerMeta(result.knowledgeConfig) : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#f7f6f2] text-[#141619]">
      {/* Top Bar — 3 clean zones, single-line controls */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 min-w-0">
            <h1 className="font-editorial text-lg sm:text-xl font-bold tracking-tight text-stone-900 whitespace-nowrap">
              Flipit Finder
            </h1>
            <span className="text-xs font-medium text-stone-600">
              Public Beta · Experimental Word Puzzle Solver
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-stone-600 whitespace-nowrap">
            <span>Active Mode:</span>
            <strong className="font-mono text-stone-900">{activeOption.title}</strong>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              disabled={!result}
              className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 text-xs font-medium text-stone-700 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:cursor-default"
            >
              <Info className="w-3.5 h-3.5 text-blue-700" />
              Trace
              {showDiagnostics ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white hover:bg-stone-50 text-xs font-medium text-stone-700 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Public Beta Experimental Notice */}
        <section
          aria-label="Public Beta Experimental Notice"
          className="rounded-lg border border-stone-200 bg-white/90 px-4 py-3 text-xs text-stone-700 leading-relaxed flex items-start gap-2.5"
        >
          <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <p>
            <strong className="text-stone-900">Experimental Public Beta:</strong> Answers are{' '}
            <strong className="font-medium text-stone-900">ranked suggestions, not guaranteed solutions</strong>
            —accuracy varies depending on the puzzle. This solver evaluates clues using offline lexical
            dictionaries and semantic relationships. User puzzle inputs are{' '}
            <strong className="font-medium text-stone-900">not persistently stored</strong>.
          </p>
        </section>

        {/* Solver Workbench Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-stone-200 p-4 sm:p-6 space-y-5"
        >
          {/* Sample Clue Strip */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                Sample Clue Pairs
              </span>
              <label className="inline-flex items-center gap-2 text-xs text-stone-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applyPresetConstraints}
                  onChange={(e) => setApplyPresetConstraints(e.target.checked)}
                  className="rounded border-stone-300 text-blue-700 focus:ring-blue-700"
                />
                Apply puzzle starting-letter & length constraints
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PRESETS.map((p) => {
                const isActive = cleanClueToken(clue1) === p.c1 && cleanClueToken(clue2) === p.c2;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className={`px-2.5 py-1 rounded border text-xs font-mono transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-stone-50 text-stone-700 border-stone-200 hover:border-stone-400 hover:bg-stone-100'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clue Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="clue1-input"
                className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5"
              >
                Clue 1
              </label>
              <input
                id="clue1-input"
                type="text"
                maxLength={64}
                value={clue1}
                onChange={(e) => setClue1(e.target.value.toUpperCase())}
                placeholder="e.g. ABODE, INVOCATION, WET"
                className="w-full rounded-md border border-stone-300 bg-white px-3.5 py-2.5 font-mono text-base font-bold tracking-wide text-stone-900 placeholder:text-stone-400 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700 uppercase"
              />
            </div>

            <div>
              <label
                htmlFor="clue2-input"
                className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5"
              >
                Clue 2
              </label>
              <input
                id="clue2-input"
                type="text"
                maxLength={64}
                value={clue2}
                onChange={(e) => setClue2(e.target.value.toUpperCase())}
                placeholder="e.g. LEAVING, RITUAL, VEGETABLES"
                className="w-full rounded-md border border-stone-300 bg-white px-3.5 py-2.5 font-mono text-base font-bold tracking-wide text-stone-900 placeholder:text-stone-400 focus:border-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-700 uppercase"
              />
            </div>
          </div>

          {/* Optional Target Word Constraints */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowConstraints(!showConstraints)}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5" />
                {showConstraints
                  ? 'Hide Target Word Constraints (Optional)'
                  : 'Add Target Word Constraints (Optional)'}
              </button>

              {(w1Start || w1Len || w2Start || w2Len) && (
                <button
                  type="button"
                  onClick={handleClearConstraints}
                  className="text-xs text-stone-600 hover:text-stone-900 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Eraser className="w-3.5 h-3.5" />
                  Clear Constraints
                </button>
              )}
            </div>

            {showConstraints && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-md bg-stone-50 border border-stone-200">
                <div>
                  <label htmlFor="w1-start" className="block text-[11px] font-medium text-stone-600 mb-1">
                    Word 1 Starts With
                  </label>
                  <input
                    id="w1-start"
                    type="text"
                    maxLength={1}
                    value={w1Start}
                    onChange={(e) => setW1Start(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="Any"
                    className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-stone-900 uppercase focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="w1-len" className="block text-[11px] font-medium text-stone-600 mb-1">
                    Word 1 Length
                  </label>
                  <input
                    id="w1-len"
                    type="number"
                    min={1}
                    max={30}
                    value={w1Len}
                    onChange={(e) => setW1Len(e.target.value)}
                    placeholder="Any"
                    className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-stone-900 tabular-nums focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="w2-start" className="block text-[11px] font-medium text-stone-600 mb-1">
                    Word 2 Starts With
                  </label>
                  <input
                    id="w2-start"
                    type="text"
                    maxLength={1}
                    value={w2Start}
                    onChange={(e) => setW2Start(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="Any"
                    className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-stone-900 uppercase focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="w2-len" className="block text-[11px] font-medium text-stone-600 mb-1">
                    Word 2 Length
                  </label>
                  <input
                    id="w2-len"
                    type="number"
                    min={1}
                    max={30}
                    value={w2Len}
                    onChange={(e) => setW2Len(e.target.value)}
                    placeholder="Any"
                    className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold text-stone-900 tabular-nums focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Knowledge Configuration Selection */}
          <KnowledgeConfigSelector value={knowledgeConfig} onChange={handleConfigChange} />

          {inputError && (
            <div className="p-3 rounded-md bg-rose-50 border border-rose-200 text-rose-900 text-xs">
              {inputError}
            </div>
          )}

          {/* Submit Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-stone-200">
            <label className="inline-flex items-center gap-2 text-xs text-stone-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableCompoundMatching}
                onChange={(e) => setEnableCompoundMatching(e.target.checked)}
                className="rounded border-stone-300 text-blue-700 focus:ring-blue-700"
              />
              Include closed & hyphenated dictionary compounds
            </label>

            <button
              type="submit"
              disabled={isSolving}
              className="px-5 py-2.5 rounded-md bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Search className="w-4 h-4" />
              {isSolving ? 'Solving Offline...' : 'Solve Clue Pair'}
            </button>
          </div>
        </form>

        {/* Loading Placeholder */}
        {isSolving && !result && (
          <div className="bg-white rounded-lg border border-stone-200 p-8 text-center text-sm text-stone-600">
            Loading partitioned offline lexicon and evaluating clue transformations...
          </div>
        )}

        {/* Active Results */}
        {result && resultBanner && (
          <div className="space-y-4">
            {/* Explicit Knowledge Configuration Provenance Banner */}
            <div
              className={`rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${resultBanner.tone}`}
            >
              <div className="space-y-0.5">
                <div className="text-xs font-mono font-bold tracking-wide">
                  RESULT PROVENANCE · {resultBanner.label}
                </div>
                <p className="text-xs opacity-90">{resultBanner.detail}</p>
              </div>
              <div className="text-xs font-mono tabular-nums whitespace-nowrap shrink-0">
                {result.candidates.length} ranked · {result.totalCombinationsEvaluated.toLocaleString()} pairs ·{' '}
                {result.solveTimeMs.toFixed(1)} ms
              </div>
            </div>

            {/* Optional Pipeline Trace Drawer */}
            {showDiagnostics && (
              <PipelineDiagnosticsPanel
                diagnostic={result.diagnostic}
                solveTimeMs={result.solveTimeMs}
              />
            )}

            {/* Ranked Candidate Answers or Explicit No-Valid-Phrase State */}
            {result.candidates.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-600">
                    Ranked Candidate Answers ({result.candidates.length})
                  </h2>
                  <span className="text-xs text-stone-500">
                    Ordered deterministically by heuristic score
                  </span>
                </div>

                {result.candidates.map((cand, idx) => (
                  <CandidateCard
                    key={`${cand.targetPhrase}-${idx}`}
                    candidate={cand}
                    rank={idx + 1}
                    clue1={result.clue1}
                    clue2={result.clue2}
                    knowledgeConfig={result.knowledgeConfig}
                    constraints={result.constraints}
                    defaultExpanded={idx === 0}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-stone-200 p-6 sm:p-8 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <h2 className="font-editorial text-xl font-bold text-stone-900">
                      No Valid Phrase Recognized
                    </h2>
                    <p className="text-sm text-stone-700 leading-relaxed">
                      {result.diagnostic.failureDescription ||
                        `No recognized two-word phrase or compound matched transformations of "${result.clue1}" and "${result.clue2}" under ${resultBanner.label}.`}
                    </p>
                    <div className="text-xs font-mono text-stone-500 pt-1 tabular-nums">
                      Status Code: {result.diagnostic.failureReason || 'NO_RECOGNIZED_PHRASES'} · Clue 1 surviving:{' '}
                      {result.diagnostic.clue1.postConstraintCount}/{result.diagnostic.clue1.preConstraintCount} · Clue 2 surviving:{' '}
                      {result.diagnostic.clue2.postConstraintCount}/{result.diagnostic.clue2.preConstraintCount}
                    </div>
                  </div>
                </div>

                {!showDiagnostics && (
                  <div className="pt-2 border-t border-stone-200">
                    <button
                      type="button"
                      onClick={() => setShowDiagnostics(true)}
                      className="text-xs font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Info className="w-3.5 h-3.5" />
                      Inspect Clue Transformations & Constraint Rejections
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-stone-200 bg-white mt-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-stone-500">
          <span>
            Offline Lexical Dictionaries: Princeton WordNet 3.0 · Moby Thesaurus II · Moby Compound Words
          </span>
          <span>Public Beta · Inputs Not Stored</span>
        </div>
      </footer>
    </div>
  );
}
