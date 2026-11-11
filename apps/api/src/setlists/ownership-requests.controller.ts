import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { SongOwnershipService } from "./song-ownership.service.js";

/** Teams asking for songs you own (see SongOwnershipService). */
@ApiTags("setlists")
@ApiBearerAuth()
@Controller("ownership-requests")
export class OwnershipRequestsController {
  constructor(private readonly ownership: SongOwnershipService) {}

  @Get()
  incoming(@SignedIn() user: AuthenticatedUser) {
    return this.ownership.incoming(user);
  }

  @Post(":requestId/accept")
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(@SignedIn() user: AuthenticatedUser, @Param("requestId") requestId: string): Promise<void> {
    return this.ownership.accept(user, requestId);
  }

  @Post(":requestId/decline")
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@SignedIn() user: AuthenticatedUser, @Param("requestId") requestId: string): Promise<void> {
    return this.ownership.decline(user, requestId);
  }
}
