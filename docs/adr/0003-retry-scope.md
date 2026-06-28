# ADR 0003: Retry Scope

## Status

Accepted

## Context

`slot-flight` is a slot-wise JSON streaming helper. The core question is whether reliability behaviours such as retry belong in the library, or whether they make the library too much of an orchestration layer.

Slot failures are not generic LLM failures. They are known only after the engine parses frame ids, maps them to JSON paths, parses JSON slot bodies, validates with Zod, detects missing frames, and classifies slot protocol failures. A caller outside the engine cannot easily retry only the failed slot without duplicating slot id mapping, frame request construction, attempt tracking, and partial state handling.

## Decision

Keep per-slot retry in the engine. Retry is part of slot execution because the engine owns the information needed to retry the smallest failed unit.

Retry recoverable slot protocol failures, such as an unfinished frame, as slot failures. Do not retry provider failures, caller cancellation, unknown slot ids, or duplicate slot ids as provider policy.

Do not split slots into multiple model calls inside the engine. Comparisons with local models showed that splitting slots often increased latency and provider/socket failure exposure, while one compact frame request was the best default.

Do not add broader orchestration features such as exponential backoff, global rate limiting, provider failover, queues, or multi-model routing. Those belong to the caller's LLM SDK or application workflow.

## Consequences

- The library remains a JSON streaming helper, not an agent runtime.
- Retry keeps high leverage: callers get per-slot repair for invalid values and recoverable frame failures without learning the internal frame id protocol.
- Tests should treat retry as slot execution behaviour, not provider adapter behaviour.
