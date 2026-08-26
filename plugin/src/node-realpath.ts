import { realpath as nodeRealpath } from "fs/promises";

// The community review environment does not load @types/node, so the
// fs/promises import degrades to an error-typed value there. Widen through
// unknown first (always allowed) and pin the stable
// (path: string) => Promise<string> signature here so every call site stays
// fully typed in both environments.
const nodeRealpathImpl: unknown = nodeRealpath;
export const realpath = nodeRealpathImpl as (path: string) => Promise<string>;
