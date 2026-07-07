import unittest

from slot_flight.frame import SlotFrameParser


class SlotFrameParserTest(unittest.TestCase):
    def test_extracts_ordered_slot_frame_events(self):
        parser = SlotFrameParser({"1": "name", "2": "title"})

        events = [
            *parser.push("<1>\nAli"),
            *parser.push("ce\n</1>\n<2>\nEng"),
            *parser.push("ineer\n</2>"),
        ]
        parser.finish()

        starts = [event for event in events if event.type == "slot-start"]
        self.assertEqual([event.slot for event in starts], ["name", "title"])
        self.assertIn(
            ("slot-complete", "name", "Alice"),
            [(event.type, event.slot, event.value) for event in events],
        )
        self.assertIn(
            ("slot-complete", "title", "Engineer"),
            [(event.type, event.slot, event.value) for event in events],
        )

    def test_rejects_unregistered_slot_ids(self):
        parser = SlotFrameParser({"1": "name"})

        with self.assertRaisesRegex(Exception, 'Received unregistered slot id "2"'):
            parser.push("<2>\nAlice\n</2>")

    def test_rejects_inline_closing_delimiters(self):
        parser = SlotFrameParser({"1": "name"})

        parser.push("<1>Alice</1>")

        with self.assertRaisesRegex(
            Exception, "Slot stream ended before closing delimiter."
        ):
            parser.finish()

    def test_rejects_inline_empty_closing_delimiters(self):
        parser = SlotFrameParser({"1": "name"})

        parser.push("<1></1>")

        with self.assertRaisesRegex(
            Exception, "Slot stream ended before closing delimiter."
        ):
            parser.finish()

    def test_accepts_empty_values_with_a_line_delimited_closing_tag(self):
        parser = SlotFrameParser({"1": "name"})

        events = parser.push("<1>\n</1>")
        parser.finish()

        self.assertIn(
            ("slot-complete", "name", ""),
            [(event.type, event.slot, event.value) for event in events],
        )

    def test_extracts_indexed_repeat_slot_frames(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        events = [
            *parser.push("<1:0>billing\n</1:0>"),
            *parser.push("<1:1>latency\n</1:1>"),
        ]
        parser.finish()

        self.assertIn(
            ("slot-complete", "tags[]", 0, "billing"),
            [(event.type, event.slot, event.index, event.value) for event in events],
        )
        self.assertIn(
            ("slot-complete", "tags[]", 1, "latency"),
            [(event.type, event.slot, event.index, event.value) for event in events],
        )

    def test_handles_indexed_repeat_headers_split_across_streaming_chunks(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        events = [
            *parser.push("<1:"),
            *parser.push("0>billing\n</1:0>"),
        ]
        parser.finish()

        self.assertIn(
            ("slot-complete", "tags[]", 0, "billing"),
            [(event.type, event.slot, event.index, event.value) for event in events],
        )

    def test_rejects_repeat_slot_frames_without_an_index(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        with self.assertRaisesRegex(
            Exception,
            'Repeatable slot "tags\\[\\]" must use indexed tags like <1:0>.',
        ):
            parser.push("<1>billing\n</1>")

    def test_rejects_indexed_frames_for_fixed_slots(self):
        parser = SlotFrameParser({"1": "name"})

        with self.assertRaisesRegex(
            Exception,
            'Received indexed frame for fixed slot "name".',
        ):
            parser.push("<1:0>Alice\n</1:0>")

    def test_rejects_skipped_repeat_indexes(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        with self.assertRaisesRegex(
            Exception,
            'Expected repeat index 0 for slot "tags\\[\\]" but received 1.',
        ):
            parser.push("<1:1>latency\n</1:1>")

    def test_rejects_oversized_partial_repeat_indexes_instead_of_buffering(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        with self.assertRaisesRegex(Exception, "Expected slot id header"):
            parser.push(f"<1:{'9' * 10_000}")

    def test_rejects_oversized_completed_repeat_indexes_without_int_conversion(self):
        parser = SlotFrameParser({"1": "tags[]"}, {"tags[]"})

        with self.assertRaisesRegex(Exception, "Expected repeat index 0"):
            parser.push(f"<1:{'9' * 10_000}>value\n</1:0>")

    def test_preserves_tag_like_text_inside_a_value(self):
        parser = SlotFrameParser({"1": "name"})

        events = [
            *parser.push("<1>Alice </1> Cooper"),
            *parser.push("\n</1>"),
        ]
        parser.finish()

        self.assertIn(
            ("slot-complete", "name", "Alice </1> Cooper"),
            [(event.type, event.slot, event.value) for event in events],
        )

    def test_handles_closing_delimiters_split_across_streaming_chunks(self):
        parser = SlotFrameParser({"1": "name"})

        events = [
            *parser.push("<1>Alice\n<"),
            *parser.push("/"),
            *parser.push("1>"),
        ]
        parser.finish()

        self.assertIn(
            ("slot-complete", "name", "Alice"),
            [(event.type, event.slot, event.value) for event in events],
        )

    def test_rejects_stream_that_ends_before_active_slot_closes(self):
        parser = SlotFrameParser({"1": "name"})

        parser.push("<1>Alice")

        with self.assertRaisesRegex(
            Exception, "Slot stream ended before closing delimiter."
        ):
            parser.finish()

    def test_rejects_trailing_content_after_valid_slot_frames(self):
        parser = SlotFrameParser({"1": "name"})

        parser.push("<1>Alice\n</1>")

        with self.assertRaisesRegex(Exception, "Expected slot id header"):
            parser.push("trailing")

    def test_rejects_duplicate_slot_frames(self):
        parser = SlotFrameParser({"1": "name"})

        parser.push("<1>Alice\n</1>")

        with self.assertRaisesRegex(Exception, 'Received duplicate slot "name"'):
            parser.push("<1>Bob\n</1>")

    def test_rejects_partial_headers_longer_than_registered_slot_id_width(self):
        parser = SlotFrameParser({"1": "name"})

        with self.assertRaisesRegex(
            Exception, 'Expected slot id header but received "<12".'
        ):
            parser.push("<12")

    def test_truncates_long_protocol_error_previews(self):
        parser = SlotFrameParser({"1": "name"})
        value = f"<{'1' * 200}"

        with self.assertRaises(Exception) as context:
            parser.push(value)

        message = str(context.exception)
        self.assertIn("length 201", message)
        self.assertNotIn(value, message)


if __name__ == "__main__":
    unittest.main()
