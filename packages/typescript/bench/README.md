# Benchmarks

These scripts are local release checks for stream cleanup and rough throughput.
They are not part of normal CI because heap and timing numbers vary by machine.

## Performance

```sh
bun run bench:perf
BENCH_ITERATIONS=10000 bun run bench:perf
```

## Leak Signal

Run with explicit GC so the script can compare heap after each sample window:

```sh
bun run bench:leak
LEAK_ITERATIONS=5000 LEAK_SAMPLES=8 bun run bench:leak
```

The leak script checks:

- core run drain
- `finalObject`
- `completedSlotStream`
- SSE `toResponse()`
- Vercel adapter facade
- debug stream cancellation
- provider abort cleanup

The default thresholds are intentionally broad. Treat a failure as a signal to
inspect heap snapshots or run a longer targeted case, not as a precise proof of
a leak.
