import { z } from "zod";
import {
  type SlotFlightEvent,
  type SlotGenerator,
  slotFlight
} from "../src/core.js";

const endpoint =
  process.env.OLLAMA_ENDPOINT ?? "http://127.0.0.1:11434/api/chat";
const model = process.env.OLLAMA_MODEL ?? "llama3:8b";
const runs = Number(process.env.OLLAMA_COMPARE_RUNS ?? "3");
const fieldCounts = (process.env.OLLAMA_FIELD_COUNTS ?? "3,5,10")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

const fieldCatalog = [
  ["name", "Short package name. Use slot-flight."],
  ["tagline", "Concise product tagline."],
  ["summary", "One sentence product summary."],
  ["audience", "Primary user audience."],
  ["problem", "Problem the library solves."],
  ["approach", "How the library solves the problem."],
  ["streamingBenefit", "Main streaming benefit."],
  ["validation", "How schema validation is handled."],
  ["integration", "How it fits with existing LLM SDKs."],
  ["limitation", "One practical limitation or tradeoff."]
] as const;

type Mode = "prompt-json" | "slot-frame";

interface Result {
  mode: Mode;
  fields: number;
  run: number;
  success: boolean;
  totalMs: number;
  firstUsableMs: number;
  error?: string;
}

const allResults: Result[] = [];

for (const fields of fieldCounts) {
  for (let run = 1; run <= runs; run += 1) {
    allResults.push(await runPromptJson(fields, run));
    allResults.push(await runSlotFrame(fields, run));
  }
}

printSummary(allResults);

async function runPromptJson(fields: number, run: number): Promise<Result> {
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "system",
            content:
              "Return only one valid JSON object matching the provided schema. No markdown. No explanations."
          },
          {
            role: "user",
            content: structuredPrompt(fields)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content ?? "";
    const parsed = JSON.parse(content);
    schemaFor(fields).parse(parsed);
    const totalMs = performance.now() - started;
    return {
      mode: "prompt-json",
      fields,
      run,
      success: true,
      totalMs,
      firstUsableMs: totalMs
    };
  } catch (error) {
    const totalMs = performance.now() - started;
    return {
      mode: "prompt-json",
      fields,
      run,
      success: false,
      totalMs,
      firstUsableMs: totalMs,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runSlotFrame(fields: number, run: number): Promise<Result> {
  const schema = schemaFor(fields);
  let firstUsableMs = 0;
  const started = performance.now();

  const generate: SlotGenerator = async function* (request) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        options: {
          temperature: 0
        },
        messages: [
          {
            role: "system",
            content:
              "Output only the requested compact slot frames. No JSON. No markdown. No explanations."
          },
          {
            role: "user",
            content: `${request.prompt}

${slotTaskPrompt(fields)}`
          }
        ]
      })
    });

    if (!response.ok || response.body === null) {
      throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    }

    yield* ollamaContentStream(response.body);
  };

  try {
    const events: SlotFlightEvent[] = [];
    const fieldsForRun = fieldDefinitions(fields);
    const flight = slotFlight({
      schema,
      generate,
      timeoutMs: 120_000,
      maxRetries: 1,
      slots: fieldsForRun.map((field) => ({
        path: field.path,
        schema: z.string().min(1).max(180),
        prompt: field.instruction
      }))
    });

    for await (const event of flight.run()) {
      events.push(event);
      if (event.type === "slot-complete" && firstUsableMs === 0) {
        firstUsableMs = performance.now() - started;
      }
    }

    const done = events.at(-1);
    if (done?.type !== "done") {
      throw new Error("Run ended without done event.");
    }

    schema.parse(done.state);
    const totalMs = performance.now() - started;
    return {
      mode: "slot-frame",
      fields,
      run,
      success: true,
      totalMs,
      firstUsableMs
    };
  } catch (error) {
    const totalMs = performance.now() - started;
    return {
      mode: "slot-frame",
      fields,
      run,
      success: false,
      totalMs,
      firstUsableMs: firstUsableMs || totalMs,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function* ollamaContentStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        break;
      }

      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }

      const payload = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
      };
      if (payload.message?.content) {
        yield payload.message.content;
      }
      if (payload.done) {
        return;
      }
    }
  }
}

function fieldNames(count: number): string[] {
  return fieldDefinitions(count).map((field) => field.path);
}

function fieldDefinitions(count: number): Array<{
  path: string;
  instruction: string;
}> {
  if (count > fieldCatalog.length) {
    throw new Error(`Cannot compare more than ${fieldCatalog.length} fields.`);
  }

  return fieldCatalog.slice(0, count).map(([path, instruction]) => ({
    path,
    instruction
  }));
}

function schemaFor(count: number): z.ZodObject<Record<string, z.ZodString>> {
  return z.object(
    Object.fromEntries(
      fieldNames(count).map((name) => [name, z.string().min(1).max(180)])
    ) as Record<string, z.ZodString>
  );
}

function structuredPrompt(fields: number): string {
  return [
    `Generate a product profile for a TypeScript library named slot-flight.`,
    `The object must contain exactly these ${fields} fields: ${fieldNames(fields).join(", ")}.`,
    "Each value must be a concise plain string.",
    "Return only a raw JSON object.",
    "Do not use markdown.",
    "Do not wrap the JSON in a code fence.",
    "Do not add explanations before or after the JSON."
  ].join("\n");
}

function slotTaskPrompt(fields: number): string {
  return [
    `Generate a product profile for a TypeScript library named slot-flight.`,
    "Use the numeric XML-like slot ids from the slot list above.",
    `Emit exactly ${fields} requested slot frames.`,
    "Each frame body must be a concise plain string."
  ].join("\n");
}

function printSummary(results: Result[]): void {
  console.log("mode,fields,runs,success_rate,avg_total_ms,avg_first_usable_ms");

  for (const fields of fieldCounts) {
    for (const mode of ["prompt-json", "slot-frame"] satisfies Mode[]) {
      const group = results.filter(
        (result) => result.fields === fields && result.mode === mode
      );
      const successes = group.filter((result) => result.success);
      const successRate =
        group.length === 0 ? 0 : successes.length / group.length;
      console.log(
        [
          mode,
          fields,
          group.length,
          successRate.toFixed(2),
          average(successes.map((result) => result.totalMs)).toFixed(0),
          average(successes.map((result) => result.firstUsableMs)).toFixed(0)
        ].join(",")
      );
    }
  }

  const failures = results.filter((result) => !result.success);
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const failure of failures) {
      console.log(
        `${failure.mode}, fields=${failure.fields}, run=${failure.run}: ${failure.error}`
      );
    }
  }
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
