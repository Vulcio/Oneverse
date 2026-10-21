import type { DisplayColumnsValue } from "@oneverse/core";

/**
 * How many columns a chart flows into (issue #177): as many as fit (auto),
 * or 1, 2 or 3 - newspaper-style, a section never split between two. Each
 * mode keeps its own, in the Display panel (issue #209).
 */
export type ChartColumns = DisplayColumnsValue;
