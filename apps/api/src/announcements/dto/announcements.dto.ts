import { CreateAnnouncementSchema, SaveOrganizationAnnouncementSchema, SaveTeamAnnouncementSchema, UpdateAnnouncementSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreateAnnouncementDto extends zodDto(CreateAnnouncementSchema) {}
export class UpdateAnnouncementDto extends zodDto(UpdateAnnouncementSchema) {}
export class SaveOrganizationAnnouncementDto extends zodDto(SaveOrganizationAnnouncementSchema) {}
export class SaveTeamAnnouncementDto extends zodDto(SaveTeamAnnouncementSchema) {}
