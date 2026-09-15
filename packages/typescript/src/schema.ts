import type * as z3 from "zod/v3";
import type * as z4 from "zod/v4";

export type ZodSchema<T = unknown> = z3.ZodType<T> | z4.ZodType<T>;
export type ZodIssue = z3.ZodIssue | z4.core.$ZodIssue;
export type SchemaOutput<T extends ZodSchema> = T extends z3.ZodTypeAny
  ? z3.output<T>
  : T extends z4.ZodType
    ? z4.output<T>
    : never;

export function parseSchema<T extends ZodSchema>(
  schema: T,
  value: unknown
): SchemaOutput<T> {
  return schema.parse(value) as SchemaOutput<T>;
}

// Use version-specific definitions instead of constructor identity: callers
// can supply schemas from either major or another copy of the same major.
export function schemaKind(schema: ZodSchema): string {
  return "_zod" in schema
    ? schema._zod.def.type
    : (schema._def as z3.ZodTypeDef & { typeName: string }).typeName
        .replace(/^Zod/, "")
        .toLowerCase();
}

export function objectShape(schema: ZodSchema): Record<string, ZodSchema> {
  return (schema as z3.ZodObject<z3.ZodRawShape> | z4.ZodObject).shape;
}

export function arrayElement(schema: ZodSchema): ZodSchema {
  return (schema as z3.ZodArray<z3.ZodTypeAny> | z4.ZodArray<z4.ZodType>)
    .element;
}

export function unwrapSchema(schema: ZodSchema): ZodSchema {
  let current = schema;
  // These wrappers preserve the JSON path. Keep the original schema on leaf
  // slots so validation still applies its optional/default/catch behavior.
  while (
    [
      "optional",
      "nullable",
      "default",
      "catch",
      "readonly",
      "prefault",
      "nonoptional"
    ].includes(schemaKind(current))
  ) {
    current =
      "_zod" in current
        ? (
            current as
              | z4.ZodOptional<z4.ZodType>
              | z4.ZodNullable<z4.ZodType>
              | z4.ZodDefault<z4.ZodType>
              | z4.ZodCatch<z4.ZodType>
              | z4.ZodReadonly<z4.ZodType>
              | z4.ZodPrefault<z4.ZodType>
              | z4.ZodNonOptional<z4.ZodType>
          )._zod.def.innerType
        : (
            current as
              | z3.ZodOptional<z3.ZodTypeAny>
              | z3.ZodNullable<z3.ZodTypeAny>
              | z3.ZodDefault<z3.ZodTypeAny>
              | z3.ZodCatch<z3.ZodTypeAny>
              | z3.ZodReadonly<z3.ZodTypeAny>
          )._def.innerType;
  }
  return current;
}
