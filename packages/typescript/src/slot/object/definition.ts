import { SlotFlightConfigurationError } from "../../errors.js";
import {
  arrayElement,
  objectShape,
  schemaKind,
  unwrapSchema,
  type ZodSchema
} from "../../schema.js";
import type { SlotDefinition } from "../../types.js";

export interface SlotObjectOptions<TSchema extends ZodSchema> {
  schema: TSchema;
  prompt?: string;
  maxRetries?: number;
}

export interface SlotObjectOutput<TSchema extends ZodSchema>
  extends SlotObjectOptions<TSchema> {
  slots: SlotDefinition[];
}

export function slotObject<TSchema extends ZodSchema>(
  options: SlotObjectOptions<TSchema>
): SlotObjectOutput<TSchema> {
  return {
    ...options,
    slots: inferSlots(options.schema)
  };
}

function inferSlots(schema: ZodSchema): SlotDefinition[] {
  const root = unwrapSchema(schema);
  if (schemaKind(root) !== "object") {
    throw new SlotFlightConfigurationError(
      "slotObject() requires a Zod object schema."
    );
  }

  const slots = Object.entries(objectShape(root)).flatMap(([key, child]) =>
    inferSlotAtPath(child, key)
  );

  if (slots.length === 0) {
    throw new SlotFlightConfigurationError(
      "slotObject() requires at least one schema field with .describe()."
    );
  }

  return slots;
}

function inferSlotAtPath(schema: ZodSchema, path: string): SlotDefinition[] {
  return inferSlotAtPathWithPrompts(schema, path, []);
}

function inferSlotAtPathWithPrompts(
  schema: ZodSchema,
  path: string,
  inheritedPrompts: string[]
): SlotDefinition[] {
  const unwrapped = unwrapSchema(schema);
  const prompt = schema.description;
  const prompts =
    prompt === undefined ? inheritedPrompts : [...inheritedPrompts, prompt];

  if (schemaKind(unwrapped) === "object") {
    return Object.entries(objectShape(unwrapped)).flatMap(([key, child]) =>
      inferSlotAtPathWithPrompts(child, `${path}.${key}`, prompts)
    );
  }

  if (schemaKind(unwrapped) === "array") {
    return inferArraySlots(unwrapped, path, prompts);
  }

  if (schemaKind(unwrapped) === "record" || schemaKind(unwrapped) === "map") {
    throw new SlotFlightConfigurationError(
      `Schema field "${path}" cannot infer structural slots for dynamic object or map values.`
    );
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
  schema: ZodSchema,
  path: string,
  prompts: string[]
): SlotDefinition[] {
  const itemSchema = unwrapSchema(arrayElement(schema));
  if (schemaKind(itemSchema) === "object") {
    return Object.entries(objectShape(itemSchema)).flatMap(([key, child]) =>
      inferSlotAtPathWithPrompts(child, `${path}[].${key}`, prompts)
    );
  }

  if (schemaKind(itemSchema) === "array") {
    throw new SlotFlightConfigurationError(
      `Array field "${path}" cannot infer structural slots for nested array items.`
    );
  }

  if (schemaKind(itemSchema) === "record" || schemaKind(itemSchema) === "map") {
    throw new SlotFlightConfigurationError(
      `Array field "${path}" cannot infer structural slots for dynamic object or map items.`
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
      schema: arrayElement(schema)
    }
  ];
}
