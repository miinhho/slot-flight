import unittest
from typing import Any, Literal, cast

from pydantic import BaseModel, Field

from slot_flight import SlotFlightConfigurationError, slot_object


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


class SlotObjectDefinitionTest(unittest.TestCase):
    def test_infers_slots_from_pydantic_field_descriptions(self):
        output = slot_object(Article)

        self.assertEqual(
            [(slot.path, slot.prompt) for slot in output.slots],
            [
                ("title", "Write a short title."),
                ("priority", "Write exactly one of: low, medium, high."),
                ("tags[]", "Write two tags, one tag per frame."),
                ("metadata.audience", "Write the intended audience."),
            ],
        )

    def test_rejects_undocumented_leaf_fields(self):
        class MissingDescription(BaseModel):
            title: str

        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            'Pydantic field "title" must use Field\\(description=\\.\\.\\.\\)',
        ):
            slot_object(MissingDescription)

    def test_rejects_dynamic_mapping_fields(self):
        class DynamicPayload(BaseModel):
            payload: dict[str, str] = Field(description="Write payload fields.")

        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            'Pydantic field "payload" cannot infer structural slots',
        ):
            slot_object(DynamicPayload)

    def test_inherits_parent_descriptions_for_nested_models(self):
        output = slot_object(NestedArticle)

        self.assertEqual(
            [(slot.path, slot.prompt) for slot in output.slots],
            [
                (
                    "metadata.audience",
                    "Write the full metadata object.\n"
                    "Write the intended audience.",
                )
            ],
        )

    def test_rejects_nested_array_and_dynamic_array_items(self):
        class NestedArrayPayload(BaseModel):
            matrix: list[list[str]] = Field(description="Write matrix rows.")

        class DynamicArrayPayload(BaseModel):
            payloads: list[dict[str, str]] = Field(description="Write payloads.")

        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            'Array field "matrix" cannot infer structural slots',
        ):
            slot_object(NestedArrayPayload)
        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            'Array field "payloads" cannot infer structural slots',
        ):
            slot_object(DynamicArrayPayload)

    def test_rejects_non_pydantic_models(self):
        with self.assertRaisesRegex(
            SlotFlightConfigurationError,
            "slot_object\\(\\) requires a Pydantic model",
        ):
            slot_object(cast(Any, dict))


if __name__ == "__main__":
    unittest.main()
