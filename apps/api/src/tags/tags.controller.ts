import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags as ApiSwaggerTags } from "@nestjs/swagger";
import { SignedIn } from "../common/decorators/signed-in.decorator.js";
import type { AuthenticatedUser } from "../common/types/authenticated-request.js";
import { TagCategoryResponseDto, TagResponseDto } from "./dto/tag-response.dto.js";
import { TagsService } from "./tags.service.js";

@ApiSwaggerTags("tags")
@ApiBearerAuth()
@Controller("tags")
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get("categories")
  @ApiOkResponse({ type: TagCategoryResponseDto, isArray: true })
  findCategories(): ReturnType<TagsService["findCategories"]> {
    return this.tagsService.findCategories();
  }

  @Get()
  @ApiOkResponse({ type: TagResponseDto, isArray: true })
  findAll(@SignedIn() user: AuthenticatedUser): ReturnType<TagsService["findVisibleToUser"]> {
    return this.tagsService.findVisibleToUser(user.id);
  }
}
