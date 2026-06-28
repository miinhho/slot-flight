import { SlotFlightConfigurationError } from "../errors.js";
import type { SlotDefinition } from "../types.js";
import { expandSlotPath } from "./path.js";

export interface CompiledSlot {
  definition: SlotDefinition;
  path: string;
}

export function compileSlotPlan(definitions: SlotDefinition[]): CompiledSlot[] {
  const slots: CompiledSlot[] = [];
  const seen = new Set<string>();

  for (const definition of definitions) {
    for (const path of expandSlotPath(definition.path, definition.count)) {
      if (seen.has(path)) {
        throw new SlotFlightConfigurationError(
          `Duplicate slot path "${path}".`
        );
      }
      seen.add(path);
      slots.push({ definition, path });
    }
  }

  return slots;
}
