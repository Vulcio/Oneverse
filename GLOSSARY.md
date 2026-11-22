# Oneverse

Oneverse is a family of apps for churches and other groups that make music and run events together: one account,
one server, several apps that share people, teams, songs, sets and screens. This glossary is the one vocabulary
for all of them, in the app, the docs, issues and code reviews. Decisions behind it are in [docs/adr/](docs/adr/).

## Products

**Oneverse**:
The whole product family and the one account people sign in with.
_Avoid_: Songverse (for the whole product, its name before 2026-10-21)

**Oneverse home**:
The app people land in after signing in, at app.oneverse.top: their organisations, teams, news and the apps they can open.
_Avoid_: hub, account app, Oneverse (alone, for this app)

**Songverse**:
The musicians' app: songs, songbooks, sets, practice and Live.
_Avoid_: Oneverse (for this app), the web app

**Oneverse Plan**:
The planning app: calendars, events, line-ups and organisations' groups, on its own at plan.oneverse.top.
_Avoid_: Planiverse (its name until 2026-11-20)

**Slideverse**:
The presentation app, planned: slide decks shown on the same screens and in the same live sessions as songs.

**Oneverse Screen**:
The native display app for TVs (Android TV first) that opens the screen page or shows an NDI source.
_Avoid_: screen app (for this app)

**Oneverse Pulse**:
The box at the venue that keeps a live session and its screens running when the internet goes.
_Avoid_: the player, songverse-player, Songverse Player

**Songverse Sonic**:
The server that splits recordings into stems and analyses them (tempo, beats, key, sections, chords); a separate project other clients can use.
_Avoid_: Demucs server, stem server

## People and groups

**Account**:
One person's sign-in, the same in every Oneverse app.
_Avoid_: user (in what people read)

**Profile**:
How a person appears to others: name, picture, what they play or do.

**Organisation**:
A church, club or school that teams are part of, and that plans events across them.
_Avoid_: org, church (as a term), workspace

**Team**:
People who work together and share what the team owns: a band, a welcome team, a kids' service. A team may stand alone or be part of an organisation, and may sit under another team.
_Avoid_: group (for a team), worship team (as a term)

**Planning-only team**:
A team that plans events but has no songs, songbooks or sets of its own.

**Admin**:
A member who runs a team or an organisation; **server admin** for whoever runs the whole server.
_Avoid_: owner (for a person running a team), global admin (in what people read)

**Role**:
A named set of rights given to people and teams beyond their own content: review songs, split stems, run screens.
_Avoid_: permission, capability (in what people read)

**Position**:
A job a team's members cover besides their instruments: Greeter, Coffee, Host.
_Avoid_: role (for a job at an event)

**Part**:
What an event needs filled: an instrument or a position, and how many.
_Avoid_: role (for this), slot

## Songs

**Work**:
The composition every version of a song shares, whatever its language or edition.
_Avoid_: song (for this), composition

**Song**:
One written version of a work: its title, chart, credits and files, in one language, owned by a person, a team or the catalogue.
_Avoid_: song version (in what people read), track

**Version** (of a song):
Another song of the same work: a translation, a live edit, a radio edit.
_Avoid_: version (for an arrangement)

**Arrangement**:
How a song is played: its order, key, capo, tempo and changes per pass, pointing at the song's own sections, never a copy of it.
_Avoid_: version (for this), copy

**Usual arrangement**:
The arrangement a team picks by default when the song goes in one of its sets.
_Avoid_: default arrangement

**Chart**:
A song's music as written: its sections, lines, words, chords and the order it's sung in.
_Avoid_: lyrics (for the whole chart), lead sheet, chord sheet

**Section**:
A named part of a chart: Verse 1, Chorus, Bridge.

**Song order**:
The sequence the sections are sung in, repeats included.
_Avoid_: flow (in what people read), roadmap, structure

**Songbook**:
A collection of songs, numbered like a printed book or not.
_Avoid_: library (for a songbook)

**Library**:
Every song a person can open: their own, their teams', shared with them, and the catalogue's.

**Catalogue**:
The server's shared songs, open to everyone, that a reviewer checked before they joined it.
_Avoid_: global songs, public library

**Stems**:
A recording's parts on their own (vocals, drums, bass…), split by Songverse Sonic or uploaded.
_Avoid_: tracks, multitracks (for split stems)

**Multitrack**:
Stems recorded or uploaded together for one song, played in the stem player.

## Sets and events

**Set**:
An ordered list of items prepared for one occasion, owned by a person or a team.
_Avoid_: setlist, playlist, service order

**Set item**:
One entry of a set: a song (with its arrangement), slides of text, or a Bible passage.
_Avoid_: entry, element

**Event**:
Something a team or an organisation holds on a date: a service, a rehearsal, a meeting; it may repeat.
_Avoid_: service (as a term), occurrence

**Event date**:
One occurrence of an event, with its answers, its line-up and maybe its set.

**Event type**:
A kind of event a team or an organisation holds, with what it usually needs: Service, Rehearsal, Meeting.
_Avoid_: preset (for this), template (for this)

**Line-up**:
Who is on for an event date, in which part.
_Avoid_: rota, roster, assignment (in what people read)

**Open place**:
A part of an event date that members of other teams may take.

## Screens

**Screen**:
A display paired to show sets: a TV, a projector, a stage monitor, a stream output.
_Avoid_: display, output (as a term), receiver

**Pairing**:
One link between a screen and a person, team or organisation, made with the code the screen shows; a screen can hold several and switch between them.
_Avoid_: profile (for this)

**Template**:
How a screen shows a set's content: its widgets and layout, and the presets for words, background and effects.
_Avoid_: theme, screen theme, look

**Preset**:
A saved, reusable setting for one side of a template: the words, the background or the effects; built in or a team's own.
_Avoid_: part, content theme, background theme

**Widget**:
Something a template shows besides the words: a clock, a logo, a title, a timer.

**Brand**:
A team's or organisation's logos, colours, fonts and links, for templates and widgets to use.

**Layer**:
One level of what a screen shows (background, words, widgets, messages), that can be hidden or cleared on its own.

**Operator**:
Whoever runs the screens during a live session, from the operator console or Live.
_Avoid_: tech, media person

## Live

**Live**:
Songverse's page for playing a set on stage, song after song.
_Avoid_: stage view, performance mode

**Live session**:
One running of a set, live: what plays, what the screens show and who controls them, shared by every device in it until it ends.
_Avoid_: sync session, room, sync play (for the session itself)

**Sync play**:
Devices in a live session playing in time with the leader: the metronome, the song open and the stems.
_Avoid_: sync, follow mode

**Leader**:
The person a live session follows for what plays: song, tempo, stems.
_Avoid_: master, host (for this)

**Presenting**:
What a live session's screens show right now: an item and its slide, or black.
_Avoid_: projecting, casting

**Presenter**:
Someone who may move what the screens show in a live session.

**Slide**:
What a screen shows at once of a set item: a few lines of a song, a paragraph of text, a few verses.

**Takeover**:
Oneverse Pulse running a live session at the venue while the internet is gone, and handing it back after.
_Avoid_: failover, offline mode (for this)
