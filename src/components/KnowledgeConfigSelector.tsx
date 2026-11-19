import React from 'react';
import type { KnowledgeConfig } from '../types/v3Api.ts';

interface KnowledgeConfigOption {
  id: KnowledgeConfig;
  title: string;
  tag: string;
  summary: string;
  datasets: string;
}

export const KNOWLEDGE_CONFIG_OPTIONS: KnowledgeConfigOption[] = [
  {
    id: 'pure-v3',
    title: 'Pure V3',
    tag: 'STRICT V3 LEXICON',
    summary: 'Compiled V3 lexical & phrase datasets only. Contextual lexicon and legacy V2.2.4 curated phrases are disabled.',
    datasets: 'WordNet 3.0 · Moby Thesaurus II · WordNet Collocations · Moby Compounds',
  },
  {
    id: 'hybrid',
    title: 'Hybrid',
    tag: 'V3 + CONTEXTUAL · DEFAULT',
    summary: 'Pure V3 datasets plus curated activity/contextual associations. Legacy V2.2.4 curated phrases remain disabled.',
    datasets: 'Pure V3 + Contextual Associations · No Curated Phrases',
  },
  {
    id: 'full-compatibility',
    title: 'Full Compatibility',
    tag: 'LEGACY-ASSISTED',
    summary: 'Combines V3 and Contextual engines with legacy V2.2.4 curated relationships and curated phrase repository.',
    datasets: 'Hybrid + Legacy V2.2.4 Relationships & Curated Phrases',
  },
];

interface KnowledgeConfigSelectorProps {
  value: KnowledgeConfig;
  onChange: (next: KnowledgeConfig) => void;
}

export const KnowledgeConfigSelector: React.FC<KnowledgeConfigSelectorProps> = ({
  value,
  onChange,
}) => {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wider text-stone-600">
        Knowledge Configuration
      </legend>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {KNOWLEDGE_CONFIG_OPTIONS.map((opt) => {
          const isSelected = value === opt.id;
          const isLegacy = opt.id === 'full-compatibility';
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              aria-pressed={isSelected}
              className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between gap-2 ${
                isSelected
                  ? isLegacy
                    ? 'bg-amber-50/70 border-amber-700 ring-1 ring-amber-700'
                    : 'bg-blue-50/60 border-blue-700 ring-1 ring-blue-700'
                  : 'bg-white border-stone-200 hover:border-stone-400'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-stone-900">{opt.title}</span>
                  <span
                    className={`text-[10px] font-mono font-semibold tracking-wide px-1.5 py-0.5 rounded border whitespace-nowrap ${
                      isSelected
                        ? isLegacy
                          ? 'border-amber-700/40 bg-amber-100/80 text-amber-900'
                          : 'border-blue-700/30 bg-blue-100/80 text-blue-900'
                        : 'border-stone-200 bg-stone-100 text-stone-600'
                    }`}
                  >
                    {opt.tag}
                  </span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">{opt.summary}</p>
              </div>
              <div className="text-[11px] text-stone-500 pt-1.5 border-t border-stone-200/80">
                {opt.datasets}
              </div>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};
