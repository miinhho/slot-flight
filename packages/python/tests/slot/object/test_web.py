import json
import unittest

from pydantic import BaseModel, Field

from slot_flight import create_slot_object_event_stream, slot_object
from slot_flight.slot.object import create_slot_object_stream


class TitleOnly(BaseModel):
    title: str = Field(description="Write a short title.")


class SlotObjectWebSerializationTest(unittest.IsolatedAsyncioTestCase):
    async def test_serializes_completed_slot_stream_as_ndjson(self):
        output = slot_object(TitleOnly)

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON\n</{slot.id}>"

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
            yield f"<{slot.id}>Slot-wise JSON\n</{slot.id}>"

        stream = create_slot_object_stream(output=output, generate=generate)

        body = "".join([chunk async for chunk in stream.to_sse(source="events")])
        events = parse_sse(body)

        self.assertEqual(
            [event["event"] for event in events],
            ["slot-start", "slot-delta", "slot-complete", "done"],
        )
        self.assertEqual(
            events[2],
            {
                "event": "slot-complete",
                "data": {
                    "type": "slot-complete",
                    "slot": "title",
                    "attempt": 1,
                    "value": "Slot-wise JSON",
                    "state": {"title": "Slot-wise JSON"},
                },
            },
        )

    async def test_serializes_partial_object_stream_as_ndjson(self):
        async def source():
            yield {
                "type": "slot-delta",
                "slot": "title",
                "attempt": 1,
                "delta": "Slot-wise",
                "value": "Slot-wise",
                "state": {"title": "Slot-wise"},
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
        lines = [json.loads(line) async for line in stream.to_ndjson(source="partial")]

        self.assertEqual(
            lines,
            [
                {"type": "partial", "data": {"title": "Slot-wise"}},
                {"type": "partial", "data": {"title": "Slot-wise JSON"}},
                {"type": "partial", "data": {"title": "Slot-wise JSON"}},
            ],
        )


def parse_sse(body: str):
    events = []
    for chunk in filter(None, body.strip().split("\n\n")):
        lines = chunk.splitlines()
        event_line = next(line for line in lines if line.startswith("event: "))
        data_line = next(line for line in lines if line.startswith("data: "))
        events.append(
            {
                "event": event_line.removeprefix("event: "),
                "data": json.loads(data_line.removeprefix("data: ")),
            }
        )
    return events


if __name__ == "__main__":
    unittest.main()
