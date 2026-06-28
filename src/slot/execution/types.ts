import type {
  SlotFlightEvent,
  SlotFlightPrompt,
  SlotGenerator
} from "../../types.js";
import type { CompiledSlot } from "../plan.js";

export interface SlotExecutionOptions {
  slots: CompiledSlot[];
  state: unknown;
  generate: SlotGenerator;
  prompt?: SlotFlightPrompt;
  maxRetries: number;
  signal?: AbortSignal;
  cloneState: <T>(value: T) => T;
}

export type SlotExecutionEvent = Exclude<SlotFlightEvent, { type: "done" }>;

export interface PendingFailure {
  slot: CompiledSlot;
  attempt: number;
  error: Error;
  retryable: boolean;
}
