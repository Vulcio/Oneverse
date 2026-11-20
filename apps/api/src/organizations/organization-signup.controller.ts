import { Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Query, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { AddressSuggestion } from "@oneverse/core";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { organizationSignupOpen, passCookie } from "../invitations/signup-gate.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { OrganizationSignupDto } from "./dto/organization-request.dto.js";
import { findLookalikes, keepSignupDraft } from "./organization-signup.js";
import { suggestAddresses } from "./address-lookup.js";
import { AddressSuggestionsQueryDto } from "./dto/organization-request.dto.js";
import { getEffectiveOrganizationSettings } from "./organization-settings.js";
import { assertNotLookalike } from "./organizations.service.js";

/**
 * Signing up by asking for an organisation (issue #533): signed out, the
 * organisation first - checked for look-alikes as in the app - then kept
 * for the account made next (a pass in a cookie, as an invitation's), which
 * waits for a global admin to approve it.
 */
@ApiTags("auth")
@Controller("auth")
export class OrganizationSignupController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @RateLimit("heavy")
  @Post("organization-signup")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: "Kept for the account made next (an hour). 409 ORGANIZATION_EXISTS when it's already here or asked for, ORGANIZATION_LOOKS_LIKE when it looks like one, unless duplicateNote says why it isn't." })
  async keep(@Body() dto: OrganizationSignupDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (!(await organizationSignupOpen())) throw new ForbiddenException("Sign-up by asking for an organisation isn't open here");
    assertNotLookalike(await findLookalikes(this.prisma.client, dto), dto.duplicateNote);
    const token = await keepSignupDraft(dto);
    res.cookie(...passCookie({ kind: "request", token }));
  }

  /** Addresses like what's typed, for an organisation's address (signed in or not); none when the lookup is off (Admin > Organisations). */
  @Public()
  @Get("address-suggestions")
  @ApiOkResponse({ description: "Up to 5 addresses: France's from the Base Adresse Nationale, elsewhere OpenStreetMap's through Photon. Empty when the lookup is off or doesn't answer." })
  async addressSuggestions(@Query() query: AddressSuggestionsQueryDto): Promise<AddressSuggestion[]> {
    if ((await getEffectiveOrganizationSettings()).mode !== "MULTI") return [];
    return suggestAddresses(query.q, query.country, query.lang);
  }
}
