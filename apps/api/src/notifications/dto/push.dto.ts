import { CreatePushSubscriptionSchema } from "@oneverse/core";
import { zodDto } from "../../common/zod-validation.js";

export class CreatePushSubscriptionDto extends zodDto(CreatePushSubscriptionSchema) {}
