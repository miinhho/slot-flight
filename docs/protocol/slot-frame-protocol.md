# Slot Frame Protocol

The slot frame protocol is the language-neutral contract shared by slot-flight
SDKs.

```text
<1>
Alice
</1>
<2:0>
billing
</2:0>
<2:1>
latency
</2:1>
```

## Rules

- A fixed slot frame starts with `<id>` and ends with `</id>` on its own line.
- A repeatable array slot frame starts with `<id:index>` and ends with
  `</id:index>` on its own line.
- A closing tag is a delimiter only when it is the entire line. Inline text such
  as `hello </1> world` remains part of the frame body.
- `id` is a positive decimal string assigned by the SDK for one frame request.
- `index` is a zero-based array item index assigned by the model in the frame
  tag. Repeat indexes must start at 0, increase without gaps, and be reused
  across fields that belong to the same object array item.
- The server maps frame ids to JSON paths; models must not own JSON paths.
- A frame body is always the raw value for one slot. Models must not emit JSON
  objects or arrays as slot values.
- Fixed slots must be emitted exactly once. Repeatable array slots may emit zero
  or more indexed frames.
- Unregistered ids, duplicate fixed frames, malformed delimiters, and missing
  fixed frames are protocol failures.
- Recoverable protocol failures may be retried at slot scope by the SDK.
- Fixed slot retries target the same concrete path. Repeatable retries target
  the whole repeat field sequence, such as `tags[]` or `sections[].body`,
  because a single failed array item does not have stable standalone identity in
  the frame protocol.

## Language SDK Requirements

Each language SDK should keep these pieces equivalent:

- slot path expansion and append semantics for `items[]` style repeated slots
- streaming frame parser behavior
- default prompt contract
- slot-scoped validation and retry
- provider adapters outside the core engine
