import { makeBenchCases, runBenchCase } from "./lib.js";

const iterations = Number(process.env.BENCH_ITERATIONS ?? 2_000);

console.log(`slot-flight perf bench (${iterations} iterations per case)`);

const results = [];
for (const benchCase of makeBenchCases()) {
  const result = await runBenchCase(benchCase, iterations);
  results.push({
    case: result.name,
    iterations: result.iterations,
    "total ms": result.totalMs.toFixed(2),
    "avg ms": result.avgMs.toFixed(4),
    "ops/sec": result.opsPerSecond.toFixed(0)
  });
}

console.table(results);
