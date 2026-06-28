import unittest
from typing import Literal

from pydantic import BaseModel, Field

from slot_flight import SlotFlightConfigurationError, slot_object
from slot_flight.object import create_slot_object_stream


class Metadata(BaseModel):
    audience: str = Field(description="Write the intended audience.")


class Article(BaseModel):
    title: str = Field(description="Write a short title.")
    priority: Literal["low", "medium", "high"] = Field(
        description="Write exactly one of: low, medium, high."
    )
    tags: list[str] = Field(description="Write a JSON array of two tags.")
    metadata: Metadata


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


if __name__ == "__main__":
    unittest.main()
