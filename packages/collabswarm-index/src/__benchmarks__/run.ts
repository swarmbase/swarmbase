import * as fs from 'fs';
import { join } from 'path';
import { runAllScenarios } from './scenarios';
import { BenchmarkRunner } from './benchmark-runner';
import { BenchmarkResult } from '../types';

async function main() {
  const scales = [100, 1000, 10000];
  const allResults: BenchmarkResult[] = [];

  for (const count of scales) {
    console.log(`\n## Running benchmarks at ${count} documents...`);
    const results = await runAllScenarios(count);
    allResults.push(...results);
    console.log(BenchmarkRunner.formatTable(results));
  }

  // Write JSON results
  const outPath = join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
