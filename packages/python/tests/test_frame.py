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


if __name__ == "__main__":
    unittest.main()
