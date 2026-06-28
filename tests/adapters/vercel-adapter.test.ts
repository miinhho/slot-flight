import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { streamSlotObject } from "../../src/adapters/vercel.js";
import { slotObject } from "../../src/index.js";
import { textChunks } from "../helpers.js";

describe("Vercel AI SDK adapter", () => {
  it("streams an object from streamText and appends slot instructions to messages", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const streamTextMock = (body: Record<string, unknown>) => {
      calls.push(body);
      return {
        textStream: textChunks([
          "<1>First useful field appears early.</1>",
          "<2>mixed</2>",
          "<3>high</3>"
        ])
      };
    };

    const stream = streamSlotObject({
      streamText: streamTextMock,
      model: "model-ref",
      messages: [{ role: "user", content: "Analyze feedback." }],
      output: slotObject({
        schema: z.object({
          summary: z.string().min(1).describe("Write one sentence."),
          sentiment: z
            .enum(["positive", "neutral", "negative", "mixed"])
            .describe("Write exactly one allowed sentiment."),
          priority: z
            .enum(["low", "medium", "high"])
            .describe("Write exactly one allowed priority.")
        })
      })
    });

    const slots = [];
    for await (const slot of stream.completedSlotStream) {
      slots.push(slot);
    }

    expect(calls[0]).toMatchObject({
      model: "model-ref",
      messages: [
        { role: "user", content: "Analyze feedback." },
        {
          role: "user",
          content: expect.stringContaining("Do not emit JSON.")
        }
      ]
    });
    await expect(stream.finalObject).resolves.toEqual({
      summary: "First useful field appears early.",
      sentiment: "mixed",
      priority: "high"
    });
    expect(slots.map((slot) => slot.slot)).toEqual([
      "summary",
      "sentiment",
      "priority"
    ]);
  });

  it("converts prompt into messages before appending slot instructions", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const stream = streamSlotObject({
      streamText: (body: Record<string, unknown>) => {
        calls.push(body);
        return { textStream: textChunks(["<1>ok</1>"]) };
      },
      model: "model-ref",
      prompt: "Analyze customer feedback.",
      output: slotObject({
        schema: z.object({
          status: z.string().min(1).describe("Write a status.")
        })
      })
    });

    await expect(stream.finalObject).resolves.toEqual({ status: "ok" });
    expect(calls[0]).toMatchObject({
      messages: [
        { role: "user", content: "Analyze customer feedback." },
        {
          role: "user",
          content: expect.stringContaining("Do not emit JSON.")
        }
      ]
    });
  });

  it("combines caller abort signals with the engine request signal", async () => {
    const callerController = new AbortController();
    const signals: AbortSignal[] = [];
    const stream = streamSlotObject({
      streamText: (body: Record<string, unknown>) => {
        signals.push(body.abortSignal as AbortSignal);
        return { textStream: textChunks(["<1>ok</1>"]) };
      },
      model: "model-ref",
      prompt: "Analyze customer feedback.",
      abortSignal: callerController.signal,
      output: slotObject({
        schema: z.object({
          status: z.string().min(1).describe("Write a status.")
        })
      })
    });

    await expect(stream.finalObject).resolves.toEqual({ status: "ok" });
    callerController.abort(new Error("caller cancelled"));

    expect(signals[0]?.aborted).toBe(true);
    expect((signals[0]?.reason as Error).message).toBe("caller cancelled");
  });

  it("rejects a missing streamText function", async () => {
    const stream = streamSlotObject({
      streamText: "not a function",
      model: "model-ref",
      prompt: "Analyze feedback.",
      output: slotObject({
        schema: z.object({
          status: z.string().min(1).describe("Write a status.")
        })
      })
    });

    await expect(stream.finalObject).rejects.toThrow(
      "Vercel AI SDK streamText must be a function."
    );
  });

  it("exposes completed slots separately from noisy partial objects", async () => {
    const stream = streamSlotObject({
      streamText: () => ({
        textStream: textChunks([
          "<1>First useful field appears early.</1>",
          "<2>mixed</2>"
        ])
      }),
      model: "model-ref",
      messages: [{ role: "user", content: "Analyze feedback." }],
      output: slotObject({
        schema: z.object({
          summary: z.string().min(1).describe("Write one sentence."),
          sentiment: z
            .enum(["positive", "neutral", "negative", "mixed"])
            .describe("Write exactly one allowed sentiment.")
        })
      })
    });

    const completed = [];
    for await (const slot of stream.completedSlotStream) {
      completed.push(slot);
    }

    expect(completed).toEqual([
      {
        slot: "summary",
        value: "First useful field appears early.",
        state: { summary: "First useful field appears early." }
      },
      {
        slot: "sentiment",
        value: "mixed",
        state: {
          summary: "First useful field appears early.",
          sentiment: "mixed"
        }
      }
    ]);
  });
});
