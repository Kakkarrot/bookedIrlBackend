import type { Pool } from "pg";

export type SchemaColumn = {
  type: string;
  isNullable: boolean;
  defaultValue: string | null;
};

export type SchemaConstraint = {
  type: string;
  definition: string;
};

export type SchemaIndex = {
  definition: string;
};

export type SchemaTable = {
  columns: Record<string, SchemaColumn>;
  constraints: Record<string, SchemaConstraint>;
  indexes: Record<string, SchemaIndex>;
};

export type SchemaManifest = {
  extensions: Record<string, true>;
  tables: Record<string, SchemaTable>;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSqlExpression(value: string | null) {
  if (!value) {
    return null;
  }

  let normalized = normalizeWhitespace(value);

  // Postgres often wraps defaults in redundant outer parentheses when introspected.
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    const candidate = normalized.slice(1, -1).trim();
    if (!candidate) {
      break;
    }
    normalized = candidate;
  }

  return normalized;
}

export async function readSchemaManifest(pool: Pool): Promise<SchemaManifest> {
  const [extensionsResult, columnsResult, constraintsResult, indexesResult] = await Promise.all([
    pool.query<{ extname: string }>(
      `
      SELECT extname
      FROM pg_extension
      WHERE extname NOT IN ('plpgsql')
      ORDER BY extname
      `
    ),
    pool.query<{
      table_name: string;
      column_name: string;
      formatted_type: string;
      is_nullable: boolean;
      default_value: string | null;
    }>(
      `
      SELECT
        cls.relname AS table_name,
        attr.attname AS column_name,
        pg_catalog.format_type(attr.atttypid, attr.atttypmod) AS formatted_type,
        NOT attr.attnotnull AS is_nullable,
        pg_get_expr(def.adbin, def.adrelid) AS default_value
      FROM pg_attribute attr
      INNER JOIN pg_class cls
        ON cls.oid = attr.attrelid
      INNER JOIN pg_namespace ns
        ON ns.oid = cls.relnamespace
      LEFT JOIN pg_attrdef def
        ON def.adrelid = attr.attrelid
       AND def.adnum = attr.attnum
      WHERE ns.nspname = 'public'
        AND cls.relkind = 'r'
        AND attr.attnum > 0
        AND NOT attr.attisdropped
      ORDER BY cls.relname, attr.attnum
      `
    ),
    pool.query<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      definition: string;
    }>(
      `
      SELECT
        tbl.relname AS table_name,
        con.conname AS constraint_name,
        con.contype AS constraint_type,
        pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      INNER JOIN pg_class tbl
        ON tbl.oid = con.conrelid
      INNER JOIN pg_namespace ns
        ON ns.oid = tbl.relnamespace
      WHERE ns.nspname = 'public'
      ORDER BY tbl.relname, con.conname
      `
    ),
    pool.query<{
      table_name: string;
      index_name: string;
      definition: string;
    }>(
      `
      SELECT
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS definition
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname
      `
    )
  ]);

  const tables = new Map<string, SchemaTable>();

  const getOrCreateTable = (tableName: string) => {
    const existing = tables.get(tableName);
    if (existing) {
      return existing;
    }

    const created: SchemaTable = {
      columns: {},
      constraints: {},
      indexes: {}
    };
    tables.set(tableName, created);
    return created;
  };

  for (const row of columnsResult.rows) {
    getOrCreateTable(row.table_name).columns[row.column_name] = {
      type: normalizeWhitespace(row.formatted_type),
      isNullable: row.is_nullable,
      defaultValue: normalizeSqlExpression(row.default_value)
    };
  }

  for (const row of constraintsResult.rows) {
    getOrCreateTable(row.table_name).constraints[row.constraint_name] = {
      type: row.constraint_type,
      definition: normalizeWhitespace(row.definition)
    };
  }

  for (const row of indexesResult.rows) {
    getOrCreateTable(row.table_name).indexes[row.index_name] = {
      definition: normalizeWhitespace(row.definition)
    };
  }

  const normalizedTables = Object.fromEntries(
    [...tables.entries()].sort(([left], [right]) => left.localeCompare(right))
  );

  return {
    extensions: Object.fromEntries(
      extensionsResult.rows.map((row) => [row.extname, true] as const)
    ),
    tables: normalizedTables
  };
}
