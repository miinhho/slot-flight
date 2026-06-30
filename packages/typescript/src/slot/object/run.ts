import { SlotFlightStreamError } from "../../errors.js";
import type { SlotFlightEvent } from "../../types.js";

export type SlotObjectStreamConsumer =
  | "completedSlotStream"
  | "partialObjectStream"
  | "slotEventStream"
  | "toReadableStream"
  | "toResponse"
  | "finalObject";

export class SlotObjectRun {
  private consumedBy: SlotObjectStreamConsumer | undefined;
  private sourceIterator: AsyncIterator<SlotFlightEvent> | undefined;
  private resolveFinal!: (value: unknown) => void;
  private rejectFinal!: (error: unknown) => void;

  private readonly finalObjectPromise: Promise<unknown>;

  constructor(
    private readonly source: AsyncIterable<SlotFlightEvent>,
    private readonly cancelSource?: () => void
  ) {
    this.finalObjectPromise = new Promise((resolve, reject) => {
      this.resolveFinal = resolve;
      this.rejectFinal = reject;
    });
    this.finalObjectPromise.catch(() => undefined);
  }

  get finalObject(): Promise<unknown> {
    if (this.consumedBy === undefined) {
      this.startFinalObjectDrain();
    }
    return this.finalObjectPromise;
  }

  events(consumer: SlotObjectStreamConsumer): AsyncGenerator<SlotFlightEvent> {
    // SlotObjectRun deliberately has no event history or fan-out. A run has one
    // live consumer so slow views cannot force unbounded buffering.
    this.claim(consumer);
    return this.readEvents();
  }

  cancel(): void {
    this.cancelSource?.();
    void this.sourceIterator?.return?.();
  }

  private startFinalObjectDrain(): void {
    this.claim("finalObject");
    void (async () => {
      try {
        for await (const _event of this.readEvents()) {
          // Drain the source so finalObject can be used without selecting a
          // stream view; readEvents resolves the promise when it sees "done".
        }
      } catch {
        // readEvents already rejects finalObject with the same error.
      }
    })();
  }

  private claim(consumer: SlotObjectStreamConsumer): void {
    if (this.consumedBy !== undefined) {
      throw new SlotFlightStreamError(
        `SlotObjectStream is already being consumed by ${this.consumedBy}. Choose one stream view per run.`
      );
    }

    this.consumedBy = consumer;
  }

  private async *readEvents(): AsyncGenerator<SlotFlightEvent> {
    const iterator = this.source[Symbol.asyncIterator]();
    this.sourceIterator = iterator;
    let sawDone = false;
    let completed = false;
    let finalState: unknown;

    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) {
          break;
        }

        const event = next.value;
        if (event.type === "done") {
          sawDone = true;
          finalState = event.state;
        }
        yield event;
      }

      if (!sawDone) {
        throw new SlotFlightStreamError(
          "SlotObjectStream source completed without a done event."
        );
      }

      completed = true;
      this.resolveFinal(finalState);
    } catch (error) {
      this.rejectFinal(error);
      throw error;
    } finally {
      this.sourceIterator = undefined;
      if (!completed) {
        this.cancel();
        await iterator.return?.();
        this.rejectFinal(new DOMException("Stream cancelled", "AbortError"));
      }
    }
  }
}
