import unittest
from types import SimpleNamespace
from typing import Any

from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.langchain import stream_slot_object as langchain_stream
from slot_flight.adapters.openai import stream_slot_object as openai_stream
from slot_flight.adapters.openai_compatible import (
    stream_slot_object as openai_compatible_stream,
)


class Summary(BaseModel):
    title: str = Field(description="Write a short title.")
    tags: list[str] = Field(description="Write a JSON array of two tags.")


class AdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_openai_adapter_streams_slot_object(self):
        client = FakeOpenAIClient(
            [
                {"choices": [{"delta": {"content": "<1>Hello</1>"}}]},
                {"choices": [{"delta": {"content": '<2>["a","b"]</2>'}}]},
            ]
        )

        stream = openai_stream(
            client=client,
            model="test-model",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
            temperature=0.2,
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        created = self.assert_created(client.created)
        self.assertTrue(created["stream"])
        self.assertEqual(created["model"], "test-model")
        self.assertEqual(created["temperature"], 0.2)
        self.assertIn("OUTPUT CONTRACT", created["messages"][-1]["content"])

    async def test_openai_adapter_closes_provider_stream_on_early_stop(self):
        provider_stream = CloseableAsyncItems(
            [{"choices": [{"delta": {"content": "<1>Hello"}}]}]
        )
        client = FakeOpenAIClient(provider_stream)

        stream = openai_stream(
            client=client,
            model="test-model",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )
        iterator = stream.events().__aiter__()

        await iterator.__anext__()
        await iterator.aclose()

        self.assertTrue(provider_stream.closed)

    async def test_openai_adapter_supports_object_chunks_from_sync_stream(self):
        client = FakeOpenAIClient(
            CloseableIterator(
                [
                    _openai_chunk("<1>Hello</1>"),
                    _openai_chunk('<2>["a","b"]</2>'),
                ]
            )
        )

        stream = openai_stream(
            client=client,
            model="test-model",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )

    async def test_openai_compatible_adapter_streams_sse_chat_completions(self):
        client = FakeOpenAICompatibleClient(
            [
                'data: {"choices":[{"delta":{"content":"<1>Hello</1>"}}]}',
                'data: {"choices":[{"delta":{"content":"<2>[\\"a\\",\\"b\\"]</2>"}}]}',
                "data: [DONE]",
            ]
        )

        stream = openai_compatible_stream(
            client=client,
            base_url="https://integrate.api.nvidia.com/v1",
            api_key="test-key",
            model="minimaxai/minimax-m3",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
            temperature=0.2,
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        self.assertEqual(client.method, "POST")
        self.assertEqual(
            client.url,
            "https://integrate.api.nvidia.com/v1/chat/completions",
        )
        headers = self.assert_created(client.headers)
        payload = self.assert_created(client.payload)
        self.assertEqual(headers["Authorization"], "Bearer test-key")
        self.assertEqual(headers["Accept"], "text/event-stream")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["model"], "minimaxai/minimax-m3")
        self.assertEqual(payload["temperature"], 0.2)
        self.assertIn("OUTPUT CONTRACT", payload["messages"][-1]["content"])

    async def test_langchain_adapter_streams_slot_object(self):
        runnable = FakeRunnable(["<1>Hello</1>", '<2>["a","b"]</2>'])

        stream = langchain_stream(
            runnable=runnable,
            messages=[("human", "Classify this.")],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        messages = self.assert_messages(runnable.messages)
        self.assertEqual(messages[-1][0], "human")
        self.assertIn("OUTPUT CONTRACT", messages[-1][1])

    async def test_langchain_adapter_supports_sync_stream(self):
        runnable = FakeSyncRunnable(["<1>Hello</1>", '<2>["a","b"]</2>'])

        stream = langchain_stream(
            runnable=runnable,
            messages=[("human", "Classify this.")],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        messages = self.assert_messages(runnable.messages)
        self.assertIn("OUTPUT CONTRACT", messages[-1][1])

    async def test_langchain_adapter_supports_message_chunk_content_parts(self):
        runnable = FakeRunnable(
            [
                SimpleNamespace(content=[{"type": "text", "text": "<1>He"}, "llo</1>"]),
                {"content": [{"type": "text", "text": '<2>["a",'}, '"b"]</2>']},
            ]
        )

        stream = langchain_stream(
            runnable=runnable,
            messages=[("human", "Classify this.")],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )

    async def test_langchain_adapter_closes_sync_stream_on_early_stop(self):
        source = CloseableIterator(["<1>Hello"])
        runnable = FakeSyncRunnable(source)

        stream = langchain_stream(
            runnable=runnable,
            messages=[("human", "Classify this.")],
            output=slot_object(Summary),
        )
        iterator = stream.events().__aiter__()

        await iterator.__anext__()
        await iterator.aclose()

        self.assertTrue(source.closed)

    def assert_created(self, value: dict[str, Any] | None) -> dict[str, Any]:
        self.assertIsNotNone(value)
        assert value is not None
        return value

    def assert_messages(self, value: list[Any] | None) -> list[Any]:
        self.assertIsNotNone(value)
        assert value is not None
        return value


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
    def __init__(self, lines):
        self._lines = lines
        self.method: str | None = None
        self.url: str | None = None
        self.headers: dict[str, str] | None = None
        self.payload: dict[str, Any] | None = None

    def stream(self, method, url, *, headers, json):
        self.method = method
        self.url = url
        self.headers = headers
        self.payload = json
        return FakeOpenAICompatibleResponse(self._lines)


class FakeOpenAICompatibleResponse:
    def __init__(self, lines):
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def raise_for_status(self):
        return None

    async def aiter_lines(self):
        for line in self._lines:
            yield line


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


def _openai_chunk(content: str):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=content))]
    )


if __name__ == "__main__":
    unittest.main()
