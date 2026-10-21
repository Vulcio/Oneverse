import { ChooseChordShapeSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class ChooseChordShapeDto extends zodDto(ChooseChordShapeSchema) {}
