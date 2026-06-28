# ADR 0001: Compact Slot Frame Protocol

## Status

Accepted

## Context

The library exists because prompt-only JSON generation is not reliably streamable. The model can produce invalid JSON, empty fields, missing fields, or unparseable partial state. The server should own the JSON shape and assemble values as they arrive.

Early slot frames used full JSON paths and per-slot sentinels:

```text
SLOT:description
BEGIN:<sentinel>
value
<sentinel>
```

This was clear but verbose. In local `llama3:8b` comparisons, long headers increased completion time and frame omissions appeared as field count increased.

## Decision

Use compact slot ids and id-based closing tags:

```text
<1>value</1>
<2>value</2>
```

For concise text values, prefer one-line frames so the closing tag follows the
value immediately:

```text
<1>value</1>
```

The server maps slot ids to JSON paths for each frame stream request. The model never owns the JSON path. Unknown ids, duplicate ids, missing frames, invalid values, and cancellation are handled by the engine.

The parser still accepts both inline and line-oriented frames:

```text
<1>value</1>
```

```text
<1>
value
</1>
```

## Consequences

- Frame overhead is much lower than full path plus sentinel frames.
- Smaller models copy XML-like tags more reliably than very terse `@1 ... @@` delimiters.
- Slot ids are only stable inside one request. Callers should reason in JSON paths, not ids.
- Failed or missing slots can be retried without regenerating successful slots.
- Recoverable protocol failures, such as an unfinished frame, can be retried without retrying completed slots.
