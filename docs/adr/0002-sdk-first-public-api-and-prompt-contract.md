# ADR 0002: SDK-First Public API and Default Prompt Contract

## Status

Accepted

## Context

The library is a JSON streaming helper, not an LLM SDK. Early examples centered the low-level `slotFlight()` engine, which made the library look like the main orchestration layer in an agent stack. The intended DX is the opposite: callers should keep using their existing LLM SDK and add slot-wise object streaming at the output boundary.

The default prompt also needed to be more explicit. A compact frame protocol reduces token overhead, but small and medium models still need a strong output contract: one frame per requested slot, exact tags, no markdown, no JSON document, clear text-vs-JSON value rules, and retry-aware wording.

## Decision

Keep the root package focused on happy-path object helpers:

- `slot-flight`: `slotObject` and stream types.
- `slot-flight/adapters/openai`: OpenAI-compatible `streamSlotObject`.
- `slot-flight/adapters/vercel`: Vercel AI SDK `streamSlotObject`.
- `slot-flight/adapters/stream`: generic async chunk adapter.
- `slot-flight/core`: advanced low-level engine usage.

Do not expose `slot-flight/slot` as a package export. Slot parser, path, protocol, and execution modules remain internal implementation boundaries.

The default prompt uses a structured contract with these sections:

- output contract
- frame shape
- value rules
- slot list

Each slot lists id, path, mode, attempt, open tag, close tag, and slot instruction. The prompt keeps the compact frame protocol but makes the model's obligations explicit.

## Consequences

- README and examples start from existing SDK calls instead of the low-level engine.
- Agent developers can adopt the helper without making `slot-flight` the center of their LLM stack.
- The prompt is longer than the earliest PoC prompt, but still avoids per-path sentinels and repeated verbose frame headers in the generated output.
- Advanced users can still build directly on `slot-flight/core`.
- Internal slot modules can change without committing to a public package subpath.
