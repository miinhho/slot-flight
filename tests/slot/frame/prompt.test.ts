import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createSlotFramePrompt } from "../../../src/slot/frame/prompt.js";
import { createSlotFrameRequests } from "../../../src/slot/frame/request.js";

describe("slot frame prompt", () => {
  it("describes a structured slot-frame contract for text and JSON slots", () => {
    const slots = createSlotFrameRequests(
      [
        {
          path: "summary",
          definition: {
            path: "summary",
            schema: z.string(),
            prompt: "Write one concise operational summary."
          }
        },
        {
          path: "tags",
          definition: {
            path: "tags",
            schema: z.array(z.string()).length(3),
            mode: "json",
            prompt: "Write exactly 3 short tags."
          }
        }
      ],
      new Map([
        ["summary", 1],
        ["tags", 2]
      ])
    );

    const prompt = createSlotFramePrompt(slots, undefined);

    expect(prompt).toContain("OUTPUT CONTRACT");
    expect(prompt).toContain("Do not emit JSON.");
    expect(prompt).toContain("The server owns the object shape");
    expect(prompt).toContain("- id: 1");
    expect(prompt).toContain("  path: summary");
    expect(prompt).toContain("  mode: text");
    expect(prompt).toContain("  attempt: 1");
    expect(prompt).toContain("  open: <1>");
    expect(prompt).toContain("  close: </1>");
    expect(prompt).toContain("Prefer one-line frames");
    expect(prompt).toContain("<1>raw slot value only</1>");
    expect(prompt).toContain("immediately write the exact closing tag");
    expect(prompt).toContain("Write one concise operational summary.");
    expect(prompt).toContain("- id: 2");
    expect(prompt).toContain("  path: tags");
    expect(prompt).toContain("  mode: json");
    expect(prompt).toContain("  attempt: 2");
    expect(prompt).toContain("one syntactically valid JSON value");
    expect(prompt).toContain(
      "A retry attempt means the previous frame or value"
    );
  });

  it("lets callers replace the default prompt completely", () => {
    const slots = createSlotFrameRequests(
      [
        {
          path: "name",
          definition: {
            path: "name",
            schema: z.string()
          }
        }
      ],
      new Map([["name", 1]])
    );

    expect(createSlotFramePrompt(slots, "custom prompt")).toBe("custom prompt");
    expect(
      createSlotFramePrompt(
        slots,
        ({ slots: requestedSlots }) => `custom ${requestedSlots[0]?.path}`
      )
    ).toBe("custom name");
  });
});
