import type {
  SlotFlightPrompt,
  SlotFlightPromptRequest,
  SlotFrameRequest
} from "../../types.js";

export function createSlotFramePrompt(
  slots: SlotFrameRequest[],
  prompt: SlotFlightPrompt | undefined
): string {
  const request: SlotFlightPromptRequest = {
    prompt: "",
    slots,
    attempt: Math.max(...slots.map((slot) => slot.attempt))
  };

  return typeof prompt === "function"
    ? prompt(request)
    : (prompt ?? defaultSlotFramePrompt(slots));
}

export function defaultSlotFramePrompt(slots: SlotFrameRequest[]): string {
  const slotList = slots.map(formatSlotPromptEntry).join("\n\n");
  return [
    "You are filling slots for a server-owned JSON object.",
    "Do not emit JSON.",
    "The server owns the object shape, paths, validation, retries, and assembly.",
    "",
    "OUTPUT CONTRACT",
    "- Emit exactly one frame for each requested slot.",
    "- Emit frames in the same order as the slot list.",
    "- Copy each open and close tag exactly.",
    "- Do not emit unrequested ids, JSON paths, markdown, code fences, commentary, bullets, or explanations.",
    "- Do not omit a frame. If a value is uncertain, make the best valid value for that slot.",
    "- Do not include a closing tag string inside a value.",
    "",
    "FRAME SHAPE",
    "- Prefer one-line frames for concise values:",
    "<1>raw slot value only</1>",
    "- Use multiline frames only when the value itself needs multiple lines:",
    "<1>",
    "raw multiline slot value only",
    "</1>",
    "- After writing a value, immediately write the exact closing tag for that id.",
    "",
    "VALUE RULES",
    "- For mode: text, emit the raw value only. Do not wrap it in quotes unless quotes are part of the value.",
    "- For mode: json, emit one syntactically valid JSON value inside the frame body and nothing else.",
    "- JSON strings, arrays, and objects must use valid JSON syntax with double-quoted strings.",
    "- Respect each slot instruction, especially enum labels, length limits, item counts, and requested language.",
    "- A retry attempt means the previous frame or value for that slot failed parsing, protocol checks, or validation. Produce a corrected value only for the requested retry slot.",
    "",
    "SLOTS",
    slotList
  ].join("\n");
}

function formatSlotPromptEntry(slot: SlotFrameRequest): string {
  return [
    `- id: ${slot.id}`,
    `  path: ${slot.path}`,
    `  mode: ${slot.mode}`,
    `  attempt: ${slot.attempt}`,
    `  open: <${slot.id}>`,
    `  close: </${slot.id}>`,
    slot.prompt ? `  instruction: ${slot.prompt}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
