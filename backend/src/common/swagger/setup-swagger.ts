import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApiErrorResponseDto, ApiSuccessResponseDto } from '../dto/api-response.dto';

/**
 * Mounts the interactive API documentation.
 *
 * Not served in production. The document lists every route and its shape, which
 * is a map of the attack surface, and there is no reason for a school's users
 * to have it. Staging keeps it, so the frontend team can work against something
 * real.
 */
export function setupSwagger(
  app: INestApplication,
  options: { isProduction: boolean },
): string | null {
  if (options.isProduction) {
    return null;
  }

  const config = new DocumentBuilder()
    .setTitle('CyberSchola API')
    .setDescription(
      [
        'Multi-tenant school management API.',
        '',
        'Every response uses the same envelope. On success the `code` is `OK`.',
        'On failure it is a stable error identity: branch on `code`, never on `message`.',
        '',
        'A resource belonging to another school returns `404 NOT_FOUND`, identical to',
        'a resource that does not exist. This is deliberate: a distinct status would',
        'confirm the id exists and allow enumeration across tenants.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    extraModels: [ApiSuccessResponseDto, ApiErrorResponseDto],
  });

  const path = 'api/docs';
  SwaggerModule.setup(path, app, document, {
    swaggerOptions: { persistAuthorization: true, docExpansion: 'list' },
    customSiteTitle: 'CyberSchola API',
  });

  return path;
}
