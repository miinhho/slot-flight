import { SlotFlightConfigurationError } from "../errors.js";

type TemplateToken =
  | { type: "property"; key: string }
  | { type: "array-wildcard" };

type ConcreteToken =
  | { type: "property"; key: string }
  | { type: "index"; index: number };

export function parseSlotTemplate(path: string): TemplateToken[] {
  if (path.trim() === "") {
    throw new SlotFlightConfigurationError("Slot path cannot be empty.");
  }

  return path.split(".").flatMap((segment) => {
    if (segment === "") {
      throw new SlotFlightConfigurationError(`Invalid slot path "${path}".`);
    }

    if (segment.endsWith("[]")) {
      const key = segment.slice(0, -2);
      if (!key) {
        throw new SlotFlightConfigurationError(
          `Invalid array segment "${segment}" in "${path}".`
        );
      }
      return [
        { type: "property", key },
        { type: "array-wildcard" }
      ] satisfies TemplateToken[];
    }

    if (segment.includes("[") || segment.includes("]")) {
      throw new SlotFlightConfigurationError(
        `Template path "${path}" must use [] wildcards, not concrete indexes.`
      );
    }

    return [{ type: "property", key: segment }] satisfies TemplateToken[];
  });
}

export function expandSlotPath(path: string, count?: number): string[] {
  const tokens = parseSlotTemplate(path);
  const wildcardCount = tokens.filter(
    (token) => token.type === "array-wildcard"
  ).length;

  if (wildcardCount === 0) {
    return [path];
  }

  if (wildcardCount > 1) {
    throw new SlotFlightConfigurationError(
      `Slot path "${path}" has multiple [] wildcards. Define one repeated dimension per slot.`
    );
  }

  if (!Number.isInteger(count) || count === undefined || count < 0) {
    throw new SlotFlightConfigurationError(
      `Slot path "${path}" requires a non-negative count.`
    );
  }

  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    paths.push(
      tokens
        .map((token) =>
          token.type === "property" ? token.key : `[${String(index)}]`
        )
        .join(".")
        .replaceAll(".[", "[")
    );
  }

  return paths;
}

export function parseConcretePath(path: string): ConcreteToken[] {
  if (path.trim() === "") {
    throw new SlotFlightConfigurationError("Concrete path cannot be empty.");
  }

  const tokens: ConcreteToken[] = [];
  for (const segment of path.split(".")) {
    if (segment === "") {
      throw new SlotFlightConfigurationError(
        `Invalid concrete path "${path}".`
      );
    }

    const match = /^(?<key>[^[\]]+)(?<indexes>(\[\d+\])*)$/.exec(segment);
    if (!match?.groups) {
      throw new SlotFlightConfigurationError(
        `Invalid concrete path segment "${segment}".`
      );
    }

    tokens.push({ type: "property", key: match.groups.key });

    const indexes = match.groups.indexes.match(/\[(\d+)\]/g) ?? [];
    for (const rawIndex of indexes) {
      tokens.push({
        type: "index",
        index: Number(rawIndex.slice(1, -1))
      });
    }
  }

  return tokens;
}

export function concretePathToJsonPointer(path: string): string {
  return parseConcretePath(path)
    .map((token) =>
      token.type === "property" ? escapePointer(token.key) : String(token.index)
    )
    .reduce((pointer, segment) => `${pointer}/${segment}`, "");
}

export function setPathValue(
  target: unknown,
  path: string,
  value: unknown
): "add" | "replace" {
  if (!isRecord(target)) {
    throw new SlotFlightConfigurationError(
      "JSON state root must be an object."
    );
  }

  const tokens = parseConcretePath(path);
  let current: unknown = target;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isLast = index === tokens.length - 1;

    if (token.type === "property") {
      if (!isRecord(current)) {
        throw new SlotFlightConfigurationError(
          `Cannot set property "${token.key}" in "${path}".`
        );
      }

      if (isLast) {
        const operation = Object.hasOwn(current, token.key) ? "replace" : "add";
        current[token.key] = value;
        return operation;
      }

      if (!Object.hasOwn(current, token.key) || current[token.key] == null) {
        // The server owns JSON assembly, so missing containers are created from
        // the next token instead of relying on model-emitted structure.
        current[token.key] = tokens[index + 1]?.type === "index" ? [] : {};
      }

      current = current[token.key];
      continue;
    }

    if (!Array.isArray(current)) {
      throw new SlotFlightConfigurationError(
        `Cannot set array index ${token.index} in "${path}".`
      );
    }

    if (isLast) {
      const operation = token.index in current ? "replace" : "add";
      current[token.index] = value;
      return operation;
    }

    if (current[token.index] == null) {
      // Preserve sparse array semantics while still creating nested containers
      // when a later slot targets a deeper path.
      current[token.index] = tokens[index + 1]?.type === "index" ? [] : {};
    }

    current = current[token.index];
  }

  throw new SlotFlightConfigurationError(
    `Cannot set value for path "${path}".`
  );
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
