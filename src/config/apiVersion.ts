import fs from "node:fs";
import path from "node:path";

function readOpenApiVersion(): string | null {
  const specPath = path.resolve(process.cwd(), "openapi.yaml");
  if (!fs.existsSync(specPath)) {
    return null;
  }
  const content = fs.readFileSync(specPath, "utf8");
  const lines = content.split(/\r?\n/);
  let inInfo = false;
  for (const line of lines) {
    if (line.trim() === "info:") {
      inInfo = true;
      continue;
    }
    if (inInfo && /^[^\s]/.test(line)) {
      inInfo = false;
    }
    if (inInfo) {
      const match = line.match(/^\s*version:\s*([^\s#]+)/);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}

export const apiVersion = process.env.API_VERSION ?? readOpenApiVersion();

if (!apiVersion) {
  throw new Error("API version not found. Set API_VERSION or ensure openapi.yaml has info.version.");
}
