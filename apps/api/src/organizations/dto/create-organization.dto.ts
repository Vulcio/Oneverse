import { CreateOrganizationSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateOrganizationDto extends zodDto(CreateOrganizationSchema) {}
