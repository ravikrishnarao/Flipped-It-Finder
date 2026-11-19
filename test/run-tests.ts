/**
 * Flipit Finder - Master Automated Test Runner (V2.2)
 * Executes unit tests, original benchmark regression tests, and independent generalization tests.
 * Reports regression accuracy and independent generalization accuracy separately.
 */

import { runBenchmarkTests } from './benchmark.test.ts';
import { runGeneralizationTests } from './generalization.test.ts';
import { runDiagnosticRegressionTests } from './diagnostic-regression.test.ts';
import { runContextualRelationshipTests } from './contextual-relationships.test.ts';
import { runUnitTests, type TestResult } from './unit.test.ts';

function printHeader(title: string) {
  console.log('\n' + '='.repeat(74));
  console.log(`  ${title}`);
  console.log('='.repeat(74));
}

function runAll() {
  const startGlobal = performance.now();

  printHeader('FLIPIT FINDER SOLVER - AUTOMATED TEST SUITE (V2.2.4)');

  // 1. Run Unit Tests
  console.log('\n[1/5] Executing Unit Tests (Morphology, Providers, Engine, Ranker)...');
  const unitResults = runUnitTests();
  for (const r of unitResults) {
    const symbol = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`         Error: ${r.error}`);
    }
  }

  // 2. Run Benchmark Regression Tests (Original 17)
  console.log('\n[2/5] Executing Original 17 Benchmark Regression Tests...');
  const { results: benchResults, details: benchDetails } = runBenchmarkTests();
  for (const r of benchResults) {
    const symbol = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`         Error: ${r.error}`);
    }
  }

  // 3. Run Compositional Generalization Tests (12 Puzzles)
  console.log('\n[3/5] Executing Compositional Generalization Tests (WordNet + Moby)...');
  const { results: genResults, details: genDetails } = runGeneralizationTests();
  for (const r of genResults) {
    const symbol = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`         Error: ${r.error}`);
    }
  }

  // 4. Run Diagnostic & Pipeline Regression Tests (INVOCATION + RITUAL, etc.)
  console.log('\n[4/5] Executing Diagnostic & Pipeline Regression Tests (V2.2.3)...');
  const diagResults = runDiagnosticRegressionTests();
  for (const r of diagResults) {
    const symbol = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`         Error: ${r.error}`);
    }
  }

  // 5. Run Contextual & Activity Relationship Tests (DRY + MOP -> CLEAN SWEEP, etc.)
  console.log('\n[5/5] Executing Contextual & Activity Relationship Tests (V2.2.4)...');
  const contextualResults = runContextualRelationshipTests();
  for (const r of contextualResults) {
    const symbol = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  [${symbol}] ${r.name}`);
    if (!r.passed && r.error) {
      console.log(`         Error: ${r.error}`);
    }
  }

  // 4. Print Benchmark Regression Performance Table
  printHeader('ORIGINAL 17 REGRESSION PUZZLES MATRIX');
  console.log(
    'ID'.padEnd(12) +
    'CLUES'.padEnd(20) +
    'SOLVED PHRASE'.padEnd(18) +
    'MATCH SCORE'.padEnd(14) +
    'STATUS'.padEnd(10)
  );
  console.log('-'.repeat(74));

  for (const d of benchDetails) {
    const status = d.passed ? 'PASS' : 'FAIL';
    console.log(
      d.id.padEnd(12) +
      d.clues.padEnd(20) +
      d.resolved.padEnd(18) +
      `${(d.matchScore * 100).toFixed(1)}%`.padEnd(14) +
      status.padEnd(10)
    );
  }

  // 5. Print Compositional Generalization Performance Table
  printHeader('COMPOSITIONAL GENERALIZATION PUZZLES MATRIX');
  console.log(
    'ID'.padEnd(12) +
    'CLUES'.padEnd(20) +
    'SOLVED PHRASE'.padEnd(18) +
    'MATCH SCORE'.padEnd(14) +
    'STATUS'.padEnd(10)
  );
  console.log('-'.repeat(74));

  for (const d of genDetails) {
    const status = d.passed ? 'PASS' : 'FAIL';
    console.log(
      d.id.padEnd(12) +
      d.clues.padEnd(20) +
      d.resolved.padEnd(18) +
      `${(d.matchScore * 100).toFixed(1)}%`.padEnd(14) +
      status.padEnd(10)
    );
  }

  // 6. Overall Metrics Breakdown
  const benchPassed = benchDetails.filter((d) => d.passed).length;
  const benchAccuracy = (benchPassed / benchDetails.length) * 100;

  const genPassed = genDetails.filter((d) => d.passed).length;
  const genAccuracy = (genPassed / genDetails.length) * 100;

  const allResults: TestResult[] = [
    ...unitResults,
    ...benchResults,
    ...genResults,
    ...diagResults,
    ...contextualResults,
  ];
  const total = allResults.length;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = total - passed;
  const elapsed = Math.round((performance.now() - startGlobal) * 100) / 100;

  printHeader('TEST EXECUTION & ACCURACY SUMMARY');
  console.log(`Original Regression Accuracy    : ${benchAccuracy.toFixed(1)}% (${benchPassed} / ${benchDetails.length})`);
  console.log(`Compositional Generalization    : ${genAccuracy.toFixed(1)}% (${genPassed} / ${genDetails.length})`);
  console.log(`Note: Compositional accuracy measures generalization across offline WordNet/Moby datasets, not arbitrary unseen puzzles.`);
  console.log(`Total Tests Run                 : ${total}`);
  console.log(`Passed                          : ${passed}`);
  console.log(`Failed                          : ${failed}`);
  console.log(`Total Execution Time            : ${elapsed} ms\n`);

  if (failed > 0) {
    console.error(`❌ TEST SUITE FAILED: ${failed} test(s) did not pass.\n`);
    process.exit(1);
  } else {
    console.log(`✨ ALL TESTS PASSED SUCCESSFULLY! Generalized solver verified.\n`);
    process.exit(0);
  }
}

runAll();
