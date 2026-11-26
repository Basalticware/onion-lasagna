/**
 * @fileoverview Path parameter extraction types.
 *
 * These types enable TypeScript to extract path parameter names from
 * URL path templates at compile time, providing full type safety for
 * path parameters in routes.
 *
 * @module unified/route/types/path-params
 */

import { InvalidRequestError } from '../../../exceptions/invalid-request.error';

/** Path values that URL parsing treats as dot segments (F6). */
const DOT_SEGMENTS: ReadonlySet<string> = new Set(['.', '..']);

const DOT_SEGMENT_MESSAGE = 'Path value must not be "." or ".."';

/**
 * A valid path-parameter identifier must start with a letter or underscore,
 * followed by zero or more letters, digits, or underscores — matching the
 * regex `[a-zA-Z_][a-zA-Z0-9_]*` that the runtime helpers enforce.
 */
type IsIdentifier<S extends string> = S extends `${infer First}${string}`
  ? First extends
      | 'a'
      | 'b'
      | 'c'
      | 'd'
      | 'e'
      | 'f'
      | 'g'
      | 'h'
      | 'i'
      | 'j'
      | 'k'
      | 'l'
      | 'm'
      | 'n'
      | 'o'
      | 'p'
      | 'q'
      | 'r'
      | 's'
      | 't'
      | 'u'
      | 'v'
      | 'w'
      | 'x'
      | 'y'
      | 'z'
      | 'A'
      | 'B'
      | 'C'
      | 'D'
      | 'E'
      | 'F'
      | 'G'
      | 'H'
      | 'I'
      | 'J'
      | 'K'
      | 'L'
      | 'M'
      | 'N'
      | 'O'
      | 'P'
      | 'Q'
      | 'R'
      | 'S'
      | 'T'
      | 'U'
      | 'V'
      | 'W'
      | 'X'
      | 'Y'
      | 'Z'
      | '_'
    ? true
    : false
  : false;

/**
 * Extracts parameter names from a path template string.
 *
 * Supports both `:param` and `{param}` syntaxes for maximum compatibility
 * with different routing conventions.
 *
 * Only identifier-shaped parameters are extracted (i.e. names that start with a
 * letter or underscore), matching the `[a-zA-Z_][a-zA-Z0-9_]*` constraint the
 * runtime helpers apply. This prevents non-param colons (e.g. the `:` in a
 * time literal like `/schedule/12:30`) from being misinterpreted as params.
 *
 * @example Colon syntax (Express-style)
 * ```typescript
 * type Params = ExtractPathParamNames<'/users/:userId/posts/:postId'>;
 * // 'userId' | 'postId'
 * ```
 *
 * @example Brace syntax (OpenAPI-style)
 * ```typescript
 * type Params = ExtractPathParamNames<'/users/{userId}/posts/{postId}'>;
 * // 'userId' | 'postId'
 * ```
 *
 * @example No parameters
 * ```typescript
 * type Params = ExtractPathParamNames<'/users'>;
 * // never
 * ```
 *
 * @example Non-identifier colon (not a param)
 * ```typescript
 * type Params = ExtractPathParamNames<'/time/12:30'>;
 * // never — '30' does not start with a letter or underscore
 * ```
 */
export type ExtractPathParamNames<T extends string> =
  // Match :param followed by more path
  T extends `${string}:${infer Param}/${infer Rest}`
    ? IsIdentifier<Param> extends true
      ? Param | ExtractPathParamNames<`/${Rest}`>
      : ExtractPathParamNames<`/${Rest}`>
    : // Match :param at end
      T extends `${string}:${infer Param}`
      ? IsIdentifier<Param> extends true
        ? Param
        : never
      : // Match {param} followed by more path
        T extends `${string}{${infer Param}}/${infer Rest}`
        ? Param | ExtractPathParamNames<`/${Rest}`>
        : // Match {param} at end
          T extends `${string}{${infer Param}}`
          ? Param
          : never;

/**
 * Creates an object type with all path parameters as string properties.
 *
 * @example
 * ```typescript
 * type Params = PathParams<'/projects/:projectId/tasks/:taskId'>;
 * // { projectId: string; taskId: string }
 *
 * type NoParams = PathParams<'/projects'>;
 * // Record<string, never> (empty object type)
 * ```
 */
export type PathParams<T extends string> =
  ExtractPathParamNames<T> extends never
    ? Record<string, never>
    : Record<ExtractPathParamNames<T>, string>;

/**
 * Checks if a path has any parameters.
 *
 * @example
 * ```typescript
 * type HasParams = HasPathParams<'/users/:id'>; // true
 * type NoParams = HasPathParams<'/users'>; // false
 * ```
 */
export type HasPathParams<T extends string> = ExtractPathParamNames<T> extends never ? false : true;

/**
 * Converts a path template with parameters to a regex pattern.
 * This is used internally for route matching.
 *
 * @example
 * ```typescript
 * pathToRegex('/users/:id/posts/:postId')
 * // /^\/users\/([^\/]+)\/posts\/([^\/]+)\/?$/
 * ```
 */
export function pathToRegex(path: string): RegExp {
  const pattern = path
    // Escape special regex characters except : and {}
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Replace :param with capture group
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '([^/]+)')
    // Replace {param} with capture group
    .replace(/\\\{([a-zA-Z_][a-zA-Z0-9_]*)\\\}/g, '([^/]+)');

  return new RegExp(`^${pattern}/?$`);
}

/**
 * Extracts parameter names from a path string at runtime.
 *
 * @example
 * ```typescript
 * getPathParamNames('/users/:userId/posts/:postId')
 * // ['userId', 'postId']
 * ```
 */
export function getPathParamNames(path: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- regex capture group always exists
  const colonParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]!);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- regex capture group always exists
  const braceParams = [...path.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]!);
  return [...colonParams, ...braceParams];
}

/**
 * Checks if a path has any parameters at runtime.
 */
export function hasPathParams(path: string): boolean {
  return /:([a-zA-Z_][a-zA-Z0-9_]*)/.test(path) || /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/.test(path);
}

/**
 * Replaces path parameters with actual values.
 *
 * Uses regex with a word-boundary pattern (`(?![a-zA-Z0-9_])`) so that a
 * shorter param name never corrupts a longer param that shares the same prefix
 * (C12-1). All occurrences of each placeholder are replaced (C12-2).
 *
 * @example
 * ```typescript
 * buildPath('/users/:userId/posts/:postId', { userId: '123', postId: '456' })
 * // '/users/123/posts/456'
 *
 * buildPath('/users/{userId}', { userId: '123' })
 * // '/users/123'
 * ```
 *
 * @example A dot-segment value is refused (F6)
 * ```typescript
 * buildPath('/users/:id/profile', { id: '..' })
 * // throws InvalidRequestError (code 'INVALID_REQUEST', field 'pathParams.id')
 * ```
 *
 * @throws {InvalidRequestError} When a value that fills a placeholder is
 *   exactly `.` or `..` after encoding. URL parsing collapses such a dot
 *   segment (`/users/../profile` becomes `/profile`), so the value would
 *   retarget the route. Percent-encoding does not help: WHATWG URL treats
 *   `%2e%2e` as `..` too. Values that merely contain dots (`a.b`, `..a`) build.
 *   The check is on the whole value, not on the segment it lands in, so a
 *   template such as `/files/:name.json` refuses `name: '..'` as well.
 */
export function buildPath(template: string, params: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(params)) {
    const encoded = encodeURIComponent(value);

    // C12-1 fix: use a negative-lookahead `(?![a-zA-Z0-9_])` so `:id` never
    // matches inside `:idType`.  The lookahead is zero-width, so it does not
    // consume the following character.
    // C12-2 fix: use the `g` flag so every occurrence is replaced.
    const colonRegex = new RegExp(`:${key}(?![a-zA-Z0-9_])`, 'g');

    // Brace syntax is already boundary-safe (closing `}` acts as a natural
    // boundary), but we still use the global flag to replace all occurrences.
    const braceRegex = new RegExp(`\\{${key}\\}`, 'g');

    // F6: refuse a value that would become a `.` or `..` path segment. Checked
    // on the encoded value, and only when the key fills a placeholder.
    if (
      DOT_SEGMENTS.has(encoded) &&
      (result.search(colonRegex) !== -1 || result.search(braceRegex) !== -1)
    ) {
      throw new InvalidRequestError({
        message: `Path parameter "${key}" must not be "." or ".."`,
        validationErrors: [{ field: `pathParams.${key}`, message: DOT_SEGMENT_MESSAGE }],
      });
    }

    result = result.replace(colonRegex, encoded);
    result = result.replace(braceRegex, encoded);
  }

  return result;
}

/**
 * Normalizes a path template to use consistent :param syntax.
 *
 * @example
 * ```typescript
 * normalizePath('/users/{userId}')
 * // '/users/:userId'
 * ```
 */
export function normalizePath(path: string): string {
  return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, ':$1');
}
