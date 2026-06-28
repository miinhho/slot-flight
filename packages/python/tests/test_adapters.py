import unittest
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
        return AsyncItems(self._chunks)


class FakeAnthropicClient:
    def __init__(self, events):
        self.messages = FakeMessages(events)


class FakeAnthropicStreamClient:
    def __init__(self, texts):
        self.messages = FakeStreamMessages(texts)


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

    def stream(self, **kwargs):
        self.created = kwargs
        return FakeTextStreamContext(self._texts)


class FakeTextStreamContext:
    def __init__(self, texts):
        self.text_stream = texts

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
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
        return iter(self._chunks)


class AsyncItems:
    def __init__(self, items):
        self._items = items

    async def __aiter__(self):
        for item in self._items:
            yield item


if __name__ == "__main__":
    unittest.main()
