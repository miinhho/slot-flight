import type {
  MaybePromise,
  SlotFlightRequest,
  SlotGenerator
} from "../types.js";

export type ChunkStreamFactory<TChunk> = (
  request: SlotFlightRequest
) => MaybePromise<AsyncIterable<TChunk>>;

export type ChunkTextExtractor<TChunk> = (
  chunk: TChunk,
  request: SlotFlightRequest
) => string | null | undefined;

export interface ChunkStreamGeneratorOptions<TChunk> {
  stream: ChunkStreamFactory<TChunk>;
  text: ChunkTextExtractor<TChunk>;
}

export function createChunkStreamGenerator<TChunk>({
  stream,
  text
}: ChunkStreamGeneratorOptions<TChunk>): SlotGenerator {
  return async function* chunkStreamGenerator(request) {
    const chunks = await stream(request);

    for await (const chunk of chunks) {
      const value = text(chunk, request);
      if (value !== undefined && value !== null && value.length > 0) {
        yield value;
      }
    }
  };
}

export function createTextStreamGenerator(
  stream: ChunkStreamFactory<string>
): SlotGenerator {
  return createChunkStreamGenerator({
    stream,
    text: (chunk) => chunk
  });
}
