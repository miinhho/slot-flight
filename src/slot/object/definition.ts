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
  const unwrapped = unwrapSchema(schema);
  const prompt = schema.description;

  if (prompt !== undefined) {
    return [
      {
        path,
        prompt,
        schema,
        mode: isJsonValueSchema(unwrapped) ? "json" : "text"
      }
    ];
  }

  if (unwrapped instanceof z.ZodObject) {
    return Object.entries(unwrapped.shape).flatMap(([key, child]) =>
      inferSlotAtPath(child as z.ZodTypeAny, `${path}.${key}`)
    );
  }

  throw new SlotFlightConfigurationError(
    `Schema field "${path}" must use .describe() to become a slot.`
  );
}

function isJsonValueSchema(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodArray || schema instanceof z.ZodObject;
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
