import { ApiProperty } from "@nestjs/swagger";
import { OWNERSHIP_SCOPES, PUBLICATION_STATES } from "@oneverse/core";

export class SongVersionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() workId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ required: false, nullable: true }) alternateTitle!: string | null;
  @ApiProperty() language!: string;
  @ApiProperty({ enum: OWNERSHIP_SCOPES }) ownerScope!: (typeof OWNERSHIP_SCOPES)[number];
  @ApiProperty({ required: false, nullable: true }) ownerUserId!: string | null;
  @ApiProperty({ required: false, nullable: true }) ownerTeamId!: string | null;
  @ApiProperty({ enum: PUBLICATION_STATES }) publicationState!: (typeof PUBLICATION_STATES)[number];
  @ApiProperty({ required: false, nullable: true }) ccli!: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class SongVersionSongbookMembershipDto {
  @ApiProperty() songbookId!: string;
  @ApiProperty() songbookName!: string;
  @ApiProperty({ required: false, nullable: true }) abbreviation!: string | null;
  @ApiProperty({ required: false, nullable: true }) entryCode!: string | null;
  @ApiProperty({ required: false, nullable: true, description: "The printed volume the number falls in (the songbook's sections)" }) sectionLabel!: string | null;
  @ApiProperty({ description: 'To give someone without the app: "JEM 855 · JEM3", or the songbook\'s name when unnumbered' }) reference!: string;
}
