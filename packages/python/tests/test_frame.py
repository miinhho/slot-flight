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

    def test_accepts_inline_opening_and_closing_tags(self):
        parser = SlotFrameParser({"1": "name"})

        events = parser.push("<1>Alice</1>")
        parser.finish()

        self.assertIn(
            ("slot-complete", "name", "Alice"),
            [(event.type, event.slot, event.value) for event in events],
        )


if __name__ == "__main__":
    unittest.main()
