import { ApiProperty } from "@nestjs/swagger";
import { OWNERSHIP_SCOPES, SONGBOOK_KINDS, type SongbookSection } from "@oneverse/core";

export class SongbookEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() songVersionId!: string;
  @ApiProperty({ required: false, nullable: true }) entryCode!: string | null;
  @ApiProperty({ required: false, nullable: true }) songVersionTitle!: string | null;
  @ApiProperty({ required: false, nullable: true, description: "Computed from the songbook's sections, if any" })
  sectionLabel!: string | null;
}

export class PendingSongbookEntryResponseDto {
  @ApiProperty({ description: "The SongbookCatalogEntry id - pass this to the materialize endpoint" })
  catalogEntryId!: string;
  @ApiProperty() entryCode!: string;
  @ApiProperty() title!: string;
}

export class SongbookResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ required: false, nullable: true }) abbreviation!: string | null;
  @ApiProperty({ required: false, nullable: true }) language!: string | null;
  @ApiProperty({ required: false, nullable: true }) publisher!: string | null;
  @ApiProperty({ required: false, nullable: true }) year!: number | null;
  @ApiProperty({ enum: SONGBOOK_KINDS }) kind!: (typeof SONGBOOK_KINDS)[number];
  @ApiProperty({ required: false, nullable: true }) sections!: SongbookSection[] | null;
  @ApiProperty({ enum: OWNERSHIP_SCOPES }) ownerScope!: (typeof OWNERSHIP_SCOPES)[number];
  @ApiProperty({ required: false, nullable: true }) ownerTeamId!: string | null;
  @ApiProperty({
    required: false,
    nullable: true,
    description: "Set if this songbook was imported from a SongbookCatalog",
  })
  sourceCatalogId?: string | null;
  @ApiProperty({
    enum: ["own", "edit", "view"],
    description: "What the user may do with it (issue #211): own it (change, share, delete), edit its entries and details (shared to edit), or view it",
  })
  access!: "own" | "edit" | "view";
  @ApiProperty({ type: SongbookEntryResponseDto, isArray: true, required: false })
  entries?: SongbookEntryResponseDto[];
  @ApiProperty({
    type: PendingSongbookEntryResponseDto,
    isArray: true,
    required: false,
    description: "Catalog entries not yet materialized into a real song - only set when sourceCatalogId is set",
  })
  pendingEntries?: PendingSongbookEntryResponseDto[];
}
