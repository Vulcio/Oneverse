import { CONFORMANCE, type ConformanceArea } from "./suites.js";
import { CONFORMANCE_SCHEMA, THROWS, normalizeIds, toJson, type ConformanceFile } from "./format.js";

export * from "./format.js";
export { CONFORMANCE, type ConformanceArea } from "./suites.js";

/** One case's answer from this implementation, as the files hold it. */
export function answer(run: (...args: unknown[]) => unknown, args: unknown[]): unknown {
  let result: unknown;
  try {
    // The arguments as JSON, as another implementation reads them from the file.
    result = run(...(JSON.parse(JSON.stringify(args)) as unknown[]));
  } catch {
    return THROWS;
  }
  return normalizeIds(toJson(result) ?? null, args);
}

/** An area's file, its answers worked out now. */
export function conformanceFile(area: ConformanceArea): ConformanceFile {
  return {
    $schema: CONFORMANCE_SCHEMA,
    area: area.area,
    about: area.about,
    functions: Object.fromEntries(
      Object.entries(area.functions).map(([name, fn]) => [
        name,
        { about: fn.about, params: fn.params, cases: fn.cases.map((c) => ({ name: c.name, args: c.args, expected: answer(fn.run, c.args) })) },
      ]),
    ),
  };
}

/** Every area's file, by file name. */
export function conformanceFiles(): Record<string, ConformanceFile> {
  return Object.fromEntries(CONFORMANCE.map((area) => [`${area.area}.json`, conformanceFile(area)]));
}
