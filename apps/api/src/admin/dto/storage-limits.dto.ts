import { ApiProperty } from "@nestjs/swagger";
import { SaveStorageLimitsSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class StorageLimitsResponseDto {
  @ApiProperty({ description: "A user's limit when no storage role sets one, in MB" })
  defaultLimitMb!: number;

  @ApiProperty({ description: "True when no default is saved and the built-in one applies" })
  isBuiltIn!: boolean;

  @ApiProperty()
  builtInDefaultMb!: number;

  @ApiProperty({ description: "A team's pool when no storage role sets one, in MB (issue #160)" })
  defaultTeamLimitMb!: number;

  @ApiProperty()
  teamIsBuiltIn!: boolean;

  @ApiProperty()
  builtInTeamDefaultMb!: number;
}

/** Null resets to the built-in default. */
export class SaveStorageLimitsDto extends zodDto(SaveStorageLimitsSchema) {}
