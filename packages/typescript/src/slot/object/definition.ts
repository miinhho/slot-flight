import { z } from "zod";
import { SlotFlightConfigurationError } from "../../errors.js";
import type { SlotDefinition } from "../../types.js";

export interface SlotObjectOptions<TSchema extends z.ZodTypeAny> {
  schema: TSchema;
  prompt?: string;
  maxRetries?: number;
}

export interface SlotObjectOutput<TSchema extends z.ZodTypeAny>
  extends SlotObjectOptions<TSchema> {
  slots: SlotDefinition[];
}

export function slotObject<TSchema extends z.ZodTypeAny>(
  options: SlotObjectOptions<TSchema>
): SlotObjectOutput<TSchema> {
  return {
    ...options,
    slots: inferSlots(options.schema)
  };
}

function inferSlots(schema: z.ZodTypeAny): SlotDefinition[] {
  const root = unwrapSchema(schema);
  if (!(root instanceof z.ZodObject)) {
    throw new SlotFlightConfigurationError(
      "slotObject() requires a Zod object schema."
    );
  }

  const slots = Object.entries(root.shape).flatMap(([key, child]) =>
    inferSlotAtPath(child as z.ZodTypeAny, key)
  );

  if (slots.length === 0) {
    throw new SlotFlightConfigurationError(
      "slotObject() requires at least one schema field with .describe()."
    );
  }

  return slots;
}

function inferSlotAtPath(schema: z.ZodTypeAny, path: string): SlotDefinition[] {
  return inferSlotAtPathWithPrompts(schema, path, []);
}

function inferSlotAtPathWithPrompts(
  schema: z.ZodTypeAny,
  path: string,
  inheritedPrompts: string[]
): SlotDefinition[] {
  const unwrapped = unwrapSchema(schema);
  const prompt = schema.description;
  const prompts =
    prompt === undefined ? inheritedPrompts : [...inheritedPrompts, prompt];

  if (unwrapped instanceof z.ZodObject) {
    return Object.entries(unwrapped.shape).flatMap(([key, child]) =>
      inferSlotAtPathWithPrompts(
        child as z.ZodTypeAny,
        `${path}.${key}`,
        prompts
      )
    );
  }

  if (unwrapped instanceof z.ZodArray) {
    return inferArraySlots(unwrapped, path, prompts);
  }

  const slotPrompt = prompts.join("\n");
  if (slotPrompt !== "") {
    return [
      {
        path,
        prompt: slotPrompt,
        schema
      }
    ];
  }

  throw new SlotFlightConfigurationError(
    `Schema field "${path}" must use .describe() to become a slot.`
  );
}

function inferArraySlots(
  schema: z.ZodArray<z.ZodTypeAny>,
  path: string,
  prompts: string[]
): SlotDefinition[] {
  const itemSchema = unwrapSchema(schema.element);
  if (itemSchema instanceof z.ZodObject) {
    return Object.entries(itemSchema.shape).flatMap(([key, child]) =>
      inferSlotAtPathWithPrompts(
        child as z.ZodTypeAny,
        `${path}[].${key}`,
        prompts
      )
    );
  }

  if (itemSchema instanceof z.ZodArray) {
    throw new SlotFlightConfigurationError(
      `Array field "${path}" cannot infer structural slots for nested array items.`
    );
  }

  const slotPrompt = prompts.join("\n");
  if (slotPrompt === "") {
    throw new SlotFlightConfigurationError(
      `Schema field "${path}" must use .describe() to become a slot.`
    );
  }

  return [
    {
      path: `${path}[]`,
      prompt: slotPrompt,
      schema: schema.element
    }
  ];
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;

  // Slot inference should follow the value shape through common wrappers such
  // as optional/default, because those wrappers do not change the JSON path.
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodCatch
  ) {
    current = current._def.innerType;
  }

  return current;
}
