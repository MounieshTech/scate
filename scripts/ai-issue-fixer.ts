import { GoogleGenAI, Type } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

interface FileChange {
  filePath: string;
  explanation: string;
  content: string;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
]);

/**
 * Scans the entire repository tree to collect all files relevant to the issue.
 */
function collectRepositoryFiles(dir: string, baseDir: string = dir): string[] {
  const filePaths: string[] = [];
  let entries: fs.Dirent[] = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return filePaths;
  }

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...collectRepositoryFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ALLOWED_EXTENSIONS.has(ext)) {
        const rel = path.relative(baseDir, fullPath);
        // Exclude huge generated lock files
        if (rel !== 'package-lock.json' && rel !== 'bun.lock') {
          filePaths.push(rel);
        }
      }
    }
  }

  return filePaths;
}

export async function solveIssue(issueTitle: string, issueBody: string): Promise<{
  success: boolean;
  explanation: string;
  modifiedFiles: string[];
  rawResponse?: string;
}> {
  console.log(`\n[AI Resolver] Analyzing Issue: "${issueTitle}"`);

  // Dynamically collect the entire codebase
  const allRepoFiles = collectRepositoryFiles(process.cwd());
  console.log(`[AI Resolver] Found ${allRepoFiles.length} repository files across the codebase.`);

  const existingFilesContext = allRepoFiles
    .map((f) => {
      try {
        const content = fs.readFileSync(path.resolve(process.cwd(), f), 'utf8');
        return `=== FILE: ${f} ===\n${content}\n`;
      } catch {
        return '';
      }
    })
    .join('\n');

  const prompt = `
You are an expert autonomous software engineer and coding agent.
Your task is to analyze and resolve an issue reported in this repository.

### ISSUE TITLE
${issueTitle}

### ISSUE DESCRIPTION
${issueBody}

### ENTIRE REPOSITORY CODEBASE
${existingFilesContext}

### INSTRUCTIONS & OPERATING RULES
1. Carefully analyze the issue title, description, and the entire repository context.
2. Determine which specific file or files need changes to fix the bug, address failing CI/tests, or fulfill the request.
3. If the issue asks to modify documentation (e.g. README.md), configuration, source code, workflows, or scripts, modify ONLY the necessary files.
4. Output the full, complete updated content for each modified file (no truncated code, no ellipses).
5. Ensure the code syntax is 100% valid TypeScript/JavaScript/YAML/Markdown.
6. Return a valid JSON object matching the requested schema:
   - "explanation": a concise description of root cause and what you changed.
   - "changes": an array of file modifications containing "filePath", "explanation", and the complete "content".
`;

  const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];
  let lastError: Error | null = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[AI Resolver] Calling Gemini with model: ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              explanation: {
                type: Type.STRING,
                description: 'Explanation of root cause and fix applied',
              },
              changes: {
                type: Type.ARRAY,
                description: 'Files to modify with complete updated content',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    filePath: {
                      type: Type.STRING,
                      description: 'Relative path to the file',
                    },
                    explanation: {
                      type: Type.STRING,
                      description: 'Reason for changes in this file',
                    },
                    content: {
                      type: Type.STRING,
                      description: 'Complete updated content of the file',
                    },
                  },
                  required: ['filePath', 'content'],
                },
              },
            },
            required: ['explanation', 'changes'],
          },
        },
      });

      const resultText = response.text || '{}';
      const parsed = JSON.parse(resultText) as {
        explanation: string;
        changes: FileChange[];
      };

      const modifiedFiles: string[] = [];

      if (parsed.changes && Array.isArray(parsed.changes)) {
        for (const change of parsed.changes) {
          const fullPath = path.resolve(process.cwd(), change.filePath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, change.content, 'utf8');
          modifiedFiles.push(change.filePath);
          console.log(`[AI Resolver] Applied changes to ${change.filePath}`);
        }
      }

      return {
        success: true,
        explanation: parsed.explanation || 'Fix applied successfully.',
        modifiedFiles,
        rawResponse: resultText,
      };
    } catch (err: unknown) {
      lastError = err as Error;
      console.warn(`[AI Resolver] Model ${model} encountered: ${lastError.message}. Retrying...`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return {
    success: false,
    explanation: `Failed after trying models: ${lastError?.message}`,
    modifiedFiles: [],
  };
}

// CLI runner if invoked directly in GitHub Actions
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('ai-issue-fixer.ts') || process.argv[1].endsWith('ai-issue-fixer.js'));

if (isMain) {
  const issueTitle = process.env.ISSUE_TITLE || process.argv[2] || '';
  const issueBody = process.env.ISSUE_BODY || process.argv[3] || '';

  if (!issueTitle) {
    console.error('Usage: tsx scripts/ai-issue-fixer.ts <issueTitle> [issueBody]');
    process.exit(1);
  }

  solveIssue(issueTitle, issueBody)
    .then((res) => {
      if (!res.success) {
        process.exit(1);
      }
      console.log(`[AI Resolver Done] Modified ${res.modifiedFiles.length} file(s).`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
