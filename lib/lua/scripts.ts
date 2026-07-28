import { readFileSync } from "node:fs";
import path from "node:path";

const luaDir = path.join(process.cwd(), "lib", "lua");

export const luaScripts = {
  reserveStock: readFileSync(path.join(luaDir, "reserveStock.lua"), "utf8"),
  releaseStock: readFileSync(path.join(luaDir, "releaseStock.lua"), "utf8"),
  enqueue: readFileSync(path.join(luaDir, "enqueue.lua"), "utf8"),
  promote: readFileSync(path.join(luaDir, "promote.lua"), "utf8"),
};

export const luaShas: Record<keyof typeof luaScripts, string> = {
  reserveStock: "",
  releaseStock: "",
  enqueue: "",
  promote: "",
};