import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createSlotFramePrompt } from "../../../src/slot/frame/prompt.js";
import { createSlotFrameRequests } from "../../../src/slot/frame/request.js";

describe("slot frame prompt", () => {
  it("includes repeat metadata without reintroducing slot modes", () => {
    const slots = createSlotFrameRequests(
      [
        {
          path: "summary",
          repeat: "none",
          definition: {
            path: "summary",
            schema: z.string(),
            prompt: "Write one concise operational summary."
          }
        },
        {
          path: "tags[]",
          repeat: "append",
          arrayPath: "tags",
          definition: {
            path: "tags[]",
            schema: z.string(),
            prompt: "Write exactly 3 short tags."
          }
        }
      ],
      new Map([
        ["summary", 1],
        ["tags[]", 2]
      ])
    );

    const prompt = createSlotFramePrompt(slots, undefined);

    expect(slots[1]).toMatchObject({
      path: "tags[]",
      repeat: "append"
    });
    expect(prompt).toContain("  repeat: append");
    expect(prompt).toContain("  open: <2:0>");
    expect(prompt).toContain("  close: </2:0>");
    expect(prompt).toContain("Use the same repeat index");
    expect(prompt).toContain("Do not emit JSON objects, JSON arrays");
    expect(prompt).not.toContain("mode:");
    expect(prompt).not.toContain("mode: json");
  });

  it("lets callers replace the default prompt completely", () => {
    const slots = createSlotFrameRequests(
      [
        {
          path: "name",
          repeat: "none",
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
