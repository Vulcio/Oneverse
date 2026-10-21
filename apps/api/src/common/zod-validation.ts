import { ArgumentMetadata, BadRequestException, Injectable, InternalServerErrorException, PipeTransform } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import type { ParameterObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface.js";
import { cleanupOpenApiDoc, createZodDto } from "nestjs-zod";
import { describeRequestIssue } from "@oneverse/core";
import { z, type ZodError } from "zod";

/**
 * Requests are validated with the zod schemas in @oneverse/core (issue
 * #118), through nestjs-zod's DTOs: `class XDto extends zodDto(XSchema) {}`.
 *
 * A failed request answers 400 with `message: string[]`, one per problem,
 * worded as class-validator did ("year must not be less than 1000") so
 * clients and their messages carry on as before. A message a schema sets
 * itself ("A song needs at least one artist") is used as it is.
 */

/** A class made by nestjs-zod's createZodDto (it marks them so). */
const isZodDto = (metatype: unknown): metatype is { schema: z.ZodType } =>
  typeof metatype === "function" && (metatype as { isZodDto?: boolean }).isZodDto === true;

// Only for the messages a schema doesn't set itself (those win over this).
z.config({ customError: (issue) => describeRequestIssue(issue) });

function validationException(error: ZodError) {
  // "property a should not exist; property b should not exist" is one issue, several messages.
  const messages = error.issues.flatMap((issue) => issue.message.split("; "));
  return new BadRequestException(messages);
}

function validate(value: unknown, schema: z.ZodType) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationException(parsed.error);
  return parsed.data;
}

/**
 * The global pipe: a whole body or query typed with a zod DTO is parsed
 * with its schema. One that isn't is a mistake in the controller, refused
 * rather than let through unchecked. Single values (`@Param("id")`,
 * `@Query("q")`) and custom decorators are left to the handler.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    const { metatype, type, data } = metadata;
    if (isZodDto(metatype)) return validate(value, metatype.schema);
    if ((type === "body" || type === "query") && data === undefined) {
      throw new InternalServerErrorException(`The whole ${type} of this route isn't validated: type it with a zod DTO`);
    }
    return value;
  }
}

/** The request schemas by their DTO's name, for the API's docs. */
const requestSchemas = new Map<string, z.ZodType>();

/**
 * A request DTO from a core schema. Nest asks each DTO class for its
 * OpenAPI description by calling this static method on it, so `this.name`
 * is the DTO's own name ("CreateSongVersionDto").
 */
export function zodDto<T extends z.ZodType>(schema: T) {
  // createZodDto makes a new class each time: its own method can be wrapped.
  const Dto = createZodDto(schema);
  const metadata = (Dto as unknown as { _OPENAPI_METADATA_FACTORY(): unknown })._OPENAPI_METADATA_FACTORY;
  Object.defineProperty(Dto, "_OPENAPI_METADATA_FACTORY", {
    value(this: { name: string }) {
      requestSchemas.set(this.name, schema);
      return metadata.call(this);
    },
  });
  return Dto;
}

/**
 * The API's docs, request bodies and queries described by zod itself.
 * @nestjs/swagger reads a nullable field's type list ("string" or null) as
 * an array, so each request DTO's schema is replaced with zod's JSON
 * Schema, which OpenAPI 3.1 takes as it is.
 */
export function openApiDoc(document: OpenAPIObject): OpenAPIObject {
  const doc = cleanupOpenApiDoc(document, { version: "3.1" });
  const schemas = doc.components?.schemas ?? {};
  const described = new Map<string, { properties?: Record<string, object> }>();
  for (const [name, schema] of requestSchemas) {
    const json: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) };
    delete json.$schema;
    described.set(name, json);
    if (schemas[name]) schemas[name] = json;
  }
  // A query DTO becomes one parameter per field: each is described from the
  // schema whose fields are exactly the operation's query parameters.
  for (const path of Object.values(doc.paths)) {
    for (const operation of [path.get, path.put, path.post, path.patch, path.delete]) {
      const query = (operation?.parameters ?? []).filter((p): p is ParameterObject => "in" in p && p.in === "query");
      if (!query.length) continue;
      const names = query.map((p) => p.name).sort().join();
      const match = [...described.values()].find((json) => Object.keys(json.properties ?? {}).sort().join() === names);
      for (const parameter of query) {
        if (match?.properties?.[parameter.name]) parameter.schema = match.properties[parameter.name];
      }
    }
  }
  return doc;
}
