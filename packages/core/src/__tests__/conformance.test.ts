import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { CONFORMANCE, THROWS, answer, differs, normalizeIds, type ConformanceFile } from "../conformance/index.js";

// The shared test cases (issue #170): this implementation against the
// files every implementation runs, and the files against the cases.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../conformance");
const REGENERATE = "run pnpm --filter @oneverse/core conformance and review the diff";

describe("the conformance files", () => {
  it("are one per area, no more", () => {
    expect(readdirSync(dir).filter((name) => name.endsWith(".json")).sort(), REGENERATE).toEqual(CONFORMANCE.map((area) => `${area.area}.json`).sort());
  });

  for (const area of CONFORMANCE) {
    describe(area.area, () => {
      const file = JSON.parse(readFileSync(path.join(dir, `${area.area}.json`), "utf8")) as ConformanceFile;
      it("has every function's cases, as written in suites.ts", () => {
        const listed = Object.fromEntries(Object.entries(area.functions).map(([name, fn]) => [name, fn.cases.map((c) => ({ name: c.name, args: c.args }))]));
        const inFile = Object.fromEntries(Object.entries(file.functions).map(([name, fn]) => [name, fn.cases.map((c) => ({ name: c.name, args: c.args }))]));
        expect(inFile, REGENERATE).toEqual(JSON.parse(JSON.stringify(listed)));
      });
      for (const [name, fn] of Object.entries(area.functions)) {
        for (const c of file.functions[name]?.cases ?? []) {
          it(`${name}: ${c.name}`, () => {
            const found = differs(answer(fn.run, c.args), c.expected);
            expect(found, `${found} - if the change is meant, ${REGENERATE}`).toBeNull();
          });
        }
      }
    });
  }
});

describe("normalizeIds", () => {
  it("numbers the IDs made while answering, keeps the ones given", () => {
    const made = "sec_0123456789abcdef";
    expect(normalizeIds({ id: made, flow: `fi_0123456789abcdef`, kept: "sec_verse", [made]: 1 }, [{ id: "sec_verse" }])).toEqual({ id: "sec_@1", flow: "fi_@1", kept: "sec_verse", "sec_@1": 1 });
  });
  it("a failure is the same answer whatever it says", () => {
    expect(answer(() => {
      throw new Error("any message");
    }, [])).toEqual(THROWS);
  });
});
