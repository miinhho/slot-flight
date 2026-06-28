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
import { createChunkStreamGenerator } from "./stream.js";

export interface OpenAIChatCompletionsClient {
  chat: {
    completions: {
      create: unknown;
    };
  };
}

type OpenAIChatCompletionsCreate = (
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal }
) => MaybePromise<AsyncIterable<OpenAIChatCompletionChunk>>;

export interface OpenAIChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
    message?: {
      content?: string | null;
    };
  }>;
}

export type OpenAIChatCompletionParams = Record<string, unknown> & {
  model: string;
  messages?: readonly unknown[];
};

export interface OpenAIStreamSlotObjectRequestOptions {
  signal?: AbortSignal;
}

export type OpenAIStreamSlotObjectParams<TSchema extends z.ZodTypeAny> =
  OpenAIChatCompletionParams & {
    client: OpenAIChatCompletionsClient;
    output: SlotObjectOutput<TSchema>;
    slotPromptRole?: string;
    run?: SlotFlightRunOptions;
  };

export type OpenAIClientStreamSlotObjectParams<TSchema extends z.ZodTypeAny> =
  OpenAIChatCompletionParams & {
    output: SlotObjectOutput<TSchema>;
    slotPromptRole?: string;
    run?: SlotFlightRunOptions;
  };

export interface SlotFlightOpenAIChatCompletionsExtension {
  streamSlotObject: <TSchema extends z.ZodTypeAny>(
    body: OpenAIClientStreamSlotObjectParams<TSchema>,
    options?: OpenAIStreamSlotObjectRequestOptions
  ) => SlotObjectStream<z.infer<TSchema>>;
}

export type SlotFlightOpenAIClient<
  TClient extends OpenAIChatCompletionsClient
> = TClient & {
  chat: TClient["chat"] & {
    completions: TClient["chat"]["completions"] &
      SlotFlightOpenAIChatCompletionsExtension;
  };
};

export function withSlotFlight<TClient extends OpenAIChatCompletionsClient>(
  client: TClient
): SlotFlightOpenAIClient<TClient> {
  const completions = client.chat
    .completions as TClient["chat"]["completions"] &
    Partial<SlotFlightOpenAIChatCompletionsExtension>;

  if (completions.streamSlotObject === undefined) {
    Object.defineProperty(completions, "streamSlotObject", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: <TSchema extends z.ZodTypeAny>(
        body: OpenAIClientStreamSlotObjectParams<TSchema>,
        options: OpenAIStreamSlotObjectRequestOptions = {}
      ) => {
        const { run, ...rest } = body;
        return streamSlotObject({
          client,
          ...rest,
          run: {
            ...run,
            signal: combineAbortSignals(run?.signal, options.signal)
          }
        });
      }
    });
  }

  return client as SlotFlightOpenAIClient<TClient>;
}

export function streamSlotObject<TSchema extends z.ZodTypeAny>({
  client,
  output,
  slotPromptRole = "user",
  run,
  ...chat
}: OpenAIStreamSlotObjectParams<TSchema>): SlotObjectStream<z.infer<TSchema>> {
  const streamController = new AbortController();
  const generate = createChunkStreamGenerator({
    stream: (request) =>
      callOpenAIChatCompletionsCreate(
        client,
        createOpenAIChatBody(request, chat, slotPromptRole),
        request.signal
      ),
    text: extractOpenAIContentDelta
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

function createOpenAIChatBody(
  request: SlotFlightRequest,
  chat: OpenAIChatCompletionParams,
  slotPromptRole: string
): Record<string, unknown> {
  const { messages = [], ...rest } = chat;
  return {
    ...rest,
    messages: [
      ...messages,
      {
        role: slotPromptRole,
        content: request.prompt
      }
    ],
    stream: true
  };
}

function callOpenAIChatCompletionsCreate(
  client: OpenAIChatCompletionsClient,
  body: Record<string, unknown>,
  signal: AbortSignal
): MaybePromise<AsyncIterable<OpenAIChatCompletionChunk>> {
  const completions = client.chat.completions;
  const create = completions.create;
  if (typeof create !== "function") {
    throw new TypeError("OpenAI chat completions client is missing create().");
  }

  return (create as OpenAIChatCompletionsCreate).call(completions, body, {
    signal
  });
}

function extractOpenAIContentDelta(chunk: OpenAIChatCompletionChunk): string {
  return (
    chunk.choices
      ?.map((choice) => choice.delta?.content ?? choice.message?.content ?? "")
      .join("") ?? ""
  );
}

function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined
): AbortSignal | undefined {
  if (first === undefined || first.aborted) {
    return first ?? second;
  }

  if (second === undefined || second.aborted) {
    return second ?? first;
  }

  const controller = new AbortController();
  const abortFromFirst = () => controller.abort(first.reason);
  const abortFromSecond = () => controller.abort(second.reason);

  first.addEventListener("abort", abortFromFirst, { once: true });
  second.addEventListener("abort", abortFromSecond, { once: true });
  controller.signal.addEventListener(
    "abort",
    () => {
      first.removeEventListener("abort", abortFromFirst);
      second.removeEventListener("abort", abortFromSecond);
    },
    { once: true }
  );

  return controller.signal;
}
