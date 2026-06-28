import type {
  SlotFlightEvent,
  SlotFlightRequest,
  SlotFrameRequest
} from "../src/core.js";

export async function collectEvents(iterator: AsyncIterable<SlotFlightEvent>) {
  const events: SlotFlightEvent[] = [];
  for await (const event of iterator) {
    events.push(event);
  }
  return events;
}

export async function* textChunks(values: string[]): AsyncGenerator<string> {
  for (const value of values) {
    yield value;
  }
}

export function createRequest(prompt: string): SlotFlightRequest {
  return {
    prompt,
    slots: [],
    attempt: 1,
    signal: new AbortController().signal
  };
}

export function firstSlot(request: SlotFlightRequest): SlotFrameRequest {
  const slot = request.slots[0];
  if (slot === undefined) {
    throw new Error("Expected request to contain at least one slot.");
  }
  return slot;
}
