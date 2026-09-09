import { createRequire } from "node:module";

/**
 * Single source of truth for the version string. It used to be duplicated as
 * a literal in `cli.ts` and `mcp/server.ts` (kept in step by release-please
 * `extra-files` annotations); reading package.json means a release can only
 * ever bump one place. package.json ships inside the published tarball, and
 * this module sits one directory below it both in `src/` and in `dist/`.
 */
const require = createRequire(import.meta.url);

export const VERSION: string = (require("../package.json") as { version: string }).version;
