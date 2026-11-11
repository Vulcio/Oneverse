import { Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SetlistSharingService } from "./setlist-sharing.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

/** A set's share link, as opened by the person it was sent to. */
@ApiTags("setlists")
@Controller("set-invites")
export class SetInvitesController {
  constructor(private readonly sharing: SetlistSharingService) {}

  /** What the link leads to, so the page can say before sign-in. */
  @Public()
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.sharing.preview(token);
  }

  @ApiBearerAuth()
  @RateLimit("heavy")
  @Post(":token/join")
  join(@SignedIn() user: AuthenticatedUser, @Param("token") token: string) {
    return this.sharing.join(user, token);
  }
}
