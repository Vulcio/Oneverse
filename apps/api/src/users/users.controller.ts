import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiExcludeEndpoint, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { StorageUsageResponseDto } from "./dto/storage-usage.dto.js";
import { UpdateUserDto } from "./dto/update-user.dto.js";
import { UserResponseDto } from "./dto/user-response.dto.js";
import { UsersService } from "./users.service.js";
import { UPLOAD_OPTIONS } from "../common/uploads.js";
import { RateLimit } from "../security/rate-limit.decorator.js";

// The web app uploads an already-cropped image well under this; the server
// normalizes whatever it gets anyway (see ImageService.normalizeAvatar).
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @ApiOkResponse({ type: UserResponseDto })
  findMe(@CurrentUser() user?: AuthenticatedUser) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.findMe(user.id);
  }

  @Patch("me")
  @ApiOkResponse({ type: UserResponseDto })
  updateMe(@CurrentUser() user: AuthenticatedUser | undefined, @Body() dto: UpdateUserDto) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.updateMe(user.id, dto);
  }

  /** "What do you play or do?" skipped for now (issue #109). */
  @Post("me/profile-prompt/skip")
  @HttpCode(HttpStatus.NO_CONTENT)
  async skipProfilePrompt(@CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    if (!user) throw new UnauthorizedException();
    await this.usersService.skipProfilePrompt(user.id);
  }

  @Get("me/storage")
  @ApiOkResponse({ type: StorageUsageResponseDto })
  storage(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.getStorageUsage(user.id);
  }

  @Put("me/avatar")
  @UseInterceptors(FileInterceptor("file", { ...UPLOAD_OPTIONS, limits: { fileSize: MAX_AVATAR_SIZE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiOkResponse({ type: UserResponseDto })
  setAvatar(@CurrentUser() user: AuthenticatedUser | undefined, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!user) throw new UnauthorizedException();
    if (!file) throw new BadRequestException("A file is required");
    return this.usersService.setAvatar(user.id, file.buffer);
  }

  @Delete("me/avatar")
  @ApiOkResponse({ type: UserResponseDto })
  removeAvatar(@CurrentUser() user: AuthenticatedUser | undefined) {
    if (!user) throw new UnauthorizedException();
    return this.usersService.removeAvatar(user.id);
  }

  @Public()
  @RateLimit("none")
  @Get(":userId/avatar/:key")
  @ApiExcludeEndpoint()
  async avatar(
    @Param("userId") userId: string,
    @Param("key") key: string,
    @Query("size") size: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { body, contentType } = await this.usersService.getAvatar(userId, key, size === undefined ? undefined : Number(size));
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Rendered as <img> by the web app on another origin.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return new StreamableFile(body);
  }
}
