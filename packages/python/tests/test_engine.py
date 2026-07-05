import unittest

from pydantic import BaseModel, Field

from slot_flight import SlotDefinition, SlotFlight


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

    async def test_appends_unknown_length_array_from_repeated_slot_frames(self):
        async def generate(request):
            self.assertEqual(request.slots[0].path, "tags[]")
            self.assertEqual(request.slots[0].repeat, "append")
            slot = request.slots[0]
            yield f"<{slot.id}:0>billing\n</{slot.id}:0>"
            yield f"<{slot.id}:1>latency\n</{slot.id}:1>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "tags[]",
                        validate=_non_empty_string,
                    )
                ],
                generate=generate,
            )
        )

        self.assertEqual(
            events[-1],
            {"type": "done", "state": {"tags": ["billing", "latency"]}},
        )

    async def test_retries_repeatable_field_as_full_sequence(self):
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            slot = request.slots[0]
            if slot.attempt == 1:
                yield f"<{slot.id}:0>old-first\n</{slot.id}:0>"
                yield f"<{slot.id}:1>\n</{slot.id}:1>"
                yield f"<{slot.id}:2>stale-third\n</{slot.id}:2>"
                return
            yield f"<{slot.id}:0>new-first\n</{slot.id}:0>"
            yield f"<{slot.id}:1>new-second\n</{slot.id}:1>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "tags[]",
                        validate=_non_empty_string,
                    )
                ],
                generate=generate,
                max_retries=1,
            )
        )

        self.assertEqual(requests, [["tags[]:1"], ["tags[]:2"]])
        self.assertEqual(
            events[-1],
            {"type": "done", "state": {"tags": ["new-first", "new-second"]}},
        )

    async def test_retries_repeatable_field_when_final_array_validation_fails(self):
        class TagsModel(BaseModel):
            tags: list[str] = Field(min_length=2)

        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            slot = request.slots[0]
            yield f"<{slot.id}:0>first\n</{slot.id}:0>"
            if slot.attempt == 2:
                yield f"<{slot.id}:1>second\n</{slot.id}:1>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "tags[]",
                        validate=_non_empty_string,
                    )
                ],
                generate=generate,
                max_retries=1,
                validate_final=TagsModel,
            )
        )

        self.assertEqual(requests, [["tags[]:1"], ["tags[]:2"]])
        self.assertTrue(
            any(
                event["type"] == "slot-retry" and event["slot"] == "tags[]"
                for event in events
            )
        )
        self.assertEqual(
            events[-1],
            {"type": "done", "state": TagsModel(tags=["first", "second"])},
        )

    async def test_retries_only_failed_object_array_field_sequence(self):
        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            heading = next(
                (slot for slot in request.slots if slot.path == "sections[].heading"),
                None,
            )
            body = next(
                (slot for slot in request.slots if slot.path == "sections[].body"),
                None,
            )

            if heading is not None and body is not None and body.attempt == 1:
                yield f"<{body.id}:0>Old opening\n</{body.id}:0>"
                yield f"<{heading.id}:0>Intro\n</{heading.id}:0>"
                yield f"<{heading.id}:1>Details\n</{heading.id}:1>"
                yield f"<{body.id}:1>\n</{body.id}:1>"
            if body is not None and body.attempt == 2:
                yield f"<{body.id}:0>New opening\n</{body.id}:0>"
                yield f"<{body.id}:1>New detail\n</{body.id}:1>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "sections[].heading",
                        validate=_non_empty_string,
                    ),
                    SlotDefinition(
                        "sections[].body",
                        validate=_non_empty_string,
                    ),
                ],
                generate=generate,
                max_retries=1,
            )
        )

        self.assertEqual(
            requests,
            [
                ["sections[].heading:1", "sections[].body:1"],
                ["sections[].body:2"],
            ],
        )
        self.assertEqual(
            events[-1],
            {
                "type": "done",
                "state": {
                    "sections": [
                        {"heading": "Intro", "body": "New opening"},
                        {"heading": "Details", "body": "New detail"},
                    ]
                },
            },
        )

    async def test_retries_missing_object_array_field_from_final_validation(self):
        class Section(BaseModel):
            heading: str
            body: str

        class Article(BaseModel):
            sections: list[Section] = Field(min_length=2)

        requests = []

        async def generate(request):
            requests.append([f"{slot.path}:{slot.attempt}" for slot in request.slots])
            heading = next(
                (slot for slot in request.slots if slot.path == "sections[].heading"),
                None,
            )
            body = next(
                (slot for slot in request.slots if slot.path == "sections[].body"),
                None,
            )

            if heading is not None:
                yield f"<{heading.id}:0>Intro\n</{heading.id}:0>"
                yield f"<{heading.id}:1>Details\n</{heading.id}:1>"
            if body is not None:
                yield f"<{body.id}:0>Opening\n</{body.id}:0>"
                if body.attempt == 2:
                    yield f"<{body.id}:1>More detail\n</{body.id}:1>"

        events = await collect_events(
            SlotFlight(
                slots=[
                    SlotDefinition(
                        "sections[].heading",
                        validate=_non_empty_string,
                    ),
                    SlotDefinition(
                        "sections[].body",
                        validate=_non_empty_string,
                    ),
                ],
                generate=generate,
                max_retries=1,
                validate_final=Article,
            )
        )

        self.assertEqual(
            requests,
            [
                ["sections[].heading:1", "sections[].body:1"],
                ["sections[].body:2"],
            ],
        )
        self.assertEqual(
            events[-1],
            {
                "type": "done",
                "state": Article(
                    sections=[
                        Section(heading="Intro", body="Opening"),
                        Section(heading="Details", body="More detail"),
                    ]
                ),
            },
        )

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
