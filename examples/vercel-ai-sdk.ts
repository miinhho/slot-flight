import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { z } from "zod";
import { streamSlotObject } from "../src/adapters/vercel.js";
import { slotObject } from "../src/index.js";

const openai = createOpenAI({
  apiKey: process.env.API_KEY,
  baseURL: process.env.API_BASE_URL ?? "https://integrate.api.nvidia.com/v1"
});

const model = process.env.MODEL ?? "openai/gpt-oss-20b";

const feedback = [
  "We moved 18 support agents onto the new dashboard last week.",
  "The streaming summaries are useful, but the first useful field takes too long to appear.",
  "We also need a way to flag billing-related complaints before the full report is finished."
].join(" ");

const stream = streamSlotObject({
  streamText,
  model: openai(model),
  messages: [
    {
      role: "user",
      content: [
        "Analyze this customer feedback for a support operations dashboard.",
        "Return concise values that can be shown while the response is still streaming.",
        "",
        feedback
      ].join("\n")
    }
  ],
  temperature: 0.2,
  output: slotObject({
    schema: z.object({
      summary: z
        .string()
        .min(1)
        .max(240)
        .describe("Summarize the operational issue in one sentence."),
      sentiment: z
        .enum(["positive", "neutral", "negative", "mixed"])
        .describe("Write exactly one of: positive, neutral, negative, mixed."),
      priority: z
        .enum(["low", "medium", "high"])
        .describe("Write exactly one of: low, medium, high."),
      requestedAction: z
        .string()
        .min(1)
        .max(180)
        .describe(
          "Write the next action a support operations manager should take."
        )
    })
  })
});

for await (const slot of stream.completedSlotStream) {
  process.stdout.write(`[slot:${slot.slot}] ${JSON.stringify(slot.value)}\n`);
}

process.stdout.write(
  `[final] ${JSON.stringify(await stream.finalObject, null, 2)}\n`
);
