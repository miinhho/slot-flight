import { nextPendingSlots } from "./failures.js";
import { runFrameRequest } from "./frame-request.js";
import { throwIfAborted } from "./scope.js";
import type { SlotExecutionEvent, SlotExecutionOptions } from "./types.js";

export type { SlotExecutionOptions } from "./types.js";

export async function* runSlotFrameStream({
  slots,
  state,
  generate,
  prompt,
  maxRetries,
  signal,
  cloneState,
  validateRepeatState
}: SlotExecutionOptions): AsyncGenerator<SlotExecutionEvent, void> {
  const attempts = new Map(slots.map((slot) => [slot.path, 1]));
  let pending = [...slots];

  while (true) {
    while (pending.length > 0) {
      throwIfAborted(signal);

      // Each pass asks for every currently pending slot in one frame stream.
      // Completed slots drop out; only retryable failures come back as pending.
      const failures = yield* runFrameRequest({
        slots: pending,
        attempts,
        state,
        generate,
        prompt,
        signal,
        cloneState
      });

      pending = yield* nextPendingSlots({
        failures,
        remaining: [],
        attempts,
        maxRetries,
        state,
        cloneState
      });
    }

    const failures =
      validateRepeatState?.({
        state,
        slots,
        attempts
      }) ?? new Map();

    pending = yield* nextPendingSlots({
      failures,
      remaining: [],
      attempts,
      maxRetries,
      state,
      cloneState
    });

    if (pending.length === 0) {
      return;
    }
  }
}
