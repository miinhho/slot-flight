import type { SlotFlightEvent } from "../../types.js";
import {
  completedEventIterator,
  partialObjectIterator
} from "./projections.js";
import type {
  SlotObjectReadableStreamOptions,
  SlotObjectResponseOptions,
  SlotObjectStreamFormat,
  SlotObjectStreamSource
} from "./stream.js";

type SlotObjectStreamPayloadEvent =
  | SlotFlightEvent["type"]
  | "partial"
  | "slot";

interface SlotObjectStreamPayload {
  event: SlotObjectStreamPayloadEvent;
  data: unknown;
}

export function toReadableStream<T>(
  events: AsyncIterable<SlotFlightEvent>,
  options: SlotObjectReadableStreamOptions,
  onCancel?: () => void
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const format = options.format ?? "sse";
  const source = options.source ?? "completed";
  let iterator: AsyncIterator<SlotObjectStreamPayload> | undefined;
  let cancelled = false;

  return new ReadableStream({
    async start(controller) {
      iterator = streamPayloads<T>(events, source)[Symbol.asyncIterator]();
      try {
        while (!cancelled) {
          const next = await iterator.next();
          if (next.done) {
            controller.close();
            return;
          }

          const payload = next.value;
          controller.enqueue(encoder.encode(formatPayload(payload, format)));
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error);
        }
      }
    },
    async cancel() {
      cancelled = true;
      // Browser/client cancellation should abort the underlying model run, not
      // just stop serializing bytes from this Response.
      onCancel?.();
      void iterator?.return?.();
    }
  });
}

export function toResponse<T>(
  events: AsyncIterable<SlotFlightEvent>,
  options: SlotObjectResponseOptions,
  onCancel?: () => void
): Response {
  const format = options.format ?? "sse";
  const headers = new Headers(options.headers);

  if (!headers.has("content-type")) {
    headers.set(
      "content-type",
      format === "sse"
        ? "text/event-stream; charset=utf-8"
        : "application/x-ndjson; charset=utf-8"
    );
  }
  if (format === "sse" && !headers.has("cache-control")) {
    headers.set("cache-control", "no-cache");
  }

  return new Response(toReadableStream<T>(events, options, onCancel), {
    status: options.status,
    statusText: options.statusText,
    headers
  });
}

async function* streamPayloads<T>(
  events: AsyncIterable<SlotFlightEvent>,
  source: SlotObjectStreamSource
): AsyncGenerator<SlotObjectStreamPayload> {
  if (source === "partial") {
    for await (const partial of partialObjectIterator<T>(events)) {
      yield { event: "partial", data: partial };
    }
    return;
  }

  if (source === "events") {
    for await (const event of events) {
      yield { event: event.type, data: serializeEvent(event) };
    }
    return;
  }

  for await (const event of completedEventIterator(events)) {
    yield completedEventPayload<T>(event);
  }
}

function completedEventPayload<T>(
  event: SlotFlightEvent
): SlotObjectStreamPayload {
  if (event.type === "slot-complete") {
    return {
      event: "slot",
      data: {
        slot: event.slot,
        value: event.value,
        state: event.state as Partial<T>
      }
    };
  }

  if (event.type === "done") {
    return { event: "done", data: { state: event.state } };
  }

  return { event: event.type, data: serializeEvent(event) };
}

function formatPayload(
  payload: SlotObjectStreamPayload,
  format: SlotObjectStreamFormat
): string {
  if (format === "ndjson") {
    return `${JSON.stringify({ type: payload.event, data: payload.data })}\n`;
  }

  return `event: ${payload.event}\ndata: ${JSON.stringify(payload.data)}\n\n`;
}

function serializeEvent(event: SlotFlightEvent): unknown {
  if (event.type === "slot-error" || event.type === "slot-retry") {
    // Error objects lose useful fields through JSON.stringify; serialize the
    // stable pieces clients can depend on.
    return {
      ...event,
      error: {
        name: event.error.name,
        message: event.error.message
      }
    };
  }

  return event;
}
