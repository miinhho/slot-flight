import OpenAI from "openai";
import { z } from "zod";
import { streamSlotObject } from "../src/adapters/openai.js";
import { slotObject } from "../src/index.js";
import type { SlotFlightEvent } from "../src/types.js";

const apiKey = process.env.API_KEY;
if (!apiKey) {
  throw new Error("Set API_KEY before running the structural API check.");
}

const client = new OpenAI({
  apiKey,
  baseURL: process.env.API_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
});

const model = process.env.MODEL ?? "openai/gpt-oss-20b";

const schema = z.object({
  summary: z
    .string()
    .min(1)
    .max(220)
    .describe("Write one concise operational summary."),
  metadata: z
    .object({
      audience: z.string().min(1).max(80),
      priority: z.enum(["low", "medium", "high"])
    })
    .describe(
      "Write metadata fields for a support operations dashboard. Audience should be a short role label. Priority must be exactly low, medium, or high."
    ),
  tags: z
    .array(z.string().min(1).max(32))
    .length(3)
    .describe("Write exactly 3 short dashboard tags, one tag per frame."),
  sections: z
    .array(
      z.object({
        heading: z.string().min(1).max(80),
        action: z.string().min(1).max(160)
      })
    )
    .length(2)
    .describe(
      "Write exactly 2 follow-up sections. For each section, write a heading and an action."
    )
});

const stream = streamSlotObject({
  client,
  model,
  messages: [
    {
      role: "user",
      content: [
        "Classify this support dashboard feedback.",
        "The response must follow the slot-frame contract appended by the SDK.",
        "Do not write JSON objects or arrays. Emit raw values in the requested slot frames.",
        "",
        "Feedback:",
        "The billing export failed twice today. The dashboard still shows stale totals, and the operations lead needs an ETA plus a quick escalation plan before the finance review."
      ].join("\n")
    }
  ],
  temperature: 0,
  top_p: 1,
  max_tokens: 2048,
  output: slotObject({
    schema,
    maxRetries: 2
  })
});

const events: SlotFlightEvent[] = [];
for await (const event of stream.slotEventStream) {
  events.push(event);
  if (event.type === "slot-complete") {
    process.stdout.write(
      `[slot:${event.slot}] ${JSON.stringify(event.value)}\n`
    );
  }
}

const finalObject = await stream.finalObject;
assertStructuralEvents(events);

process.stdout.write(`[final] ${JSON.stringify(finalObject, null, 2)}\n`);
process.stdout.write("[ok] structural API check passed\n");

function assertStructuralEvents(events: SlotFlightEvent[]): void {
  const completedSlots = events
    .filter((event) => event.type === "slot-complete")
    .map((event) => event.slot);

  assertIncludes(completedSlots, "metadata.audience");
  assertIncludes(completedSlots, "metadata.priority");
  assertIncludes(completedSlots, "tags[0]");
  assertIncludes(completedSlots, "tags[1]");
  assertIncludes(completedSlots, "tags[2]");
  assertIncludes(completedSlots, "sections[0].heading");
  assertIncludes(completedSlots, "sections[0].action");
  assertIncludes(completedSlots, "sections[1].heading");
  assertIncludes(completedSlots, "sections[1].action");

  for (const slot of completedSlots) {
    if (slot === "metadata" || slot === "tags" || slot === "sections") {
      throw new Error(`Unexpected opaque structural slot "${slot}".`);
    }
  }

  for (const event of events) {
    if (
      event.type === "slot-delta" &&
      (event.slot.startsWith("metadata.") || event.slot.startsWith("sections["))
    ) {
      const state = event.state as {
        metadata?: unknown;
        sections?: unknown;
      };
      if (typeof state.metadata === "string") {
        throw new Error("metadata became a raw JSON string during streaming.");
      }
      if (typeof state.sections === "string") {
        throw new Error("sections became a raw JSON string during streaming.");
      }
    }
  }
}

function assertIncludes(values: string[], expected: string): void {
  if (!values.includes(expected)) {
    throw new Error(
      `Expected completed slot "${expected}", got ${JSON.stringify(values)}.`
    );
  }
}
