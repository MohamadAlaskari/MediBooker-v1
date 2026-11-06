import {
  Body,
  Controller,
  Get,
  Module,
  type ModuleMetadata,
  Post,
  Query,
  RequestMethod,
  Scope,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_PATH,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants.js';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum.js';
import {
  APP_GUARD,
  ContextIdFactory,
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
  ModulesContainer,
  RouterModule,
} from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TEST_ENV } from '../../../test/support/test-env.js';
import { AppModule } from '../../app.module.js';
import { API_VERSIONING } from '../../app.setup.js';
import { parseEnv } from '../../config/env.schema.js';
import { PracticeScoped, practiceScopeOf } from '../tenancy/practice-scoped.decorator.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { isPublicHandler, Public } from './public.decorator.js';

/** A route that answers without authentication, under the path Nest serves it at. */
interface PublicRoute {
  handler: string;
  method: string;
  path: string;
}

/** Any route, with what the architecture rules read about it. */
interface MappedRoute {
  handler: string;
  path: string;
  isPublic: boolean;
  practiceScope: string | undefined;
  hasUnvalidatedInput: boolean;
}

interface Inventory {
  publicRoutes: PublicRoute[];
  routes: MappedRoute[];
  /** Routed methods whose instance property is not the prototype's method (a bound handler). */
  reboundHandlers: string[];
}

type Imports = NonNullable<ModuleMetadata['imports']>;

/** The runtime types the ValidationPipe skips: an interface or `import type` compiles to Object. */
const TYPES_WITHOUT_VALIDATION: readonly unknown[] = [
  Object,
  Array,
  String,
  Number,
  Boolean,
  undefined,
];

/** The route argument kinds the rule reads, as Nest writes them in its metadata keys. */
const VALIDATED_PARAMTYPES: ReadonlySet<string> = new Set([
  String(RouteParamtypes.BODY),
  String(RouteParamtypes.QUERY),
]);

/** Whether a whole `@Body()` or `@Query()` of a handler has a type the pipe would not validate. */
function hasUnvalidatedInput(controller: object, prototype: object, method: string): boolean {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Readonly<
    Record<string, { index: number; data?: unknown }>
  >;
  const types = (Reflect.getMetadata('design:paramtypes', prototype, method) ??
    []) as readonly unknown[];
  return Object.entries(args).some(([key, { index, data }]) => {
    const isWholeInput = VALIDATED_PARAMTYPES.has(key.split(':')[0] ?? '') && data === undefined;
    return isWholeInput && TYPES_WITHOUT_VALIDATION.includes(types[index]);
  });
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

/** Metadata that Nest stores as one value or as several. */
function valuesOf(metadata: unknown): unknown[] {
  return Array.isArray(metadata) ? metadata : [metadata];
}

function pathsOf(metadata: unknown): string[] {
  return valuesOf(metadata).filter((path): path is string => typeof path === 'string');
}

function joinPath(...parts: string[]): string {
  const segments = parts.map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${segments.join('/')}`;
}

/** The path RouterModule mounts a module at, read as Nest's RoutesResolver reads it. */
function modulePathOf(moduleType: unknown, applicationId: string): string {
  if (typeof moduleType !== 'function') return '';
  const path: unknown =
    Reflect.getMetadata(`${MODULE_PATH}${applicationId}`, moduleType) ??
    Reflect.getMetadata(MODULE_PATH, moduleType);
  return typeof path === 'string' ? path : '';
}

/**
 * The paths Nest serves a route at. As in Nest 12, the controller's version is its own, or version
 * 1 (`API_VERSIONING`) when it has none (RoutesResolver, `??`); the route's version is the method's
 * when that is truthy, otherwise the controller's (RoutePathFactory, `||`). An empty result or a
 * version-neutral one gets no version prefix; every other version gives `/api/v<version>`. A
 * version this test cannot read gives a path that no expected list contains, so it fails closed.
 */
function servedPathsOf(
  methodVersion: unknown,
  controllerVersion: unknown,
  route: string,
): string[] {
  const version: unknown =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- RoutePathFactory uses ||
    methodVersion || (controllerVersion ?? API_VERSIONING.defaultVersion);
  if (!version) return [route];
  return valuesOf(version).map((each) => {
    if (each === VERSION_NEUTRAL) return route;
    if (typeof each === 'string') return `/${API_VERSIONING.prefix}${each}${route}`;
    return `(unreadable version)${route}`;
  });
}

/**
 * The controller instance whose properties the guard sees. A request-scoped controller (also one
 * that a request-scoped dependency makes so) is created for each request, so one is resolved here.
 */
async function routedInstanceOf(
  moduleRef: TestingModule,
  wrapper: ReturnType<DiscoveryService['getControllers']>[number],
): Promise<unknown> {
  if (wrapper.isDependencyTreeStatic()) return wrapper.instance as unknown;
  const contextId = ContextIdFactory.create();
  moduleRef.registerRequestByContextId({}, contextId);
  return (await moduleRef.resolve(wrapper.token, contextId, { strict: false })) as unknown;
}

/**
 * The public routes of the controllers Nest registers for `imports`, read at runtime, so a marker
 * applied through a composed decorator counts too. As Nest does (PathsExplorer), a route's path,
 * method and version come from the prototype's method, and the handler that the guard checks is
 * the instance's property; a module path set by RouterModule comes before the controller path.
 */
async function inventoryOf(imports: Imports): Promise<Inventory> {
  const moduleRef = await Test.createTestingModule({
    imports: [...imports, DiscoveryModule],
  }).compile();
  try {
    const scanner = moduleRef.get(MetadataScanner);
    const { applicationId } = moduleRef.get(ModulesContainer);
    const inventory: Inventory = { publicRoutes: [], routes: [], reboundHandlers: [] };
    for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
      const { metatype } = wrapper;
      if (typeof metatype !== 'function') continue;
      const instance = await routedInstanceOf(moduleRef, wrapper);
      const prototype: unknown = metatype.prototype;
      if (!isObject(prototype)) continue;
      const modulePath = modulePathOf(wrapper.host?.metatype, applicationId);
      const controllerPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, metatype));
      const controllerVersion: unknown = Reflect.getMetadata(VERSION_METADATA, metatype);
      for (const name of scanner.getAllMethodNames(prototype)) {
        const method: unknown = Reflect.get(prototype, name);
        if (typeof method !== 'function') continue;
        const methodPaths = pathsOf(Reflect.getMetadata(PATH_METADATA, method));
        if (methodPaths.length === 0) continue;
        const label = `${metatype.name}.${name}`;
        const handler: unknown = isObject(instance) ? Reflect.get(instance, name) : method;
        if (handler !== method) inventory.reboundHandlers.push(label);
        if (typeof handler !== 'function') continue;
        const isPublic = isPublicHandler(handler);
        const practiceScope = practiceScopeOf(handler);
        const requestMethod: unknown = Reflect.getMetadata(METHOD_METADATA, method);
        const httpMethod =
          typeof requestMethod === 'number'
            ? (RequestMethod[requestMethod] ?? 'unknown')
            : 'unknown';
        const methodVersion: unknown = Reflect.getMetadata(VERSION_METADATA, method);
        for (const controllerPath of controllerPaths) {
          for (const methodPath of methodPaths) {
            const route = joinPath(modulePath, controllerPath, methodPath);
            for (const path of servedPathsOf(methodVersion, controllerVersion, route)) {
              inventory.routes.push({
                handler: label,
                path,
                isPublic,
                practiceScope,
                hasUnvalidatedInput: hasUnvalidatedInput(metatype, prototype, name),
              });
              if (isPublic)
                inventory.publicRoutes.push({ handler: label, method: httpMethod, path });
            }
          }
        }
      }
    }
    inventory.publicRoutes.sort((a, b) => a.path.localeCompare(b.path));
    return inventory;
  } finally {
    await moduleRef.close();
  }
}

@Controller('things')
class MountedController {
  @Public() // test-only: public, in a module that RouterModule mounts at /mounted
  @Get(':id')
  thing(): void {
    // a route handler's body does not matter here
  }
}

@Module({ controllers: [MountedController] })
class MountedModule {}

@Controller({ path: 'versioned', version: ['2', VERSION_NEUTRAL] })
class VersionedController {
  @Public() // test-only: public under version 2 and without a version
  @Get()
  open(): void {
    // a route handler's body does not matter here
  }

  @Public() // test-only: an empty method version, which Nest treats as none (||)
  @Version('')
  @Get('empty')
  empty(): void {
    // a route handler's body does not matter here
  }
}

@Controller('rebound')
class ReboundController {
  constructor() {
    this.handle = this.handle.bind(this);
  }

  @Public() // test-only: the constructor binds the handler, so the guard sees an unmarked function
  @Get()
  handle(): void {
    // a route handler's body does not matter here
  }
}

@Controller({ path: 'scoped', scope: Scope.REQUEST })
class RequestScopedController {
  constructor() {
    this.handle = this.handle.bind(this);
  }

  @Public() // test-only: created for each request, whose constructor binds the handler
  @Get()
  handle(): void {
    // a route handler's body does not matter here
  }
}

@Controller({ path: 'blank', version: '' })
class BlankVersionController {
  @Public() // test-only: an empty controller version, which Nest serves without a version prefix
  @Get()
  open(): void {
    // a route handler's body does not matter here
  }
}

@Module({
  imports: [MountedModule, RouterModule.register([{ path: 'mounted', module: MountedModule }])],
  controllers: [
    VersionedController,
    BlankVersionController,
    ReboundController,
    RequestScopedController,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthenticationGuard }],
})
class FixtureModule {}

describe('the route inventory', () => {
  it('lists module paths, versions and the handler the guard checks, and reports a bound handler', async () => {
    expect(await inventoryOf([FixtureModule])).toMatchObject({
      publicRoutes: [
        { handler: 'MountedController.thing', method: 'GET', path: '/api/v1/mounted/things/:id' },
        { handler: 'VersionedController.open', method: 'GET', path: '/api/v2/versioned' },
        { handler: 'VersionedController.empty', method: 'GET', path: '/api/v2/versioned/empty' },
        { handler: 'BlankVersionController.open', method: 'GET', path: '/blank' },
        { handler: 'VersionedController.open', method: 'GET', path: '/versioned' },
        { handler: 'VersionedController.empty', method: 'GET', path: '/versioned/empty' },
      ],
      reboundHandlers: ['ReboundController.handle', 'RequestScopedController.handle'],
    });
  });

  it('matches what a running app serves: the listed paths answer, nearby paths do not, the bound handlers are closed', async () => {
    const { publicRoutes } = await inventoryOf([FixtureModule]);
    const moduleRef = await Test.createTestingModule({ imports: [FixtureModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.enableVersioning(API_VERSIONING);
    await app.init();
    try {
      const server = app.getHttpServer();
      const statusOf = async (path: string): Promise<number> =>
        (await request(server).get(path)).status;
      const listed = publicRoutes.map(({ path }) => path.replace(':id', '1'));
      const statuses: Record<string, number> = {};
      for (const path of listed) statuses[path] = await statusOf(path);
      expect(statuses).toEqual(Object.fromEntries(listed.map((path) => [path, 200])));
      // Paths a wrong inventory would list instead: Nest serves none of them.
      const unserved = [
        '/api/v1/versioned',
        '/api/v1/versioned/empty',
        '/api/v1/blank',
        '/api/v/blank',
        '/things/1',
        '/scoped',
      ];
      const misses: Record<string, number> = {};
      for (const path of unserved) misses[path] = await statusOf(path);
      expect(misses).toEqual(Object.fromEntries(unserved.map((path) => [path, 404])));
      expect({
        rebound: await statusOf('/api/v1/rebound'),
        scoped: await statusOf('/api/v1/scoped'),
      }).toEqual({ rebound: 401, scoped: 401 });
    } finally {
      await app.close();
    }
  });
});

/** The only path prefixes under which a route may answer without sign-in (02 §4). */
const PUBLIC_PREFIXES = ['/api/v1/public/', '/health/'];

function publicOutsideTheAllowedPaths(routes: readonly MappedRoute[]): string[] {
  return routes
    .filter(({ isPublic, path }) => isPublic && !PUBLIC_PREFIXES.some((p) => path.startsWith(p)))
    .map(({ handler }) => handler);
}

/** A route under a practice's path must resolve that practice, or it could serve any (ADR 0005). */
function practicePathsWithoutScope(routes: readonly MappedRoute[]): string[] {
  return routes
    .filter(
      ({ path, practiceScope }) =>
        path.includes('/practices/:practiceId') && practiceScope === undefined,
    )
    .map(({ handler }) => handler);
}

/** The slug scope belongs to public routes under /public/practices/:slug only. */
function slugScopesOutsidePublicPaths(routes: readonly MappedRoute[]): string[] {
  return routes
    .filter(
      ({ path, practiceScope }) =>
        practiceScope === 'slug' && !path.startsWith('/api/v1/public/practices/:slug'),
    )
    .map(({ handler }) => handler);
}

@Controller('practices/:practiceId/things')
class RuleBreakingController {
  @Public() // test-only: public outside the allowed paths, and under a practice without a scope
  @Get()
  open(): void {
    // a route handler's body does not matter here
  }

  @PracticeScoped('slug') // test-only: the slug scope outside the public paths
  @Get('by-slug')
  bySlug(): void {
    // a route handler's body does not matter here
  }
}

/** What a body typed without a class looks like: the ValidationPipe never sees its shape. */
interface UntypedBody {
  role: string;
}

class TypedQueryDto {
  page?: string;
}

@Controller('input-rules')
class InputRulesController {
  @Post('untyped') // test-only: a body the pipe would skip
  untyped(@Body() body: UntypedBody): boolean {
    return body.role === 'ADMIN';
  }

  @Get('typed') // test-only: a query with a class, and a single named value, which are fine
  typed(@Query() query: TypedQueryDto, @Query('other') other: string): boolean {
    return query.page === other;
  }
}

function inputsWithoutValidation(routes: readonly MappedRoute[]): string[] {
  return routes.filter((route) => route.hasUnvalidatedInput).map(({ handler }) => handler);
}

@Module({ controllers: [RuleBreakingController, InputRulesController] })
class RuleBreakingModule {}

describe('the route rules (02 §11)', () => {
  it('hold for the app', async () => {
    const { routes } = await inventoryOf([AppModule.forRoot(parseEnv(TEST_ENV))]);
    expect(routes.length).toBeGreaterThan(0);
    expect(publicOutsideTheAllowedPaths(routes)).toEqual([]);
    expect(practicePathsWithoutScope(routes)).toEqual([]);
    expect(slugScopesOutsidePublicPaths(routes)).toEqual([]);
    expect(inputsWithoutValidation(routes)).toEqual([]);
  });

  it('fail for a controller that breaks them', async () => {
    const { routes } = await inventoryOf([RuleBreakingModule]);
    expect(publicOutsideTheAllowedPaths(routes)).toEqual(['RuleBreakingController.open']);
    expect(practicePathsWithoutScope(routes)).toEqual(['RuleBreakingController.open']);
    expect(slugScopesOutsidePublicPaths(routes)).toEqual(['RuleBreakingController.bySlug']);
    expect(inputsWithoutValidation(routes)).toEqual(['InputRulesController.untyped']);
  });
});

describe('public routes (02 §4)', () => {
  it('are exactly the list of practices, the practice page and the two health probes: a new public route is a reviewed change to this list', async () => {
    expect(await inventoryOf([AppModule.forRoot(parseEnv(TEST_ENV))])).toMatchObject({
      publicRoutes: [
        {
          handler: 'PublicPracticeController.listPublicPractices',
          method: 'GET',
          path: '/api/v1/public/practices',
        },
        {
          handler: 'PublicPracticeController.getPublicPractice',
          method: 'GET',
          path: '/api/v1/public/practices/:slug',
        },
        { handler: 'HealthController.live', method: 'GET', path: '/health/live' },
        { handler: 'HealthController.ready', method: 'GET', path: '/health/ready' },
      ],
      reboundHandlers: [],
    });
  });
});
