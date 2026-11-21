import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

/** Document the same envelope the global JSON response interceptor emits. */
export function ApiSuccess(model: Type<unknown> | Type<unknown>[], status = 200) {
  const models = Array.isArray(model) ? model : [model];
  return applyDecorators(
    ApiExtraModels(...models),
    ApiResponse({
      status,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: Array.isArray(model)
            ? { oneOf: models.map((item) => ({ $ref: getSchemaPath(item) })) }
            : { $ref: getSchemaPath(model) },
        },
      },
    }),
  );
}
