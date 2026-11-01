import { z } from "zod";
import {
  SONG_PROVIDER_API_VERSION,
  SongProviderArtistPictureSchema,
  SongProviderCapabilitiesSchema,
  SongProviderContentSchema,
  SongProviderErrorSchema,
  SongProviderSearchResultSchema,
  SongProviderSearchSchema,
  SongProviderSongSchema,
  SongProviderSongSummarySchema,
  SongProviderVersionSchema,
} from "./index.js";

/** A schema as JSON Schema 2020-12 (OpenAPI 3.1's dialect), as a server writes it: what it sends. */
const schema = (type: z.ZodType) => {
  const json = z.toJSONSchema(type, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const answer = (description: string, name: string) => ({ description, content: { "application/json": { schema: ref(name) } } });
const errors = {
  "401": answer("No key, or not one it takes.", "Error"),
  "404": answer("It doesn't have that.", "Error"),
  "429": answer("Too many requests: Oneverse tries again later.", "Error"),
  default: answer("Anything else: said to the admin as this provider's error.", "Error"),
};
const songId = { name: "id", in: "path", required: true, description: "The provider's own ID for the song, as its search gave it.", schema: { type: "string", maxLength: 200 } };

/**
 * The Song provider API (issue #157) as an OpenAPI 3.1 description, written
 * from the schemas Oneverse reads answers with - docs/song-provider-api.json
 * is this, and a test keeps the file the same as what's read.
 */
export function songProviderOpenApi(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Song provider API",
      version: `${SONG_PROVIDER_API_VERSION}.0.0`,
      summary: "What a server answers so that Oneverse can look songs up in it.",
      description: [
        "A server to this description can be added in Oneverse's Admin > Plugins > Song provider: Oneverse then asks it for song info (Auto detect), artwork, artists' pictures, and chords with lyrics (Find chords), for the hooks the admin chose among those it answers.",
        "",
        "- Oneverse calls it from its server: over HTTPS on a public address, unless the admin said it's on the same network. It never follows a redirect, reads at most 2 MB of an answer, and waits 8 seconds at most.",
        "- Answers are JSON. Fields Oneverse doesn't know are ignored, so a server can add its own; one that doesn't fit is refused as a whole, never guessed at.",
        "- Images (artwork, pictures) are downloaded by Oneverse's server only from this server's own address (same origin as the address the admin entered) or a music service's image host.",
        "- An example server, dependency-free, is in Oneverse's repository: examples/song-provider/server.mjs.",
      ].join("\n"),
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: "https://songs.example.com", description: "The address an admin enters, without /v1 (with it works too)." }],
    security: [{ bearer: [] }],
    paths: {
      "/v1/capabilities": {
        get: {
          operationId: "capabilities",
          summary: "Who it is and what it answers",
          description: "Asked when the server is added and on Test connection. A hook it doesn't list is never asked.",
          responses: { "200": answer("Its capabilities.", "Capabilities"), ...errors },
        },
      },
      "/v1/search": {
        post: {
          operationId: "search",
          summary: "Songs by title (and artist)",
          description: "For Auto detect, the artwork search and Find chords. Best matches first. For Find chords, only songs with chords are shown: `hasContent: true`, or `versions` listed. Versions are shown under their song, the best rated first, with where each comes from.",
          requestBody: { required: true, content: { "application/json": { schema: ref("SearchRequest") } } },
          responses: { "200": answer("The songs found, possibly none.", "SearchResult"), ...errors },
        },
      },
      "/v1/songs/{id}": {
        get: {
          operationId: "song",
          summary: "A song's details",
          description: "When a match is chosen in Auto detect, and with its chords and lyrics.",
          parameters: [songId],
          responses: { "200": answer("The song.", "Song"), ...errors },
        },
      },
      "/v1/songs/{id}/content": {
        get: {
          operationId: "songContent",
          summary: "A song's chords and lyrics",
          description: "As ChordPro text, or as a SongDocument v2 (https://github.com/Vulcio/Oneverse/blob/main/docs/song-document-v2.md), which Oneverse checks as it checks a stored song. `rights` is shown to the person taking the chart.",
          parameters: [
            songId,
            { name: "version", in: "query", required: false, description: "One of the song's `versions`, by its ID; left out, the song's default chart.", schema: { type: "string", maxLength: 200 } },
          ],
          responses: { "200": answer("The chart.", "Content"), ...errors },
        },
      },
      "/v1/artists/picture": {
        get: {
          operationId: "artistPicture",
          summary: "An artist's picture",
          parameters: [{ name: "name", in: "query", required: true, description: "The artist's name, as songs credit them.", schema: { type: "string", maxLength: 300 } }],
          responses: { "200": answer("Its picture.", "ArtistPicture"), ...errors },
        },
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "The key the admin entered, if any: `Authorization: Bearer <key>`. Kept encrypted by Oneverse." },
      },
      schemas: {
        Capabilities: schema(SongProviderCapabilitiesSchema),
        SearchRequest: schema(SongProviderSearchSchema),
        SongSummary: schema(SongProviderSongSummarySchema),
        SearchResult: schema(SongProviderSearchResultSchema),
        Song: schema(SongProviderSongSchema),
        Version: schema(SongProviderVersionSchema),
        Content: schema(SongProviderContentSchema),
        ArtistPicture: schema(SongProviderArtistPictureSchema),
        Error: schema(SongProviderErrorSchema),
      },
    },
  };
}
