import type { z } from "zod";
import { slotFlight } from "../engine.js";
import {
  createSlotObjectStream,
  type SlotObjectOutput,
  type SlotObjectStream
} from "../slot/index.js";
import type {
  MaybePromise,
  SlotFlightRequest,
  SlotFlightRunOptions
} from "../types.js";
import { createTextStreamGenerator } from "./stream.js";

export interface VercelStreamTextResult {
  textStream: AsyncIterable<string>;
}

export type VercelStreamText = unknown;

type VercelStreamTextCall = (
  body: Record<string, unknown>
) => MaybePromise<VercelStreamTextResult>;

export type VercelStreamTextParams = Record<string, unknown> & {
  messages?: readonly unknown[];
  prompt?: string;
  abortSignal?: AbortSignal;
};

export type VercelStreamSlotObjectParams<TSchema extends z.ZodTypeAny> =
  VercelStreamTextParams & {
    streamText: VercelStreamText;
    output: SlotObjectOutput<TSchema>;
    slotPromptRole?: string;
    run?: SlotFlightRunOptions;
  };

export function streamSlotObject<TSchema extends z.ZodTypeAny>({
  streamText,
  output,
  slotPromptRole = "user",
  run,
  ...params
}: VercelStreamSlotObjectParams<TSchema>): SlotObjectStream<z.infer<TSchema>> {
  const streamController = new AbortController();
  const generate = createTextStreamGenerator(async (request) => {
    const result = await callStreamText(
      streamText,
      createVercelStreamTextBody(request, params, slotPromptRole)
    );
    return result.textStream;
  });

  return createSlotObjectStream(
    slotFlight({
      schema: output.schema,
      slots: output.slots,
      prompt: output.prompt,
      maxRetries: output.maxRetries,
      generate
    }).run({
      ...run,
      signal: combineAbortSignals(run?.signal, streamController.signal)
    }),
    {
      cancel: () =>
        streamController.abort(
          new DOMException("Stream cancelled", "AbortError")
        )
    }
  );
}

function callStreamText(
  streamText: VercelStreamText,
  body: Record<string, unknown>
): MaybePromise<VercelStreamTextResult> {
  if (typeof streamText !== "function") {
    throw new TypeError("Vercel AI SDK streamText must be a function.");
  }

  return (streamText as VercelStreamTextCall)(body);
}

function createVercelStreamTextBody(
  request: SlotFlightRequest,
  params: VercelStreamTextParams,
  slotPromptRole: string
): Record<string, unknown> {
  const { abortSignal, messages, prompt, ...rest } = params;
  return {
    ...rest,
    ...appendSlotPrompt({ messages, prompt }, slotPromptRole, request.prompt),
    abortSignal: combineAbortSignals(abortSignal, request.signal)
  };
}

function appendSlotPrompt(
  body: Pick<VercelStreamTextParams, "messages" | "prompt">,
  role: string,
  slotPrompt: string
): Pick<VercelStreamTextParams, "messages" | "prompt"> {
  if (body.messages !== undefined) {
    return {
      messages: [...body.messages, { role, content: slotPrompt }]
    };
  }

  if (body.prompt !== undefined) {
    return {
      messages: [
        { role: "user", content: body.prompt },
        { role, content: slotPrompt }
      ]
    };
  }

  return {
    messages: [{ role, content: slotPrompt }]
  };
}

function combineAbortSignals(
  callerSignal: AbortSignal | undefined,
  engineSignal: AbortSignal
): AbortSignal {
  if (callerSignal === undefined || callerSignal.aborted) {
    return callerSignal ?? engineSignal;
  }

  if (engineSignal.aborted) {
    return engineSignal;
  }

  const controller = new AbortController();
  callerSignal.addEventListener(
    "abort",
    () => controller.abort(callerSignal.reason),
    { once: true }
  );
  engineSignal.addEventListener(
    "abort",
    () => controller.abort(engineSignal.reason),
    { once: true }
  );

  return controller.signal;
}
