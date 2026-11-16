import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { DEFAULT_TRANSFER_RETENTION_DAYS } from "@oneverse/core";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import { GlobalAdminGuard } from "../common/guards/global-admin.guard.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { AdminUsersService } from "../user-management/admin-users.service.js";
import { AdminService, type AdminCommandResult } from "./admin.service.js";
import { AuthConfigResponseDto } from "./dto/admin-auth-response.dto.js";
import { AdminStorageResponseDto, StorageConfigResponseDto } from "./dto/admin-storage-response.dto.js";
import { AdminUserResponseDto } from "./dto/admin-user-response.dto.js";
import { DeleteUserDto, TransferLinkResponseDto, UpdateUserByAdminDto } from "./dto/manage-user.dto.js";
import { SaveAuthConfigDto, SendTestEmailDto } from "./dto/save-auth-config.dto.js";
import { SaveStorageConfigDto } from "./dto/save-storage-config.dto.js";
import { SaveStorageLimitsDto, StorageLimitsResponseDto } from "./dto/storage-limits.dto.js";
import { SaveSecuritySettingsDto } from "./dto/security-settings.dto.js";
import { SaveCollaborationSettingsDto } from "./dto/collaboration-settings.dto.js";
import { SaveErrorReportingSettingsDto } from "./dto/error-reporting-settings.dto.js";
import { clearErrorReportingSettings, getErrorReportingSummary, saveErrorReportingSettings } from "../error-reporting/error-reporting-settings.js";
import { reportError } from "../error-reporting/error-reporter.js";
import { clearCollaborationSettings, getCollaborationSettingsSummary, saveCollaborationSettings } from "../sync/collaboration-settings.js";
import { clearSecuritySettings, getSecuritySettingsSummary, saveSecuritySettings } from "../security/security-settings.js";
import { SaveNotificationServerSettingsDto } from "./dto/notification-settings.dto.js";
import { clearNotificationSettings, generatePushKeys, getNotificationSettingsSummary, saveNotificationSettings } from "../notifications/notification-settings.js";

/**
 * Operational tools for global admins - today, the migrate/seed steps
 * that used to require shelling into the API container by hand. Meant to
 * grow into a broader "server & API" ops panel over time.
 *
 * Deliberately in-process only (no child_process/shell-exec anywhere in
 * this module): running seed logic in-process is straightforward, but
 * there's no supported non-CLI way to run `prisma migrate deploy`, so
 * migrations are applied when the API container starts (see the CMD in
 * Dockerfile.api) - this only reports status.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("admin")
@UseGuards(GlobalAdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminUsers: AdminUsersService,
  ) {}

  @Get("migrations/status")
  @ApiOkResponse({ description: "Read-only: compares migrations on disk against what's applied in the DB." })
  migrationStatus(): Promise<AdminCommandResult> {
    return this.adminService.migrationStatus();
  }

  @Post("seed")
  @ApiOkResponse({ description: "Runs the database seed script in-process." })
  runSeed(): Promise<AdminCommandResult> {
    return this.adminService.runSeed();
  }

  @Get("users")
  @ApiOkResponse({ type: AdminUserResponseDto, isArray: true })
  listUsers(): ReturnType<AdminUsersService["list"]> {
    return this.adminUsers.list();
  }

  @Patch("users/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  updateUser(
    @Param("userId") userId: string,
    @Body() dto: UpdateUserByAdminDto,
    @SignedIn() admin: AuthenticatedUser,
  ): Promise<void> {
    return this.adminUsers.update(admin.id, userId, dto);
  }

  /** Returns the transfer link when contentAction is "transfer", otherwise null. */
  @Post("users/:userId/delete")
  @ApiOkResponse({ type: TransferLinkResponseDto })
  deleteUser(
    @Param("userId") userId: string,
    @Body() dto: DeleteUserDto,
    @SignedIn() admin: AuthenticatedUser,
  ): ReturnType<AdminUsersService["remove"]> {
    return this.adminUsers.remove(admin.id, userId, dto.contentAction, dto.retentionDays ?? DEFAULT_TRANSFER_RETENTION_DAYS);
  }

  @Post("users/:userId/transfer-link")
  @ApiOkResponse({ type: TransferLinkResponseDto })
  regenerateTransferLink(@Param("userId") userId: string): ReturnType<AdminUsersService["regenerateTransferLink"]> {
    return this.adminUsers.regenerateTransferLink(userId);
  }

  @Get("storage")
  @ApiOkResponse({ type: AdminStorageResponseDto })
  storageStats(): ReturnType<AdminService["storageStats"]> {
    return this.adminService.storageStats();
  }

  @Get("storage/limits")
  @ApiOkResponse({ type: StorageLimitsResponseDto })
  getStorageLimits(): ReturnType<AdminService["getStorageLimits"]> {
    return this.adminService.getStorageLimits();
  }

  @Put("storage/limits")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveStorageLimits(@Body() dto: SaveStorageLimitsDto): Promise<void> {
    return this.adminService.saveStorageLimits(dto);
  }

  @Get("storage/config")
  @ApiOkResponse({ type: StorageConfigResponseDto })
  getStorageConfig(): ReturnType<AdminService["getStorageConfig"]> {
    return this.adminService.getStorageConfig();
  }

  @Put("storage/config")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveStorageConfig(@Body() dto: SaveStorageConfigDto): Promise<void> {
    return this.adminService.saveStorageConfig(dto);
  }

  @Delete("storage/config")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearStorageConfig(): Promise<void> {
    return this.adminService.clearStorageConfig();
  }

  // --- how the API protects itself (issue #113): rate limits, who reads its docs

  @Get("security")
  @ApiOkResponse({ description: "Each setting's value, and whether it comes from the database, its env var or the default." })
  getSecuritySettings(): ReturnType<typeof getSecuritySettingsSummary> {
    return getSecuritySettingsSummary();
  }

  @Put("security")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveSecuritySettings(@Body() dto: SaveSecuritySettingsDto): Promise<void> {
    return saveSecuritySettings(dto);
  }

  @Delete("security")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearSecuritySettings(): Promise<void> {
    return clearSecuritySettings();
  }

  // --- live collaboration (issue #27): typing in the same song together

  @Get("collaboration")
  @ApiOkResponse({ description: "Whether live co-editing is on, and whether that comes from the database, LIVE_CO_EDITING or the default (off)." })
  getCollaborationSettings(): ReturnType<typeof getCollaborationSettingsSummary> {
    return getCollaborationSettingsSummary();
  }

  @Put("collaboration")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveCollaborationSettings(@Body() dto: SaveCollaborationSettingsDto): Promise<void> {
    return saveCollaborationSettings(dto);
  }

  @Delete("collaboration")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearCollaborationSettings(): Promise<void> {
    return clearCollaborationSettings();
  }

  // --- error reporting (issue #469): where the API's, the Worker's and the web apps' errors go

  @Get("error-reporting")
  @ApiOkResponse({ description: "Where error reports go (a Sentry or GlitchTip DSN), whether the web apps' are sent too, the environment, and where each comes from: the database, its ERROR_REPORTING_* env var, or the default." })
  getErrorReporting(): ReturnType<typeof getErrorReportingSummary> {
    return getErrorReportingSummary();
  }

  @Put("error-reporting")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveErrorReporting(@Body() dto: SaveErrorReportingSettingsDto): Promise<void> {
    return saveErrorReportingSettings(dto);
  }

  @Delete("error-reporting")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearErrorReporting(): Promise<void> {
    return clearErrorReportingSettings();
  }

  /** A report sent now, to check the DSN: whether its server took it. */
  @Post("error-reporting/test")
  @ApiOkResponse({ description: "Whether the error reporting server took a test report." })
  async testErrorReporting(): Promise<{ sent: boolean }> {
    const sent = await reportError({ type: "TestReport", message: `A test report from Admin > Error reporting, ${new Date().toISOString()}` }, { source: "api", where: "Admin > Error reporting" });
    return { sent };
  }

  // --- how notifications go out besides the bell (issue #236)

  @Get("notifications")
  @ApiOkResponse({ description: "Whether notifications go by email, and whether that comes from the database, its env var or the default." })
  getNotificationSettings(): ReturnType<typeof getNotificationSettingsSummary> {
    return getNotificationSettingsSummary();
  }

  @Put("notifications")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveNotificationSettings(@Body() dto: SaveNotificationServerSettingsDto): Promise<void> {
    return saveNotificationSettings(dto);
  }

  @Delete("notifications")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearNotificationSettings(): Promise<void> {
    return clearNotificationSettings();
  }

  /** A new VAPID key pair for web push, saved; devices turned on with the old one must be turned on again. */
  @Post("notifications/vapid-keys")
  generatePushKeys(): Promise<{ publicKey: string }> {
    return generatePushKeys();
  }

  @Get("auth")
  @ApiOkResponse({ type: AuthConfigResponseDto })
  getAuthConfig(): ReturnType<AdminService["getAuthConfig"]> {
    return this.adminService.getAuthConfig();
  }

  @Put("auth")
  @HttpCode(HttpStatus.NO_CONTENT)
  saveAuthConfig(@Body() dto: SaveAuthConfigDto): Promise<void> {
    return this.adminService.saveAuthConfig(dto);
  }

  @Delete("auth/email")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearAuthEmailConfig(): Promise<void> {
    return this.adminService.clearEmailAuthConfig();
  }

  /** A test email (issue #38), to the admin unless `to` names another address; refused with the provider's answer when it fails. */
  @Post("auth/email/test")
  @HttpCode(HttpStatus.OK)
  sendTestEmail(@SignedIn() admin: AuthenticatedUser, @Body() dto: SendTestEmailDto): Promise<{ sent: boolean; to: string }> {
    return this.adminService.sendTestEmail(dto.to ?? admin.email);
  }

  @Delete("auth/google")
  @HttpCode(HttpStatus.NO_CONTENT)
  clearAuthGoogleConfig(): Promise<void> {
    return this.adminService.clearGoogleAuthConfig();
  }
}
