// All Convex function modules, for convexTest(schema, modules).
// Tests live outside convex/, so the glob points back into it. It must
// include convex/_generated so convex-test can locate the modules root.
export const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "../../convex/**/*.js",
  "!../../convex/**/*.d.ts",
]);
