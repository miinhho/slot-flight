class SlotFlightError(Exception):
    """Base class for slot-flight engine failures."""


class SlotFlightConfigurationError(SlotFlightError):
    """Raised when slot definitions or paths are invalid."""


class SlotFlightJsonParseError(SlotFlightError):
    """Raised when a JSON-mode slot body is not valid JSON."""


class SlotFlightSlotProtocolError(SlotFlightError):
    def __init__(self, message: str, retryable: bool):
        super().__init__(message)
        self.retryable = retryable


class SlotFlightStreamError(SlotFlightError):
    """Raised when the provider stream fails."""


class SlotFlightValidationError(SlotFlightError):
    """Raised when a slot value fails user validation."""
