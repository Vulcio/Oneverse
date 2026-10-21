import { CreateInviteLinkSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateInviteLinkDto extends zodDto(CreateInviteLinkSchema) {}
