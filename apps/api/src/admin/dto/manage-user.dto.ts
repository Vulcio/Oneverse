import { ApiProperty } from "@nestjs/swagger";
import { DeleteUserSchema, UpdateUserByAdminSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

/** Each field is optional; omitted fields are left unchanged. */
export class UpdateUserByAdminDto extends zodDto(UpdateUserByAdminSchema) {}

export class DeleteUserDto extends zodDto(DeleteUserSchema) {}

export class TransferLinkResponseDto {
  @ApiProperty() transferUrl!: string;
  @ApiProperty() expiresAt!: Date;
}
