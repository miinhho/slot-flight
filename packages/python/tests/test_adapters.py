import unittest
from types import SimpleNamespace
from typing import Any

from pydantic import BaseModel, Field

from slot_flight import slot_object
from slot_flight.adapters.anthropic import stream_slot_object as anthropic_stream
from slot_flight.adapters.langchain import stream_slot_object as langchain_stream
from slot_flight.adapters.openai import stream_slot_object as openai_stream


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

    async def test_anthropic_adapter_streams_slot_object(self):
        client = FakeAnthropicClient(
            [
                {"type": "content_block_delta", "delta": {"text": "<1>Hello</1>"}},
                {
                    "type": "content_block_delta",
                    "delta": {"text": '<2>["a","b"]</2>'},
                },
            ]
        )

        stream = anthropic_stream(
            client=client,
            model="claude-test",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        created = self.assert_created(client.messages.created)
        self.assertTrue(created["stream"])
        self.assertEqual(created["model"], "claude-test")

    async def test_anthropic_adapter_prefers_native_text_stream_context(self):
        client = FakeAnthropicStreamClient(["<1>Hello</1>", '<2>["a","b"]</2>'])

        stream = anthropic_stream(
            client=client,
            model="claude-test",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
            max_tokens=256,
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        created = self.assert_created(client.messages.created)
        self.assertEqual(created["max_tokens"], 256)

    async def test_anthropic_adapter_supports_object_events(self):
        client = FakeAnthropicClient(
            [
                _anthropic_text_delta("<1>Hello</1>"),
                _anthropic_text_delta('<2>["a","b"]</2>'),
            ]
        )

        stream = anthropic_stream(
            client=client,
            model="claude-test",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )

    async def test_anthropic_adapter_supports_async_native_text_stream_context(self):
        client = FakeAsyncAnthropicStreamClient(["<1>Hello</1>", '<2>["a","b"]</2>'])

        stream = anthropic_stream(
            client=client,
            model="claude-test",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )
        context = client.messages.context
        self.assertIsNotNone(context)
        assert context is not None
        self.assertTrue(context.exited)

    async def test_anthropic_adapter_exits_native_stream_context_on_early_stop(self):
        client = FakeAnthropicStreamClient(["<1>Hello"])

        stream = anthropic_stream(
            client=client,
            model="claude-test",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )
        iterator = stream.events().__aiter__()

        await iterator.__anext__()
        await iterator.aclose()

        context = client.messages.context
        self.assertIsNotNone(context)
        assert context is not None
        self.assertTrue(context.exited)

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


class FakeAnthropicClient:
    def __init__(self, events):
        self.messages = FakeMessages(events)


class FakeAnthropicStreamClient:
    def __init__(self, texts):
        self.messages = FakeStreamMessages(texts)


class FakeAsyncAnthropicStreamClient:
    def __init__(self, texts):
        self.messages = FakeAsyncStreamMessages(texts)


class FakeMessages:
    def __init__(self, events):
        self._events = events
        self.created: dict[str, Any] | None = None

    async def create(self, **kwargs):
        self.created = kwargs
        return AsyncItems(self._events)


class FakeStreamMessages:
    def __init__(self, texts):
        self._texts = texts
        self.created: dict[str, Any] | None = None
        self.context: FakeTextStreamContext | None = None

    def stream(self, **kwargs):
        self.created = kwargs
        self.context = FakeTextStreamContext(self._texts)
        return self.context


class FakeAsyncStreamMessages:
    def __init__(self, texts):
        self._texts = texts
        self.created: dict[str, Any] | None = None
        self.context: FakeAsyncTextStreamContext | None = None

    def stream(self, **kwargs):
        self.created = kwargs
        self.context = FakeAsyncTextStreamContext(self._texts)
        return self.context


class FakeTextStreamContext:
    def __init__(self, texts):
        self.text_stream = texts
        self.exited = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.exited = True
        return False


class FakeAsyncTextStreamContext:
    def __init__(self, texts):
        self.text_stream = AsyncItems(texts)
        self.exited = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        self.exited = True
        return False


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


def _anthropic_text_delta(text: str):
    return SimpleNamespace(
        type="content_block_delta",
        delta=SimpleNamespace(text=text),
    )


if __name__ == "__main__":
    unittest.main()
