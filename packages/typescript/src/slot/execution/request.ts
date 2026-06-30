import type { SlotFlightPrompt, SlotFlightRequest } from "../../types.js";
import { createSlotFramePrompt } from "../frame/prompt.js";

export function createSlotFlightRequest(
  frameRequests: SlotFlightRequest["slots"],
  prompt: SlotFlightPrompt | undefined,
  signal: AbortSignal
): SlotFlightRequest {
  return {
    prompt: createSlotFramePrompt(frameRequests, prompt),
    slots: frameRequests,
    attempt: Math.max(...frameRequests.map((slot) => slot.attempt)),
    signal
  };
}
