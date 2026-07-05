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
    "- For repeat: none, emit exactly one frame for each requested slot.",
    "- For repeat slots, emit one indexed frame per array item using <id:index> and </id:index>.",
    "- Repeat indexes start at 0, increase without gaps, and identify the array item.",
    "- Use the same repeat index for fields that belong to the same object array item.",
    "- Copy each open and close tag exactly.",
    "- Put each closing tag on its own line with no other text on that line.",
    "- Do not emit unrequested ids, JSON paths, markdown, code fences, commentary, bullets, or explanations.",
    "- Do not omit a frame. If a value is uncertain, make the best valid value for that slot.",
    "",
    "FRAME SHAPE",
    "<1>",
    "raw slot value only",
    "</1>",
    "- The parser only treats a closing tag as a delimiter when it is the whole line.",
    '- Inline text like "hello </1> world" is value text, not a delimiter.',
    "",
    "VALUE RULES",
    "- Emit the raw slot value only. Do not wrap it in quotes unless quotes are part of the value.",
    "- Do not emit JSON objects, JSON arrays, markdown, bullets, or explanations inside a slot frame.",
    "- For repeat: append, each indexed frame writes one primitive array item.",
    "- For repeat: item-field, each indexed frame writes one field on that object array item.",
    "- Respect each slot instruction, especially enum labels, length limits, item counts, and requested language.",
    "- A retry attempt means the previous frame or value for that slot failed parsing, protocol checks, or validation.",
    "- For repeat retries, produce the full corrected sequence for that requested repeat field, not just the failed item.",
    "",
    "SLOTS",
    slotList
  ].join("\n");
}

function formatSlotPromptEntry(slot: SlotFrameRequest): string {
  const repeat = slot.repeat && slot.repeat !== "none";
  return [
    `- id: ${slot.id}`,
    `  path: ${slot.path}`,
    repeat ? `  repeat: ${slot.repeat}` : undefined,
    `  attempt: ${slot.attempt}`,
    repeat ? `  open: <${slot.id}:0>` : `  open: <${slot.id}>`,
    repeat ? `  close: </${slot.id}:0>` : `  close: </${slot.id}>`,
    repeat ? "  next item tags: increment :0 to :1, :2, ..." : undefined,
    slot.prompt ? `  instruction: ${slot.prompt}` : undefined
  ]
    .filter(Boolean)
    .join("\n");
}
