import { UpdateOrganizationSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class UpdateOrganizationDto extends zodDto(UpdateOrganizationSchema) {}
