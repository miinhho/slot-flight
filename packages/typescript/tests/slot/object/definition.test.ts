import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { SlotFlightConfigurationError } from "../../../src/core.js";
import { slotObject } from "../../../src/index.js";

describe("slotObject definitions", () => {
  it("infers slots from described Zod fields", () => {
    const output = slotObject({
      schema: z.object({
        title: z.string().describe("Write a title."),
        metadata: z.object({
          audience: z.string().min(1).describe("Write the intended audience.")
        })
      })
    });

    expect(output.slots).toEqual([
      expect.objectContaining({
        path: "title",
        prompt: "Write a title.",
        mode: "text"
      }),
      expect.objectContaining({
        path: "metadata.audience",
        prompt: "Write the intended audience.",
        mode: "text"
      })
    ]);
    expect(output.slots[1]?.schema.safeParse("")).toMatchObject({
      success: false
    });
  });

  it("uses one JSON slot for described array and object fields", () => {
    const output = slotObject({
      schema: z.object({
        tags: z
          .array(z.string().min(1))
          .length(3)
          .describe("Write exactly 3 tags."),
        metadata: z
          .object({
            audience: z.string(),
            priority: z.enum(["low", "high"])
          })
          .describe("Write the metadata object.")
      })
    });

    expect(output.slots).toEqual([
      expect.objectContaining({
        path: "tags",
        prompt: "Write exactly 3 tags.",
        mode: "json"
      }),
      expect.objectContaining({
        path: "metadata",
        prompt: "Write the metadata object.",
        mode: "json"
      })
    ]);
  });

  it("rejects fields that are not described", () => {
    expect(() =>
      slotObject({
        schema: z.object({
          title: z.string()
        })
      })
    ).toThrow(SlotFlightConfigurationError);
  });
});
