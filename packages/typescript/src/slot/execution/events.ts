import {
  SlotFlightSlotProtocolError,
  SlotFlightValidationError
} from "../../errors.js";
import type { SlotFrameParser, SlotFrameParserEvent } from "../frame/parser.js";
import { setPathValue } from "../path.js";
import type { CompiledSlot } from "../plan.js";
import { SlotPathResolver } from "./path-resolver.js";
import { abortable } from "./scope.js";
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
  const paths = new SlotPathResolver();

  for await (const chunk of abortable(stream, signal)) {
    for (const frameEvent of parser.push(chunk)) {
      const event = handleFrameEvent({
        frameEvent,
        slots,
        paths,
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
  paths,
  attempts,
  state,
  completed,
  failures,
  cloneState
}: {
  frameEvent: SlotFrameParserEvent;
  slots: CompiledSlot[];
  paths: SlotPathResolver;
  attempts: Map<string, number>;
  state: unknown;
  completed: Set<string>;
  failures: Map<string, PendingFailure>;
  cloneState: <T>(value: T) => T;
}): SlotExecutionEvent | undefined {
  const slot = mustFindSlot(slots, frameEvent.slot);

  if (frameEvent.type === "slot-start") {
    const concretePath = paths.start(slot, frameEvent.index);
    return {
      type: "slot-start",
      slot: concretePath,
      attempt: attempts.get(slot.path) ?? 1,
      state: cloneState(state)
    };
  }

  if (frameEvent.type === "slot-delta") {
    const concretePath = paths.current(slot, frameEvent.index);
    setPathValue(state, concretePath, frameEvent.value);
    return {
      type: "slot-delta",
      slot: concretePath,
      attempt: attempts.get(slot.path) ?? 1,
      delta: frameEvent.delta,
      value: frameEvent.value,
      state: cloneState(state)
    };
  }

  return completeSlotFrame({
    frameEvent,
    slot,
    concretePath: paths.current(slot, frameEvent.index),
    paths,
    attempts,
    state,
    completed,
    failures,
    cloneState
  });
}

function completeSlotFrame({
  frameEvent,
  slot,
  concretePath,
  paths,
  attempts,
  state,
  completed,
  failures,
  cloneState
}: {
  frameEvent: Extract<SlotFrameParserEvent, { type: "slot-complete" }>;
  slot: CompiledSlot;
  concretePath: string;
  paths: SlotPathResolver;
  attempts: Map<string, number>;
  state: unknown;
  completed: Set<string>;
  failures: Map<string, PendingFailure>;
  cloneState: <T>(value: T) => T;
}): SlotExecutionEvent | undefined {
  const attempt = attempts.get(slot.path) ?? 1;
  if (completed.has(concretePath)) {
    throw new SlotFlightSlotProtocolError(
      `Received duplicate slot "${concretePath}".`,
      false
    );
  }

  const validated = slot.definition.schema.safeParse(frameEvent.value);
  if (!validated.success) {
    // Zod failures are slot-local: retry this slot without regenerating slots
    // that already produced validated values.
    failures.set(slot.path, {
      slot,
      attempt,
      error: new SlotFlightValidationError(
        concretePath,
        validated.error.issues
      ),
      retryable: true
    });
    completed.add(concretePath);
    paths.complete(slot, frameEvent.index);
    return undefined;
  }

  setPathValue(state, concretePath, validated.data);
  completed.add(concretePath);
  paths.complete(slot, frameEvent.index);
  return {
    type: "slot-complete",
    slot: concretePath,
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
