import { ApiProperty } from "@nestjs/swagger";

export class TagCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ required: false, nullable: true, description: "e.g. { fr: \"Thème\" }" }) translations!: unknown;
  @ApiProperty() isGlobal!: boolean;
  @ApiProperty() sortOrder!: number;
}

class TagCategoryRefDto {
  @ApiProperty({ description: "theme, season, occasion, style (genre), mood, instrumentation, or an admin's own" }) slug!: string;
}

export class TagResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty({ type: TagCategoryRefDto }) category!: TagCategoryRefDto;
  @ApiProperty() slug!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ required: false, nullable: true, description: "e.g. { fr: \"Pâques\" }" }) translations!: unknown;
  @ApiProperty() scope!: string;
  @ApiProperty() isApproved!: boolean;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ required: false, nullable: true, description: "A theme's group (issue #37), e.g. \"salvation\"" }) group!: string | null;
  @ApiProperty({ required: false, nullable: true, description: "Other words for it, per locale, e.g. { fr: [\"faveur\"] }" }) aliases!: unknown;
  @ApiProperty({ description: "Hidden from pickers, still shown on the songs that have it" }) retired!: boolean;
}
