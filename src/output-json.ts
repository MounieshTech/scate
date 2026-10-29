// Handles writing scan results to a JSON file.
import fs from 'node:fs';
import path from 'node:path';
import type { ScateRow } from './types.js';

/**
 * Writes the scan results to a JSON file mirroring the table data.
 */
export async function writeJsonOutput(
  outputPath: string,
  rows: ScateRow[],
): Promise<void> {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  const dir = path.dirname(resolvedPath);

  if (dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const jsonContent = JSON.stringify(rows, null, 2);
  await fs.promises.writeFile(resolvedPath, jsonContent, 'utf8');
}
