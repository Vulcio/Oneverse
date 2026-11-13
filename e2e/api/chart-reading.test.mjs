// A chart read by the server (issue #124), for a device that couldn't: a
// scanned PDF or a photo goes to the Worker, which reads it by OCR the way
// the device would - chords on their syllables, the header taken as the
// song's details, the licence footer left out - and only its sender can
// follow it.
import { API, check, finish, user } from "../lib/harness.mjs";
import { SCANNED_CHART, scannedChartPdf, scannedChartPng } from "../lib/chart-scans.mjs";

const me = await user("Chart reader");
const someone = await user("Someone else");

async function start(who, buffer, name) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), name);
  const res = await fetch(`${API}/chart-reading`, { method: "POST", headers: { Authorization: `Bearer ${who.bearer}` }, body: form });
  return { status: res.status, body: await res.json() };
}

const follow = async (who, id) => {
  const res = await fetch(`${API}/chart-reading/${id}`, { headers: { Authorization: `Bearer ${who.bearer}` } });
  return { status: res.status, body: await res.json() };
};

/** Followed until it's read (or not), as the web app does. */
async function read(id) {
  for (let i = 0; i < 120; i++) {
    const { body } = await follow(me, id);
    if (body.state === "read" || body.state === "failed") return body;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("still reading after two minutes");
}

const png = await scannedChartPng();

const pdf = await start(me, await scannedChartPdf(png), "scan.pdf");
check("a scanned PDF is taken to be read", pdf.status === 201 && typeof pdf.body.id === "string", JSON.stringify(pdf));
const other = await follow(someone, pdf.body.id);
check("someone else can't follow it", other.status === 404, JSON.stringify(other));
const fromPdf = await read(pdf.body.id);
check("it's read by OCR, each chord on its syllable", fromPdf.state === "read" && fromPdf.result.ocr === true && fromPdf.result.chart === SCANNED_CHART, JSON.stringify(fromPdf.result?.chart));
check(
  "its title, names, key, tempo, time, CCLI number and copyright are details",
  fromPdf.result.details.title === "Amazing Grace (My Chains Are Gone)" &&
    fromPdf.result.details.artists.join("|") === "Chris Tomlin|John Newton" &&
    fromPdf.result.details.key === "G" &&
    fromPdf.result.details.tempo === 64 &&
    fromPdf.result.details.timeSignature === "3/4" &&
    fromPdf.result.details.ccli === "4768151" &&
    fromPdf.result.details.copyright === "© 2006 sixsteps Music",
  JSON.stringify(fromPdf.result.details),
);
check("the licence footer is left out", fromPdf.result.dropped.length === 1 && !fromPdf.result.chart.includes("CCLI"), JSON.stringify(fromPdf.result.dropped));

const photo = await start(me, png, "photo.png");
const fromPhoto = await read(photo.body.id);
check("a photo is read the same way", fromPhoto.state === "read" && fromPhoto.result.chart === SCANNED_CHART, JSON.stringify(fromPhoto.result?.chart));

const text = await start(me, Buffer.from("{title: Not a picture}"), "song.cho");
check("a file that's neither a PDF nor a picture is refused", text.status === 400, JSON.stringify(text));

finish();
