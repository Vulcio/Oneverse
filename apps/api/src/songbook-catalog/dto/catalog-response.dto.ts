import { ApiProperty } from "@nestjs/swagger";

export class CatalogEntryOriginalDto {
  @ApiProperty() catalogId!: string;
  @ApiProperty() catalogName!: string;
  @ApiProperty({ nullable: true }) catalogAbbreviation!: string | null;
  @ApiProperty() entryId!: string;
  @ApiProperty() entryCode!: string;
  @ApiProperty() title!: string;
}

export class CatalogEntryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() entryCode!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ nullable: true }) sortTitle!: string | null;
  @ApiProperty({ nullable: true }) subtitle!: string | null;
  @ApiProperty({ nullable: true, description: 'As written, e.g. "JEM 245"' }) originalSong!: string | null;
  @ApiProperty({ nullable: true, type: CatalogEntryOriginalDto, description: "The entry originalSong points to, when it exists" })
  original!: CatalogEntryOriginalDto | null;
  @ApiProperty({ nullable: true }) originalLanguage!: string | null;
  @ApiProperty({ nullable: true }) artist!: string | null;
  @ApiProperty({ nullable: true }) composer!: string | null;
  @ApiProperty({ nullable: true }) lyricist!: string | null;
  @ApiProperty({ nullable: true }) album!: string | null;
  @ApiProperty({ nullable: true }) year!: number | null;
  @ApiProperty({ nullable: true }) key!: string | null;
  @ApiProperty({ nullable: true }) timeSignature!: string | null;
  @ApiProperty({ nullable: true }) tempo!: number | null;
  @ApiProperty({ nullable: true, description: "Seconds" }) durationSeconds!: number | null;
  @ApiProperty({ nullable: true }) copyright!: string | null;
  @ApiProperty({ nullable: true }) ccli!: string | null;
  @ApiProperty({ nullable: true }) isrc!: string | null;
  @ApiProperty({ nullable: true }) reference!: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [String], description: "YouTube, Spotify, Apple Music or Deezer addresses (issue #210)" }) links!: string[];
  @ApiProperty({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [CatalogEntryOriginalDto], required: false, description: "Entries whose original song this is (on a catalogue's page)" })
  translations?: CatalogEntryOriginalDto[];
}

export class CatalogResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ required: false, nullable: true }) abbreviation!: string | null;
  @ApiProperty({ required: false, nullable: true }) publisher!: string | null;
  @ApiProperty({ required: false, nullable: true }) isbn!: string | null;
  @ApiProperty({ required: false, nullable: true }) description!: string | null;
  @ApiProperty({ required: false, nullable: true }) coverImageUrl!: string | null;
  @ApiProperty({ required: false, nullable: true }) officialUrl!: string | null;
  @ApiProperty({ required: false, nullable: true }) language!: string | null;
  @ApiProperty() licensed!: boolean;
  @ApiProperty({ type: CatalogEntryResponseDto, isArray: true, required: false })
  entries?: CatalogEntryResponseDto[];
}

export class CatalogFileProblemDto {
  @ApiProperty({ nullable: true, description: "Row number (CSV line, header = 1; or JSON entry position from 1); null for the whole file" })
  row!: number | null;
  @ApiProperty() message!: string;
}

export class CatalogChangeDto {
  @ApiProperty() entryCode!: string;
  @ApiProperty({ enum: ["create", "update", "delete"] }) kind!: "create" | "update" | "delete";
  @ApiProperty({ type: [String], description: "Fields that change (updates)" }) fields!: string[];
}

export class ImportCatalogResultDto {
  @ApiProperty({ enum: ["csv", "json"] }) format!: "csv" | "json";
  @ApiProperty() dryRun!: boolean;
  @ApiProperty({ description: "False when nothing was saved (dry run, or replace mode with problems)" }) applied!: boolean;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() deleted!: number;
  @ApiProperty({ type: [CatalogFileProblemDto] }) problems!: CatalogFileProblemDto[];
  @ApiProperty({ type: [String] }) unknownColumns!: string[];
  @ApiProperty({ type: [CatalogChangeDto], description: "The first 500 changes" }) changes!: CatalogChangeDto[];
}
