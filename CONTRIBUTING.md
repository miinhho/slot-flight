# Contributing

This repository is a multi-language SDK workspace. Keep language-specific
tooling inside each package and keep shared behavior aligned through the slot
frame protocol docs.

## Repository Layout

- `docs/protocol`: language-neutral slot frame protocol
- `packages/typescript`: TypeScript SDK, examples, tests, and npm metadata
- `packages/python`: Python SDK, examples, tests, and PyPI metadata

## Development

Run package commands from the package directory that owns the change.

TypeScript:

```sh
cd packages/typescript
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
bun run build
```

Python:

```sh
cd packages/python
uv sync --locked --all-extras --dev
uv run ruff check .
uv run ty check
uv run pytest
uv build
uv run twine check dist/*
```

The Python examples can be smoke-tested locally:

```sh
cd packages/python
uv run --extra langchain examples/langchain_runnable.py
```

The OpenAI-compatible example can run against NVIDIA NIM or another
OpenAI-compatible endpoint. Use the root `.env.example` keys with either the
OpenAI SDK adapter or the raw HTTP adapter:

```sh
API_KEY=...
API_BASE_URL=https://integrate.api.nvidia.com/v1
MODEL=openai/gpt-oss-20b
```

Then run:

```sh
cd packages/python
uv run --extra openai examples/openai_compatible.py
uv run --extra openai-compatible examples/openai_compatible_httpx.py
```

## CI

CI is split by changed paths.

TypeScript CI runs for:

- `packages/typescript/**`
- `docs/protocol/**`
- TypeScript workflow changes

Python CI runs for:

- `packages/python/**`
- `docs/protocol/**`
- Python workflow changes

Protocol changes intentionally trigger both language CI jobs.

## Releases

Releases are language-scoped.

TypeScript:

1. Update `packages/typescript/package.json` version.
2. Run the TypeScript verification commands.
3. Commit the version change.
4. Push a `typescript-v...` tag.
5. The TypeScript release workflow publishes `packages/typescript` to npm.

Python:

1. Update `packages/python/pyproject.toml` version.
2. Run the Python verification commands.
3. Commit the version change.
4. Push a `python-v...` tag.
5. The Python release workflow builds and publishes `packages/python` to PyPI.

The release workflows are intentionally scoped to language tags:

- `typescript-v*`
- `python-v*`

Do not publish from root tooling. The root of the repository is for shared
documentation and repository-level configuration only.
