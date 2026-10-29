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

export async function solveIssue(issueTitle: string, issueBody: string): Promise<{
  success: boolean;
  explanation: string;
  modifiedFiles: string[];
  rawResponse?: string;
}> {
  console.log(`\n[AI Resolver] Analyzing Issue: "${issueTitle}"`);

  // Target core source files of the repository
  const relevantFiles = [
    'src/types.ts',
    'src/discover-env-files.ts',
    'src/scan-source.ts',
    'src/merge-status.ts',
    'src/output-table.ts',
    'src/output-json.ts',
    'src/cli.ts',
  ];

  const existingFilesContext = relevantFiles
    .filter((f) => fs.existsSync(f))
    .map((f) => `=== FILE: ${f} ===\n${fs.readFileSync(f, 'utf8')}\n`)
    .join('\n');

  const prompt = `
You are an expert autonomous software engineer and coding agent.
Your task is to resolve an issue reported in this TypeScript Node.js repository called "scate".

### ISSUE TITLE
${issueTitle}

### ISSUE DESCRIPTION
${issueBody}

### EXISTING CODEBASE CONTEXT
${existingFilesContext}

### INSTRUCTIONS
1. Analyze the issue, identify the root cause or required feature.
2. Produce the entire updated content for any file that needs modification.
3. Ensure the changes adhere strictly to the project's existing coding style and TypeScript conventions.
4. Do NOT introduce breaking changes. Ensure backward compatibility and safety.
5. Return a JSON object with:
   - "explanation": a concise summary of why the bug occurred and what was changed.
   - "changes": an array of file changes, each with "filePath", "explanation", and "content" (complete file content).
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
