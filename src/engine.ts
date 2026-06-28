import type { z } from "zod";
import {
  type CompiledSlot,
  compileSlotPlan,
  runSlotFrameStream
} from "./slot/index.js";
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
  SlotFlightJsonParseError,
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
      cloneState: cloneJson
    })) {
      yield event;
    }

    const parsed = this.schema.parse(state);
    yield {
      type: "done",
      state: cloneJson(parsed)
    };

    return { state: parsed };
  }
}

export function slotFlight<TSchema extends z.ZodTypeAny>(
  options: SlotFlightOptions<TSchema>
): SlotFlight<TSchema> {
  return new SlotFlight(options);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
