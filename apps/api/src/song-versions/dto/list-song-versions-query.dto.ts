import { ListSongVersionsQuerySchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

/** GET /song-versions: one page of the songs you can see, optionally searched and filtered. */
export class ListSongVersionsQueryDto extends zodDto(ListSongVersionsQuerySchema) {}
