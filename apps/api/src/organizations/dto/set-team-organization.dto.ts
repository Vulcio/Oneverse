import { SetTeamOrganizationSchema } from "@songverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class SetTeamOrganizationDto extends zodDto(SetTeamOrganizationSchema) {}
