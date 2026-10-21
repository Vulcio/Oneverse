import { ApiProperty } from "@nestjs/swagger";
import { TEAM_ROLES } from "@oneverse/core";

export class InviteLinkResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() token!: string;
  @ApiProperty({ enum: TEAM_ROLES }) role!: (typeof TEAM_ROLES)[number];
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ required: false, nullable: true }) expiresAt!: Date | null;
  @ApiProperty() usedCount!: number;
  @ApiProperty({ required: false, nullable: true }) maxUses!: number | null;
}
