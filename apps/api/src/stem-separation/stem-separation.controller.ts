import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { SaveSonicServerSchema, SaveStemSeparationSettingsSchema, StartStemSeparationSchema } from "@songverse/core";
import { decryptSecret } from "@songverse/secret-crypto";
import { AccessPolicyService } from "../access/access-policy.service.js";
import type { Request } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { zodDto } from "../common/zod-validation.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimit } from "../security/rate-limit.decorator.js";
import { testDemucs } from "./demucs-client.js";
import { listSonicServers, ownServersPolicy, removeSonicServer, saveSonicServer, SonicServerInputError, sonicServerSummary, type SonicServerOwner } from "./sonic-servers.js";
import { StemSeparationService } from "./stem-separation.service.js";
import { clearStemSeparationSettings, getEffectiveStemSeparationSettings, getStemSeparationSummary, saveStemSeparationSettings } from "./stem-separation-settings.js";

class StartStemSeparationDto extends zodDto(StartStemSeparationSchema) {}
class SaveStemSeparationSettingsDto extends zodDto(SaveStemSeparationSettingsSchema) {}
class SaveSonicServerDto extends zodDto(SaveSonicServerSchema) {}

/** Test connection: its health (what it is, its version), what it offers, with the key; whether it finds beats and bars (API 1.5, issue #299). */
async function testServer(settings: Parameters<typeof testDemucs>[0]) {
  try {
    const result = await testDemucs(settings);
    const version = typeof result.health.version === "string" ? result.health.version : null;
    const [major = 0, minor = 0] = (version ?? "").split(".").map(Number);
    return { ok: true as const, ...result, version, beats: version ? major > 1 || (major === 1 && minor >= 5) : null };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
/** Where the Demucs API's webhooks come: this API's own address (AUTH_URL); null without one (then the Worker only polls). */
function callbackUrl(): string | null {
  const own = process.env.AUTH_URL?.replace(/\/+$/, "");
  return own ? `${own}/stem-separation/callback` : null;
}

/** Splitting a song's recordings into stems (issue #63). */
@ApiTags("stem-separation")
@ApiBearerAuth()
@Controller()
export class StemSeparationController {
  constructor(private readonly separations: StemSeparationService) {}

  @Get("song-versions/:songVersionId/stem-separations")
  @ApiOkResponse({ description: "Whether the viewer may split the song's recordings (or why not), and its separations: theirs, or all for who may." })
  list(@Param("songVersionId") songVersionId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.separations.list(user, songVersionId);
  }

  @RateLimit("heavy")
  @Post("song-versions/:songVersionId/attachments/:attachmentId/separate")
  start(@Param("songVersionId") songVersionId: string, @Param("attachmentId") attachmentId: string, @Body() dto: StartStemSeparationDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.separations.start(user, songVersionId, attachmentId, dto.parts, callbackUrl(), dto.replace ?? false);
  }

  @RateLimit("heavy")
  @Post("stem-separations/:separationId/retry")
  @HttpCode(HttpStatus.NO_CONTENT)
  retry(@Param("separationId") separationId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.separations.retry(user, separationId, callbackUrl());
  }

  /** The instance's Sonic server's signed webhook (X-Demucs-Signature over the raw body). */
  @Public()
  @RateLimit("none")
  @ApiExcludeEndpoint()
  @Post("stem-separation/callback")
  @HttpCode(HttpStatus.NO_CONTENT)
  callback(@Req() req: Request & { rawBody?: Buffer }, @Headers("x-demucs-signature") signature: string | undefined) {
    return this.separations.callback(req.rawBody, signature);
  }

  /** A team's or an organisation's Sonic server's (issue #300), checked with its own secret. */
  @Public()
  @RateLimit("none")
  @ApiExcludeEndpoint()
  @Post("stem-separation/callback/:serverId")
  @HttpCode(HttpStatus.NO_CONTENT)
  serverCallback(@Param("serverId") serverId: string, @Req() req: Request & { rawBody?: Buffer }, @Headers("x-demucs-signature") signature: string | undefined) {
    return this.separations.callback(req.rawBody, signature, serverId);
  }
}

/**
 * A team's or an organisation's own Songverse Sonic server (issue #300),
 * for its admins, when Admin > Stem separation allows them: what's
 * connected (never its key), connecting or changing it, a test, and
 * disconnecting it.
 */
@ApiTags("stem-separation")
@ApiBearerAuth()
@Controller()
export class SonicServersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
  ) {}

  private async admin(user: AuthenticatedUser | undefined, owner: SonicServerOwner): Promise<SonicServerOwner> {
    if (!user) throw new UnauthorizedException();
    if (owner.kind === "team") {
      if (!(await this.prisma.client.team.count({ where: { id: owner.id } }))) throw new NotFoundException("Team not found");
      if (!user.isGlobalAdmin && (await this.access.teamRole(user.id, owner.id)) !== "ADMIN") throw new ForbiddenException("Only the team's admins connect its Sonic server");
    } else {
      if (!(await this.prisma.client.organization.count({ where: { id: owner.id } }))) throw new NotFoundException("Organisation not found");
      const membership = await this.prisma.client.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: owner.id, userId: user.id } }, select: { role: true } });
      if (!user.isGlobalAdmin && membership?.role !== "ADMIN") throw new ForbiddenException("Only the organisation's admins connect its Sonic server");
    }
    return owner;
  }

  private async save(owner: SonicServerOwner, dto: SaveSonicServerDto) {
    if (!(await ownServersPolicy()).allowed) throw new ForbiddenException("This Songverse doesn't let teams and organisations connect their own Sonic servers: its admin can allow it in Admin > Stem separation");
    try {
      await saveSonicServer(owner, dto);
    } catch (error) {
      if (error instanceof SonicServerInputError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async test(owner: SonicServerOwner) {
    const policy = await ownServersPolicy();
    const server = await this.prisma.client.sonicServer.findUnique({ where: owner.kind === "team" ? { teamId: owner.id } : { organizationId: owner.id } });
    if (!server) throw new NotFoundException("No Sonic server is connected");
    return testServer({ apiUrl: server.apiUrl, apiKey: decryptSecret(server.apiKeyEnc, process.env.SETTINGS_ENCRYPTION_KEY), guard: { allowPrivate: policy.allowPrivate } });
  }

  @Get("teams/:teamId/sonic-server")
  async getTeam(@Param("teamId") teamId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return sonicServerSummary(await this.admin(user, { kind: "team", id: teamId }));
  }

  @Put("teams/:teamId/sonic-server")
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveTeam(@Param("teamId") teamId: string, @Body() dto: SaveSonicServerDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.save(await this.admin(user, { kind: "team", id: teamId }), dto);
  }

  @Delete("teams/:teamId/sonic-server")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTeam(@Param("teamId") teamId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await removeSonicServer(await this.admin(user, { kind: "team", id: teamId }));
  }

  @RateLimit("heavy")
  @Post("teams/:teamId/sonic-server/test")
  @HttpCode(HttpStatus.OK)
  async testTeam(@Param("teamId") teamId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.test(await this.admin(user, { kind: "team", id: teamId }));
  }

  @Get("organizations/:organizationId/sonic-server")
  async getOrganization(@Param("organizationId") organizationId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return sonicServerSummary(await this.admin(user, { kind: "organization", id: organizationId }));
  }

  @Put("organizations/:organizationId/sonic-server")
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveOrganization(@Param("organizationId") organizationId: string, @Body() dto: SaveSonicServerDto, @CurrentUser() user: AuthenticatedUser | undefined) {
    await this.save(await this.admin(user, { kind: "organization", id: organizationId }), dto);
  }

  @Delete("organizations/:organizationId/sonic-server")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOrganization(@Param("organizationId") organizationId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    await removeSonicServer(await this.admin(user, { kind: "organization", id: organizationId }));
  }

  @RateLimit("heavy")
  @Post("organizations/:organizationId/sonic-server/test")
  @HttpCode(HttpStatus.OK)
  async testOrganization(@Param("organizationId") organizationId: string, @CurrentUser() user: AuthenticatedUser | undefined) {
    return this.test(await this.admin(user, { kind: "organization", id: organizationId }));
  }
}

/** Admin > Stem separation (issue #63): the Demucs API's settings and a test. Who may use it is a role (issue #160). */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin/stem-separation")
@UseGuards(GlobalAdminGuard)
export class AdminStemSeparationController {
  @Get()
  get(): ReturnType<typeof getStemSeparationSummary> {
    return getStemSeparationSummary();
  }

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Body() dto: SaveStemSeparationSettingsDto): Promise<void> {
    return saveStemSeparationSettings(dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(): Promise<void> {
    return clearStemSeparationSettings();
  }

  /** Its health check and what it offers, with the saved key. */
  @Post("test")
  @HttpCode(HttpStatus.OK)
  async test() {
    return testServer(await getEffectiveStemSeparationSettings());
  }

  /** The Sonic servers teams and organisations connected (issue #300). */
  @Get("servers")
  servers(): ReturnType<typeof listSonicServers> {
    return listSonicServers();
  }
}
