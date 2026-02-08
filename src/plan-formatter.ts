import chalk from "chalk";

export type ResourceType = "file" | "ruleset" | "setting";
export type ResourceAction = "create" | "update" | "delete" | "unchanged";

export interface Resource {
  type: ResourceType;
  repo: string;
  name: string;
  action: ResourceAction;
  details?: ResourceDetails;
}

export interface ResourceDetails {
  diff?: string[];
  properties?: PropertyChange[];
}

export interface PropertyChange {
  path: string;
  action: "add" | "change" | "remove";
  oldValue?: unknown;
  newValue?: unknown;
}

export function formatResourceId(resource: Resource): string {
  return `${resource.type} "${resource.repo}/${resource.name}"`;
}

export function formatResourceLine(resource: Resource): string {
  const id = formatResourceId(resource);

  switch (resource.action) {
    case "create":
      return chalk.green(`+ ${id}`);
    case "update":
      return chalk.yellow(`~ ${id}`);
    case "delete":
      return chalk.red(`- ${id}`);
    case "unchanged":
      return chalk.gray(`  ${id}`);
  }
}
