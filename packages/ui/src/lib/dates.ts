import { createContext, useContext } from "react";
import type { Locale } from "react-day-picker";
import { enUS, fr } from "react-day-picker/locale";

/**
 * Calendar days ("YYYY-MM-DD") and the calendar's Dates, which are local
 * midnights: converted by their local fields, so no time zone moves a day.
 */
export function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function fromDayKey(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The calendar's months, day names and first day of the week, in the app's language. */
export function calendarLocale(language: string): Locale {
  return language.startsWith("fr") ? fr : enUS;
}

/** The signed-in person's first day of the week (issue #235), for every calendar; null: their language's. */
export const WeekStartContext = createContext<0 | 1 | 6 | null>(null);

export function useWeekStart(): 0 | 1 | 6 | null {
  return useContext(WeekStartContext);
}
