import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CreateSignupInvitationSchema, SignupPassSchema } from "@oneverse/core";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { InvitationsService } from "./invitations.service.js";
import { encodePass, PASS_COOKIE, PASS_MAX_AGE_S, passIsValid } from "./signup-gate.js";

class CreateSignupInvitationDto extends zodDto(CreateSignupInvitationSchema) {}
class SignupPassDto extends zodDto(SignupPassSchema) {}

/** Admin > Users' invitations (issue #198). */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/invitations")
@UseGuards(GlobalAdminGuard)
export class AdminInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  list() {
    return this.invitations.list();
  }

  @Post()
  create(@CurrentUser() admin: AuthenticatedUser | undefined, @Body() dto: CreateSignupInvitationDto) {
    if (!admin) throw new UnauthorizedException();
    return this.invitations.create(admin, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string): Promise<void> {
    return this.invitations.remove(id);
  }
}

/** The signed-out side: an invitation's page, and the pass kept for the account made next. */
@ApiTags("auth")
@Controller("auth")
export class SignupPassController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Get("invitations/:token")
  preview(@Param("token") token: string) {
    return this.invitations.preview(token);
  }

  /**
   * Keeps a pass (an invitation, a team's invite link, a set's share link)
   * in a cookie for BetterAuth's routes, where the account is created -
   * also by Google, whose callback lands there. Refused when it doesn't work.
   */
  @Public()
  @RateLimit("heavy")
  @Post("invite-pass")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async keepPass(@Body() dto: SignupPassDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (!(await passIsValid(dto))) throw new NotFoundException("This link doesn't work any more. Ask for a new one.");
    res.cookie(PASS_COOKIE, encodePass(dto), {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.AUTH_URL ?? "").startsWith("https:"),
      path: "/api/auth",
      maxAge: PASS_MAX_AGE_S * 1000,
    });
  }
}
