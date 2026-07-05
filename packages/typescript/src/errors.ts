import type { z } from "zod";

export class SlotFlightError extends Error {}

export class SlotFlightConfigurationError extends SlotFlightError {
  constructor(message: string) {
    super(message);
    this.name = "SlotFlightConfigurationError";
  }
}

export class SlotFlightValidationError extends SlotFlightError {
  constructor(
    readonly path: string,
    readonly issues: z.ZodIssue[]
  ) {
    super(`Slot "${path}" failed validation.`);
    this.name = "SlotFlightValidationError";
  }
}

export class SlotFlightSlotProtocolError extends SlotFlightError {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "SlotFlightSlotProtocolError";
  }
}

export class SlotFlightStreamError extends SlotFlightError {
  constructor(message: string) {
    super(message);
    this.name = "SlotFlightStreamError";
  }
}
