import {
  SlotFlightJsonParseError,
  SlotFlightSlotProtocolError,
  SlotFlightValidationError
} from "../../errors.js";
import type { SlotFrameParser, SlotFrameParserEvent } from "../frame/parser.js";
import { setPathValue } from "../path.js";
import type { CompiledSlot } from "../plan.js";
import { abortable, normalizeError } from "./scope.js";
import type { PendingFailure, SlotExecutionEvent } from "./types.js";

export async function* consumeFrameStream({
  stream,
  parser,
  slots,
  attempts,
  state,
  completed,
  failures,
  signal,
  cloneState
}: {
  stream: AsyncIterable<string>;
  parser: SlotFrameParser;
  slots: CompiledSlot[];
  attempts: Map<string, number>;
  state: unknown;
  completed: Set<string>;
  failures: Map<string, PendingFailure>;
  signal: AbortSignal;
  cloneState: <T>(value: T) => T;
}): AsyncGenerator<SlotExecutionEvent> {
  for await (const chunk of abortable(stream, signal)) {
    for (const frameEvent of parser.push(chunk)) {
      const event = handleFrameEvent({
        frameEvent,
        slots,
        attempts,
        state,
        completed,
        failures,
        cloneState
      });
      if (event !== undefined) {
        yield event;
      }
    }
  }
}

function handleFrameEvent({
  frameEvent,
  slots,
  attempts,
  state,
  completed,
  failures,
  cloneState
}: {
  frameEvent: SlotFrameParserEvent;
  slots: CompiledSlot[];
  attempts: Map<string, number>;
  state: unknown;
  completed: Set<string>;
  failures: Map<string, PendingFailure>;
  cloneState: <T>(value: T) => T;
}): SlotExecutionEvent | undefined {
  if (frameEvent.type === "slot-start") {
    return {
      type: "slot-start",
      slot: frameEvent.slot,
      attempt: attempts.get(frameEvent.slot) ?? 1,
      state: cloneState(state)
    };
  }

  if (frameEvent.type === "slot-delta") {
    // Partial state intentionally contains raw streaming text. The complete
    // event replaces it with the parsed and validated value.
    setPathValue(state, frameEvent.slot, frameEvent.value);
    return {
      type: "slot-delta",
      slot: frameEvent.slot,
      attempt: attempts.get(frameEvent.slot) ?? 1,
      delta: frameEvent.delta,
      value: frameEvent.value,
      state: cloneState(state)
    };
  }

  return completeSlotFrame({
    frameEvent,
    slots,
    attempts,
    state,
    completed,
    failures,
    cloneState
  });
}

function completeSlotFrame({
  frameEvent,
  slots,
  attempts,
  state,
  completed,
  failures,
  cloneState
}: {
  frameEvent: Extract<SlotFrameParserEvent, { type: "slot-complete" }>;
  slots: CompiledSlot[];
  attempts: Map<string, number>;
  state: unknown;
  completed: Set<string>;
  failures: Map<string, PendingFailure>;
  cloneState: <T>(value: T) => T;
}): SlotExecutionEvent | undefined {
  const slot = mustFindSlot(slots, frameEvent.slot);
  const attempt = attempts.get(slot.path) ?? 1;
  const parsedValue = parseSlotValue(slot, frameEvent.value);
  if (!parsedValue.success) {
    // The frame arrived, but the value is unusable. Mark it completed for this
    // pass so missing-slot detection does not add a second failure for it.
    failures.set(slot.path, {
      slot,
      attempt,
      error: parsedValue.error,
      retryable: true
    });
    completed.add(slot.path);
    return undefined;
  }

  const validated = slot.definition.schema.safeParse(parsedValue.value);
  if (!validated.success) {
    // Zod failures are slot-local: retry this slot without regenerating slots
    // that already produced validated values.
    failures.set(slot.path, {
      slot,
      attempt,
      error: new SlotFlightValidationError(slot.path, validated.error.issues),
      retryable: true
    });
    completed.add(slot.path);
    return undefined;
  }

  setPathValue(state, slot.path, validated.data);
  completed.add(slot.path);
  return {
    type: "slot-complete",
    slot: slot.path,
    attempt,
    value: validated.data,
    state: cloneState(state)
  };
}

function mustFindSlot(slots: CompiledSlot[], path: string): CompiledSlot {
  const slot = slots.find((candidate) => candidate.path === path);
  if (slot === undefined) {
    throw new SlotFlightSlotProtocolError(
      `Received unregistered slot "${path}".`,
      false
    );
  }
  return slot;
}

function parseSlotValue(
  slot: CompiledSlot,
  rawValue: string
): { success: true; value: unknown } | { success: false; error: Error } {
  if (slot.definition.mode !== "json") {
    return { success: true, value: rawValue };
  }

  try {
    return { success: true, value: JSON.parse(rawValue) };
  } catch (error) {
    return {
      success: false,
      error: new SlotFlightJsonParseError(
        slot.path,
        normalizeError(error).message
      )
    };
  }
}
