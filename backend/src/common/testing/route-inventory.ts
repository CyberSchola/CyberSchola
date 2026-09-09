import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import type { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';

import { TENANT_OPTIONAL_KEY } from '../../tenancy/tenant-optional.decorator';

export interface RouteRecord {
  /** Controller class name, so a failure names something greppable. */
  controller: string;
  /** Handler method name. */
  handler: string;
  method: string;
  path: string;
  /** True when the handler or its controller carries `@TenantOptional()`. */
  tenantOptional: boolean;
}

function joinPath(controllerPath: string, handlerPath: string): string {
  const parts = [controllerPath, handlerPath]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0);

  return `/${parts.join('/')}`;
}

/**
 * Every HTTP route the application exposes, discovered from the controllers.
 *
 * Read from the running application rather than from a hand-kept list, because
 * a hand-kept list is exactly the thing that goes stale. The value of decision
 * 9A is that a new endpoint cannot be forgotten: if it exists it appears here,
 * and if it appears here it has to be accounted for.
 *
 * Discovered through `DiscoveryService` rather than by walking the Express
 * router. Nest wraps every handler before Express sees it, so decorator
 * metadata such as `@TenantOptional()` is not readable from a router layer.
 * Reading the controller classes gets the metadata that was actually applied.
 */
export function collectRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): RouteRecord[] {
  const routes: RouteRecord[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    const metatype = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;

    if (!instance || !metatype) {
      continue;
    }

    const prototype = Object.getPrototypeOf(instance) as object;
    const controllerPath = reflector.get<string | undefined>(PATH_METADATA, metatype) ?? '';

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = instance[methodName];

      if (typeof handler !== 'function') {
        continue;
      }

      const httpMethod = reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);

      // Not every public method is a route. Only those carrying an HTTP verb.
      if (httpMethod === undefined) {
        continue;
      }

      const handlerPath = reflector.get<string | undefined>(PATH_METADATA, handler) ?? '';

      routes.push({
        controller: metatype.name,
        handler: methodName,
        method: RequestMethod[httpMethod],
        path: joinPath(controllerPath, handlerPath),
        // getAllAndOverride so a controller-level decorator covers every route
        // on it, which is how the health controller will mark itself.
        tenantOptional:
          reflector.getAllAndOverride<boolean | undefined>(TENANT_OPTIONAL_KEY, [
            handler,
            metatype,
          ]) === true,
      });
    }
  }

  if (routes.length === 0) {
    // An empty inventory would make every conformance assertion pass by having
    // nothing to check, which is worse than failing because it looks green.
    throw new Error(
      'The route inventory is empty. Either no controllers were discovered or the ' +
        'metadata keys have changed. An empty inventory passes vacuously, so this throws.',
    );
  }

  return routes;
}
