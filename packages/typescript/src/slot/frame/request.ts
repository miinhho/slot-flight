import type { SlotFrameRequest } from "../../types.js";
import type { CompiledSlot } from "../plan.js";

export function createSlotId(index: number): string {
  return String(index + 1);
}

export function createSlotFrameRequests(
  slots: CompiledSlot[],
  attempts: ReadonlyMap<string, number>
): SlotFrameRequest[] {
  // Frame ids are local to this provider request. Retried subsets get compact
  // ids again, while the server keeps the stable mapping back to slot paths.
  return slots.map((slot, index) => {
    const frame: SlotFrameRequest = {
      id: createSlotId(index),
      path: slot.path,
      templatePath: slot.definition.path,
      prompt: "",
      attempt: attempts.get(slot.path) ?? 1,
      repeat: slot.repeat
    };

    frame.prompt =
      typeof slot.definition.prompt === "function"
        ? slot.definition.prompt(frame)
        : (slot.definition.prompt ?? "");

    return frame;
  });
}
