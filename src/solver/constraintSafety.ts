/**
 * Flipit Finder — Constraint Validation & Safe Regex Evaluation
 * Protects all solver layers against catastrophic backtracking (ReDoS),
 * malformed patterns, and out-of-range constraint values.
 */

import type { WordConstraint } from './types.ts';

const MAX_PATTERN_LENGTH = 40;
const MAX_BRACE_QUANTIFIER = 40;
const MAX_TOTAL_QUANTIFIERS = 6;

/**
 * Validates that a regex pattern string (or RegExp source) cannot trigger
 * catastrophic backtracking or syntax errors before compilation.
 */
export function isSafeConstraintPattern(pattern: string | RegExp): {
  safe: boolean;
  reason?: string;
} {
  const source = typeof pattern === 'string' ? pattern : pattern.source;

  if (!source || source.length === 0) {
    return { safe: false, reason: 'Empty pattern' };
  }
  if (source.length > MAX_PATTERN_LENGTH) {
    return {
      safe: false,
      reason: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`,
    };
  }

  // Reject lookarounds, named/special group extensions (?=...), (?<=...), backreferences (\1..\9)
  if (/\(\?[=!<a-zA-Z:]/.test(source) || /\\[1-9]/.test(source)) {
    return { safe: false, reason: 'Lookarounds and backreferences are not permitted' };
  }

  // Reject adjacent quantifiers such as **, ++, *+, +*, ?+, ?*, }+ , etc.
  if (/([+*?]|\{\d+,?\d*\})\s*[+*?{]/.test(source)) {
    return { safe: false, reason: 'Adjacent quantifiers are not permitted' };
  }

  // Reject excessively large brace repeat bounds {N} or {N,M}
  const braceMatches = source.matchAll(/\{(\d+)(?:,(\d*))?\}/g);
  for (const m of braceMatches) {
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    if (
      !Number.isFinite(min) ||
      min > MAX_BRACE_QUANTIFIER ||
      (m[2] !== undefined && m[2] === '') || // Reject unbounded {N,}
      max > MAX_BRACE_QUANTIFIER ||
      max < min
    ) {
      return { safe: false, reason: 'Unbounded or excessive repetition range' };
    }
  }

  // Structural paren analysis to reject any group containing a quantifier or alternation
  // that is itself quantified: e.g. (a+)+, (a|aa)+, ([a-z]+)*, ((a)+)+
  const groupStack: Array<{ hasQuantifierOrAlt: boolean }> = [];
  let inCharClass = false;
  let totalQuantifiers = 0;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++; // Skip escaped char
      continue;
    }
    if (inCharClass) {
      if (ch === ']') inCharClass = false;
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      continue;
    }
    if (ch === '(') {
      groupStack.push({ hasQuantifierOrAlt: false });
      continue;
    }
    if (ch === ')') {
      const closed = groupStack.pop();
      if (!closed) {
        return { safe: false, reason: 'Unbalanced closing parenthesis' };
      }
      const next = source[i + 1];
      const nextIsQuantifier = next === '+' || next === '*' || next === '?' || next === '{';
      if (closed.hasQuantifierOrAlt && nextIsQuantifier) {
        return { safe: false, reason: 'Nested quantifier or quantified alternation rejected' };
      }
      if (groupStack.length > 0 && (closed.hasQuantifierOrAlt || nextIsQuantifier)) {
        groupStack[groupStack.length - 1].hasQuantifierOrAlt = true;
      }
      continue;
    }
    if (ch === '|') {
      if (groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasQuantifierOrAlt = true;
      }
      continue;
    }
    if (ch === '+' || ch === '*' || ch === '?' || ch === '{') {
      totalQuantifiers++;
      if (totalQuantifiers > MAX_TOTAL_QUANTIFIERS) {
        return { safe: false, reason: 'Too many quantifiers in pattern' };
      }
      if (groupStack.length > 0) {
        groupStack[groupStack.length - 1].hasQuantifierOrAlt = true;
      }
    }
  }

  if (inCharClass || groupStack.length > 0) {
    return { safe: false, reason: 'Unclosed character class or group' };
  }

  // Reject multiple unbounded wildcard runs like .*.*
  if (/\.\*.*\.\*|\.\+.*\.\+/.test(source)) {
    return { safe: false, reason: 'Repeated wildcard quantifiers are not permitted' };
  }

  return { safe: true };
}

/**
 * Safely compiles a constraint pattern into a non-global, case-insensitive RegExp,
 * or returns an explicit failure reason if unsafe/invalid.
 */
export function compileSafeConstraintRegex(
  pattern: string | RegExp
): { regex?: RegExp; reason?: string } {
  const check = isSafeConstraintPattern(pattern);
  if (!check.safe) {
    return { reason: check.reason || 'Unsafe pattern rejected' };
  }

  try {
    const source = typeof pattern === 'string' ? pattern : pattern.source;
    // Always compile fresh without g/y flags to keep .test() stateless and bounded
    return { regex: new RegExp(source, 'i') };
  } catch {
    return { reason: 'Invalid constraint pattern syntax' };
  }
}

/**
 * Validate a candidate word against a WordConstraint rule, returning structured match status and reasons.
 */
export function evaluateWordConstraint(
  word: string,
  constraint?: WordConstraint
): { matches: boolean; reason?: string } {
  if (!constraint) return { matches: true };
  const cleanWord = word.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
  if (!cleanWord) {
    return { matches: false, reason: 'Candidate word is empty or non-alphanumeric' };
  }

  const failures: string[] = [];

  if (typeof constraint.length === 'number' && cleanWord.length !== constraint.length) {
    failures.push(`Length is ${cleanWord.length} (expected ${constraint.length})`);
  }

  if (constraint.startsWith) {
    const prefix = constraint.startsWith.trim().toUpperCase();
    if (!cleanWord.startsWith(prefix)) {
      failures.push(`Starts with '${cleanWord.charAt(0)}' (expected '${prefix}')`);
    }
  }

  if (constraint.endsWith) {
    const suffix = constraint.endsWith.trim().toUpperCase();
    if (!cleanWord.endsWith(suffix)) {
      failures.push(`Ends with '${cleanWord.slice(-suffix.length)}' (expected '${suffix}')`);
    }
  }

  if (constraint.pattern) {
    const compiled = compileSafeConstraintRegex(constraint.pattern);
    if (!compiled.regex) {
      failures.push(`Rejected unsafe constraint pattern: ${compiled.reason}`);
    } else if (!compiled.regex.test(cleanWord)) {
      failures.push(
        `Does not match pattern /${typeof constraint.pattern === 'string' ? constraint.pattern : constraint.pattern.source}/`
      );
    }
  }

  if (failures.length > 0) {
    return { matches: false, reason: failures.join('; ') };
  }

  return { matches: true };
}
