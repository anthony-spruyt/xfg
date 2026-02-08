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
