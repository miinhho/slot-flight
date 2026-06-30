import asyncio
import json
import unittest
from typing import Any, Literal, cast

from pydantic import BaseModel, Field

from slot_flight import (
    SlotFlightConfigurationError,
    create_slot_object_event_stream,
    slot_object,
)
from slot_flight.slot.object import create_slot_object_stream


class Metadata(BaseModel):
    audience: str = Field(description="Write the intended audience.")


class Article(BaseModel):
    title: str = Field(description="Write a short title.")
    priority: Literal["low", "medium", "high"] = Field(
        description="Write exactly one of: low, medium, high."
    )
    tags: list[str] = Field(description="Write a JSON array of two tags.")
    metadata: Metadata


class NestedArticle(BaseModel):
    metadata: Metadata = Field(description="Write the full metadata object.")


class TitleOnly(BaseModel):
    title: str = Field(description="Write a short title.")


class SlotObjectTest(unittest.IsolatedAsyncioTestCase):
    async def test_inferrs_slots_from_pydantic_field_descriptions(self):
        output = slot_object(Article)

        self.assertEqual(
            [(slot.path, slot.mode, slot.prompt) for slot in output.slots],
            [
                ("title", "text", "Write a short title."),
                ("priority", "text", "Write exactly one of: low, medium, high."),
                ("tags", "json", "Write a JSON array of two tags."),
                ("metadata.audience", "text", "Write the intended audience."),
            ],
        )

        async def generate(request):
            values = {
                "title": "Slot-wise JSON",
                "priority": "high",
                "tags": '["llm","json"]',
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                yield f"<{slot.id}>{values[slot.path]}</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        final_object = await stream.final_object()

        self.assertEqual(
            final_object,
            Article(
                title="Slot-wise JSON",
                priority="high",
                tags=["llm", "json"],
                metadata=Metadata(audience="backend engineers"),
            ),
        )

    def test_rejects_undocumented_leaf_fields(self):
        class MissingDescription(BaseModel):
            title: str

        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            'Pydantic field "title" must use Field\\(description=\\.\\.\\.\\)',
        ):
            slot_object(MissingDescription)

    def test_rejects_non_pydantic_models(self):
        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            "slot_object\\(\\) requires a Pydantic model",
        ):
            slot_object(cast(Any, dict))

    async def test_retries_failed_pydantic_slot_validation(self):
        output = slot_object(Article, max_retries=1)
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            values = {
                "title": "Slot-wise JSON",
                "priority": "urgent" if request.attempt == 1 else "high",
                "tags": '["llm","json"]',
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                yield f"<{slot.id}>{values[slot.path]}</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        final_object = await stream.final_object()

        self.assertEqual(final_object.priority, "high")
        self.assertEqual(
            requests,
            [
                [
                    "title:1",
                    "priority:1",
                    "tags:1",
                    "metadata.audience:1",
                ],
                ["priority:2"],
            ],
        )

    async def test_described_nested_model_becomes_one_json_slot(self):
        output = slot_object(NestedArticle)

        self.assertEqual(
            [(slot.path, slot.mode) for slot in output.slots],
            [("metadata", "json")],
        )

        async def generate(request):
            slot = request.slots[0]
            yield f'<{slot.id}>{{"audience":"backend engineers"}}</{slot.id}>'

        stream = create_slot_object_stream(output=output, generate=generate)

        self.assertEqual(
            await stream.final_object(),
            NestedArticle(metadata=Metadata(audience="backend engineers")),
        )

    async def test_completed_slots_and_final_object_share_one_model_run(self):
        output = slot_object(Article)
        run_count = 0

        async def generate(request):
            nonlocal run_count
            run_count += 1
            values = {
                "title": "Slot-wise JSON",
                "priority": "high",
                "tags": '["llm","json"]',
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                yield f"<{slot.id}>{values[slot.path]}</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        completed = [slot async for slot in stream.completed_slots()]
        final_object = await stream.final_object()

        self.assertEqual(run_count, 1)
        self.assertEqual(
            [slot.slot for slot in completed],
            [slot.path for slot in output.slots],
        )
        self.assertEqual(final_object.title, "Slot-wise JSON")

    async def test_wraps_existing_slot_event_source(self):
        run_count = 0

        async def source():
            nonlocal run_count
            run_count += 1
            yield {
                "type": "slot-start",
                "slot": "title",
                "attempt": 1,
                "state": {},
            }
            yield {
                "type": "slot-delta",
                "slot": "title",
                "attempt": 1,
                "delta": "Slot-wise JSON",
                "value": "Slot-wise JSON",
                "state": {},
            }
            yield {
                "type": "slot-complete",
                "slot": "title",
                "attempt": 1,
                "value": "Slot-wise JSON",
                "state": {"title": "Slot-wise JSON"},
            }
            yield {"type": "done", "state": {"title": "Slot-wise JSON"}}

        stream = create_slot_object_event_stream(source)

        completed = [slot async for slot in stream.completed_slot_stream()]
        final_object = await stream.final_object()

        self.assertEqual(run_count, 1)
        self.assertEqual(completed[0].slot, "title")
        self.assertEqual(final_object, {"title": "Slot-wise JSON"})

    async def test_partial_object_stream_matches_stateful_events(self):
        output = slot_object(TitleOnly)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        partials = [partial async for partial in stream.partial_object_stream()]

        self.assertEqual(
            partials,
            [
                {},
                {"title": "Slot-wise JSON"},
                TitleOnly(title="Slot-wise JSON"),
            ],
        )

    async def test_serializes_completed_slot_stream_as_ndjson(self):
        output = slot_object(TitleOnly)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        lines = [
            json.loads(line)
            async for line in stream.to_ndjson(source="completed")
        ]

        self.assertEqual(
            lines,
            [
                {
                    "type": "slot",
                    "data": {
                        "slot": "title",
                        "value": "Slot-wise JSON",
                        "state": {"title": "Slot-wise JSON"},
                    },
                },
                {
                    "type": "done",
                    "data": {"state": {"title": "Slot-wise JSON"}},
                },
            ],
        )

    async def test_serializes_low_level_events_as_sse(self):
        output = slot_object(TitleOnly)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        body = "".join([chunk async for chunk in stream.to_sse(source="events")])

        self.assertIn("event: slot-start\n", body)
        self.assertIn("event: slot-delta\n", body)
        self.assertIn("event: slot-complete\n", body)
        self.assertIn("event: done\n", body)

    async def test_rejects_second_live_consumer(self):
        output = slot_object(TitleOnly)
        release = asyncio.Event()

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON</{slot.id}>"
            await release.wait()

        stream = create_slot_object_stream(output=output, generate=generate)
        iterator = stream.events().__aiter__()
        await iterator.__anext__()

        with self.assertRaisesRegex(RuntimeError, "already has a live consumer"):
            await stream.final_object()

        release.set()
        with self.assertRaises(StopAsyncIteration):
            while True:
                await iterator.__anext__()


if __name__ == "__main__":
    unittest.main()
