/**
 * Entry point for running all core package benchmarks.
 *
 * Usage:
 *   yarn workspace @collabswarm/collabswarm benchmark
 *   yarn workspace @collabswarm/collabswarm benchmark --iterations 500
 */
import * as fs from 'fs';
import { join } from 'path';
import { PaperBenchmarkRunner, BenchmarkSuiteResult } from './benchmark-runner';
import { runCrdtSyncLatencyBenchmarks } from './crdt-sync-latency';
import { runCryptoOverheadBenchmarks } from './crypto-overhead';
import { runConvergenceSimulationBenchmarks } from './convergence-simulation';

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
  console.log(`Running core benchmarks with ${iterations} iterations...\n`);

  const allSuites: BenchmarkSuiteResult[] = [];

  // 1. CRDT Sync Latency
  console.log('=== CRDT Sync Latency ===');
  const syncLatency = await runCrdtSyncLatencyBenchmarks(iterations);
  allSuites.push(syncLatency);
  console.log(PaperBenchmarkRunner.formatTable(syncLatency.results));
  console.log();

  // 2. Crypto Overhead
  console.log('=== Crypto Overhead ===');
  const cryptoOverhead = await runCryptoOverheadBenchmarks(iterations);
  allSuites.push(cryptoOverhead);
  console.log(PaperBenchmarkRunner.formatTable(cryptoOverhead.results));
  console.log();

  // 3. Convergence Simulation
  console.log('=== Convergence Simulation ===');
  const convergence = await runConvergenceSimulationBenchmarks(Math.max(10, Math.floor(iterations / 5)));
  allSuites.push(convergence);
  console.log(PaperBenchmarkRunner.formatTable(convergence.results));
  console.log();

  // Write JSON results
  const outPath = join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(allSuites, null, 2));
  console.log(`Results written to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
