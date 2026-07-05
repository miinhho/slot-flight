import { SlotFlightSlotProtocolError } from "../../errors.js";

export type SlotFrameParserEvent =
  | { type: "slot-start"; slot: string; index?: number }
  | {
      type: "slot-delta";
      slot: string;
      index?: number;
      delta: string;
      value: string;
    }
  | { type: "slot-complete"; slot: string; index?: number; value: string };

const PROTOCOL_ERROR_PREVIEW_LENGTH = 160;
const HEADER_PATTERN = /^<(?<id>\d+)(?::(?<index>\d+))?>/;
const PARTIAL_ID_HEADER_PATTERN = /^<\d*$/;
const PARTIAL_INDEXED_HEADER_PATTERN = /^<(?<id>\d+):(?<index>\d*)$/;

type ParserState = "headers" | "value";

interface CurrentFrame {
  tag: string;
  path: string;
  index?: number;
  value: string;
  allowsImmediateClosing: boolean;
}

export class SlotFrameParser {
  private state: ParserState = "headers";
  private buffer = "";
  private current: CurrentFrame | undefined;
  private readonly completed = new Set<string>();
  private readonly nextRepeatIndexes = new Map<string, number>();
  private readonly maxSlotIdDigits: number;

  constructor(
    private readonly slotsById: Map<string, string>,
    private readonly repeatableSlots: ReadonlySet<string> = new Set()
  ) {
    this.maxSlotIdDigits = Math.max(
      1,
      ...Array.from(slotsById.keys(), (id) => id.length)
    );
  }

  push(chunk: string): SlotFrameParserEvent[] {
    this.buffer += chunk;
    const events: SlotFrameParserEvent[] = [];

    while (true) {
      if (this.state === "headers") {
        this.dropLeadingBlankLines();
        if (this.buffer.length === 0) {
          return events;
        }

        const headerMatch = HEADER_PATTERN.exec(this.buffer);
        if (headerMatch?.groups === undefined) {
          // Chunks can split a header after "<" or the id digits. Wait for
          // more bytes before treating the buffered prefix as invalid output.
          if (this.mightBePartialHeader()) {
            return events;
          }
          const preview = this.headerPreview();
          this.buffer = "";
          throw new SlotFlightSlotProtocolError(
            `Expected slot id header but received ${formatProtocolPreview(preview)}.`,
            true
          );
        }

        const id = headerMatch.groups.id;
        const rawIndex = headerMatch.groups.index;
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
        const repeatable = this.repeatableSlots.has(path);
        if (rawIndex !== undefined && !repeatable) {
          throw new SlotFlightSlotProtocolError(
            `Received indexed frame for fixed slot "${path}".`,
            true
          );
        }
        if (rawIndex === undefined && repeatable) {
          throw new SlotFlightSlotProtocolError(
            `Repeatable slot "${path}" must use indexed tags like <${id}:0>.`,
            true
          );
        }
        const frameIndex =
          rawIndex === undefined
            ? undefined
            : this.parseExpectedRepeatIndex(path, rawIndex);

        const completedKey = frameKey(path, frameIndex);
        if (this.completed.has(completedKey)) {
          throw new SlotFlightSlotProtocolError(
            `Received duplicate slot "${completedKey}".`,
            false
          );
        }

        this.current = {
          tag: header.slice(1, -1),
          path,
          index: frameIndex,
          value: "",
          allowsImmediateClosing: this.consumeOpeningLineBreak(header.length)
        };
        this.state = "value";
        events.push({
          type: "slot-start",
          slot: path,
          ...eventIndex(frameIndex)
        });
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
        `Unexpected trailing content after slot frames: ${formatProtocolPreview(this.buffer)}.`,
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
    const closing = `</${this.current.tag}>`;
    const closingIndex = findLineDelimitedClosing(
      this.buffer,
      closing,
      this.current.allowsImmediateClosing
    );

    if (closingIndex !== -1) {
      const delta = stripOneTrailingLineBreak(
        this.buffer.slice(0, closingIndex)
      );
      if (delta.length > 0) {
        this.current.value += delta;
        events.push({
          type: "slot-delta",
          slot: this.current.path,
          ...eventIndex(this.current.index),
          delta,
          value: this.current.value
        });
      }
      events.push({
        type: "slot-complete",
        slot: this.current.path,
        ...eventIndex(this.current.index),
        value: this.current.value
      });
      this.completed.add(frameKey(this.current.path, this.current.index));
      if (this.current.index !== undefined) {
        this.nextRepeatIndexes.set(this.current.path, this.current.index + 1);
      }
      this.buffer = this.buffer.slice(closingIndex + closing.length);
      this.current = undefined;
      this.state = "headers";
      return { events, completedFrame: true };
    }

    // Keep the possible delimiter line in the buffer so a close tag split
    // across chunks is not accidentally emitted as value text.
    const keepStart = findValueFlushBoundary(this.buffer, closing);
    if (keepStart === 0) {
      return { events, completedFrame: false };
    }

    const delta = this.buffer.slice(0, keepStart);
    this.buffer = this.buffer.slice(keepStart);
    this.current.value += delta;
    events.push({
      type: "slot-delta",
      slot: this.current.path,
      ...eventIndex(this.current.index),
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
    if (
      this.buffer.length <= this.maxSlotIdDigits + 1 &&
      PARTIAL_ID_HEADER_PATTERN.test(this.buffer)
    ) {
      return true;
    }

    const indexed = PARTIAL_INDEXED_HEADER_PATTERN.exec(this.buffer);
    if (indexed?.groups === undefined) {
      return false;
    }

    const id = indexed.groups.id;
    if (id.length > this.maxSlotIdDigits) {
      return false;
    }

    const path = this.slotsById.get(id);
    if (path === undefined || !this.repeatableSlots.has(path)) {
      return false;
    }

    const expectedIndex = String(this.nextRepeatIndexes.get(path) ?? 0);
    return expectedIndex.startsWith(indexed.groups.index);
  }

  private parseExpectedRepeatIndex(path: string, rawIndex: string): number {
    const expectedIndex = this.nextRepeatIndexes.get(path) ?? 0;
    const expected = String(expectedIndex);
    if (rawIndex !== expected) {
      throw new SlotFlightSlotProtocolError(
        `Expected repeat index ${expected} for slot "${path}" but received ${formatIndexForError(rawIndex)}.`,
        true
      );
    }
    return expectedIndex;
  }

  private headerPreview(): string {
    const slotLineEnd = this.buffer.indexOf("\n");
    return slotLineEnd === -1 ? this.buffer : this.buffer.slice(0, slotLineEnd);
  }

  private consumeOpeningLineBreak(headerLength: number): boolean {
    this.buffer = this.buffer.slice(headerLength);
    if (this.buffer.startsWith("\r\n")) {
      this.buffer = this.buffer.slice(2);
      return true;
    }
    if (this.buffer.startsWith("\n")) {
      this.buffer = this.buffer.slice(1);
      return true;
    }
    return false;
  }
}

function frameKey(path: string, index: number | undefined): string {
  return index === undefined ? path : `${path}:${String(index)}`;
}

function eventIndex(index: number | undefined): { index: number } | object {
  return index === undefined ? {} : { index };
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

function findLineDelimitedClosing(
  buffer: string,
  closing: string,
  allowAtStart: boolean
): number {
  let searchFrom = 0;
  while (true) {
    const index = buffer.indexOf(closing, searchFrom);
    if (index === -1) {
      return -1;
    }

    const startsLine =
      (index === 0 && allowAtStart) || buffer[index - 1] === "\n";
    const afterIndex = index + closing.length;
    const atLineEnd =
      afterIndex === buffer.length ||
      buffer[afterIndex] === "\n" ||
      (buffer[afterIndex] === "\r" && buffer[afterIndex + 1] === "\n");

    if (startsLine && atLineEnd) {
      return index;
    }

    searchFrom = index + 1;
  }
}

function findValueFlushBoundary(buffer: string, closing: string): number {
  const lastLineBreak = buffer.lastIndexOf("\n");
  if (lastLineBreak !== -1) {
    if (buffer[lastLineBreak - 1] === "\r") {
      return lastLineBreak - 1;
    }
    return lastLineBreak;
  }

  if (closing.startsWith(buffer)) {
    return 0;
  }

  if (buffer.startsWith(`${closing}\r`)) {
    return 0;
  }

  if (buffer.endsWith("\r")) {
    return buffer.length - 1;
  }

  return buffer.length;
}

function formatProtocolPreview(value: string): string {
  const escaped = value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
  if (escaped.length <= PROTOCOL_ERROR_PREVIEW_LENGTH) {
    return `"${escaped}"`;
  }
  return `"${escaped.slice(0, PROTOCOL_ERROR_PREVIEW_LENGTH)}..." (length ${value.length})`;
}

function formatIndexForError(value: string): string {
  if (value.length <= PROTOCOL_ERROR_PREVIEW_LENGTH) {
    return value;
  }
  return `${value.slice(0, PROTOCOL_ERROR_PREVIEW_LENGTH)}... (length ${value.length})`;
}
