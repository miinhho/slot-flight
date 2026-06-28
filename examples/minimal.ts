import { z } from "zod";
import { type SlotGenerator, slotFlight } from "../src/core.js";

const schema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  tags: z.array(z.string().min(1)).length(2)
});

const fakeLlm: SlotGenerator = async function* (request) {
  const valueByPath: Record<string, string> = {
    title: "Slot-wise JSON generation",
    summary: "The server assembles JSON while the model streams values.",
    "tags[0]": "streaming",
    "tags[1]": "zod"
  };

  for (const slot of request.slots) {
    yield `<${slot.id}>\n`;
    yield valueByPath[slot.path] ?? "";
    yield `\n</${slot.id}>\n`;
  }
};

const flight = slotFlight({
  schema,
  generate: fakeLlm,
  slots: [
    {
      path: "title",
      schema: z.string().min(1),
      prompt: "Write a title value."
    },
    {
      path: "summary",
      schema: z.string().min(1),
      prompt: "Write a summary value."
    },
    {
      path: "tags[]",
      count: 2,
      schema: z.string().min(1),
      prompt: ({ path }) => `Write one tag value for ${path}.`
    }
  ]
});

for await (const event of flight.run()) {
  if (event.type === "slot-delta") {
    console.log(event.slot, event.value);
  }

  if (event.type === "done") {
    console.log(event.state);
  }
}
