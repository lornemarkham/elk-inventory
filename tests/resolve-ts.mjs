// Test-only resolve hook: api/ uses extensionless imports (what Vercel's
// bundler expects); Node's type stripping needs the .ts, so add it here.
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (err) {
    if (spec.startsWith(".") && !/\\.[cm]?[jt]s$/.test(spec)) return next(spec + ".ts", ctx);
    throw err;
  }
}`));
