---
title: The song editor
description: Write and edit a chart with chords over the lyrics, organise its sections, and set the order it's sung in.
---

Open a song and choose the **Editor** tab.

![The song editor](../../assets/screenshots/en/song-editor.jpg)

The editor's toolbar stays at the top of the screen as you scroll. It has the editor's three modes on the left, then **Undo**, **Redo** and the note line, then the song's **Key**, **Transpose**, **Tempo**, **Time** and **Capo**. Its buttons never move as you use them: press **Transpose** + again and again, or **Undo**, without looking. A tool that doesn't apply in a mode is greyed out there rather than taken away.

The three modes:

- **Visual** - the chart with chords sitting over the words. This is where you'll spend most of your time.
- **Text** - the same chart as ChordPro text, for quick bulk edits. Chords and lines you don't change stay as they were.
- **Preview** - the chart as players will see it. On a wide screen it's also shown beside **Visual** and **Text**, updated as you type.

## Chords

- **Type a chord** in square brackets where it's played: `[G]Amazing grace`.
- **Move a chord** by dragging it onto another letter, or select it and use the ← → arrow keys.
- **Click a chord** to change it (with suggestions from the song's key and variations like `G7` or `Gsus4`) or delete it.
- The palette on the left lists the **chords in the song's key** (with their degree: I, IV, V…) and the chords **In this song**. Click one to add it at the cursor, or drag it onto a word. **Another chord** adds any other.

Editing the words keeps the chords with them: typing before a chord carries it along, and deleting words that carry chords leaves the chords where the words were, so you can place them again. Enter splits a line and its chords go with their words.

## Sections

Each block is a section: intro, verse, pre-chorus, chorus, post-chorus, bridge, vamp (a phrase repeated as long as needed), breakdown, instrumental, interlude, outro or tag.

- **Add a section** from the palette's **Sections** list: a click adds it after the section you're in; on a computer, drag it instead to drop it between any two sections (a line shows where it will go).
- Change a section's **type** or **label** ("Verse 2") at its top. The eye button, with the section's tools at the right of its heading, hides its label ("Chorus") on the chart in Practice and Live.
- The **⋯** menu moves, duplicates (linked or as a unique copy, see [Linked copies](/song-editor/#linked-copies)), takes out of the song order or deletes it.
- A line can be a **note for the band** ("×2, build") rather than lyrics.

## Key and transposing

Set the song's **Key** in the toolbar. **Transpose** − and + move every chord and the key by a semitone; **Undo** puts both back. **Tempo**, **Time** and **Capo** are the song's, the same as in the **Song info** tab, and are saved with it.

On a phone, the bar at the bottom of the screen always has **Save song**: greyed out until there's something to save.

## The song order

The **Song order** above the chart is the order the song is sung in, each time through a section being a *pass*.

![The song order](../../assets/screenshots/en/song-order.jpg)

- **+ Sing…** adds a pass: the chorus again, say.
- **Choose a pass** to label it ("Final chorus"), change key for it, add a note for the band, move it earlier or later, sing it again right after, or remove it.
- **Drag passes** to reorder them.
- **Follow the sections** goes back to singing each section once, in order.

Key changes and notes show on the chart at that pass.

### Linked copies

The editor shows the song in the order it's sung. A section's first appearance is the block you edit; wherever it's sung again, it's a **linked copy** - marked with a link, "Linked to Chorus", locked - that follows the section: change the section and every copy shows it.

- **Duplicate (linked)** in a section's menu adds a copy of it right after; **Duplicate (unique copy)** adds an independent section instead. In a copy's menu, **Duplicate (linked)** adds another copy with the same changes, still linked to the section, not to the copy. Moving blocks up and down (their menu) changes the order they're sung in, as does the **Song order** above.
- When the editor has room, the arrows to move a block up and down and its duplicates are also at the right of its heading, beside its menu: on a section, **Duplicate (linked)** (the link) and **Duplicate (unique copy)** (the copy icon); on a linked copy, **Duplicate (linked)** (the copy icon).
- **− / +** in a copy's heading transposes that copy alone (a key change, in Song order, carries on to the end of the song).
- **Edit this copy** opens its changes, which stay differences from the section, so it keeps following it: **Leave the line out**, change its words (removed words show greyed out and struck through, new ones highlighted, and the chords follow their words), or type another chord over one (written in the song's key) or leave it out with the eye button. **Done** locks it again.
- A changed copy shows **\*** in its heading, in the song order and on the chart. **As the section is written** (its menu) takes the changes away; **Make unique** turns it into a section of its own, its changes written in - it no longer follows the original.
- **Take out of the song order** (a section's menu) moves a section to the end, under **Not in the song order**, with its copies; **Put back in the song order** brings it back.

If a line or chord a copy changes is deleted from the section, the chart says so rather than dropping it. Exported to ChordPro, a changed copy is written out in full.

### Repeated sections

A file read in (a new song, a pasted or uploaded chart) links what it writes out again: a chorus written a second time is a linked copy of the first - also when it's a few semitones up or down (a transposed copy), when a third of its chords at most are different (a copy with those chords of its own), or when it's only the chorus's last lines.

A song written before keeps its sections twice. Above the editor, its editors see what repeats - "Chorus 2 is Chorus with 1 chord of its own", "Last chorus is Chorus, 2 semitone(s) up" - and **Link** each, or **Link all**: the repeat becomes a linked copy of the section, keeping its name. Arrangements and recordings' cue points follow, and the song's **History** can undo it. Save your changes first.

## Pasting a chart

Paste a whole chart anywhere - ChordPro, or chords written above the lyrics - and it's turned into sections with chords in place. Pasting plain words just types them. Section names on a line of their own ("Verse 1", "[Chorus]", "Refrain", "Pont", "Coro") start a section of that kind, in English, French, Spanish, German, Italian or Portuguese.

## Saving

**Save song** saves the chart and the song's details together. If someone else saved the song after you opened it, Songverse tells you instead of overwriting their changes.

## History

The **History** tab lists every save of the song, newest first: who saved it, when, and what changed - the **chart**, the **details** (title, key, rights…) or the **credits**. Saves by the same person a few minutes apart count as one step.

![A song's history](../../assets/screenshots/en/song-history.jpg)

Choose a step to see what it changed: details and credits with the old value struck out and the new one beside it, and the chart's lines removed and added. **Show the whole song as it was** shows the song at that step.

If you can edit the song, **Restore this** puts its chart, details and credits back as they were at that step. It's saved like any other change, so it shows in the history and can itself be undone. Tags, files, links and versions aren't part of the history and stay as they are. Save or discard your own changes before restoring.

Songs created before the history was kept start with **Before the history was kept**: the song as it was then.
