import { SlotFlightSlotProtocolError } from "../../errors.js";

export type SlotFrameParserEvent =
  | { type: "slot-start"; slot: string }
  | { type: "slot-delta"; slot: string; delta: string; value: string }
  | { type: "slot-complete"; slot: string; value: string };

export class SlotFrameParser {
  private state: "headers" | "value" = "headers";
  private buffer = "";
  private current:
    | {
        id: string;
        path: string;
        value: string;
      }
    | undefined;
  private readonly completed = new Set<string>();

  constructor(private readonly slotsById: Map<string, string>) {}

  push(chunk: string): SlotFrameParserEvent[] {
    this.buffer += chunk;
    const events: SlotFrameParserEvent[] = [];

    while (true) {
      if (this.state === "headers") {
        this.dropLeadingBlankLines();
        if (this.buffer.length === 0) {
          return events;
        }

        const headerMatch = /^<(?<id>\d+)>/.exec(this.buffer);
        if (headerMatch?.groups === undefined) {
          // Chunks can split a header after "<" or the id digits. Wait for
          // more bytes before treating the buffered prefix as invalid output.
          if (this.mightBePartialHeader()) {
            return events;
          }
          const slotLineEnd = this.buffer.indexOf("\n");
          const received =
            slotLineEnd === -1
              ? this.buffer
              : this.buffer.slice(0, slotLineEnd);
          throw new SlotFlightSlotProtocolError(
            `Expected slot id header but received "${received}".`,
            true
          );
        }

        const id = headerMatch.groups.id;
        const header = headerMatch[0];
        if (this.buffer.length < header.length) {
          return events;
        }

        const path = this.slotsById.get(id);
        if (path === undefined) {
          throw new SlotFlightSlotProtocolError(
            `Received unregistered slot id "${id}".`,
            false
          );
        }
        if (this.completed.has(path)) {
          throw new SlotFlightSlotProtocolError(
            `Received duplicate slot "${path}".`,
            false
          );
        }

        this.current = { id, path, value: "" };
        this.buffer = this.buffer.slice(header.length);
        if (this.buffer.startsWith("\r\n")) {
          this.buffer = this.buffer.slice(2);
        } else if (this.buffer.startsWith("\n")) {
          this.buffer = this.buffer.slice(1);
        }
        this.state = "value";
        events.push({ type: "slot-start", slot: path });
      }

      if (this.state === "value") {
        const flushed = this.flushValue();
        events.push(...flushed.events);
        if (!flushed.completedFrame) {
          return events;
        }
      }
    }
  }

  finish(): void {
    this.dropLeadingBlankLines();
    if (this.state !== "headers" || this.current !== undefined) {
      throw new SlotFlightSlotProtocolError(
        "Slot stream ended before closing delimiter.",
        true
      );
    }
    if (this.buffer.length > 0) {
      throw new SlotFlightSlotProtocolError(
        `Unexpected trailing content after slot frames: "${this.buffer}".`,
        true
      );
    }
  }

  private flushValue(): {
    events: SlotFrameParserEvent[];
    completedFrame: boolean;
  } {
    if (this.current === undefined) {
      return { events: [], completedFrame: false };
    }

    const events: SlotFrameParserEvent[] = [];
    const closing = `</${this.current.id}>`;
    const closingIndex = this.buffer.indexOf(closing);

    if (closingIndex !== -1) {
      const delta = stripOneTrailingLineBreak(
        this.buffer.slice(0, closingIndex)
      );
      if (delta.length > 0) {
        this.current.value += delta;
        events.push({
          type: "slot-delta",
          slot: this.current.path,
          delta,
          value: this.current.value
        });
      }
      events.push({
        type: "slot-complete",
        slot: this.current.path,
        value: this.current.value
      });
      this.completed.add(this.current.path);
      this.buffer = this.buffer.slice(closingIndex + closing.length);
      this.current = undefined;
      this.state = "headers";
      return { events, completedFrame: true };
    }

    // Keep a delimiter-sized suffix in the buffer so a close tag split across
    // chunks is not accidentally emitted as value text.
    const keep = closing.length + 1;
    if (this.buffer.length <= keep) {
      return { events, completedFrame: false };
    }

    const deltaEnd = this.buffer.length - keep;
    const delta = this.buffer.slice(0, deltaEnd);
    this.buffer = this.buffer.slice(deltaEnd);
    this.current.value += delta;
    events.push({
      type: "slot-delta",
      slot: this.current.path,
      delta,
      value: this.current.value
    });
    return { events, completedFrame: false };
  }

  private dropLeadingBlankLines(): void {
    while (this.buffer.startsWith("\n") || this.buffer.startsWith("\r\n")) {
      this.buffer = this.buffer.startsWith("\r\n")
        ? this.buffer.slice(2)
        : this.buffer.slice(1);
    }
  }

  private mightBePartialHeader(): boolean {
    return /^<\d*$/.test(this.buffer);
  }
}

function stripOneTrailingLineBreak(value: string): string {
  // Multiline frames commonly place the close tag on its own line; that
  // protocol newline should not become part of the slot value.
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }
  return value;
}
