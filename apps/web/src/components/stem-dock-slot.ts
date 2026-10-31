import { createContext } from "react";

/** Where a song's stem player (and its YouTube video) dock: the bottom of the app shell (issue #64). Its own module so the shell needn't load the player to give it. */
export const StemDockSlot = createContext<HTMLElement | null>(null);
