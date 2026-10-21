import { ApiProperty } from "@nestjs/swagger";
import { TEAM_ROLES, TECH_ROLES } from "@oneverse/core";

export class TeamMemberResponseDto {
  @ApiProperty() userId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ required: false, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ enum: TEAM_ROLES }) role!: (typeof TEAM_ROLES)[number];
  @ApiProperty() joinedAt!: Date;
  @ApiProperty({ type: [String], description: "Built-in instruments' keys (INSTRUMENTS), then the ids of those an admin added (issue #166)" }) instruments!: string[];
  @ApiProperty({ enum: TECH_ROLES, isArray: true }) techRoles!: (typeof TECH_ROLES)[number][];
}
