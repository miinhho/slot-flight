import asyncio
import unittest

from pydantic import BaseModel, Field

from slot_flight import create_slot_object_event_stream, slot_object
from slot_flight.slot.object import create_slot_object_stream


class TitleOnly(BaseModel):
    title: str = Field(description="Write a short title.")


class SlotObjectLifecycleTest(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_second_live_consumer(self):
        output = slot_object(TitleOnly)
        release = asyncio.Event()

        async def generate(request):
            slot = request.slots[0]
            yield f"<{slot.id}>Slot-wise JSON\n</{slot.id}>"
            await release.wait()

        stream = create_slot_object_stream(output=output, generate=generate)
        iterator = stream.events().__aiter__()
        await iterator.__anext__()

        with self.assertRaisesRegex(RuntimeError, "already being consumed by events"):
            await stream.final_object()

        release.set()
        with self.assertRaises(StopAsyncIteration):
            while True:
                await iterator.__anext__()

    async def test_final_object_rethrows_stream_failure_after_view_fails(self):
        async def source():
            yield {
                "type": "slot-start",
                "slot": "title",
                "attempt": 1,
                "state": {},
            }
            raise RuntimeError("provider disconnected")

        stream = create_slot_object_event_stream(source)

        with self.assertRaisesRegex(RuntimeError, "provider disconnected"):
            [event async for event in stream.slot_event_stream()]
        with self.assertRaisesRegex(RuntimeError, "provider disconnected"):
            await stream.final_object()

    async def test_final_object_rejects_source_completion_without_done(self):
        async def source():
            yield {
                "type": "slot-complete",
                "slot": "title",
                "attempt": 1,
                "value": "Slot-wise JSON",
                "state": {"title": "Slot-wise JSON"},
            }

        stream = create_slot_object_event_stream(source)

        with self.assertRaisesRegex(RuntimeError, "without a done event"):
            await stream.final_object()

    async def test_final_object_rethrows_cancellation_after_view_closes_early(self):
        closed = False
        release = asyncio.Event()

        async def source():
            nonlocal closed
            try:
                yield {
                    "type": "slot-start",
                    "slot": "title",
                    "attempt": 1,
                    "state": {},
                }
                await release.wait()
            finally:
                closed = True

        stream = create_slot_object_event_stream(source)
        iterator = stream.slot_event_stream().__aiter__()

        await iterator.__anext__()
        await iterator.aclose()
        await asyncio.sleep(0)

        self.assertTrue(closed)
        with self.assertRaisesRegex(RuntimeError, "cancelled before a final object"):
            await stream.final_object()


if __name__ == "__main__":
    unittest.main()
