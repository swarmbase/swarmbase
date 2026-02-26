import { BenchmarkResult } from '../types';

/**
 * Runs performance benchmarks and produces statistical results.
 */
export class BenchmarkRunner {
  /**
   * Run a benchmark function multiple times and compute statistics.
   * Includes warmup runs (10% of iterations) that are discarded.
   *
   * @param name Name of the benchmark
   * @param fn Function to benchmark (async supported)
   * @param iterations Number of measured iterations (default: 100)
   */
  async run(name: string, fn: () => Promise<void> | void, iterations: number = 100): Promise<BenchmarkResult> {
    const warmupCount = Math.max(1, Math.floor(iterations * 0.1));

    // Warmup
    for (let i = 0; i < warmupCount; i++) {
      await fn();
    }

    // Measure
    const times: number[] = [];
    const memBefore = typeof process !== 'undefined' ? process.memoryUsage().heapUsed : 0;

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await fn();
      const end = performance.now();
      times.push(end - start);
    }

    const memAfter = typeof process !== 'undefined' ? process.memoryUsage().heapUsed : 0;

    times.sort((a, b) => a - b);

    return {
      name,
      avgMs: times.reduce((sum, t) => sum + t, 0) / times.length,
      p50Ms: times[Math.floor(times.length * 0.5)],
      p99Ms: times[Math.floor(times.length * 0.99)],
      memoryDeltaBytes: memAfter - memBefore,
    };
  }

  /**
   * Format results as a markdown table.
   */
  static formatTable(results: BenchmarkResult[]): string {
    const header = '| Benchmark | Avg (ms) | P50 (ms) | P99 (ms) | Memory Delta |';
    const sep = '|-----------|----------|----------|----------|--------------|';
    const rows = results.map(r => {
      const memStr = r.memoryDeltaBytes !== undefined
        ? `${(r.memoryDeltaBytes / 1024).toFixed(1)} KB`
        : 'N/A';
      return `| ${r.name} | ${r.avgMs.toFixed(3)} | ${r.p50Ms.toFixed(3)} | ${r.p99Ms.toFixed(3)} | ${memStr} |`;
    });
    return [header, sep, ...rows].join('\n');
  }
}
