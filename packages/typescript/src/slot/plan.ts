import { SlotFlightConfigurationError } from "../errors.js";
import type { SlotDefinition } from "../types.js";
import {
  arrayWildcardPath,
  countArrayWildcards,
  expandSlotPath,
  isAppendTemplatePath
} from "./path.js";

export interface CompiledSlot {
  definition: SlotDefinition;
  path: string;
  repeat: "none" | "append" | "item-field";
  arrayPath?: string;
}

export function compileSlotPlan(definitions: SlotDefinition[]): CompiledSlot[] {
  const slots: CompiledSlot[] = [];
  const seen = new Set<string>();

  for (const definition of definitions) {
    const wildcardCount = countArrayWildcards(definition.path);
    if (wildcardCount > 1) {
      throw new SlotFlightConfigurationError(
        `Slot path "${definition.path}" has multiple [] wildcards. Define one repeated dimension per slot.`
      );
    }

    if (wildcardCount === 1 && definition.count === undefined) {
      if (seen.has(definition.path)) {
        throw new SlotFlightConfigurationError(
          `Duplicate slot path "${definition.path}".`
        );
      }
      seen.add(definition.path);

      const arrayPath = arrayWildcardPath(definition.path);
      const repeat = isAppendTemplatePath(definition.path)
        ? "append"
        : "item-field";

      slots.push({
        definition,
        path: definition.path,
        repeat,
        arrayPath
      });
      continue;
    }

    for (const path of expandSlotPath(definition.path, definition.count)) {
      if (seen.has(path)) {
        throw new SlotFlightConfigurationError(
          `Duplicate slot path "${path}".`
        );
      }
      seen.add(path);
      slots.push({ definition, path, repeat: "none" });
    }
  }

  return slots;
}
