import unittest
from types import SimpleNamespace

from slot_flight import slot_object
from slot_flight.adapters.langchain import stream_slot_object as langchain_stream

from .helpers import CloseableIterator, FakeRunnable, FakeSyncRunnable, Summary


class LangChainAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_streams_slot_object(self):
        runnable = FakeRunnable(
            ["<1>Hello\n</1>", "<2:0>a\n</2:0>\n<2:1>b\n</2:1>"]
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
        messages = assert_present_messages(self, runnable.messages)
        self.assertEqual(messages[-1][0], "human")
        self.assertIn("OUTPUT CONTRACT", messages[-1][1])

    async def test_supports_sync_stream(self):
        runnable = FakeSyncRunnable(
            ["<1>Hello\n</1>", "<2:0>a\n</2:0>\n<2:1>b\n</2:1>"]
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
        messages = assert_present_messages(self, runnable.messages)
        self.assertIn("OUTPUT CONTRACT", messages[-1][1])

    async def test_supports_message_chunk_content_parts(self):
        runnable = FakeRunnable(
            [
                SimpleNamespace(
                    content=[{"type": "text", "text": "<1>He"}, "llo\n</1>"]
                ),
                {
                    "content": [
                        {"type": "text", "text": "<2:0>a\n</2:0>"},
                        "\n<2:1>b\n</2:1>",
                    ]
                },
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

    async def test_closes_sync_stream_on_early_stop(self):
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


def assert_present_messages(test_case, value):
    test_case.assertIsNotNone(value)
    assert value is not None
    return value


if __name__ == "__main__":
    unittest.main()
