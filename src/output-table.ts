import Table from 'cli-table3';
import type { ScateRow, VariableStatus } from './types.js';

const STATUS_COLORS: Record<VariableStatus, (s: string) => string> = {
  'OK': (s) => `\x1b[32m${s}\x1b[0m`, // Green
  'Missing': (s) => `\x1b[31m${s}\x1b[0m`, // Red
  'Not filled in locally': (s) => `\x1b[33m${s}\x1b[0m`, // Yellow
  'Unused': (s) => `\x1b[90m${s}\x1b[0m`, // Gray
  'Dynamic — review manually': (s) => `\x1b[35m${s}\x1b[0m`, // Magenta
};

/**
 * Formats status with ANSI color for terminal output.
 */
function colorizeStatus(status: VariableStatus, enableColors = true): string {
  if (!enableColors) return status;
  const colorFn = STATUS_COLORS[status];
  return colorFn ? colorFn(status) : status;
}

/**
 * Renders an ASCII/Unicode table of the scate results using cli-table3.
 */
export function renderTable(rows: ScateRow[], options: { colors?: boolean } = {}): string {
  const enableColors = options.colors ?? Boolean(process.stdout.isTTY || process.env.FORCE_COLOR);

  const table = new Table({
    head: ['Variable', 'Defined in', 'Used in', 'Status'],
    style: {
      head: enableColors ? ['cyan'] : [],
      border: enableColors ? ['grey'] : [],
    },
    wordWrap: true,
  });

  if (rows.length === 0) {
    table.push([
      { colSpan: 4, content: 'No environment variables found in project.' },
    ]);
    return table.toString();
  }

  for (const row of rows) {
    const definedText = row.definedIn.length > 0 ? row.definedIn.join(', ') : '-';
    const usedText = row.usedIn.length > 0 ? row.usedIn.join('\n') : '-';
    const statusText = colorizeStatus(row.status, enableColors);

    table.push([row.variable, definedText, usedText, statusText]);
  }

  // Summary counts
  const counts: Record<VariableStatus, number> = {
    'OK': 0,
    'Missing': 0,
    'Not filled in locally': 0,
    'Unused': 0,
    'Dynamic — review manually': 0,
  };

  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }

  const summaryParts = [
    `${counts['OK']} OK`,
    `${counts['Missing']} Missing`,
    `${counts['Not filled in locally']} Not filled in locally`,
    `${counts['Unused']} Unused`,
    `${counts['Dynamic — review manually']} Dynamic`,
  ];

  const summaryLine = `\nTotal: ${rows.length} variable${rows.length === 1 ? '' : 's'} (${summaryParts.join(', ')})`;

  return table.toString() + summaryLine;
}
