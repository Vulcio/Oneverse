import { ManageRegistrationSchema, RegisterSchema, RegistrationFormQuerySchema, RegistrationFormSchema, UpdateRegistrationSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class RegistrationFormDto extends zodDto(RegistrationFormSchema) {}
export class RegistrationFormQueryDto extends zodDto(RegistrationFormQuerySchema) {}
export class RegisterDto extends zodDto(RegisterSchema) {}
export class UpdateRegistrationDto extends zodDto(UpdateRegistrationSchema) {}
export class ManageRegistrationDto extends zodDto(ManageRegistrationSchema) {}
