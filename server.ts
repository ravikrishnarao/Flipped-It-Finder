/**
 * Flipit Finder — Public Beta Express + Vite Server
 *
 * Serves the React UI and hosts the strictly offline FlipitV3Solver
 * behind local /api/* routes using bounded LRU partition caching.
 * Default solver mode: 'hybrid' (V3 + Contextual Associations; Curated Phrases disabled).
 */

import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CluePairConstraints, WordConstraint } from './src/solver/types.ts';
import { PartitionLoader } from './src/solver/v3/partitionLoader.ts';
import type { PhraseMatchType } from './src/solver/v3/phraseTypes.ts';
import type { KnowledgeConfig } from './src/solver/v3/types.ts';
import { FlipitV3Solver, type V3SolveResult } from './src/solver/v3/v3Solver.ts';

export const DEFAULT_KNOWLEDGE_CONFIG: KnowledgeConfig = 'hybrid';
export const MAX_CLUE_RAW_LENGTH = 64;
export const MAX_CONSTRAINT_WORD_LENGTH = 30;
export const DEFAULT_RATE_LIMIT_MAX = 40;
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_MAX_TRACKED_IPS = 10_000;

const VALID_KNOWLEDGE_CONFIGS = new Set<KnowledgeConfig>([
  'pure-v3',
  'hybrid',
  'full-compatibility',
]);

const VALID_MATCH_TYPES = new Set<PhraseMatchType>(['open', 'closed', 'hyphenated']);
const ALLOWED_CONSTRAINT_PAIR_KEYS = new Set(['word1', 'word2']);
const ALLOWED_WORD_CONSTRAINT_KEYS = new Set(['length', 'startsWith', 'endsWith']);

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function snapMemory() {
  const m = process.memoryUsage();
  return {
    rssMB: Math.round((m.rss / 1024 / 1024) * 100) / 100,
    heapUsedMB: Math.round((m.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((m.heapTotal / 1024 / 1024) * 100) / 100,
  };
}

function normalizeClueToken(raw: string): string {
  return raw.trim().toUpperCase().replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
}

export interface ValidatedSolveRequest {
  clue1: string;
  clue2: string;
  constraints?: CluePairConstraints;
  knowledgeConfig: KnowledgeConfig;
  enableCompoundMatching: boolean;
  allowedMatchTypes?: PhraseMatchType[];
  maxCandidates: number;
}

export function validateWordConstraintInput(
  raw: unknown,
  label: string
): { ok: true; value?: WordConstraint } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (!isPlainObject(raw)) {
    return { ok: false, error: `Invalid ${label} constraint object.` };
  }

  for (const key of Object.keys(raw)) {
    if (key === 'pattern') {
      return {
        ok: false,
        error: `Custom regular expression patterns (${label}.pattern) are not allowed.`,
      };
    }
    if (!ALLOWED_WORD_CONSTRAINT_KEYS.has(key)) {
      return {
        ok: false,
        error: `Unsupported ${label} constraint field "${key}".`,
      };
    }
  }

  const clean: WordConstraint = {};

  if (raw.length !== undefined) {
    if (
      typeof raw.length !== 'number' ||
      !Number.isInteger(raw.length) ||
      raw.length < 1 ||
      raw.length > MAX_CONSTRAINT_WORD_LENGTH
    ) {
      return {
        ok: false,
        error: `Invalid ${label}.length: expected an integer between 1 and ${MAX_CONSTRAINT_WORD_LENGTH}.`,
      };
    }
    clean.length = raw.length;
  }

  if (raw.startsWith !== undefined) {
    if (typeof raw.startsWith !== 'string') {
      return { ok: false, error: `Invalid ${label}.startsWith: expected a single letter string.` };
    }
    const trimmed = raw.startsWith.trim().toUpperCase();
    if (trimmed.length > 0) {
      if (!/^[A-Z0-9]$/.test(trimmed)) {
        return {
          ok: false,
          error: `Invalid ${label}.startsWith: expected a single alphanumeric character.`,
        };
      }
      clean.startsWith = trimmed;
    }
  }

  if (raw.endsWith !== undefined) {
    if (typeof raw.endsWith !== 'string') {
      return { ok: false, error: `Invalid ${label}.endsWith: expected a single letter string.` };
    }
    const trimmed = raw.endsWith.trim().toUpperCase();
    if (trimmed.length > 0) {
      if (!/^[A-Z0-9]$/.test(trimmed)) {
        return {
          ok: false,
          error: `Invalid ${label}.endsWith: expected a single alphanumeric character.`,
        };
      }
      clean.endsWith = trimmed;
    }
  }

  return {
    ok: true,
    value: Object.keys(clean).length > 0 ? clean : undefined,
  };
}

export function parseSolveRequest(
  rawBody: unknown
): { ok: true; value: ValidatedSolveRequest } | { ok: false; error: string } {
  if (!isPlainObject(rawBody)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  if (typeof rawBody.clue1 !== 'string' || typeof rawBody.clue2 !== 'string') {
    return { ok: false, error: 'Both clue1 and clue2 must be non-empty strings.' };
  }

  if (
    rawBody.clue1.length > MAX_CLUE_RAW_LENGTH ||
    rawBody.clue2.length > MAX_CLUE_RAW_LENGTH
  ) {
    return {
      ok: false,
      error: `Clue inputs must not exceed ${MAX_CLUE_RAW_LENGTH} characters.`,
    };
  }

  if (!normalizeClueToken(rawBody.clue1) || !normalizeClueToken(rawBody.clue2)) {
    return {
      ok: false,
      error: 'Both clue1 and clue2 must contain at least one alphanumeric character.',
    };
  }

  let knowledgeConfig: KnowledgeConfig = DEFAULT_KNOWLEDGE_CONFIG;
  if (rawBody.knowledgeConfig !== undefined) {
    if (
      typeof rawBody.knowledgeConfig !== 'string' ||
      !VALID_KNOWLEDGE_CONFIGS.has(rawBody.knowledgeConfig as KnowledgeConfig)
    ) {
      return {
        ok: false,
        error: `Invalid knowledgeConfig "${String(rawBody.knowledgeConfig)}". Expected one of: pure-v3, hybrid, full-compatibility.`,
      };
    }
    knowledgeConfig = rawBody.knowledgeConfig as KnowledgeConfig;
  }

  let constraints: CluePairConstraints | undefined;
  if (rawBody.constraints !== undefined) {
    if (!isPlainObject(rawBody.constraints)) {
      return { ok: false, error: 'constraints must be a JSON object when provided.' };
    }
    for (const key of Object.keys(rawBody.constraints)) {
      if (!ALLOWED_CONSTRAINT_PAIR_KEYS.has(key)) {
        return { ok: false, error: `Unsupported constraint group "${key}".` };
      }
    }

    const w1Res = validateWordConstraintInput(rawBody.constraints.word1, 'constraints.word1');
    if (!w1Res.ok) return w1Res;
    const w2Res = validateWordConstraintInput(rawBody.constraints.word2, 'constraints.word2');
    if (!w2Res.ok) return w2Res;

    const cleanPair: CluePairConstraints = {};
    if (w1Res.value) cleanPair.word1 = w1Res.value;
    if (w2Res.value) cleanPair.word2 = w2Res.value;
    if (cleanPair.word1 || cleanPair.word2) {
      constraints = cleanPair;
    }
  }

  let enableCompoundMatching = true;
  if (rawBody.enableCompoundMatching !== undefined) {
    if (typeof rawBody.enableCompoundMatching !== 'boolean') {
      return { ok: false, error: 'enableCompoundMatching must be a boolean.' };
    }
    enableCompoundMatching = rawBody.enableCompoundMatching;
  }

  let allowedMatchTypes: PhraseMatchType[] | undefined;
  if (rawBody.allowedMatchTypes !== undefined) {
    if (!Array.isArray(rawBody.allowedMatchTypes) || rawBody.allowedMatchTypes.length === 0) {
      return {
        ok: false,
        error: 'allowedMatchTypes must be a non-empty array of: open, closed, hyphenated.',
      };
    }
    const deduped = new Set<PhraseMatchType>();
    for (const m of rawBody.allowedMatchTypes) {
      if (typeof m !== 'string' || !VALID_MATCH_TYPES.has(m as PhraseMatchType)) {
        return {
          ok: false,
          error: `Invalid match type "${String(m)}". Expected one of: open, closed, hyphenated.`,
        };
      }
      deduped.add(m as PhraseMatchType);
    }
    allowedMatchTypes = Array.from(deduped);
  }

  let maxCandidates = 25;
  if (rawBody.maxCandidates !== undefined) {
    if (
      typeof rawBody.maxCandidates !== 'number' ||
      !Number.isInteger(rawBody.maxCandidates) ||
      rawBody.maxCandidates < 1 ||
      rawBody.maxCandidates > 50
    ) {
      return {
        ok: false,
        error: 'maxCandidates must be an integer between 1 and 50.',
      };
    }
    maxCandidates = rawBody.maxCandidates;
  }

  return {
    ok: true,
    value: {
      clue1: rawBody.clue1,
      clue2: rawBody.clue2,
      constraints,
      knowledgeConfig,
      enableCompoundMatching,
      allowedMatchTypes,
      maxCandidates,
    },
  };
}

/**
 * Removes internal partition filenames, filesystem paths, and server memory telemetry
 * from public production solve responses while keeping linguistic diagnostics intact.
 */
export function sanitizeSolveResponseForPublic(result: V3SolveResult): { result: V3SolveResult } {
  const sanitizedResult: V3SolveResult = {
    ...result,
    diagnostic: {
      ...result.diagnostic,
      clue1: {
        ...result.diagnostic.clue1,
        relationshipLookupDiagnostics: {
          ...result.diagnostic.clue1.relationshipLookupDiagnostics,
          loadedPartitions: [],
          missingPartitions: [],
        },
      },
      clue2: {
        ...result.diagnostic.clue2,
        relationshipLookupDiagnostics: {
          ...result.diagnostic.clue2.relationshipLookupDiagnostics,
          loadedPartitions: [],
          missingPartitions: [],
        },
      },
    },
  };

  return { result: sanitizedResult };
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export interface RateLimiterCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

export class BoundedIpRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxTrackedIps: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(options?: {
    maxRequests?: number;
    windowMs?: number;
    maxTrackedIps?: number;
    cleanupIntervalMs?: number;
  }) {
    this.maxRequests = options?.maxRequests ?? DEFAULT_RATE_LIMIT_MAX;
    this.windowMs = options?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
    this.maxTrackedIps = options?.maxTrackedIps ?? DEFAULT_MAX_TRACKED_IPS;

    const cleanupIntervalMs = options?.cleanupIntervalMs ?? this.windowMs;
    this.cleanupTimer = setInterval(() => {
      this.sweepExpired();
    }, cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  public sweepExpired(now = Date.now()): number {
    let removed = 0;
    for (const [ip, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(ip);
        removed++;
      }
    }
    return removed;
  }

  public check(rawIp: string, now = Date.now()): RateLimiterCheckResult {
    const ip = rawIp || 'unknown';
    const existing = this.buckets.get(ip);

    if (existing && now < existing.resetAt) {
      if (existing.count >= this.maxRequests) {
        const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
        return {
          allowed: false,
          limit: this.maxRequests,
          remaining: 0,
          resetAt: existing.resetAt,
          retryAfterSec,
        };
      }

      existing.count++;
      // Refresh LRU insertion order
      this.buckets.delete(ip);
      this.buckets.set(ip, existing);
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - existing.count),
        resetAt: existing.resetAt,
        retryAfterSec: 0,
      };
    }

    if (existing) {
      this.buckets.delete(ip);
    }

    if (this.buckets.size >= this.maxTrackedIps) {
      this.sweepExpired(now);
      while (this.buckets.size >= this.maxTrackedIps) {
        const oldestKey = this.buckets.keys().next().value;
        if (!oldestKey) break;
        this.buckets.delete(oldestKey);
      }
    }

    const fresh: RateLimitBucket = {
      count: 1,
      resetAt: now + this.windowMs,
    };
    this.buckets.set(ip, fresh);

    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - 1),
      resetAt: fresh.resetAt,
      retryAfterSec: 0,
    };
  }

  public size(): number {
    return this.buckets.size;
  }

  public destroy(): void {
    clearInterval(this.cleanupTimer);
    this.buckets.clear();
  }
}

export function createSolverInstance(options?: { maxPartitions?: number; maxCacheBytes?: number }) {
  const loader = new PartitionLoader({
    maxPartitions: options?.maxPartitions ?? 64,
    maxCacheBytes: options?.maxCacheBytes ?? 64 * 1024 * 1024, // 64 MiB bounded LRU budget
  });
  return new FlipitV3Solver({
    partitionLoader: loader,
    knowledgeConfig: DEFAULT_KNOWLEDGE_CONFIG,
  });
}

function resolveTrustProxySetting(): boolean | number {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') return 1;
  if (raw === 'false' || raw === '0') return false;
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 5) {
    return parsed;
  }
  return 1;
}

export interface CreateAppOptions {
  isProduction?: boolean;
  mountFrontend?: boolean;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  maxTrackedIps?: number;
  solver?: FlipitV3Solver;
}

export async function createApp(options?: CreateAppOptions): Promise<{
  app: Express;
  solver: FlipitV3Solver;
  rateLimiter: BoundedIpRateLimiter;
}> {
  const isProduction = options?.isProduction ?? process.env.NODE_ENV === 'production';
  const mountFrontend = options?.mountFrontend ?? true;

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxySetting());

  // Security headers and strict same-origin CORS policy
  const allowedOrigin = process.env.CORS_ALLOWED_ORIGIN?.trim() || '';
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  // Clean 400 response for malformed JSON payloads
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON request body.' });
      return;
    }
    next(err);
  });

  const solver = options?.solver ?? createSolverInstance();
  const rateLimiter = new BoundedIpRateLimiter({
    maxRequests: options?.rateLimitMax ?? DEFAULT_RATE_LIMIT_MAX,
    windowMs: options?.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
    maxTrackedIps: options?.maxTrackedIps ?? DEFAULT_MAX_TRACKED_IPS,
  });

  app.get('/api/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'flipit-finder',
      release: 'public-beta',
      defaultKnowledgeConfig: DEFAULT_KNOWLEDGE_CONFIG,
    });
  });

  app.post('/api/v3/solve', async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = rateLimiter.check(clientIp);
    res.setHeader('RateLimit-Limit', String(rateCheck.limit));
    res.setHeader('RateLimit-Remaining', String(rateCheck.remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(rateCheck.resetAt / 1000)));

    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSec));
      res.status(429).json({
        error: 'Too many requests. Please wait a minute before trying again.',
      });
      return;
    }

    const parsed = parseSolveRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    try {
      const {
        clue1,
        clue2,
        constraints,
        knowledgeConfig,
        enableCompoundMatching,
        allowedMatchTypes,
        maxCandidates,
      } = parsed.value;

      const result = await solver.solve(clue1, clue2, constraints, {
        knowledgeConfig,
        enableCompoundMatching,
        allowedMatchTypes,
        maxCandidates,
      });

      if (isProduction) {
        res.json(sanitizeSolveResponseForPublic(result));
      } else {
        res.json({
          result,
          cacheStats: solver.getCacheStats(),
          memory: snapMemory(),
        });
      }
    } catch (err) {
      console.error('[Flipit V3 Server] Solve error:', err);
      res.status(500).json({ error: 'Offline solver execution failed.' });
    }
  });

  app.get('/api/v3/cache', (_req, res) => {
    if (isProduction) {
      res.status(403).json({ error: 'Cache diagnostics are disabled in production.' });
      return;
    }
    res.json({
      cacheStats: solver.getCacheStats(),
      memory: snapMemory(),
    });
  });

  app.post('/api/v3/cache/clear', (_req, res) => {
    if (isProduction) {
      res.status(403).json({ error: 'Cache clearing is disabled in production.' });
      return;
    }
    solver.partitionLoader.clearCache();
    res.json({
      cleared: true,
      cacheStats: solver.getCacheStats(),
      memory: snapMemory(),
    });
  });

  // Ensure unknown /api/* routes return JSON 404 rather than falling through to SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (mountFrontend) {
    if (!isProduction) {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distDir = path.resolve(process.cwd(), 'dist');
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  // Final fallback error handler (never exposes stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Flipit V3 Server] Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return { app, solver, rateLimiter };
}

async function startServer() {
  const { app } = await createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`[Flipit Finder V3] Offline server listening on http://0.0.0.0:${port}`);
  });
}

const currentFile = path.resolve(fileURLToPath(import.meta.url));
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryFile === currentFile) {
  startServer().catch((err) => {
    console.error('[Flipit Finder V3] Failed to start server:', err);
    process.exit(1);
  });
}
