import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AddQuickSelectionDto } from "./dto/setlist.dto.js";
import { QuickSelectionService } from "./quick-selection.service.js";
import { requireUser } from "./setlists.controller.js";

/** Someone's Quick selection (issue #334): songs gathered, then added to a set at once. Each answers the selection as it now is. */
@ApiTags("setlists")
@ApiBearerAuth()
@Controller("quick-selection")
export class QuickSelectionController {
  constructor(private readonly quick: QuickSelectionService) {}

  @Get()
  @ApiOperation({ summary: "The user's Quick selection", description: "Its songs, in the order they were gathered." })
  get(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.quick.get(requireUser(user));
  }

  @Put("songs/:songVersionId")
  @ApiOperation({ summary: "Put a song in the Quick selection", description: "A song already in it stays where it is." })
  add(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string) {
    return this.quick.add(requireUser(user), songVersionId);
  }

  @Delete("songs/:songVersionId")
  @ApiOperation({ summary: "Take a song out of the Quick selection" })
  remove(@CurrentUser() user: AuthenticatedUser | undefined, @Param("songVersionId") songVersionId: string) {
    return this.quick.remove(requireUser(user), songVersionId);
  }

  @Delete()
  @ApiOperation({ summary: "Empty the Quick selection" })
  clear(@CurrentUser() user: AuthenticatedUser | undefined) {
    return this.quick.remove(requireUser(user));
  }

  @Post("add-to/:setlistId")
  @ApiOperation({
    summary: "Add the Quick selection's songs to a set",
    description:
      "At the end of a set the user can change, in the order they were gathered. `skipped` lists those already in the set (`in-set`) and those that can't go in it (`not-addable`); the songs now in the set leave the selection unless `keep`. Answers `added`, `skipped`, the set and the selection.",
  })
  addTo(@CurrentUser() user: AuthenticatedUser | undefined, @Param("setlistId") setlistId: string, @Body() dto: AddQuickSelectionDto) {
    return this.quick.addTo(requireUser(user), setlistId, dto.keep ?? false);
  }
}
