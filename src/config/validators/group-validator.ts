import type {
  RawConfig,
  RawConditionalGroupWhen,
  RawGroupConfig,
} from "../types.js";
import { resolveExtendsChain } from "../extends-resolver.js";
import { isPlainObject } from "../../shared/type-guards.js";
import { ValidationError } from "../../shared/errors.js";
import {
  validateFileConfigFields,
  validateSettings,
  buildRootSettingsContext,
} from "./shared.js";

function validateGroupExtends(
  groupName: string,
  extends_: string | string[],
  groupNames: Set<string>
): void {
  if (typeof extends_ === "string") {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    if (extends_ === groupName) {
      throw new ValidationError(
        `groups.${groupName}: extends cannot reference itself`
      );
    }
    if (!groupNames.has(extends_)) {
      throw new ValidationError(
        `groups.${groupName}: extends references undefined group '${extends_}'`
      );
    }
  } else if (Array.isArray(extends_)) {
    if (extends_.length === 0) {
      throw new ValidationError(
        `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
      );
    }
    const seen = new Set<string>();
    for (const entry of extends_) {
      if (typeof entry !== "string") {
        throw new ValidationError(
          `groups.${groupName}: 'extends' array entries must be strings`
        );
      }
      if (entry.length === 0) {
        throw new ValidationError(
          `groups.${groupName}: 'extends' array entries must be non-empty strings`
        );
      }
      if (entry === groupName) {
        throw new ValidationError(
          `groups.${groupName}: extends cannot reference itself`
        );
      }
      if (!groupNames.has(entry)) {
        throw new ValidationError(
          `groups.${groupName}: extends references undefined group '${entry}'`
        );
      }
      if (seen.has(entry)) {
        throw new ValidationError(
          `groups.${groupName}: duplicate '${entry}' in extends`
        );
      }
      seen.add(entry);
    }
  } else {
    throw new ValidationError(
      `groups.${groupName}: 'extends' must be a non-empty string or array of strings`
    );
  }
}

function validateNoCircularExtends(
  groups: Record<string, RawGroupConfig>
): void {
  for (const name of Object.keys(groups)) {
    if (!groups[name].extends) continue;
    try {
      resolveExtendsChain(name, groups);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function validateGroupRefArray(
  arr: unknown,
  fieldName: string,
  ctx: string,
  groupNames: string[]
): void {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new ValidationError(
      `${ctx}: '${fieldName}' must be a non-empty array of strings`
    );
  }
  const seen = new Set<string>();
  for (const name of arr) {
    if (typeof name !== "string") {
      throw new ValidationError(
        `${ctx}: '${fieldName}' entries must be strings`
      );
    }
    if (!groupNames.includes(name)) {
      throw new ValidationError(
        `${ctx}: group '${name}' in ${fieldName} is not defined in root 'groups'`
      );
    }
    if (seen.has(name)) {
      throw new ValidationError(
        `${ctx}: duplicate group '${name}' in ${fieldName}`
      );
    }
    seen.add(name);
  }
}

export function validateGroups(config: RawConfig): void {
  if (config.groups === undefined) return;

  if (!isPlainObject(config.groups)) {
    throw new ValidationError("groups must be an object");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = new Set(Object.keys(config.groups));

  for (const [groupName, group] of Object.entries(config.groups)) {
    if (groupName === "inherit") {
      throw new ValidationError(
        "'inherit' is a reserved key and cannot be used as a group name"
      );
    }

    if (groupName === "extends") {
      throw new ValidationError(
        "'extends' is a reserved key and cannot be used as a group name"
      );
    }

    if (group.extends !== undefined) {
      validateGroupExtends(groupName, group.extends, groupNames);
    }

    if (group.files) {
      for (const [fileName, fileConfig] of Object.entries(group.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `groups.${groupName}:`
        );
      }
    }

    if (group.settings !== undefined) {
      validateSettings(group.settings, `groups.${groupName}`, rootCtx);
    }
  }

  validateNoCircularExtends(config.groups);
}

export function validateConditionalGroups(config: RawConfig): void {
  if (config.conditionalGroups === undefined) return;

  if (!Array.isArray(config.conditionalGroups)) {
    throw new ValidationError("conditionalGroups must be an array");
  }

  const rootCtx = buildRootSettingsContext(config);
  const groupNames = config.groups ? Object.keys(config.groups) : [];

  for (let i = 0; i < config.conditionalGroups.length; i++) {
    const entry = config.conditionalGroups[i];
    const ctx = `conditionalGroups[${i}]`;

    if (!entry.when || !isPlainObject(entry.when)) {
      throw new ValidationError(
        `${ctx}: 'when' is required and must be an object`
      );
    }

    const { allOf, anyOf, noneOf } = entry.when as RawConditionalGroupWhen;
    if (!allOf && !anyOf && !noneOf) {
      throw new ValidationError(
        `${ctx}: 'when' must have at least one of 'allOf', 'anyOf', or 'noneOf'`
      );
    }

    if (allOf !== undefined) {
      validateGroupRefArray(allOf, "allOf", ctx, groupNames);
    }

    if (anyOf !== undefined) {
      validateGroupRefArray(anyOf, "anyOf", ctx, groupNames);
    }

    if (noneOf !== undefined) {
      validateGroupRefArray(noneOf, "noneOf", ctx, groupNames);
    }

    if (noneOf) {
      const noneOfSet = new Set(noneOf);
      if (allOf) {
        for (const g of allOf) {
          if (noneOfSet.has(g)) {
            throw new ValidationError(
              `${ctx}: noneOf group '${g}' overlaps with allOf (contradictory condition)`
            );
          }
        }
      }
      if (anyOf) {
        for (const g of anyOf) {
          if (noneOfSet.has(g)) {
            throw new ValidationError(
              `${ctx}: noneOf group '${g}' overlaps with anyOf (contradictory condition)`
            );
          }
        }
      }
    }

    if (entry.files) {
      for (const [fileName, fileConfig] of Object.entries(entry.files)) {
        if (fileName === "inherit") continue;
        if (fileConfig === false) continue;
        if (fileConfig === undefined) continue;

        validateFileConfigFields(
          fileConfig as Record<string, unknown>,
          fileName,
          `${ctx}:`
        );
      }
    }

    if (entry.settings !== undefined) {
      validateSettings(entry.settings, ctx, rootCtx);
    }
  }
}
