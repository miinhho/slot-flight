from __future__ import annotations

import inspect
from collections.abc import AsyncIterable, AsyncIterator, Iterable
from typing import Any, TypeVar, cast

T = TypeVar("T")


async def iterate_stream(stream: Any, *, error_message: str) -> AsyncIterator[T]:
    try:
        if hasattr(stream, "__aiter__"):
            async for item in cast(AsyncIterable[T], stream):
                yield item
            return

        if isinstance(stream, Iterable):
            for item in cast(Iterable[T], stream):
                yield item
            return

        raise TypeError(error_message)
    finally:
        await close_stream(stream)


async def close_stream(stream: Any) -> None:
    close = getattr(stream, "aclose", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result
        return

    close = getattr(stream, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result
