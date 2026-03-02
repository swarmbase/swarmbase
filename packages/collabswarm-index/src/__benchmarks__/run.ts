/**
 * Entry point for running all index package benchmarks.
 *
 * Usage:
 *   yarn workspace @collabswarm/collabswarm-index benchmark
 *   yarn workspace @collabswarm/collabswarm-index benchmark --iterations 500
 */
import * as fs from 'fs';
import { join } from 'path';
import { Crypto } from '@peculiar/webcrypto';

// Install WebCrypto polyfill for Node.js
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  (globalThis as any).crypto = new Crypto();
}

import { PaperBenchmarkRunner, BenchmarkSuiteResult } from './paper-benchmark-runner';
import { BenchmarkRunner } from './benchmark-runner';
import { BenchmarkResult } from '../types';
import { runAllScenarios } from './scenarios';
import { runIndexQueryScalingBenchmarks } from './index-query-scaling';
import { runBlindIndexPerfBenchmarks } from './blind-index-perf';
import { runBloomFilterScalingBenchmarks } from './bloom-filter-scaling';

function parseIterations(): number {
  const idx = process.argv.indexOf('--iterations');
  if (idx !== -1 && process.argv[idx + 1]) {
    const val = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return 100;
}

async function main() {
  const iterations = parseIterations();
  console.log(`Running index benchmarks with ${iterations} iterations...\n`);

  const allSuites: BenchmarkSuiteResult[] = [];

  // --- Legacy scenarios (existing benchmarks) ---
  console.log('=== Legacy Index Scenarios ===');
  const legacyScales = [100, 1000, 10000];
  const allLegacyResults: BenchmarkResult[] = [];
  for (const count of legacyScales) {
    console.log(`\n## Running legacy benchmarks at ${count} documents...`);
    const results = await runAllScenarios(count);
    allLegacyResults.push(...results);
    console.log(BenchmarkRunner.formatTable(results));
  }
  console.log();

  // --- New paper-quality benchmarks ---

  // 1. Index Query Scaling
  console.log('=== Index Query Scaling ===');
  const queryScaling = await runIndexQueryScalingBenchmarks(iterations);
  allSuites.push(queryScaling);
  console.log(PaperBenchmarkRunner.formatTable(queryScaling.results));
  console.log();

  // 2. Blind Index Performance
  console.log('=== Blind Index Performance ===');
  const blindIndex = await runBlindIndexPerfBenchmarks(iterations);
  allSuites.push(blindIndex);
  console.log(PaperBenchmarkRunner.formatTable(blindIndex.results));
  console.log();

  // 3. Bloom Filter Scaling
  console.log('=== Bloom Filter Scaling ===');
  const bloomFilter = await runBloomFilterScalingBenchmarks(iterations);
  allSuites.push(bloomFilter);
  console.log(PaperBenchmarkRunner.formatTable(bloomFilter.results));
  console.log();

  // Write JSON results (paper-quality format)
  const outPath = join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(allSuites, null, 2));
  console.log(`Results written to ${outPath}`);

  // Also write legacy results
  const legacyOutPath = join(__dirname, 'legacy-results.json');
  fs.writeFileSync(legacyOutPath, JSON.stringify(allLegacyResults, null, 2));
  console.log(`Legacy results written to ${legacyOutPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
