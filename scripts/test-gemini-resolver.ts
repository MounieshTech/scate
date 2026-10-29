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

async function testGeminiConnection() {
  console.log('Testing Gemini API integration in AI Studio...');

  const sampleIssueTitle = 'Support .env.default as an example template file';
  const sampleIssueBody =
    'Please treat .env.default like .env.example so its variables are marked as "Not filled in locally" instead of real env files.';

  const fileToInspect = 'src/discover-env-files.ts';
  const existingCode = fs.readFileSync(path.resolve(process.cwd(), fileToInspect), 'utf8');

  const prompt = `
You are an expert autonomous software engineer.
You are tasked with resolving this GitHub issue:

Title: ${sampleIssueTitle}
Description: ${sampleIssueBody}

Here is the existing file content of ${fileToInspect}:
${existingCode}

Instructions:
1. Identify the function 'isExampleEnvFile'.
2. Provide the exact updated code for ${fileToInspect} that supports '.env.default' as an example file.
3. Return a JSON object with:
   - "explanation": string
   - "proposedChangeSummary": string
   - "updatedSnippet": string (just the modified function)
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          explanation: { type: Type.STRING },
          proposedChangeSummary: { type: Type.STRING },
          updatedSnippet: { type: Type.STRING },
        },
        required: ['explanation', 'proposedChangeSummary', 'updatedSnippet'],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}');
  console.log('\n--- Gemini API Response ---');
  console.log('Status: Success!');
  console.log('Explanation:', parsed.explanation);
  console.log('Proposed Change:', parsed.proposedChangeSummary);
  console.log('\nUpdated Snippet:\n', parsed.updatedSnippet);

  return parsed;
}

testGeminiConnection().catch((err) => {
  console.error('Gemini API test failed:', err);
  process.exit(1);
});
