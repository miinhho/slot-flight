import { describe, expect, it } from "bun:test";
import { SlotFrameParser } from "../../../src/slot/frame/parser.js";

describe("SlotFrameParser", () => {
  it("extracts ordered slot frame events from one compact stream", () => {
    const parser = new SlotFrameParser(
      new Map([
        ["1", "name"],
        ["2", "title"]
      ])
    );

    const events = [
      ...parser.push("<1>\nAli"),
      ...parser.push("ce\n</1>\n<2>\nEng"),
      ...parser.push("ineer\n</2>")
    ];

    parser.finish();

    expect(events.filter((event) => event.type === "slot-start")).toEqual([
      { type: "slot-start", slot: "name" },
      { type: "slot-start", slot: "title" }
    ]);
    expect(events).toContainEqual({
      type: "slot-complete",
      slot: "name",
      value: "Alice"
    });
    expect(events).toContainEqual({
      type: "slot-complete",
      slot: "title",
      value: "Engineer"
    });
  });

  it("rejects unregistered slot ids", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    expect(() => parser.push("<2>\nAlice\n</2>")).toThrow(
      'Received unregistered slot id "2"'
    );
  });

  it("rejects inline closing delimiters", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    parser.push("<1>Alice</1>");

    expect(() => parser.finish()).toThrow(
      "Slot stream ended before closing delimiter."
    );
  });

  it("preserves tag-like text inside a value", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    const events = [
      ...parser.push("<1>Alice </1> Cooper"),
      ...parser.push("\n</1>")
    ];
    parser.finish();

    expect(events).toContainEqual({
      type: "slot-complete",
      slot: "name",
      value: "Alice </1> Cooper"
    });
  });

  it("handles closing delimiters split across streaming chunks", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    const events = [
      ...parser.push("<1>Alice\n<"),
      ...parser.push("/"),
      ...parser.push("1>")
    ];
    parser.finish();

    expect(events).toContainEqual({
      type: "slot-complete",
      slot: "name",
      value: "Alice"
    });
  });

  it("rejects a stream that ends before the active slot closes", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    parser.push("<1>Alice");

    expect(() => parser.finish()).toThrow(
      "Slot stream ended before closing delimiter."
    );
  });

  it("rejects trailing content after valid slot frames", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));

    expect(() => parser.push("<1>Alice\n</1>\nextra")).toThrow(
      'Expected slot id header but received "extra".'
    );
  });

  it("rejects duplicate slot frames", () => {
    const parser = new SlotFrameParser(new Map([["1", "name"]]));
    parser.push("<1>\nAlice\n</1>");

    expect(() => parser.push("\n<1>\nAlice again\n</1>")).toThrow(
      'Received duplicate slot "name"'
    );
  });
});
