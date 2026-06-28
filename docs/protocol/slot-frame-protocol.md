# Slot Frame Protocol

The slot frame protocol is the language-neutral contract shared by slot-flight
SDKs.

```text
<1>Alice</1>
<2>Senior Engineer</2>
```

## Rules

- A frame starts with `<id>` and ends with `</id>`.
- `id` is a positive decimal string assigned by the SDK for one frame request.
- The server maps frame ids to JSON paths; models must not own JSON paths.
- A frame body is either raw text or one JSON value, depending on the slot mode.
- Each requested slot must be emitted exactly once.
- Unregistered ids, duplicate frames, malformed delimiters, and missing frames
  are protocol failures.
- Recoverable protocol failures may be retried at slot scope by the SDK.

## Language SDK Requirements

Each language SDK should keep these pieces equivalent:

- slot path expansion for `items[]` style repeated slots
- streaming frame parser behavior
- default prompt contract
- slot-scoped JSON parsing, validation, and retry
- provider adapters outside the core engine
