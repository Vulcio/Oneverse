import { ApiProperty } from "@nestjs/swagger";

/** An app they can open (issue #552). */
export class AppLinkResponseDto {
  @ApiProperty({ enum: ["oneverse", "plan", "songverse", "screen"] }) app!: "oneverse" | "plan" | "songverse" | "screen";
  @ApiProperty({ description: "Its address, without a trailing slash" }) url!: string;
}
