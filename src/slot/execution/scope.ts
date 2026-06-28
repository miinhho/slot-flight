import { SlotFlightSlotProtocolError } from "../../errors.js";

export function createRequestScope(parentSignal: AbortSignal | undefined): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  // One signal controls the provider request, parser consumption, and caller
  // cancellation for a single frame stream.
  const controller = new AbortController();
  const cleanupAbort = linkAbortSignal(parentSignal, controller);

  return {
    signal: controller.signal,
    cleanup: cleanupAbort
  };
}

export async function* abortable<T>(
  stream: AsyncIterable<T>,
  signal: AbortSignal
): AsyncGenerator<T> {
  const iterator = stream[Symbol.asyncIterator]();
  const abort = createAbortPromise(signal);
  let completed = false;

  try {
    while (true) {
      const next = await Promise.race([iterator.next(), abort.promise]);
      throwIfAborted(signal);

      if (next.done) {
        completed = true;
        return;
      }

      yield next.value;
    }
  } finally {
    if (!completed) {
      // Give SDK streams a chance to release sockets/readers when cancellation
      // interrupts a frame stream mid-iteration.
      await iterator.return?.();
    }
    abort.cleanup();
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

export function isAbortError(
  error: Error,
  parentSignal: AbortSignal | undefined
): boolean {
  return parentSignal?.aborted === true || error.name === "AbortError";
}

export function isRetryableSlotProtocolError(error: Error): boolean {
  return error instanceof SlotFlightSlotProtocolError && error.retryable;
}

function createAbortPromise(signal: AbortSignal): {
  promise: Promise<never>;
  cleanup: () => void;
} {
  if (signal.aborted) {
    return {
      promise: Promise.reject(
        signal.reason ?? new DOMException("Aborted", "AbortError")
      ),
      cleanup: () => undefined
    };
  }

  let rejectAbort!: (reason: unknown) => void;
  const promise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort(signal.reason ?? new DOMException("Aborted", "AbortError"));
  };

  signal.addEventListener("abort", onAbort, { once: true });

  return {
    promise,
    cleanup: () => signal.removeEventListener("abort", onAbort)
  };
}

function linkAbortSignal(
  parent: AbortSignal | undefined,
  child: AbortController
): () => void {
  if (parent === undefined) {
    return () => undefined;
  }

  if (parent.aborted) {
    child.abort(parent.reason);
    return () => undefined;
  }

  const abort = () => child.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}
