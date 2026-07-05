import type { z } from "zod";
import { SlotFlightValidationError } from "./errors.js";
import type { PendingFailure } from "./slot/execution/types.js";
import {
  type CompiledSlot,
  compileSlotPlan,
  runSlotFrameStream
} from "./slot/index.js";
import { hasPathValue, setPathValue } from "./slot/path.js";
import type {
  SlotFlightEvent,
  SlotFlightOptions,
  SlotFlightResult,
  SlotFlightRunOptions,
  SlotGenerator
} from "./types.js";

export {
  SlotFlightConfigurationError,
  SlotFlightError,
  SlotFlightSlotProtocolError,
  SlotFlightStreamError,
  SlotFlightValidationError
} from "./errors.js";

export class SlotFlight<TSchema extends z.ZodTypeAny> {
  private readonly schema: TSchema;
  private readonly slots: CompiledSlot[];
  private readonly generateSlot: SlotGenerator;
  private readonly prompt: SlotFlightOptions<TSchema>["prompt"];
  private readonly maxRetries: number;

  constructor(options: SlotFlightOptions<TSchema>) {
    this.schema = options.schema;
    this.generateSlot = options.generate;
    this.prompt = options.prompt;
    this.maxRetries = options.maxRetries ?? 1;
    this.slots = compileSlotPlan(options.slots);
  }

  async *run(
    options: SlotFlightRunOptions = {}
  ): AsyncGenerator<SlotFlightEvent, SlotFlightResult<z.infer<TSchema>>> {
    const state = {};

    for await (const event of runSlotFrameStream({
      slots: this.slots,
      state,
      generate: this.generateSlot,
      prompt: this.prompt,
      maxRetries: this.maxRetries,
      signal: options.signal,
      cloneState: cloneJson,
      validateRepeatState: ({ state: currentState, slots, attempts }) =>
        this.repeatValidationFailures(currentState, slots, attempts)
    })) {
      yield event;
    }

    ensureRepeatableArrays(state, this.slots);
    const parsed = this.schema.parse(state);
    yield {
      type: "done",
      state: cloneJson(parsed)
    };

    return { state: parsed };
  }

  private repeatValidationFailures(
    state: unknown,
    slots: CompiledSlot[],
    attempts: ReadonlyMap<string, number>
  ): Map<string, PendingFailure> {
    const result = this.schema.safeParse(state);
    if (result.success) {
      return new Map();
    }

    const issuesBySlot = new Map<CompiledSlot, z.ZodIssue[]>();
    const repeatSlots = slots.filter((slot) => slot.repeat !== "none");
    for (const issue of result.error.issues) {
      for (const slot of repeatSlots) {
        if (issueTargetsRepeatSlot(issue.path, slot)) {
          const issues = issuesBySlot.get(slot) ?? [];
          issues.push(issue);
          issuesBySlot.set(slot, issues);
        }
      }
    }

    const failures = new Map<string, PendingFailure>();
    for (const [slot, issues] of issuesBySlot) {
      failures.set(slot.path, {
        slot,
        attempt: attempts.get(slot.path) ?? 1,
        error: new SlotFlightValidationError(slot.path, issues),
        retryable: true
      });
    }
    return failures;
  }
}

export function slotFlight<TSchema extends z.ZodTypeAny>(
  options: SlotFlightOptions<TSchema>
): SlotFlight<TSchema> {
  return new SlotFlight(options);
}

function issueTargetsRepeatSlot(
  issuePath: (string | number)[],
  slot: CompiledSlot
): boolean {
  if (slot.arrayPath === undefined) {
    return false;
  }

  const templatePath = issuePath
    .map((segment) => (typeof segment === "number" ? "[]" : String(segment)))
    .join(".")
    .replaceAll(".[]", "[]");

  return (
    templatePath === slot.path ||
    templatePath === slot.arrayPath ||
    templatePath === `${slot.arrayPath}[]`
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ensureRepeatableArrays(
  state: unknown,
  slots: readonly CompiledSlot[]
) {
  const arrayPaths = new Set(
    slots
      .filter((slot) => slot.repeat !== "none" && slot.arrayPath !== undefined)
      .map((slot) => slot.arrayPath as string)
  );

  for (const path of arrayPaths) {
    if (!hasPathValue(state, path)) {
      setPathValue(state, path, []);
    }
  }
}
