import { SlotFlightSlotProtocolError } from "../../errors.js";
import type { CompiledSlot } from "../plan.js";
import type { PendingFailure, SlotExecutionEvent } from "./types.js";

export function recordMissingSlots(
  slots: CompiledSlot[],
  completed: ReadonlySet<string>,
  failures: Map<string, PendingFailure>,
  attempts: ReadonlyMap<string, number>
): void {
  // Missing frames are slot failures, not whole-run failures. This keeps retry
  // scoped to the smallest unit the engine can safely regenerate.
  for (const slot of slots) {
    if (!completed.has(slot.path) && !failures.has(slot.path)) {
      failures.set(slot.path, {
        slot,
        attempt: attempts.get(slot.path) ?? 1,
        error: new SlotFlightSlotProtocolError(
          `Slot "${slot.path}" was not emitted by the stream.`,
          true
        ),
        retryable: true
      });
    }
  }
}

export function recordFrameFailure(
  slots: CompiledSlot[],
  completed: ReadonlySet<string>,
  failures: Map<string, PendingFailure>,
  attempts: ReadonlyMap<string, number>,
  error: Error,
  retryable: boolean
): void {
  for (const slot of slots) {
    if (!completed.has(slot.path) && !failures.has(slot.path)) {
      failures.set(slot.path, {
        slot,
        attempt: attempts.get(slot.path) ?? 1,
        error,
        retryable
      });
    }
  }
}

export async function* nextPendingSlots({
  failures,
  remaining,
  attempts,
  maxRetries,
  state,
  cloneState
}: {
  failures: Map<string, PendingFailure>;
  remaining: CompiledSlot[];
  attempts: Map<string, number>;
  maxRetries: number;
  state: unknown;
  cloneState: <T>(value: T) => T;
}): AsyncGenerator<SlotExecutionEvent, CompiledSlot[]> {
  if (failures.size === 0) {
    return remaining;
  }

  const retrySlots: CompiledSlot[] = [];
  for (const failure of failures.values()) {
    const maxAttempts = (failure.slot.definition.maxRetries ?? maxRetries) + 1;
    if (failure.retryable && failure.attempt < maxAttempts) {
      yield {
        type: "slot-retry",
        slot: failure.slot.path,
        attempt: failure.attempt,
        error: failure.error,
        state: cloneState(state)
      };
      attempts.set(failure.slot.path, failure.attempt + 1);
      retrySlots.push(failure.slot);
      continue;
    }

    yield {
      type: "slot-error",
      slot: failure.slot.path,
      attempt: failure.attempt,
      error: failure.error,
      state: cloneState(state)
    };
    throw failure.error;
  }

  // Retry failed slots before moving on so partial state progresses in the same
  // order callers requested, while already validated slots are not regenerated.
  return [...retrySlots, ...remaining];
}

export async function* frameSlotErrors(
  slots: CompiledSlot[],
  attempts: ReadonlyMap<string, number>,
  error: Error,
  state: unknown,
  cloneState: <T>(value: T) => T
): AsyncGenerator<SlotExecutionEvent> {
  for (const slot of slots) {
    yield {
      type: "slot-error",
      slot: slot.path,
      attempt: attempts.get(slot.path) ?? 1,
      error,
      state: cloneState(state)
    };
  }
}
