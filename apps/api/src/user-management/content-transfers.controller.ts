import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { ContentTransfersService } from "./content-transfers.service.js";

class TransferPreviewResponseDto {
  @ApiProperty() fromDisplayName!: string;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty() songCount!: number;
  @ApiProperty() arrangementCount!: number;
  @ApiProperty() songbookCount!: number;
  @ApiProperty() tagCount!: number;
  @ApiProperty() setCount!: number;
  @ApiProperty() storageBytes!: number;
}

/** Signed-in users only: the link hands content to whoever claims it. */
@ApiTags("transfers")
@ApiBearerAuth()
@Controller("transfers/:token")
export class ContentTransfersController {
  constructor(private readonly transfers: ContentTransfersService) {}

  @Get()
  @ApiOkResponse({ type: TransferPreviewResponseDto })
  preview(@Param("token") token: string, @SignedIn() _user: AuthenticatedUser) {
    return this.transfers.preview(token);
  }

  @Post("claim")
  @HttpCode(HttpStatus.NO_CONTENT)
  claim(@Param("token") token: string, @SignedIn() user: AuthenticatedUser): Promise<void> {
    return this.transfers.claim(token, user.id);
  }
}
