import { renderTable, escapeCell, firstSentence } from "./markdown-table.js";

export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  definitions?: Record<string, JsonSchema>;
}

const PREFIX = "schema:";

export function anchorFor(name: string): string {
  return `#${name.toLowerCase()}`;
}

function refName(ref: string): string {
  return ref.replace("#/definitions/", "");
}

function refLink(ref: string): string {
  const name = refName(ref);
  return `[\`${name}\`](${anchorFor(name)})`;
}

function literal(value: unknown): string {
  return typeof value === "string"
    ? `\`${value}\``
    : `\`${JSON.stringify(value)}\``;
}

function renderType(schema: JsonSchema): string {
  if (schema.$ref) return refLink(schema.$ref);
  if (schema.const !== undefined) return literal(schema.const);
  if (schema.enum) return schema.enum.map(literal).join(" \\| ");

  const members = schema.oneOf ?? schema.anyOf;
  if (members) {
    const rendered = members.map(renderType).filter(Boolean);
    return [...new Set(rendered)].join(" \\| ");
  }

  if (schema.type === "array") {
    const items = schema.items ? renderType(schema.items) : "`any`";
    return items.endsWith("`") && !items.includes("](")
      ? `${items.slice(0, -1)}[]\``
      : `${items}[]`;
  }

  if (
    schema.type === "object" &&
    typeof schema.additionalProperties === "object"
  ) {
    const values = renderType(schema.additionalProperties);
    return `\`object\` of ${values}`;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map((t) => `\`${t}\``).join(" \\| ");
  }

  return schema.type ? `\`${schema.type}\`` : "`any`";
}

function renderDefault(schema: JsonSchema): string {
  return schema.default === undefined ? "-" : literal(schema.default);
}

// mdformat pads every cell to its column width, so one long description widens
// every row in the table. Detail beyond the first sentence goes in a list below.
function propertyDetails(schema: JsonSchema): string[] {
  return Object.entries(schema.properties ?? {})
    .map(([name, property]): [string, string] => {
      const description = escapeCell(property.description);
      return [
        name,
        description.slice(firstSentence(description).length).trim(),
      ];
    })
    .filter(([, rest]) => rest.length > 0)
    .map(([name, rest]) => `- \`${name}\` — ${rest}`);
}

function propertyTable(schema: JsonSchema): string {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const rows = Object.entries(properties).map(([name, property]) => [
    `\`${name}\``,
    renderType(property),
    required.has(name) ? "Yes" : "No",
    renderDefault(property),
    firstSentence(escapeCell(property.description)),
  ]);

  return renderTable(
    ["Field", "Type", "Required", "Default", "Description"],
    rows
  );
}

function renderDefinition(name: string, schema: JsonSchema): string {
  const parts: string[] = [];

  if (schema.description) parts.push(escapeCell(schema.description));

  const members = schema.oneOf ?? schema.anyOf;
  if (members && !schema.properties) {
    const label = schema.oneOf ? "One of:" : "Any of:";
    parts.push(
      [label, "", ...members.map((member) => `- ${renderType(member)}`)].join(
        "\n"
      )
    );
  }

  if (schema.properties) {
    parts.push(propertyTable(schema));
    const details = propertyDetails(schema);
    if (details.length > 0) parts.push(details.join("\n"));
  }

  if (
    schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  ) {
    parts.push(
      `Additional keys map to ${renderType(schema.additionalProperties)}.`
    );
  }

  if (parts.length === 0) {
    parts.push(`\`${name}\` is ${renderType(schema)}.`);
  }

  return parts.join("\n\n");
}

export function schemaBlockIds(schema: JsonSchema): string[] {
  return [
    `${PREFIX}root`,
    ...Object.keys(schema.definitions ?? {}).map((name) => `${PREFIX}${name}`),
  ];
}

export function renderSchemaBlock(schema: JsonSchema, id: string): string {
  const name = id.slice(PREFIX.length);
  if (name === "root") {
    const details = propertyDetails(schema);
    return details.length > 0
      ? `${propertyTable(schema)}\n\n${details.join("\n")}`
      : propertyTable(schema);
  }

  const definition = schema.definitions?.[name];
  if (!definition) throw new Error(`unknown schema definition '${name}'`);
  return renderDefinition(name, definition);
}
