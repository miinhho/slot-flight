from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from pydantic import BaseModel, Field


class Summary(BaseModel):
    title: str = Field(description="Write a short title.")
    tags: list[str] = Field(description="Write two tags, one tag per frame.")


class FakeOpenAIClient:
    def __init__(self, chunks):
        self.chat = FakeChat(self, chunks)
        self.created: dict[str, Any] | None = None


class FakeChat:
    def __init__(self, owner, chunks):
        self.completions = FakeCompletions(owner, chunks)


class FakeCompletions:
    def __init__(self, owner, chunks):
        self._owner = owner
        self._chunks = chunks

    async def create(self, **kwargs):
        self._owner.created = kwargs
        if hasattr(self._chunks, "__aiter__") or hasattr(self._chunks, "close"):
            return self._chunks
        return AsyncItems(self._chunks)


class FakeOpenAICompatibleClient:
    def __init__(self, lines, *, status_code=200, body=""):
        self._lines = lines
        self._status_code = status_code
        self._body = body
        self.method: str | None = None
        self.url: str | None = None
        self.headers: dict[str, str] | None = None
        self.payload: dict[str, Any] | None = None

    def stream(self, method, url, *, headers, json):
        self.method = method
        self.url = url
        self.headers = headers
        self.payload = json
        return FakeOpenAICompatibleResponse(
            self._lines,
            status_code=self._status_code,
            body=self._body,
        )


class FakeOpenAICompatibleResponse:
    def __init__(self, lines, *, status_code=200, body=""):
        self._lines = lines
        self.status_code = status_code
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def raise_for_status(self):
        return None

    async def aread(self):
        return self._body.encode()

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeHTTPXAsyncClient:
    lines = []
    created = []

    def __init__(self, *, timeout):
        self.timeout = timeout
        self.method: str | None = None
        self.url: str | None = None
        self.headers: dict[str, str] | None = None
        self.payload: dict[str, Any] | None = None
        self.created.append(self)

    @classmethod
    def reset(cls, lines):
        cls.lines = lines
        cls.created = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def stream(self, method, url, *, headers, json):
        self.method = method
        self.url = url
        self.headers = headers
        self.payload = json
        return FakeOpenAICompatibleResponse(self.lines)


class FakeRunnable:
    def __init__(self, chunks):
        self._chunks = chunks
        self.messages: list[Any] | None = None

    async def astream(self, messages, **kwargs):
        self.messages = messages
        for chunk in self._chunks:
            yield chunk


class FakeSyncRunnable:
    def __init__(self, chunks):
        self._chunks = chunks
        self.messages: list[Any] | None = None

    def stream(self, messages, **kwargs):
        self.messages = messages
        if hasattr(self._chunks, "close"):
            return self._chunks
        return iter(self._chunks)


class AsyncItems:
    def __init__(self, items):
        self._items = items

    async def __aiter__(self):
        for item in self._items:
            yield item


class CloseableAsyncItems:
    def __init__(self, items):
        self._items = items
        self._index = 0
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._index >= len(self._items):
            raise StopAsyncIteration
        item = self._items[self._index]
        self._index += 1
        return item

    async def aclose(self):
        self.closed = True


class CloseableIterator:
    def __init__(self, items):
        self._items = iter(items)
        self.closed = False

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._items)

    def close(self):
        self.closed = True


def openai_chunk(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content))]
    )


def assert_present(test_case, value):
    test_case.assertIsNotNone(value)
    assert value is not None
    return value
