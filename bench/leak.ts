import {
  type BenchCase,
  forceGc,
  formatBytes,
  makeBenchCases,
  memoryUsageBytes,
  runBenchCase
} from "./lib.js";

const warmupIterations = Number(process.env.LEAK_WARMUP ?? 500);
const sampleIterations = Number(process.env.LEAK_ITERATIONS ?? 1_000);
const samples = Number(process.env.LEAK_SAMPLES ?? 6);
const maxRetainedBytes = Number(
  process.env.LEAK_MAX_RETAINED_BYTES ?? 16_777_216
);
const maxGrowthPerSampleBytes = Number(
  process.env.LEAK_MAX_GROWTH_PER_SAMPLE_BYTES ?? 4_194_304
);

console.log(
  [
    "slot-flight leak bench",
    `warmup=${warmupIterations}`,
    `iterations/sample=${sampleIterations}`,
    `samples=${samples}`
  ].join(" ")
);

const failures: string[] = [];

for (const benchCase of makeBenchCases()) {
  const result = await runLeakCase(benchCase);
  console.table([
    {
      case: benchCase.name,
      baseline: formatBytes(result.baseline),
      final: formatBytes(result.final),
      retained: formatBytes(result.retained),
      "growth/sample": formatBytes(result.growthPerSample)
    }
  ]);

  if (
    result.retained > maxRetainedBytes ||
    result.growthPerSample > maxGrowthPerSampleBytes
  ) {
    failures.push(
      `${benchCase.name}: retained=${formatBytes(
        result.retained
      )}, growth/sample=${formatBytes(result.growthPerSample)}`
    );
  }
}

if (failures.length > 0) {
  console.error("Potential leak signal:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}

async function runLeakCase(benchCase: BenchCase) {
  await runBenchCase(benchCase, warmupIterations);
  await forceGc();

  const baseline = memoryUsageBytes();
  const snapshots = [baseline];

  for (let sample = 0; sample < samples; sample += 1) {
    await runBenchCase(benchCase, sampleIterations);
    await forceGc();
    snapshots.push(memoryUsageBytes());
  }

  const final = snapshots.at(-1) ?? baseline;
  const retained = final - baseline;
  const growthPerSample = retained / samples;

  return {
    baseline,
    final,
    retained,
    growthPerSample
  };
}
