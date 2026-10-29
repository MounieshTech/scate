import { Command } from 'commander';
import path from 'node:path';
import { discoverEnvFiles } from './discover-env-files.js';
import { scanSource } from './scan-source.js';
import { mergeStatus } from './merge-status.js';
import { renderTable } from './output-table.js';
import { writeJsonOutput } from './output-json.js';

interface CliOptions {
  folder?: string;
  file?: string;
  o?: string;
  output?: string;
}

export function buildCli(): Command {
  const program = new Command();

  program
    .name('scate')
    .description('Scan a project folder for environment variables and audit code usage hygiene')
    .version('1.0.0')
    .option('--folder <path>', 'scan a different folder instead of cwd')
    .option('--file <path>', 'audit one specific env file against code usage')
    .option('-o, --output <path>', 'write result as JSON to this path instead of printing the table')
    .option('--o <path>', 'write result as JSON to this path instead of printing the table')
    .action(async (options: CliOptions) => {
      try {
        const targetFolder = path.resolve(process.cwd(), options.folder || '.');
        const specificFile = options.file
          ? path.resolve(process.cwd(), options.file)
          : undefined;
        const outputPath = options.o || options.output;

        // 1. Discover and parse env files
        const envFiles = await discoverEnvFiles(targetFolder, specificFile);

        // 2. Scan source code
        const sourceUsage = await scanSource(targetFolder);

        // 3. Merge status
        const rows = mergeStatus(envFiles, sourceUsage);

        // 4. Output as JSON or pretty terminal table
        if (outputPath) {
          await writeJsonOutput(outputPath, rows);
        } else {
          const tableOutput = renderTable(rows);
          console.log(tableOutput);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const cli = buildCli();
  await cli.parseAsync(argv);
}

import { fileURLToPath } from 'node:url';

// Auto-run when executed directly as main script
if (process.argv[1]) {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    if (path.resolve(process.argv[1]) === currentFile) {
      run();
    }
  } catch {
    // Ignore
  }
}
