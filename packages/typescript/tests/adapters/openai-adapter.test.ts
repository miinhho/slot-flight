import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionsClient
} from "../../src/adapters/openai.js";
import { streamSlotObject, withSlotFlight } from "../../src/adapters/openai.js";
import { slotObject } from "../../src/index.js";

describe("OpenAI adapter", () => {
  it("streams an object from an OpenAI-shaped chat request", async () => {
    const calls: Array<{
      body: Record<string, unknown>;
      signal: AbortSignal | undefined;
    }> = [];
    const client: OpenAIChatCompletionsClient = {
      chat: {
        completions: {
          create: (
            body: Record<string, unknown>,
            options?: { signal?: AbortSignal }
          ) => {
            calls.push({ body, signal: options?.signal });
            return openAIChunks([
              "<1>slot-flight\n</1>",
              { choices: [{ delta: { content: null } }] },
              "<2>Function-style OpenAI adapter\n</2>"
            ]);
          }
        }
      }
    };

    const stream = streamSlotObject({
      client,
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Create package metadata." }],
      temperature: 0.2,
      stream: false,
      output: slotObject({
        schema: z.object({
          name: z.string().min(1).describe("Use exactly slot-flight."),
          title: z.string().min(1).describe("Write a short title.")
        })
      })
    });

    await expect(stream.finalObject).resolves.toEqual({
      name: "slot-flight",
      title: "Function-style OpenAI adapter"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.body).toMatchObject({
      model: "openai/gpt-oss-20b",
      temperature: 0.2,
      stream: true,
      messages: [
        { role: "user", content: "Create package metadata." },
        {
          role: "user",
          content: expect.stringContaining("Do not emit JSON.")
        }
      ]
    });
  });

  it("preserves the SDK create() receiver", async () => {
    const completions = {
      marker: "bound",
      create(this: { marker: string }) {
        if (this.marker !== "bound") {
          throw new Error("lost receiver");
        }
        return openAIChunks(["<1>Alice\n</1>"]);
      }
    };
    const client: OpenAIChatCompletionsClient = {
      chat: { completions }
    };

    const stream = streamSlotObject({
      client,
      model: "gpt-test",
      messages: [{ role: "user", content: "Create a user." }],
      output: slotObject({
        schema: z.object({ name: z.string().min(1).describe("Write a name.") })
      })
    });

    await expect(stream.finalObject).resolves.toEqual({ name: "Alice" });
  });

  it("extends an OpenAI client with streamSlotObject", async () => {
    const calls: Array<{
      body: Record<string, unknown>;
      signal: AbortSignal | undefined;
    }> = [];
    const controller = new AbortController();
    const client = withSlotFlight({
      chat: {
        completions: {
          create: (
            body: Record<string, unknown>,
            options?: { signal?: AbortSignal }
          ) => {
            calls.push({ body, signal: options?.signal });
            return openAIChunks([
              "<1>slot-flight\n</1>",
              "<2>OpenAI SDK add-on\n</2>"
            ]);
          }
        }
      }
    });

    const stream = client.chat.completions.streamSlotObject(
      {
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "Create package metadata." }],
        temperature: 0.2,
        output: slotObject({
          schema: z.object({
            name: z.string().min(1).describe("Use exactly slot-flight."),
            title: z.string().min(1).describe("Write a short product title.")
          })
        })
      },
      { signal: controller.signal }
    );

    await expect(stream.finalObject).resolves.toEqual({
      name: "slot-flight",
      title: "OpenAI SDK add-on"
    });
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.body).toMatchObject({
      model: "openai/gpt-oss-20b",
      temperature: 0.2,
      stream: true
    });
  });

  it("honors run.signal passed through the OpenAI client extension body", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort(new Error("cancelled through body.run"));
    const client = withSlotFlight({
      chat: {
        completions: {
          create: () => {
            calls += 1;
            return openAIChunks(["<1>Alice\n</1>"]);
          }
        }
      }
    });

    const stream = client.chat.completions.streamSlotObject({
      model: "gpt-test",
      messages: [{ role: "user", content: "Create a user." }],
      run: { signal: controller.signal },
      output: slotObject({
        schema: z.object({ name: z.string().min(1).describe("Write a name.") })
      })
    });

    await expect(stream.finalObject).rejects.toThrow(
      "cancelled through body.run"
    );
    expect(calls).toBe(0);
  });

  it("aborts the OpenAI request signal when a stream view is cancelled", async () => {
    let signal: AbortSignal | undefined;
    const client: OpenAIChatCompletionsClient = {
      chat: {
        completions: {
          create: (
            _body: Record<string, unknown>,
            options?: { signal?: AbortSignal }
          ) => {
            signal = options?.signal;
            return pendingOpenAIChunks(["<1>\n"]);
          }
        }
      }
    };

    const stream = streamSlotObject({
      client,
      model: "gpt-test",
      messages: [{ role: "user", content: "Create a user." }],
      output: slotObject({
        schema: z.object({ name: z.string().min(1).describe("Write a name.") })
      })
    });
    const reader = stream
      .toReadableStream({ source: "events", format: "ndjson" })
      .getReader();

    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel();

    expect(signal?.aborted).toBe(true);
  });

  it("exposes completed slots as the primary stream output", async () => {
    const client = withSlotFlight({
      chat: {
        completions: {
          create: () =>
            openAIChunks(["<1>slot-flight\n</1>", "<2>Slot helper\n</2>"])
        }
      }
    });

    const stream = client.chat.completions.streamSlotObject({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: "Create package metadata." }],
      output: slotObject({
        schema: z.object({
          name: z.string().min(1).describe("Use exactly slot-flight."),
          title: z.string().min(1).describe("Write a short product title.")
        })
      })
    });

    const slots = [];
    for await (const slot of stream.completedSlotStream) {
      slots.push(slot);
    }

    expect(slots.map((slot) => slot.slot)).toEqual(["name", "title"]);
  });
});

async function* openAIChunks(
  values: Array<string | OpenAIChatCompletionChunk>
): AsyncGenerator<OpenAIChatCompletionChunk> {
  for (const value of values) {
    yield typeof value === "string"
      ? { choices: [{ delta: { content: value } }] }
      : value;
  }
}

function pendingOpenAIChunks(
  values: string[]
): AsyncIterable<OpenAIChatCompletionChunk> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<OpenAIChatCompletionChunk>> {
          const value = values[index];
          index += 1;
          if (value !== undefined) {
            return {
              done: false,
              value: { choices: [{ delta: { content: value } }] }
            };
          }
          return new Promise<IteratorResult<OpenAIChatCompletionChunk>>(
            () => undefined
          );
        },
        async return() {
          return { done: true, value: undefined };
        }
      };
    }
  };
}
