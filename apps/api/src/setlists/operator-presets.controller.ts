import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SaveOperatorPresetsDto } from "./dto/setlist.dto.js";
import { OperatorPresetsService } from "./operator-presets.service.js";

/** The operator's named timers and quick messages for a set (issue #358): its owner's, a team's or a person's. */
@ApiTags("setlists")
@ApiBearerAuth()
@Controller("setlists/:setlistId/operator-presets")
export class OperatorPresetsController {
  constructor(private readonly presets: OperatorPresetsService) {}

  @Get()
  @ApiOperation({
    summary: "The operator's named timers and quick messages for a set",
    description: "Its owner's: the team's for a team's set, the person's for their own. `timers` and `messages` are null while they're the built-in ones. `canEdit`: the viewer can edit the set or runs its screens.",
  })
  get(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string) {
    return this.presets.get(user, setlistId);
  }

  @Put()
  @ApiOperation({
    summary: "Change the operator's named timers and quick messages",
    description: "For every set of the same owner. Each left out keeps what's saved; null goes back to the built-in list. For whoever can edit the set or runs its screens.",
  })
  save(@SignedIn() user: AuthenticatedUser, @Param("setlistId") setlistId: string, @Body() dto: SaveOperatorPresetsDto) {
    return this.presets.save(user, setlistId, dto);
  }
}
