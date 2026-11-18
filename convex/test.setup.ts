/// <reference types="vite/client" />
// Every Convex module (including _generated), for convex-test.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
]);
