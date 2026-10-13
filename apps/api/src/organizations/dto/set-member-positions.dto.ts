import { SetMemberPositionsSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SetMemberPositionsDto extends zodDto(SetMemberPositionsSchema) {}
