# Context

## Domain Terms

### Slot

A slot is a registered JSON path that the model fills with a single value. Slots can target object properties, nested properties, or repeated array items such as `tags[]`.

### Slot Frame Stream

A slot frame stream is one LLM response containing one or more slot frames. This is the primary generation shape: the model streams values for multiple fields without emitting JSON.

### Slot Id

A slot id is the compact model-facing identifier for a slot within one frame stream request. The server maps slot ids to JSON paths. The model must copy ids exactly but does not own the JSON paths.

### Slot Protocol

The slot protocol is the streaming envelope around a slot value:

```text
<slot id>
<value>
</slot id>
```

The protocol identifies which slot id is being streamed and where the value ends. The server maps slot ids to JSON paths, discards the envelope, and treats only `<value>` as model output.

### Slot Execution

Slot execution is one concrete slot path moving through frame parsing, partial state updates, validation, and retry. Failed slots can be requested again in a follow-up slot frame stream without regenerating slots that already passed validation.

### Partial State

Partial state is the server-owned JSON document while slots are still streaming. It can contain raw string deltas before a slot is validated and replaced with its final Zod-parsed value.

### Slot Frame Request

A slot frame request is one engine-built prompt asking the model to emit frames for all slots that are currently pending. A follow-up request asks only for slots that failed parsing, protocol handling, JSON parsing, or Zod validation; slots that already passed validation are not regenerated.

### Slot Generator

A slot generator is the SDK boundary. It receives the engine-built prompt, requested slots, attempt number, and abort signal, then returns streamed text chunks. The core engine is SDK-independent because it only depends on this boundary.

### Adapter

An adapter turns an external AI SDK stream into a slot generator. OpenAI-compatible chat completions are supported by extracting `choices[].delta.content`; arbitrary SDK chunk streams can be connected by mapping each chunk to text.

### SDK-First Helper

An SDK-first helper keeps the caller's AI SDK request shape as the primary interface. OpenAI and Vercel callers pass the normal SDK call parameters plus `output: slotObject(...)`; the helper preserves the request body, appends the slot protocol prompt, and delegates parsing/assembly to the core engine.

### Client Enhancer

A client enhancer adds slot-flight behavior beside an existing LLM SDK instead of replacing the SDK as the center of the workflow. `withSlotFlight(openai)` attaches `chat.completions.streamSlotObject()`, which accepts a normal OpenAI chat body plus `output: slotObject(...)`. It is optional DX; SDK adapters should prefer function-style helpers as the primary interface.

### Function-Style Adapter Helper

A function-style adapter helper keeps the provider SDK primitive visible while adding slot object streaming. OpenAI and Vercel adapters both expose `streamSlotObject(...)` from their adapter subpath and accept the SDK call parameters plus `output: slotObject(...)`.

### Slot Object Output

A slot object output describes the server-owned JSON object to assemble. It contains the Zod object schema, field instructions from `.describe()`, retry settings, and inferred per-slot schemas. It is intentionally shaped like an output option, not like a second LLM client.

### Completed Slot Stream

A completed slot stream is the practical default output for consumers. It emits only validated slot values and their current partial state, avoiding character-level noise while preserving progressive JSON assembly.

### Web Stream Output

Web stream output adapts a slot object stream to HTTP-friendly formats. `toResponse()` defaults to Server-Sent Events over completed slots; NDJSON and low-level event streams are available for non-SSE consumers and debugging.

### JSON Slot

A JSON slot is a slot whose frame body is parsed as JSON before Zod validation. Use it for coordinated structured values, especially arrays where independent item slots can create duplicate or inconsistent siblings.

### Prompt Contract

The prompt contract is the default structured instruction sent to the model for one slot frame stream. It states the output contract, frame shape, value rules, and slot list. It must be explicit enough for real LLM calls while keeping generated output compact.

### Slot Module

The slot module is the implementation locality for slot paths, frame request construction, prompt contracts, frame parsing, slot planning, slot execution, slot object definitions, and slot object stream presentation. SDK adapters depend on this module, but slot internals do not depend on any SDK adapter.

### Public Surface

The public surface is intentionally split by depth. The root export is the happy path for `slotObject` and stream result types. Adapter subpaths expose provider-specific helpers. `core` exposes the low-level engine for advanced use. Slot parser, path, protocol, and execution modules are internal implementation boundaries.

### Vercel AI SDK Adapter

The Vercel AI SDK adapter keeps `streamText` as the generation primitive. Callers pass `streamText` plus normal AI SDK stream text parameters and `output: slotObject(...)`; the adapter appends the slot protocol prompt and consumes `textStream`.
