import unittest
from typing import Any, Literal, cast

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


class NestedArticle(BaseModel):
    metadata: Metadata = Field(description="Write the full metadata object.")


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


if __name__ == "__main__":
    unittest.main()
