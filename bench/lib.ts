import { z } from "zod";
import { streamSlotObject } from "../src/adapters/vercel.js";
import type { SlotFlightEvent, SlotGenerator } from "../src/core.js";
import { slotFlight } from "../src/core.js";
import { slotObject } from "../src/index.js";
import { createSlotObjectStream } from "../src/slot/index.js";

export interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  opsPerSecond: number;
  avgMs: number;
}

export type BenchCase = {
  name: string;
  run: () => Promise<void>;
};

const articleSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  priority: z.enum(["low", "medium", "high"]),
  tags: z.array(z.string().min(1)).length(3)
});

const articleSlots = [
  { path: "title", schema: z.string().min(1) },
  { path: "summary", schema: z.string().min(1) },
  {
    path: "sentiment",
    schema: z.enum(["positive", "neutral", "negative", "mixed"])
  },
  { path: "priority", schema: z.enum(["low", "medium", "high"]) },
  { path: "tags", schema: z.array(z.string().min(1)).length(3), mode: "json" }
] satisfies Parameters<typeof slotFlight<typeof articleSchema>>[0]["slots"];

const valueByPath: Record<string, string> = {
  title: "Streaming slots",
  summary: "Generate values while the server assembles JSON.",
  sentiment: "mixed",
  priority: "high",
  tags: '["streaming","json","zod"]'
};

export const articleGenerator: SlotGenerator = async function* (request) {
  for (const slot of request.slots) {
    yield `<${slot.id}>`;
    yield valueByPath[slot.path] ?? "value";
    yield `</${slot.id}>`;
  }
};

const describedArticleOutput = slotObject({
  schema: z.object({
    title: z.string().min(1).describe("Write a short title."),
    summary: z.string().min(1).describe("Write a summary."),
    sentiment: z
      .enum(["positive", "neutral", "negative", "mixed"])
      .describe("Write one sentiment."),
    priority: z.enum(["low", "medium", "high"]).describe("Write a priority."),
    tags: z
      .array(z.string().min(1))
      .length(3)
      .describe("Write a JSON array of exactly 3 tags.")
  })
});

export function makeCoreRun() {
  return slotFlight({
    schema: articleSchema,
    slots: articleSlots,
    generate: articleGenerator
  }).run();
}

export function makeSlotObjectStream() {
  return createSlotObjectStream(makeCoreRun());
}

export function makeVercelStream() {
  return streamSlotObject({
    streamText: () => ({
      textStream: articleGenerator({
        prompt: "",
        slots: [
          {
            id: "1",
            path: "title",
            templatePath: "title",
            prompt: "Write a short title.",
            attempt: 1,
            mode: "text"
          },
          {
            id: "2",
            path: "summary",
            templatePath: "summary",
            prompt: "Write a summary.",
            attempt: 1,
            mode: "text"
          },
          {
            id: "3",
            path: "sentiment",
            templatePath: "sentiment",
            prompt: "Write one sentiment.",
            attempt: 1,
            mode: "text"
          },
          {
            id: "4",
            path: "priority",
            templatePath: "priority",
            prompt: "Write a priority.",
            attempt: 1,
            mode: "text"
          },
          {
            id: "5",
            path: "tags",
            templatePath: "tags",
            prompt: "Write a JSON array of exactly 3 tags.",
            attempt: 1,
            mode: "json"
          }
        ],
        attempt: 1,
        signal: new AbortController().signal
      })
    }),
    model: "bench-model",
    messages: [{ role: "user", content: "bench" }],
    output: describedArticleOutput
  });
}

export async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _item of iterable) {
    // Drain all items.
  }
}

export async function collectEvents(
  iterable: AsyncIterable<SlotFlightEvent>
): Promise<SlotFlightEvent[]> {
  const events: SlotFlightEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

export function makeBenchCases(): BenchCase[] {
  return [
    {
      name: "core final event drain",
      run: async () => {
        await drain(makeCoreRun());
      }
    },
    {
      name: "slot object finalObject",
      run: async () => {
        await makeSlotObjectStream().finalObject;
      }
    },
    {
      name: "completedSlotStream",
      run: async () => {
        await drain(makeSlotObjectStream().completedSlotStream);
      }
    },
    {
      name: "toResponse sse read",
      run: async () => {
        await makeSlotObjectStream().toResponse().text();
      }
    },
    {
      name: "vercel adapter finalObject",
      run: async () => {
        await makeVercelStream().finalObject;
      }
    },
    {
      name: "debug stream cancel",
      run: async () => {
        let closed = false;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const source = async function* (): AsyncGenerator<SlotFlightEvent> {
          try {
            yield {
              type: "slot-start",
              slot: "title",
              attempt: 1,
              state: {}
            };
            await gate;
          } finally {
            closed = true;
          }
        };

        const stream = createSlotObjectStream(source(), { cancel: release });
        const reader = stream.debug
          .toReadableStream({ source: "events", format: "ndjson" })
          .getReader();
        await reader.read();
        await reader.cancel();
        await waitFor(() => closed);
        if (!closed) {
          throw new Error(
            "Expected debug stream cancellation to close source."
          );
        }
      }
    },
    {
      name: "abort cleanup",
      run: async () => {
        const controller = new AbortController();
        let cleanedUp = false;
        const generate: SlotGenerator = async function* (request) {
          try {
            const slot = request.slots[0];
            if (slot === undefined) {
              throw new Error("Expected at least one slot.");
            }
            yield `<${slot.id}>`;
            controller.abort(new Error("bench abort"));
            yield "ignored";
          } finally {
            cleanedUp = true;
          }
        };

        await collectEvents(
          slotFlight({
            schema: z.object({ title: z.string() }),
            slots: [{ path: "title", schema: z.string() }],
            generate
          }).run({ signal: controller.signal })
        ).catch(() => undefined);

        if (!cleanedUp) {
          throw new Error("Expected abort to close provider stream.");
        }
      }
    }
  ];
}

export async function runBenchCase(
  benchCase: BenchCase,
  iterations: number
): Promise<BenchResult> {
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await benchCase.run();
  }
  const totalMs = performance.now() - started;
  return {
    name: benchCase.name,
    iterations,
    totalMs,
    opsPerSecond: (iterations / totalMs) * 1000,
    avgMs: totalMs / iterations
  };
}

export function formatBytes(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(2)} MiB`;
  }
  if (abs >= 1024) {
    return `${(value / 1024).toFixed(2)} KiB`;
  }
  return `${value.toFixed(0)} B`;
}

export function memoryUsageBytes(): number {
  return process.memoryUsage().heapUsed;
}

export async function forceGc(): Promise<void> {
  const gc = globalThis.gc ?? Bun.gc;
  for (let index = 0; index < 3; index += 1) {
    gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
