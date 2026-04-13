import type { SchemaManifest } from "./schemaManifest";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(basePath: string, nextSegment: string) {
  return basePath ? `${basePath}.${nextSegment}` : nextSegment;
}

function compareValues(left: JsonValue, right: JsonValue, path: string, diffs: string[]) {
  if (Array.isArray(left) && Array.isArray(right)) {
    const maxLength = Math.max(left.length, right.length);

    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = `${path}[${index}]`;

      if (index >= left.length) {
        diffs.push(`remote extra at ${nextPath}: ${JSON.stringify(right[index])}`);
        continue;
      }

      if (index >= right.length) {
        diffs.push(`remote missing at ${nextPath}: expected ${JSON.stringify(left[index])}`);
        continue;
      }

      compareValues(left[index], right[index], nextPath, diffs);
    }

    return;
  }

  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) =>
      a.localeCompare(b)
    );

    for (const key of keys) {
      const nextPath = joinPath(path, key);

      if (!(key in right)) {
        diffs.push(`remote missing at ${nextPath}: expected ${JSON.stringify(left[key])}`);
        continue;
      }

      if (!(key in left)) {
        diffs.push(`remote extra at ${nextPath}: ${JSON.stringify(right[key])}`);
        continue;
      }

      compareValues(left[key], right[key], nextPath, diffs);
    }

    return;
  }

  if (left !== right) {
    diffs.push(
      `mismatch at ${path}: local=${JSON.stringify(left)} remote=${JSON.stringify(right)}`
    );
  }
}

export function diffSchemaManifest(local: SchemaManifest, remote: SchemaManifest) {
  const diffs: string[] = [];

  compareValues(local as JsonValue, remote as JsonValue, "schema", diffs);

  return diffs;
}
