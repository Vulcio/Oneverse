import { CreateOrganizationEventSchema, OrganizationEventPresetSchema, UpdateOrganizationEventDateSchema, UpdateOrganizationEventSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateOrganizationEventDto extends zodDto(CreateOrganizationEventSchema) {}
export class UpdateOrganizationEventDto extends zodDto(UpdateOrganizationEventSchema) {}
export class UpdateOrganizationEventDateDto extends zodDto(UpdateOrganizationEventDateSchema) {}
export class OrganizationEventPresetDto extends zodDto(OrganizationEventPresetSchema) {}
