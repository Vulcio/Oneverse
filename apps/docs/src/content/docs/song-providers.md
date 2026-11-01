---
title: Song providers
description: Find chords and song info at outside servers, set one up as an admin, or run your own to the Song provider API.
---

A **song provider** is a server outside Songverse that has songs: a publisher's catalogue, your church's own library, a converter for another service. Where an admin has connected one, Songverse can look songs up in it: their details and artwork in **Auto detect**, artists' pictures, and their chords and lyrics with **Find chords**. Songverse talks to every provider the same way, the **Song provider API**, so anyone can offer songs by running a server to it.

## Find chords

When a song provider is connected for chords, a song's **Song content** box (on **Song info**, while adding a song) shows **Find chords**, with the providers it looks in. It looks up the song's name; change what it looks for in its box and **Search**. Each result shows its artist, key and provider. **Use this chart** puts its chords and lyrics in the box, as ChordPro: check them, and change anything before you **Save song**. The details you haven't filled in yet - the artist, writers, key, tempo, time signature, CCLI number and copyright - are taken from the provider too. Under the box, a line says where the chart came from, with what the provider says you may do with it.

On a song that exists, the Editor's **Replace from a file or paste…** has **Find chords** too (see [Replacing the chart](/song-editor/#replacing-the-chart)).

Only use a chart you have the rights to: the provider's line says what it allows.

<div data-audience="admin">

## Connecting a provider

In **Admin > Plugins**, the **Song provider** plugin is off until you turn it **On** (or list `song-provider` in the `PLUGINS_ENABLED` environment variable; **Revert to environment variables** goes back to it).

Under **Servers**, **Add a server**:

- **Address**: the provider's address, such as `https://songs.example.com` (with or without `/v1`).
- **Key**: the key the provider gave you, if it needs one. It's kept encrypted with `SETTINGS_ENCRYPTION_KEY` and never shown again; **Edit** takes a new one, or **Remove the saved key**.
- **Name**: left blank, the name the provider gives itself.
- **On this network**: for a provider you run next to Songverse, on a private or local address (`http://192.168.1.20:4100`). Without it, the address must be a public one starting with `https://`.

**Add** asks the provider what it answers first: a provider that doesn't answer, or refuses the key, isn't added, and the page says why. Each server then shows what it's **Asked for**, among what it answers: **Song info**, **Artwork**, **Artists' pictures** and **Chords and lyrics**. Untick one to stop asking it for that, or untick **On** to stop asking it at all. **Test connection** asks it again; the last error it gave, if any, shows under it. Servers are asked in their order: the arrow moves one up.

For song info, artwork and artists' pictures, providers are also listed as **Song providers** in Admin > Metadata (see [Admin](/admin/#server-maintenance)), with the other services, in the order you choose there.

Songverse calls a provider from its server, never from people's browsers, with the same rules as every outside address: no redirects, at most 2 MB an answer, 8 seconds at most. An image is downloaded only from the provider's own address or a music service's image host.

</div>

## Running your own provider

A provider answers five requests, under `/v1`, in JSON, taking the key as `Authorization: Bearer <key>`:

| Request | What it answers |
| --- | --- |
| `GET /v1/capabilities` | Its `name`, the `apiVersion` it speaks (`1`) and what it `provides`: `songInfo`, `artwork`, `artistPictures`, `chords`. |
| `POST /v1/search` | The songs matching a `title` (and `artist`, `language`), at most `limit`: each with its `id`, `title`, `artists`, and `hasContent` when it has chords. |
| `GET /v1/songs/{id}` | A song's details: writers, album, release date, key, tempo, time signature, length, ISRC, CCLI number, artwork, copyright and links. |
| `GET /v1/songs/{id}/content` | Its chords and lyrics: `format` `chordpro` with the ChordPro text, or `song-document/v2` with a SongDocument, and its `copyright` and `rights`. |
| `GET /v1/artists/picture?name=…` | An artist's picture (`url`, `pageUrl`), or 404. |

An error is a 4xx or 5xx status with `{ "error": { "code": "not-found", "message": "…" } }`. Fields Songverse doesn't know are ignored, so a provider can send its own; an answer that doesn't fit is refused whole, and shown to the admin as that provider's error.

The full description is an OpenAPI 3.1 file, [`docs/song-provider-api.json`](https://github.com/Vulcio/Oneverse/blob/main/docs/song-provider-api.json) in Songverse's repository, written from the same schemas Songverse reads answers with. A small example server, with no dependencies, is next to it in [`examples/song-provider/server.mjs`](https://github.com/Vulcio/Oneverse/blob/main/examples/song-provider/server.mjs): run it with `node examples/song-provider/server.mjs`, add `http://localhost:4100` with the key `example-key` and **On this network**, and replace its songs with your own. Songverse's own tests use it as their provider.

## Plugins

A plugin adds a source of songs to Songverse: the Song provider plugin is the first, built into Songverse. Each says what it provides - song info, artwork, artists' pictures, chords and lyrics - and Songverse asks it where those are used: Auto detect, a song's artwork, an artist's page, Find chords. For now every plugin is built in, trusted like the rest of Songverse; installing plugins from elsewhere, each kept apart from the server, comes later.
