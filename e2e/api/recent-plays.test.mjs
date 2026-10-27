// How often a song was played in a team's sets lately, and the team's limit (issue #335): a warning, never a block.
import { stamp, sql, check, user, call, finish } from "../lib/harness.mjs";

const isoDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const admin = await user("admin");
const member = await user("member");

const team = (await call(admin, "POST", "/teams", { name: `Plays Team ${stamp}` })).body;
sql(`insert into "TeamMembership" (id, "teamId", "userId", role, "joinedAt", "updatedAt") values ('tm${stamp}', '${team.id}', '${member.id}', 'MEMBER', now(), now())`);
const song = (await call(admin, "POST", "/song-versions", { artists: ["Test Artist"], title: `Often ${stamp}`, language: "en", teamId: team.id })).body;
const fresh = (await call(admin, "POST", "/song-versions", { artists: ["Test Artist"], title: `Fresh ${stamp}`, language: "en", teamId: team.id })).body;

// A set the team played, `daysAgo` days ago, with the song in it.
const played = async (daysAgo) => {
  const set = (await call(admin, "POST", "/setlists", { name: `Played ${daysAgo} ${stamp}`, eventDate: isoDate(2), teamId: team.id })).body;
  await call(admin, "POST", `/setlists/${set.id}/items`, { songVersionId: song.id });
  sql(`update "Setlist" set "eventDate"='${isoDate(-daysAgo)}' where id='${set.id}'`);
  return set;
};
await played(7);
await played(14);
await played(100); // Before the window, even at ten weeks.
const next = (await call(admin, "POST", "/setlists", { name: `Next ${stamp}`, eventDate: isoDate(5), teamId: team.id })).body;
// A personal set's plays aren't the team's.
const mine = (await call(admin, "POST", "/setlists", { name: `Mine ${stamp}`, eventDate: isoDate(1) })).body;

let r = await call(admin, "GET", `/teams/${team.id}`);
check("a team counts six weeks by default, with no limit", r.body.repeatWeeks === 6 && r.body.repeatLimit === null, JSON.stringify({ weeks: r.body.repeatWeeks, limit: r.body.repeatLimit }));

r = await call(admin, "GET", `/setlists/for-song/${song.id}`);
let plays = r.body.find((set) => set.id === next.id)?.recentPlays;
check("for a team set: played twice in six weeks, last a week ago", plays?.count === 2 && plays.last === isoDate(-7) && plays.weeks === 6 && plays.limit === null, JSON.stringify(plays));
check("a personal set says nothing about plays", r.body.find((set) => set.id === mine.id)?.recentPlays === undefined);

r = await call(member, "PATCH", `/teams/${team.id}`, { repeatLimit: 2 });
check("only the team's admins set its limit", r.status === 403, String(r.status));
r = await call(admin, "PATCH", `/teams/${team.id}`, { repeatLimit: 0 });
check("a limit is at least 1", r.status === 400, JSON.stringify(r.body));
r = await call(admin, "PATCH", `/teams/${team.id}`, { repeatLimit: 2, repeatWeeks: 10 });
check("the team's admin sets the window and the limit", r.status === 200 && r.body.repeatLimit === 2 && r.body.repeatWeeks === 10, JSON.stringify(r.body));

r = await call(admin, "POST", `/setlists/${next.id}/items`, { songVersionId: song.id });
check("a song over the limit can still be added", r.status === 201 || r.status === 200, String(r.status));
await call(admin, "POST", `/setlists/${next.id}/items`, { songVersionId: fresh.id });

r = await call(member, "GET", `/setlists/${next.id}`);
const often = r.body.items.find((item) => item.song?.id === song.id);
const other = r.body.items.find((item) => item.song?.id === fresh.id);
check("in the set, the song shows its plays against the limit (the set itself not counted)", often?.recentPlays?.count === 2 && often.recentPlays.limit === 2 && often.recentPlays.weeks === 10, JSON.stringify(often?.recentPlays));
check("a song not played lately says so", other?.recentPlays?.count === 0 && other.recentPlays.last === null, JSON.stringify(other?.recentPlays));

r = await call(admin, "PATCH", `/teams/${team.id}`, { repeatWeeks: 1 });
r = await call(admin, "GET", `/setlists/${next.id}`);
check("a shorter window counts fewer plays", r.body.items.find((item) => item.song?.id === song.id)?.recentPlays?.count === 1);

r = await call(admin, "PATCH", `/teams/${team.id}`, { repeatLimit: null });
check("the limit can be turned off", r.status === 200 && r.body.repeatLimit === null, JSON.stringify(r.body));

r = await call(admin, "GET", `/setlists/${mine.id}`);
check("a personal set's songs carry no plays", r.status === 200 && r.body.items.every((item) => item.recentPlays === undefined));

finish();
