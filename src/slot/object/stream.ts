import type { SlotFlightEvent } from "../../types.js";
import { completedSlotIterator, partialObjectIterator } from "./projections.js";
import { SlotObjectRun } from "./run.js";
import { toReadableStream, toResponse } from "./web.js";

export interface CompletedSlot<T = unknown> {
  slot: string;
  value: unknown;
  state: Partial<T>;
}

export type SlotObjectStreamSource = "completed" | "partial" | "events";
export type SlotObjectStreamFormat = "sse" | "ndjson";

export interface SlotObjectReadableStreamOptions {
  source?: SlotObjectStreamSource;
  format?: SlotObjectStreamFormat;
}

export interface SlotObjectResponseOptions {
  source?: SlotObjectStreamSource;
  format?: SlotObjectStreamFormat;
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
}

export interface SlotObjectStream<T> {
  readonly completedSlotStream: AsyncIterable<CompletedSlot<T>>;
  readonly partialObjectStream: AsyncIterable<Partial<T>>;
  readonly slotEventStream: AsyncIterable<SlotFlightEvent>;
  readonly finalObject: Promise<T>;
  toReadableStream(
    options?: SlotObjectReadableStreamOptions
  ): ReadableStream<Uint8Array>;
  toResponse(options?: SlotObjectResponseOptions): Response;
}

export interface SlotObjectStreamOptions {
  cancel?: () => void;
}

export function createSlotObjectStream<T>(
  source: AsyncIterable<SlotFlightEvent>,
  options: SlotObjectStreamOptions = {}
): SlotObjectStream<T> {
  const run = new SlotObjectRun(source, options.cancel);
  return {
    completedSlotStream: {
      [Symbol.asyncIterator]: () =>
        completedSlotIterator<T>(run.events("completedSlotStream"))
    },
    get finalObject() {
      return run.finalObject as Promise<T>;
    },
    partialObjectStream: {
      [Symbol.asyncIterator]: () =>
        partialObjectIterator<T>(run.events("partialObjectStream"))
    },
    slotEventStream: {
      [Symbol.asyncIterator]: () => run.events("slotEventStream")
    },
    toReadableStream: (options = {}) =>
      toReadableStream<T>(run.events("toReadableStream"), options, () =>
        run.cancel()
      ),
    toResponse: (options = {}) =>
      toResponse<T>(run.events("toResponse"), options, () => run.cancel())
  };
}
