/**
 * Which database dumps a backup keeps (issue #119): the newest of each of the
 * last `daily` days that have one, of the last `weekly` ISO weeks, and of the
 * last `monthly` months - by default 7, 4 and 12. The newest is always kept.
 * Pure, so it's tested on its own.
 */
export interface Dump {
  key: string;
  at: Date;
}

export interface Keep {
  daily: number;
  weekly: number;
  monthly: number;
}

const day = (at: Date) => at.toISOString().slice(0, 10);
const month = (at: Date) => at.toISOString().slice(0, 7);
/** ISO 8601 week, "2026-W44": weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(at: Date): string {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function dumpsToKeep(dumps: Dump[], keep: Keep): Set<string> {
  const newestFirst = [...dumps].sort((a, b) => b.at.getTime() - a.at.getTime());
  const kept = new Set<string>();
  if (newestFirst[0]) kept.add(newestFirst[0].key);
  const pick = (period: (at: Date) => string, count: number) => {
    const seen = new Set<string>();
    for (const dump of newestFirst) {
      const id = period(dump.at);
      if (seen.has(id)) continue;
      if (seen.size >= count) break;
      seen.add(id);
      kept.add(dump.key);
    }
  };
  pick(day, keep.daily);
  pick(isoWeek, keep.weekly);
  pick(month, keep.monthly);
  return kept;
}

/** A dump's key in the bucket: `db/2026-10-31T03-00-12Z.dump.enc`, after the prefix. */
export function dumpKey(at: Date): string {
  return `db/${at.toISOString().slice(0, 19).replace(/:/g, "-")}Z.dump.enc`;
}

/** When a dump was made, from its key; null for anything else in db/. */
export function dumpTime(key: string): Date | null {
  const match = /db\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump\.enc$/.exec(key);
  return match ? new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`) : null;
}
