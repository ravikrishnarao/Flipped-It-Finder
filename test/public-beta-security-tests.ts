/**
 * Flipit Finder — Public Beta Security, Validation & Production Hardening Tests
 */

import * as assert from 'node:assert';
import * as http from 'node:http';
import {
  BoundedIpRateLimiter,
  createApp,
} from '../server.ts';
import {
  evaluateWordConstraint,
  isSafeConstraintPattern,
} from '../src/solver/constraintSafety.ts';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  options?: {
    body?: string | Record<string, unknown>;
    headers?: Record<string, string>;
  }
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, baseUrl);
    const payload =
      typeof options?.body === 'string'
        ? options.body
        : options?.body !== undefined
        ? JSON.stringify(options.body)
        : undefined;

    const reqHeaders: Record<string, string> = {
      ...(options?.headers ?? {}),
    };
    if (payload !== undefined && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      parsed,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      }
    );

    req.on('error', reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

async function runSecurityTests() {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.stack || err.message : String(err)}`);
      failed++;
    }
  }

  console.log('\n======================================================================');
  console.log(' FLIPIT FINDER — PUBLIC BETA SECURITY & HARDENING TEST SUITE');
  console.log('======================================================================');

  // ------------------------------------------------------------------
  // 1. Solver-level Regex Safety & ReDoS Protection
  // ------------------------------------------------------------------
  console.log('\n[1/4] Testing Solver-Level Regex Safety & Constraint Guard...');

  await test('Rejects catastrophic backtracking and unsafe regex patterns directly in solver layer', () => {
    const unsafePatterns = [
      '(a+)+$',
      '([a-z]+)*$',
      '(a|aa)+b',
      '((x+)+)y',
      '.*.*$',
      '(?=a)b',
      '(a)\\1',
      '[unclosed',
      'A'.repeat(45),
      'a{5,}',
    ];

    for (const pat of unsafePatterns) {
      const check = isSafeConstraintPattern(pat);
      assert.strictEqual(check.safe, false, `Expected pattern "${pat}" to be rejected`);

      const t0 = performance.now();
      const evalRes = evaluateWordConstraint('AAAAAAAAAAAAAAAAAAAAAAAAAAAA!', { pattern: pat });
      const elapsed = performance.now() - t0;
      assert.strictEqual(evalRes.matches, false, `Expected unsafe pattern "${pat}" to fail safely`);
      assert.ok(elapsed < 50, `Expected near-instant evaluation, took ${elapsed}ms`);
    }
  });

  await test('Allows benign literal/anchored word patterns when invoked via internal TypeScript API', () => {
    assert.strictEqual(evaluateWordConstraint('HOME', { pattern: '^H..E$' }).matches, true);
    assert.strictEqual(evaluateWordConstraint('HOUSE', { pattern: '^H..E$' }).matches, false);
    assert.strictEqual(evaluateWordConstraint('CLEAN', { pattern: '^C[A-Z]{3}N$' }).matches, true);
  });

  // ------------------------------------------------------------------
  // 2. Bounded IP Rate Limiter Unit & Memory Cap Checks
  // ------------------------------------------------------------------
  console.log('\n[2/4] Testing Bounded Per-IP Rate Limiter Cleanup & Cap...');

  await test('BoundedIpRateLimiter enforces 40 req/min limit, cleans expired entries, and caps tracked IPs', () => {
    const limiter = new BoundedIpRateLimiter({
      maxRequests: 40,
      windowMs: 60_000,
      maxTrackedIps: 5,
    });

    try {
      const t0 = 1_000_000;
      for (let i = 1; i <= 40; i++) {
        const res = limiter.check('198.51.100.10', t0 + i * 100);
        assert.strictEqual(res.allowed, true, `Request #${i} should be allowed`);
        assert.strictEqual(res.remaining, 40 - i);
      }

      const blocked = limiter.check('198.51.100.10', t0 + 5_000);
      assert.strictEqual(blocked.allowed, false, '41st request within minute must be blocked');
      assert.strictEqual(blocked.remaining, 0);
      assert.ok(blocked.retryAfterSec >= 1);

      // Resets after 60s window expires
      const resetOk = limiter.check('198.51.100.10', t0 + 61_000);
      assert.strictEqual(resetOk.allowed, true);
      assert.strictEqual(resetOk.remaining, 39);

      // Flood from 25 unique IPs must remain strictly bounded <= maxTrackedIps (5)
      for (let ipIdx = 0; ipIdx < 25; ipIdx++) {
        limiter.check(`203.0.113.${ipIdx}`, t0 + 62_000);
      }
      assert.ok(
        limiter.size() <= 5,
        `Rate limiter bucket count exceeded maxTrackedIps (got ${limiter.size()})`
      );

      // Expired sweep drops stale buckets cleanly
      const removed = limiter.sweepExpired(t0 + 130_000);
      assert.ok(removed > 0);
      assert.strictEqual(limiter.size(), 0);
    } finally {
      limiter.destroy();
    }
  });

  // ------------------------------------------------------------------
  // 3. Live Production HTTP Server Security & Validation Checks
  // ------------------------------------------------------------------
  console.log('\n[3/4] Testing Live Production Express App (Validation, Headers, Telemetry)...');

  const { app, rateLimiter } = await createApp({
    isProduction: true,
    mountFrontend: true,
    rateLimitMax: 40,
    rateLimitWindowMs: 60_000,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await test('GET / returns HTTP 200 with Public Beta title and security headers', async () => {
      const res = await httpRequest(baseUrl, 'GET', '/');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.includes('Flipit Finder'));
      assert.ok(res.body.includes('Public Beta'));
      assert.strictEqual(res.headers['x-powered-by'], undefined);
      assert.strictEqual(res.headers['x-content-options'] ?? res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
    });

    await test('GET /api/health returns HTTP 200 without memory or filesystem telemetry', async () => {
      const res = await httpRequest(baseUrl, 'GET', '/api/health');
      assert.strictEqual(res.status, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.defaultKnowledgeConfig, 'hybrid');
      assert.strictEqual(data.memory, undefined);
      assert.strictEqual(data.cacheStats, undefined);
    });

    await test('Same-origin CORS policy omits Access-Control-Allow-Origin for untrusted origins', async () => {
      const res = await httpRequest(baseUrl, 'GET', '/api/health', {
        headers: { Origin: 'https://untrusted.example.com' },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
    });

    await test('Default solve mode uses hybrid (Curated disabled) and solves DRY + MOP -> CLEAN SWEEP cleanly', async () => {
      const res = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': '198.51.100.50' },
        body: {
          clue1: 'DRY',
          clue2: 'MOP',
          constraints: {
            word1: { startsWith: 'C', length: 5 },
            word2: { startsWith: 'S', length: 5 },
          },
          enableCompoundMatching: true,
        },
      });
      assert.strictEqual(res.status, 200);
      const data = JSON.parse(res.body);
      assert.strictEqual(data.result.knowledgeConfig, 'hybrid');
      assert.strictEqual(data.result.bestMatch?.targetPhrase, 'CLEAN SWEEP');

      // Production telemetry stripping checks
      assert.strictEqual(data.memory, undefined, 'memory must not be exposed in production');
      assert.strictEqual(data.cacheStats, undefined, 'cacheStats must not be exposed in production');
      assert.deepStrictEqual(
        data.result.diagnostic.clue1.relationshipLookupDiagnostics.loadedPartitions,
        []
      );
      assert.deepStrictEqual(
        data.result.diagnostic.clue2.relationshipLookupDiagnostics.loadedPartitions,
        []
      );
      assert.ok(!res.body.includes('rssMB'), 'Response must not include rssMB');
      assert.ok(!res.body.includes('data/v3'), 'Response must not include filesystem paths');
      assert.ok(!res.body.includes('wn_d.json'), 'Response must not include partition filenames');
    });

    await test('Rejects client-supplied regex patterns with HTTP 400', async () => {
      const res1 = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': '198.51.100.51' },
        body: {
          clue1: 'DRY',
          clue2: 'MOP',
          constraints: { word1: { pattern: '(a+)+$' } },
        },
      });
      assert.strictEqual(res1.status, 400);

      const res2 = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': '198.51.100.51' },
        body: {
          clue1: 'DRY',
          clue2: 'MOP',
          constraints: { word2: { pattern: '^S.*' } },
        },
      });
      assert.strictEqual(res2.status, 400);
    });

    await test('Rejects excessively long clues (>64 chars) and allows <=64 char valid strings', async () => {
      const resTooLong = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': '198.51.100.52' },
        body: {
          clue1: 'A'.repeat(65),
          clue2: 'MOP',
        },
      });
      assert.strictEqual(resTooLong.status, 400);

      const resExact64 = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': '198.51.100.52' },
        body: {
          clue1: 'A'.repeat(64),
          clue2: 'MOP',
        },
      });
      assert.strictEqual(resExact64.status, 200);
    });

    await test('Rejects malformed requests, invalid constraints, and bad JSON with HTTP 400 (never 500)', async () => {
      const badBodies: Array<string | Record<string, unknown>> = [
        '{bad json',
        '[]',
        {},
        { clue1: '', clue2: 'MOP' },
        { clue1: '!!!', clue2: 'MOP' },
        { clue1: 123, clue2: 'MOP' },
        { clue1: 'DRY', clue2: 'MOP', knowledgeConfig: 'unknown-mode' },
        { clue1: 'DRY', clue2: 'MOP', enableCompoundMatching: 'true' },
        { clue1: 'DRY', clue2: 'MOP', allowedMatchTypes: [] },
        { clue1: 'DRY', clue2: 'MOP', allowedMatchTypes: ['invalid'] },
        { clue1: 'DRY', clue2: 'MOP', maxCandidates: 51 },
        { clue1: 'DRY', clue2: 'MOP', maxCandidates: 0 },
        { clue1: 'DRY', clue2: 'MOP', constraints: 'bad' },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word3: { length: 4 } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { length: 0 } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { length: 31 } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { length: 4.5 } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { startsWith: 'AB' } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { endsWith: '$' } } },
        { clue1: 'DRY', clue2: 'MOP', constraints: { word1: { unexpected: true } } },
      ];

      for (const body of badBodies) {
        const res = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
          headers: { 'X-Forwarded-For': '198.51.100.53' },
          body,
        });
        assert.strictEqual(
          res.status,
          400,
          `Expected 400 for body ${typeof body === 'string' ? body : JSON.stringify(body)}, got ${res.status}`
        );
      }
    });

    await test('Production disables POST /api/v3/cache/clear and GET /api/v3/cache', async () => {
      const clearRes = await httpRequest(baseUrl, 'POST', '/api/v3/cache/clear');
      assert.strictEqual(clearRes.status, 403);

      const getRes = await httpRequest(baseUrl, 'GET', '/api/v3/cache');
      assert.strictEqual(getRes.status, 403);
    });

    // ------------------------------------------------------------------
    // 4. Live HTTP Rate Limit Verification (40 req/min -> 41st = 429)
    // ------------------------------------------------------------------
    console.log('\n[4/4] Verifying Live HTTP Rate Limiting (40 req/min)...');

    await test('POST /api/v3/solve enforces 40 req/min per IP and returns HTTP 429 on 41st request', async () => {
      const testIp = '198.51.100.99';
      for (let i = 1; i <= 40; i++) {
        const res = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
          headers: { 'X-Forwarded-For': testIp },
          body: {
            clue1: 'ABODE',
            clue2: 'LEAVING',
            constraints: {
              word1: { startsWith: 'H', length: 4 },
              word2: { startsWith: 'C', length: 6 },
            },
          },
        });
        assert.strictEqual(res.status, 200, `Request #${i} expected 200, got ${res.status}`);
      }

      const limited = await httpRequest(baseUrl, 'POST', '/api/v3/solve', {
        headers: { 'X-Forwarded-For': testIp },
        body: { clue1: 'ABODE', clue2: 'LEAVING' },
      });
      assert.strictEqual(limited.status, 429);
      assert.ok(Number(limited.headers['retry-after']) >= 1);
      assert.strictEqual(limited.headers['ratelimit-remaining'], '0');
    });
  } finally {
    rateLimiter.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n----------------------------------------------------------------------');
  console.log(` SECURITY & HARDENING RESULTS: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
