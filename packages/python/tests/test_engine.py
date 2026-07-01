import unittest

from slot_flight import SlotDefinition, SlotFlight
from slot_flight.errors import SlotFlightJsonParseError


async def collect_events(flight):
    events = []
    async for event in flight.run():
        events.append(event)
    return events


class SlotFlightTest(unittest.IsolatedAsyncioTestCase):
    async def test_assembles_server_owned_json_from_one_frame_stream(self):
        async def generate(request):
            values = {
                "title": "Slot-wise JSON",
                "tags[0]": "llm",
                "tags[1]": "json",
                "metadata.audience": "backend engineers",
            }
            for slot in request.slots:
                yield f"<{slot.id}>\n{values[slot.path]}\n</{slot.id}>\n"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition("title", validate=_non_empty_string),
                    SlotDefinition("tags[]", count=2, validate=_non_empty_string),
                    SlotDefinition("metadata.audience", validate=_non_empty_string),
                ],
                generate=generate,
            )
        )

        self.assertEqual(
            events[-1],
            {
                "type": "done",
                "state": {
                    "title": "Slot-wise JSON",
                    "tags": ["llm", "json"],
                    "metadata": {"audience": "backend engineers"},
                },
            },
        )

    async def test_retries_only_failed_slots_after_validation_fails(self):
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            for slot in request.slots:
                value = "" if slot.path == "title" and slot.attempt == 1 else "valid"
                yield f"<{slot.id}>{value}\n</{slot.id}>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition("title", validate=_non_empty_string),
                    SlotDefinition("summary", validate=_non_empty_string),
                ],
                generate=generate,
                max_retries=1,
            )
        )

        self.assertEqual(requests, [["title:1", "summary:1"], ["title:2"]])
        self.assertTrue(
            any(
                event["type"] == "slot-retry" and event["slot"] == "title"
                for event in events
            )
        )

    async def test_retries_json_slot_when_body_is_invalid_json(self):
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            for slot in request.slots:
                value = '["billing",' if slot.attempt == 1 else '["billing","latency"]'
                yield f"<{slot.id}>{value}\n</{slot.id}>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "tags",
                        mode="json",
                        validate=lambda value: _list_length(value, 2),
                    )
                ],
                generate=generate,
                max_retries=1,
            )
        )

        self.assertEqual(requests, [["tags:1"], ["tags:2"]])
        retry = next(event for event in events if event["type"] == "slot-retry")
        self.assertIsInstance(retry["error"], SlotFlightJsonParseError)

    async def test_closes_source_stream_when_consumer_stops_early(self):
        source = CloseableAsyncItems(["<1>Hello"])

        async def generate(request):
            return source

        iterator = SlotFlight(
            slots=[SlotDefinition("title", validate=_non_empty_string)],
            generate=generate,
        ).run().__aiter__()

        await iterator.__anext__()
        await iterator.aclose()

        self.assertTrue(source.closed)


def _non_empty_string(value):
    if not isinstance(value, str) or value == "":
        raise ValueError("expected non-empty string")
    return value


def _list_length(value, length):
    if not isinstance(value, list) or len(value) != length:
        raise ValueError(f"expected list of length {length}")
    return value


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


if __name__ == "__main__":
    unittest.main()
