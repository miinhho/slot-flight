import unittest
from unittest.mock import patch

from slot_flight import SlotFlightStreamError, slot_object
from slot_flight.adapters.openai_compatible import (
    stream_slot_object as openai_compatible_stream,
)

from .helpers import (
    FakeHTTPXAsyncClient,
    FakeOpenAICompatibleClient,
    Summary,
    assert_present,
)


class OpenAICompatibleAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_streams_sse_chat_completions(self):
        client = FakeOpenAICompatibleClient(
            [
                'data: {"choices":[{"delta":{"content":"<1>Hello\\n</1>"}}]}',
                (
                    'data: {"choices":[{"delta":{"content":'
                    '"<2:0>a\\n</2:0>\\n<2:1>b\\n</2:1>"}}]}'
                ),
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
            timeout=0.01,
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
        headers = assert_present(self, client.headers)
        payload = assert_present(self, client.payload)
        self.assertEqual(headers["Authorization"], "Bearer test-key")
        self.assertEqual(headers["Accept"], "text/event-stream")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["model"], "minimaxai/minimax-m3")
        self.assertEqual(payload["temperature"], 0.2)
        self.assertIn("OUTPUT CONTRACT", payload["messages"][-1]["content"])

    async def test_accepts_common_chunk_variants(self):
        client = FakeOpenAICompatibleClient(
            [
                ": keep-alive",
                'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":1}}',
                'data: {"choices":[{"text":"<1>Hello\\n</1>"}]}',
                (
                    'data: {"choices":[{"message":{"content":['
                    '{"type":"text","text":"<2:0>a\\n</2:0>"},'
                    '"\\n<2:1>b\\n</2:1>"]}}]}'
                ),
                "data: [DONE]",
            ]
        )

        stream = openai_compatible_stream(
            client=client,
            base_url="https://integrate.api.nvidia.com/v1",
            model="minimaxai/minimax-m3",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        self.assertEqual(
            await stream.final_object(),
            Summary(title="Hello", tags=["a", "b"]),
        )

    async def test_reports_malformed_sse_json(self):
        client = FakeOpenAICompatibleClient(["data: not-json"])

        stream = openai_compatible_stream(
            client=client,
            base_url="https://integrate.api.nvidia.com/v1",
            model="minimaxai/minimax-m3",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        with self.assertRaisesRegex(
            SlotFlightStreamError,
            "malformed JSON SSE data line",
        ):
            await stream.final_object()

    async def test_reports_http_error_body(self):
        client = FakeOpenAICompatibleClient(
            [],
            status_code=401,
            body='{"error":"bad api key"}',
        )

        stream = openai_compatible_stream(
            client=client,
            base_url="https://integrate.api.nvidia.com/v1",
            model="minimaxai/minimax-m3",
            messages=[{"role": "user", "content": "Classify this."}],
            output=slot_object(Summary),
        )

        with self.assertRaisesRegex(
            SlotFlightStreamError,
            'HTTP 401: \\{"error":"bad api key"\\}',
        ):
            await stream.final_object()

    async def test_uses_bounded_default_timeout(self):
        FakeHTTPXAsyncClient.reset(
            [
                'data: {"choices":[{"delta":{"content":"<1>Hello\\n</1>"}}]}',
                (
                    'data: {"choices":[{"delta":{"content":'
                    '"<2:0>a\\n</2:0>\\n<2:1>b\\n</2:1>"}}]}'
                ),
                "data: [DONE]",
            ]
        )

        with patch("httpx.AsyncClient", FakeHTTPXAsyncClient):
            stream = openai_compatible_stream(
                base_url="https://integrate.api.nvidia.com/v1",
                model="minimaxai/minimax-m3",
                messages=[{"role": "user", "content": "Classify this."}],
                output=slot_object(Summary),
            )

            self.assertEqual(
                await stream.final_object(),
                Summary(title="Hello", tags=["a", "b"]),
            )

        created = FakeHTTPXAsyncClient.created[0]
        self.assertEqual(created.timeout.connect, 10.0)
        self.assertEqual(created.timeout.read, 60.0)
        self.assertEqual(created.timeout.write, 60.0)
        self.assertEqual(created.timeout.pool, 60.0)

    async def test_allows_disabling_timeout(self):
        FakeHTTPXAsyncClient.reset(
            [
                'data: {"choices":[{"delta":{"content":"<1>Hello\\n</1>"}}]}',
                "data: [DONE]",
            ]
        )

        with patch("httpx.AsyncClient", FakeHTTPXAsyncClient):
            stream = openai_compatible_stream(
                base_url="https://integrate.api.nvidia.com/v1",
                model="minimaxai/minimax-m3",
                messages=[{"role": "user", "content": "Classify this."}],
                output=slot_object(Summary),
                timeout=None,
            )

            self.assertEqual(
                await stream.final_object(),
                Summary(title="Hello", tags=[]),
            )

        created = FakeHTTPXAsyncClient.created[0]
        self.assertIsNone(created.timeout)


if __name__ == "__main__":
    unittest.main()
