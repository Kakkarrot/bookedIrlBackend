import type { SchemaManifest } from "./schemaManifest";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type SchemaManifestDiffOptions = {
  ignoreRemoteOnlyExtensions?: Iterable<string>;
};

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

function compareNamedObjectMaps(
  local: Record<string, JsonValue>,
  remote: Record<string, JsonValue>,
  path: string,
  diffs: string[]
) {
  const names = [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const name of names) {
    const nextPath = joinPath(path, name);

    if (!(name in remote)) {
      diffs.push(`remote missing at ${nextPath}: expected ${JSON.stringify(local[name])}`);
      continue;
    }

    if (!(name in local)) {
      diffs.push(`remote extra at ${nextPath}: ${JSON.stringify(remote[name])}`);
      continue;
    }

    compareValues(local[name], remote[name], nextPath, diffs);
  }
}

export function diffSchemaManifest(
  local: SchemaManifest,
  remote: SchemaManifest,
  options: SchemaManifestDiffOptions = {}
) {
  const diffs: string[] = [];

  const ignoredRemoteOnlyExtensions = new Set(options.ignoreRemoteOnlyExtensions ?? []);
  const localExtensions = Object.keys(local.extensions).sort((a, b) => a.localeCompare(b));
  const remoteExtensions = Object.keys(remote.extensions).sort((a, b) => a.localeCompare(b));

  for (const extensionName of localExtensions) {
    if (!(extensionName in remote.extensions)) {
      diffs.push(`remote missing extension: ${extensionName}`);
    }
  }

  for (const extensionName of remoteExtensions) {
    if (!(extensionName in local.extensions) && !ignoredRemoteOnlyExtensions.has(extensionName)) {
      diffs.push(`remote extra extension: ${extensionName}`);
    }
  }

  compareNamedObjectMaps(
    local.tables as Record<string, JsonValue>,
    remote.tables as Record<string, JsonValue>,
    "schema.tables",
    diffs
  );

  return diffs;
}
