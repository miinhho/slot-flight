import unittest

from slot_flight import slot_object
from slot_flight.adapters.openai import stream_slot_object as openai_stream

from .helpers import (
    CloseableAsyncItems,
    CloseableIterator,
    FakeOpenAIClient,
    Summary,
    assert_present,
    openai_chunk,
)


class OpenAIAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_streams_slot_object(self):
        client = FakeOpenAIClient(
            [
                {"choices": [{"delta": {"content": "<1>Hello\n</1>"}}]},
                {
                    "choices": [
                        {"delta": {"content": "<2:0>a\n</2:0>\n<2:1>b\n</2:1>"}}
                    ]
                },
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
        created = assert_present(self, client.created)
        self.assertTrue(created["stream"])
        self.assertEqual(created["model"], "test-model")
        self.assertEqual(created["temperature"], 0.2)
        self.assertIn("OUTPUT CONTRACT", created["messages"][-1]["content"])

    async def test_closes_provider_stream_on_early_stop(self):
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

    async def test_supports_object_chunks_from_sync_stream(self):
        client = FakeOpenAIClient(
            CloseableIterator(
                [
                    openai_chunk("<1>Hello\n</1>"),
                    openai_chunk("<2:0>a\n</2:0>\n<2:1>b\n</2:1>"),
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


if __name__ == "__main__":
    unittest.main()
