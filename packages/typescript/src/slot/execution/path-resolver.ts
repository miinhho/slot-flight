import { SlotFlightSlotProtocolError } from "../../errors.js";
import { concretePathForArrayItem } from "../path.js";
import type { CompiledSlot } from "../plan.js";

export class SlotPathResolver {
  private readonly activePaths = new Map<string, string>();

  start(slot: CompiledSlot, index: number | undefined): string {
    const concretePath = this.resolveStart(slot, index);
    this.activePaths.set(frameKey(slot.path, index), concretePath);
    return concretePath;
  }

  current(slot: CompiledSlot, index: number | undefined): string {
    const key = frameKey(slot.path, index);
    const concretePath = this.activePaths.get(key);
    if (concretePath === undefined) {
      throw new SlotFlightSlotProtocolError(
        `Received value for slot "${key}" before its frame started.`,
        false
      );
    }
    return concretePath;
  }

  complete(slot: CompiledSlot, index: number | undefined): void {
    this.activePaths.delete(frameKey(slot.path, index));
  }

  private resolveStart(slot: CompiledSlot, index: number | undefined): string {
    if (slot.repeat === "none") {
      if (index !== undefined) {
        throw new SlotFlightSlotProtocolError(
          `Received indexed frame for fixed slot "${slot.path}".`,
          true
        );
      }
      return slot.path;
    }

    if (index === undefined) {
      throw new SlotFlightSlotProtocolError(
        `Repeatable slot "${slot.path}" must use an indexed frame tag.`,
        true
      );
    }

    if (slot.arrayPath === undefined) {
      throw new SlotFlightSlotProtocolError(
        `Repeatable slot "${slot.path}" is missing its array path.`,
        false
      );
    }

    return concretePathForArrayItem(slot.path, index);
  }
}

function frameKey(path: string, index: number | undefined): string {
  return index === undefined ? path : `${path}:${String(index)}`;
}
