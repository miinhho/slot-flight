import type { SlotFlightEvent } from "../../types.js";
import type { CompletedSlot } from "./stream.js";

export async function* partialObjectIterator<T>(
  events: AsyncIterable<SlotFlightEvent>
): AsyncGenerator<Partial<T>> {
  for await (const event of events) {
    if (eventHasState(event)) {
      yield event.state as Partial<T>;
    }
  }
}

export async function* completedSlotIterator<T>(
  events: AsyncIterable<SlotFlightEvent>
): AsyncGenerator<CompletedSlot<T>> {
  for await (const event of events) {
    if (event.type === "slot-complete") {
      yield {
        slot: event.slot,
        value: event.value,
        state: event.state as Partial<T>
      };
    }
  }
}

export async function* completedEventIterator(
  events: AsyncIterable<SlotFlightEvent>
): AsyncGenerator<SlotFlightEvent> {
  for await (const event of events) {
    if (isCompletedOutputEvent(event)) {
      yield event;
    }
  }
}

function eventHasState(event: SlotFlightEvent): event is SlotFlightEvent & {
  state: unknown;
} {
  return (
    event.type === "slot-delta" ||
    event.type === "slot-complete" ||
    event.type === "done"
  );
}

function isCompletedOutputEvent(event: SlotFlightEvent): boolean {
  return (
    event.type === "slot-complete" ||
    event.type === "slot-retry" ||
    event.type === "slot-error" ||
    event.type === "done"
  );
}
