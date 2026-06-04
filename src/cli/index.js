#!/usr/bin/env node
import { MiniJIT } from "../api/engine.js";
import fs from "fs";
import path from "path";

const file = process.argv[2];

if (!file) {
  const { startREPL } = await import("./repl.js");
  startREPL(new MiniJIT());
} else {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) {
    console.error(`Error: file not found: ${file}`);
    process.exit(1);
  }
  const source = fs.readFileSync(resolved, "utf8");
  const engine = new MiniJIT();
  engine.run(source);
}
