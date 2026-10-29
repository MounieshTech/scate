import type {
  EnvFileResult,
  UsageResult,
  ScateRow,
  VariableStatus,
} from './types.js';

interface VariableAggregate {
  variable: string;
  definedIn: Set<string>;
  definedInReal: boolean;
  usedIn: Set<string>;
  isDynamic: boolean;
}

/**
 * Merges environment file definitions and code usage into a unified list of rows,
 * assigning one of the exact five statuses based on strict priority order:
 * 1. "Dynamic — review manually" — referenced via non-literal key
 * 2. "OK" — defined in a real .env* file (not .env.example) AND referenced in code
 * 3. "Missing" — referenced in code, not defined in any real .env* file
 * 4. "Not filled in locally" — present in .env.example only, absent from every real .env* file
 * 5. "Unused" — defined in a real .env* file, never referenced in code
 */
export function mergeStatus(
  envFiles: EnvFileResult[],
  sourceUsage: UsageResult,
): ScateRow[] {
  const map = new Map<string, VariableAggregate>();

  function getOrCreate(variable: string): VariableAggregate {
    let item = map.get(variable);
    if (!item) {
      item = {
        variable,
        definedIn: new Set<string>(),
        definedInReal: false,
        usedIn: new Set<string>(),
        isDynamic: false,
      };
      map.set(variable, item);
    }
    return item;
  }

  // 1. Process environment files
  for (const envFile of envFiles) {
    for (const [varName] of envFile.variables) {
      const item = getOrCreate(varName);
      item.definedIn.add(envFile.filePath);
      if (!envFile.isExample) {
        item.definedInReal = true;
      }
    }
  }

  // 2. Process source code literal usages
  for (const usage of sourceUsage.usages) {
    const item = getOrCreate(usage.variable);
    item.usedIn.add(`${usage.file}:${usage.line}`);
  }

  // 3. Process dynamic non-literal usages
  // Group by dynamic expression to give a clean, informative row
  const dynamicGroups = new Map<string, Set<string>>();
  for (const dyn of sourceUsage.dynamicUsages) {
    const key = `[dynamic: ${dyn.expression}]`;
    let set = dynamicGroups.get(key);
    if (!set) {
      set = new Set<string>();
      dynamicGroups.set(key, set);
    }
    set.add(`${dyn.file}:${dyn.line}`);
  }

  for (const [dynKey, locations] of dynamicGroups) {
    const item: VariableAggregate = {
      variable: dynKey,
      definedIn: new Set<string>(),
      definedInReal: false,
      usedIn: locations,
      isDynamic: true,
    };
    map.set(dynKey, item);
  }

  // 4. Assign status and format rows
  const rows: ScateRow[] = [];

  for (const item of map.values()) {
    let status: VariableStatus;

    if (item.isDynamic) {
      status = 'Dynamic — review manually';
    } else if (item.definedInReal && item.usedIn.size > 0) {
      status = 'OK';
    } else if (item.usedIn.size > 0 && !item.definedInReal) {
      status = 'Missing';
    } else if (item.definedIn.size > 0 && !item.definedInReal) {
      status = 'Not filled in locally';
    } else if (item.definedInReal && item.usedIn.size === 0) {
      status = 'Unused';
    } else {
      status = 'Unused';
    }

    rows.push({
      variable: item.variable,
      definedIn: Array.from(item.definedIn).sort(),
      usedIn: Array.from(item.usedIn).sort(),
      status,
    });
  }

  // Sort rows: regular variables alphabetically first, then dynamic variables
  rows.sort((a, b) => {
    const aDyn = a.variable.startsWith('[dynamic');
    const bDyn = b.variable.startsWith('[dynamic');
    if (aDyn && !bDyn) return 1;
    if (!aDyn && bDyn) return -1;
    return a.variable.localeCompare(b.variable);
  });

  return rows;
}
