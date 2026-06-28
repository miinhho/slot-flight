import type { SlotFlightPrompt, SlotGenerator } from "../../types.js";
import { SlotFrameParser } from "../frame/parser.js";
import { createSlotFrameRequests } from "../frame/request.js";
import type { CompiledSlot } from "../plan.js";
import { consumeFrameStream } from "./events.js";
import {
  frameSlotErrors,
  recordFrameFailure,
  recordMissingSlots
} from "./failures.js";
import { createSlotFlightRequest } from "./request.js";
import {
  createRequestScope,
  isAbortError,
  isRetryableSlotProtocolError,
  normalizeError
} from "./scope.js";
import type { PendingFailure, SlotExecutionEvent } from "./types.js";

export async function* runFrameRequest({
  slots,
  attempts,
  state,
  generate,
  prompt,
  signal,
  cloneState
}: {
  slots: CompiledSlot[];
  attempts: Map<string, number>;
  state: unknown;
  generate: SlotGenerator;
  prompt?: SlotFlightPrompt;
  signal?: AbortSignal;
  cloneState: <T>(value: T) => T;
}): AsyncGenerator<SlotExecutionEvent, Map<string, PendingFailure>> {
  const requestScope = createRequestScope(signal);
  const frameRequests = createSlotFrameRequests(slots, attempts);
  const request = createSlotFlightRequest(
    frameRequests,
    prompt,
    requestScope.signal
  );
  const completed = new Set<string>();
  const failures = new Map<string, PendingFailure>();

  try {
    const stream = await generate(request);
    const parser = new SlotFrameParser(
      new Map(frameRequests.map((slot) => [slot.id, slot.path]))
    );

    yield* consumeFrameStream({
      stream,
      parser,
      slots,
      attempts,
      state,
      completed,
      failures,
      signal: request.signal,
      cloneState
    });

    parser.finish();
    recordMissingSlots(slots, completed, failures, attempts);
  } catch (error) {
    const normalized = normalizeError(error);
    if (isAbortError(normalized, signal)) {
      yield* frameSlotErrors(slots, attempts, normalized, state, cloneState);
      throw normalized;
    }

    // Provider/runtime failures are recorded for incomplete slots but are not
    // retried unless the parser can prove this was a recoverable protocol miss.
    recordFrameFailure(
      slots,
      completed,
      failures,
      attempts,
      normalized,
      isRetryableSlotProtocolError(normalized)
    );
  } finally {
    requestScope.cleanup();
  }

  return failures;
}
