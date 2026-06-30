import { describe, expect, it } from "bun:test";
import { SlotFlightConfigurationError } from "../../src/core.js";
import {
  concretePathToJsonPointer,
  expandSlotPath,
  setPathValue
} from "../../src/slot/path.js";

describe("slot paths", () => {
  it("expands array item wildcard paths", () => {
    expect(expandSlotPath("tags[]", 3)).toEqual([
      "tags[0]",
      "tags[1]",
      "tags[2]"
    ]);
    expect(expandSlotPath("sections[].heading", 2)).toEqual([
      "sections[0].heading",
      "sections[1].heading"
    ]);
    expect(() => expandSlotPath("tags[]")).toThrow(
      SlotFlightConfigurationError
    );
  });

  it("sets nested object and array values", () => {
    const state = {};

    expect(setPathValue(state, "sections[0].heading", "Intro")).toBe("add");
    expect(setPathValue(state, "sections[0].body", "Body")).toBe("add");
    expect(setPathValue(state, "sections[0].heading", "Start")).toBe("replace");

    expect(state).toEqual({
      sections: [{ heading: "Start", body: "Body" }]
    });
  });

  it("converts concrete paths to JSON Pointers", () => {
    expect(concretePathToJsonPointer("sections[1].heading")).toBe(
      "/sections/1/heading"
    );
  });

  it("escapes JSON Pointer special characters in property names", () => {
    expect(concretePathToJsonPointer("metadata.a/b~c")).toBe(
      "/metadata/a~1b~0c"
    );
  });
});
