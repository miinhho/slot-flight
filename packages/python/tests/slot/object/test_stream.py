import unittest
from typing import Literal

from pydantic import BaseModel, Field

from slot_flight import create_slot_object_event_stream, slot_object
from slot_flight.slot.object import create_slot_object_stream


class Metadata(BaseModel):
    audience: str = Field(description="Write the intended audience.")


class Article(BaseModel):
    title: str = Field(description="Write a short title.")
    priority: Literal["low", "medium", "high"] = Field(
        description="Write exactly one of: low, medium, high."
    )
    tags: list[str] = Field(description="Write two tags, one tag per frame.")
    metadata: Metadata


class NestedArticle(BaseModel):
    metadata: Metadata = Field(description="Write the full metadata object.")


class TitleOnly(BaseModel):
    title: str = Field(description="Write a short title.")


class SlotObjectStreamTest(unittest.IsolatedAsyncioTestCase):
    async def test_streams_pydantic_object_from_inferred_slots(self):
        output = slot_object(Article)

        async def generate(request):
            values = {
                "title": "Slot-wise JSON",
                "priority": "high",
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                if slot.path == "tags[]":
                    yield f"<{slot.id}:0>llm\n</{slot.id}:0>"
                    yield f"<{slot.id}:1>json\n</{slot.id}:1>"
                    continue
                yield f"<{slot.id}>{values[slot.path]}\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        self.assertEqual(
            await stream.final_object(),
            Article(
                title="Slot-wise JSON",
                priority="high",
                tags=["llm", "json"],
                metadata=Metadata(audience="backend engineers"),
            ),
        )

    async def test_retries_failed_pydantic_slot_validation(self):
        output = slot_object(Article, max_retries=1)
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            values = {
                "title": "Slot-wise JSON",
                "priority": "urgent" if request.attempt == 1 else "high",
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                if slot.path == "tags[]":
                    yield f"<{slot.id}:0>llm\n</{slot.id}:0>"
                    yield f"<{slot.id}:1>json\n</{slot.id}:1>"
                    continue
                yield f"<{slot.id}>{values[slot.path]}\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        final_object = await stream.final_object()

        self.assertEqual(final_object.priority, "high")
        self.assertEqual(
            requests,
            [
                [
                    "title:1",
                    "priority:1",
                    "tags[]:1",
                    "metadata.audience:1",
                ],
                ["priority:2"],
            ],
        )

    async def test_streams_described_nested_model_from_structural_slot(self):
        output = slot_object(NestedArticle)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>backend engineers\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        self.assertEqual(
            await stream.final_object(),
            NestedArticle(metadata=Metadata(audience="backend engineers")),
        )

    async def test_described_nested_model_partial_stream_stays_structured(self):
        output = slot_object(NestedArticle)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>backend"
            yield f" engineers\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)
        partials = [partial async for partial in stream.partial_object_stream()]

        self.assertIn(
            {"metadata": {"audience": "backend engineers"}},
            partials,
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
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                if slot.path == "tags[]":
                    yield f"<{slot.id}:0>llm\n</{slot.id}:0>"
                    yield f"<{slot.id}:1>json\n</{slot.id}:1>"
                    continue
                yield f"<{slot.id}>{values[slot.path]}\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        completed = [slot async for slot in stream.completed_slots()]
        final_object = await stream.final_object()

        self.assertEqual(run_count, 1)
        self.assertEqual(
            [slot.slot for slot in completed],
            ["title", "priority", "tags[0]", "tags[1]", "metadata.audience"],
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
            yield f"<{slot.id}>Slot-wise JSON\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        partials = [partial async for partial in stream.partial_object_stream()]

        self.assertEqual(
            partials,
            [
                {"title": "Slot-wise JSON"},
                {"title": "Slot-wise JSON"},
                TitleOnly(title="Slot-wise JSON"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
