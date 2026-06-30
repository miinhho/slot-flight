import type { z } from "zod";

export type MaybePromise<T> = T | Promise<T>;

export type SlotFlightEvent =
  | {
      type: "slot-start";
      slot: string;
      attempt: number;
      state: unknown;
    }
  | {
      type: "slot-delta";
      slot: string;
      attempt: number;
      delta: string;
      value: string;
      state: unknown;
    }
  | {
      type: "slot-complete";
      slot: string;
      attempt: number;
      value: unknown;
      state: unknown;
    }
  | {
      type: "slot-retry";
      slot: string;
      attempt: number;
      error: Error;
      state: unknown;
    }
  | {
      type: "slot-error";
      slot: string;
      attempt: number;
      error: Error;
      state: unknown;
    }
  | {
      type: "done";
      state: unknown;
    };

export interface SlotDefinition<TValue = unknown> {
  /**
   * Slot path inside the server-owned JSON document.
   *
   * Examples: "title", "summary", "tags[]", "sections[].heading".
   * Paths with [] require count, which expands them into concrete item paths.
   */
  path: string;
  prompt?: string | ((slot: SlotFrameRequest) => string);
  schema: z.ZodType<TValue>;
  mode?: "text" | "json";
  count?: number;
  /**
   * Overrides the engine retry count for this slot only.
   *
   * Retry is scoped to slot parsing, validation, and recoverable protocol
   * failures. Provider-level retry, backoff, and rate limiting belong outside
   * slot-flight.
   */
  maxRetries?: number;
}

export interface SlotFrameRequest {
  id: string;
  path: string;
  templatePath: string;
  prompt: string;
  attempt: number;
  mode: "text" | "json";
}

export interface SlotFlightRequest {
  prompt: string;
  slots: SlotFrameRequest[];
  attempt: number;
  signal: AbortSignal;
}

export type SlotFlightPromptRequest = Omit<SlotFlightRequest, "signal">;

export type SlotFlightPrompt =
  | string
  | ((request: SlotFlightPromptRequest) => string);

export type SlotGenerator = (
  request: SlotFlightRequest
) => AsyncIterable<string> | Promise<AsyncIterable<string>>;

export interface SlotFlightOptions<TSchema extends z.ZodTypeAny> {
  schema: TSchema;
  slots: SlotDefinition[];
  generate: SlotGenerator;
  prompt?: SlotFlightPrompt;
  /**
   * Number of validation/parsing retries per failed slot.
   *
   * This does not retry transport errors as a provider policy; it only retries
   * the slot units the engine can prove failed or recoverably malformed.
   */
  maxRetries?: number;
}

export interface SlotFlightRunOptions {
  signal?: AbortSignal;
}

export interface SlotFlightResult<T> {
  state: T;
}
