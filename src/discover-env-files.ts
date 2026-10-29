import fs from 'node:fs';
import path from 'node:path';
import type { EnvFileResult, EnvVariableDefinition } from './types.js';

const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
]);

/**
 * Parses simple .gitignore rules to find directories to skip.
 * We specifically do NOT filter out .env files even if listed in .gitignore,
 * because projects routinely gitignore real .env files to protect secrets.
 */
function getIgnoredDirectories(targetDir: string): Set<string> {
  const ignored = new Set<string>(ALWAYS_IGNORED_DIRS);
  const gitignorePath = path.join(targetDir, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('#')) continue;
        // Strip trailing and leading slashes
        const normalized = line.replace(/^\/+/, '').replace(/\/+$/, '');
        // Do not add .env* patterns to ignored dirs/files
        if (normalized.startsWith('.env') || normalized.includes('*.env')) {
          continue;
        }
        if (normalized) {
          ignored.add(normalized);
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return ignored;
}

/**
 * Lightweight KEY=VALUE parser with zero dependencies.
 * Handles export prefixes, comments, quotes, multiline/inline comments, and empty values.
 */
export function parseEnvContent(
  content: string,
): Map<string, EnvVariableDefinition> {
  const variables = new Map<string, EnvVariableDefinition>();
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let line = lines[i].trim();

    // Skip empty lines or pure comment lines
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Strip leading 'export ' if present
    if (line.startsWith('export ') || line.startsWith('export\t')) {
      line = line.slice(7).trim();
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }

    let rawVal = line.slice(eqIndex + 1).trim();

    // Handle quoted values
    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"') && rawVal.length >= 2) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'") && rawVal.length >= 2)
    ) {
      rawVal = rawVal.slice(1, -1);
    } else {
      // Remove inline comments for unquoted values: KEY=value # comment
      const commentIdx = rawVal.indexOf(' #');
      if (commentIdx !== -1) {
        rawVal = rawVal.slice(0, commentIdx).trim();
      }
    }

    // Record the first definition if not present, or update
    if (!variables.has(key)) {
      variables.set(key, {
        variable: key,
        line: lineNumber,
        rawValue: rawVal,
      });
    }
  }

  return variables;
}

/**
 * Determines whether a file represents an example template rather than a real env file.
 */
export function isExampleEnvFile(filename: string): boolean {
  const lower = path.basename(filename).toLowerCase();
  return (
    lower === '.env.example' ||
    lower === '.env.sample' ||
    lower.endsWith('.example') ||
    lower.endsWith('.sample')
  );
}

/**
 * Discovers and parses every .env* file in the target folder,
 * or parses a single specified file if provided.
 */
export async function discoverEnvFiles(
  targetDir: string,
  specificFile?: string,
): Promise<EnvFileResult[]> {
  const results: EnvFileResult[] = [];

  // If a specific file is requested:
  if (specificFile) {
    const resolvedPath = path.isAbsolute(specificFile)
      ? specificFile
      : path.resolve(targetDir, specificFile);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Specified env file not found: ${resolvedPath}`);
    }

    const relPath = path.relative(targetDir, resolvedPath) || path.basename(resolvedPath);
    const content = await fs.promises.readFile(resolvedPath, 'utf8');
    const variables = parseEnvContent(content);

    results.push({
      filePath: relPath,
      absolutePath: resolvedPath,
      isExample: isExampleEnvFile(resolvedPath),
      variables,
    });

    return results;
  }

  const ignoredDirs = getIgnoredDirectories(targetDir);

  async function walkDir(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(targetDir, fullPath);

      if (entry.isDirectory()) {
        if (
          ignoredDirs.has(entry.name) ||
          ignoredDirs.has(relPath) ||
          entry.name.startsWith('.') && entry.name !== '.'
        ) {
          continue;
        }
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const basename = entry.name;
        // Match .env, .env.local, .env.production, etc.
        if (basename === '.env' || basename.startsWith('.env.')) {
          try {
            const content = await fs.promises.readFile(fullPath, 'utf8');
            const variables = parseEnvContent(content);
            results.push({
              filePath: relPath,
              absolutePath: fullPath,
              isExample: isExampleEnvFile(basename),
              variables,
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  await walkDir(targetDir);

  // Sort files deterministically: .env first, then .env.example, then alphabetical
  results.sort((a, b) => {
    if (a.filePath === '.env') return -1;
    if (b.filePath === '.env') return 1;
    return a.filePath.localeCompare(b.filePath);
  });

  return results;
}
