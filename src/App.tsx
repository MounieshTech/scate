/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Terminal,
  ShieldCheck,
  FileJson,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  GitPullRequest,
  Sparkles,
  Bot,
  Github,
  CheckCircle2,
  Code2,
} from 'lucide-react';

interface RunResult {
  command: string;
  output: string;
  success: boolean;
  timestamp: string;
  jsonOutput?: string | null;
}

interface AiFixResult {
  title: string;
  explanation: string;
  modifiedFiles: string[];
  rawResponse?: string;
  success: boolean;
}

const PRESET_COMMANDS = [
  { label: 'Run Default Scan', cmd: 'scate', desc: 'Audits current workspace (.env* files vs code)' },
  { label: 'Export JSON', cmd: 'scate --o out.json', desc: 'Writes audit report to out.json' },
  { label: 'Audit Specific File', cmd: 'scate --file .env.example', desc: 'Audits only .env.example' },
  { label: 'Show Help', cmd: 'scate --help', desc: 'Displays CLI usage & available flags' },
  { label: 'Run Test Suite', cmd: 'npm test', desc: 'Runs unit & AST integration tests' },
];

const SAMPLE_ISSUES = [
  {
    title: 'Support .env.default as a template env file',
    body: 'Please treat .env.default like .env.example so its variables are marked as "Not filled in locally" instead of real env files.',
  },
  {
    title: 'Add export explanation to CLI help output',
    body: 'In src/output-table.ts, clarify that "Not filled in locally" indicates variables defined only in template files.',
  },
];

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKH]/g, '');
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'cli' | 'ai-workflow'>('cli');

  // CLI Scanner State
  const [commandInput, setCommandInput] = useState<string>('scate');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [history, setHistory] = useState<RunResult[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // AI Workflow Tester State
  const [issueTitle, setIssueTitle] = useState<string>(SAMPLE_ISSUES[0].title);
  const [issueBody, setIssueBody] = useState<string>(SAMPLE_ISSUES[0].body);
  const [isAiSolving, setIsAiSolving] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<AiFixResult | null>(null);

  useEffect(() => {
    executeCommand('scate');
  }, []);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isRunning]);

  const executeCommand = async (cmdToRun: string) => {
    if (isRunning) return;
    setIsRunning(true);
    const time = new Date().toLocaleTimeString();

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmdToRun }),
      });

      const data = await response.json();
      let jsonContent: string | null = null;

      if (cmdToRun.includes('--o') || cmdToRun.includes('-o')) {
        const match = cmdToRun.match(/(?:--o|-o)\s+([^\s]+)/);
        const filePath = match ? match[1] : 'out.json';
        try {
          const fileRes = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
          if (fileRes.ok) {
            jsonContent = await fileRes.text();
          }
        } catch {
          // ignore
        }
      }

      setHistory((prev) => [
        ...prev,
        {
          command: cmdToRun,
          output: data.output,
          success: data.success,
          timestamp: time,
          jsonOutput: jsonContent,
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setHistory((prev) => [
        ...prev,
        {
          command: cmdToRun,
          output: `Failed to execute: ${msg}`,
          success: false,
          timestamp: time,
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const testAiIssueSolver = async () => {
    if (isAiSolving || !issueTitle) return;
    setIsAiSolving(true);
    setAiResult(null);

    try {
      const response = await fetch('/api/solve-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: issueTitle, description: issueBody }),
      });

      const data = await response.json();
      setAiResult({
        title: issueTitle,
        explanation: data.explanation || 'Fix applied successfully.',
        modifiedFiles: data.modifiedFiles || [],
        rawResponse: data.rawResponse,
        success: data.success ?? true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiResult({
        title: issueTitle,
        explanation: `Error: ${msg}`,
        modifiedFiles: [],
        success: false,
      });
    } finally {
      setIsAiSolving(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard?.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white flex flex-col">
      {/* Top Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center font-mono text-emerald-400 font-bold text-base shadow-sm">
              &gt;_
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold tracking-tight text-white text-base">scate</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono">
                  v1.0.0
                </span>
              </div>
              <p className="text-xs text-zinc-400">CLI &amp; Autonomous GitHub Auto-PR Agent</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('cli')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'cli'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              CLI Terminal
            </button>
            <button
              onClick={() => setActiveTab('ai-workflow')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
                activeTab === 'ai-workflow'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
              GitHub Auto-PR Agent
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full space-y-6">
        {activeTab === 'cli' ? (
          <>
            {/* Run Controls Header */}
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-emerald-400" />
                    Interactive Scate Terminal Runner
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Run scate against this project to audit environment variables in real time.
                  </p>
                </div>
                <button
                  onClick={() => setHistory([])}
                  className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 self-start md:self-center px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-800 border border-zinc-700/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear Console
                </button>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COMMANDS.map((preset) => (
                  <button
                    key={preset.cmd}
                    onClick={() => {
                      setCommandInput(preset.cmd);
                      executeCommand(preset.cmd);
                    }}
                    disabled={isRunning}
                    className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700/90 active:bg-zinc-700 text-zinc-200 text-xs font-mono border border-zinc-700 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-sm"
                  >
                    <Play className="w-3.5 h-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="font-semibold text-zinc-100">{preset.label}</span>
                    <span className="text-zinc-400 text-[11px] hidden sm:inline">({preset.cmd})</span>
                  </button>
                ))}
              </div>

              {/* Interactive Command Input Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (commandInput.trim()) {
                    executeCommand(commandInput.trim());
                  }
                }}
                className="flex items-center gap-2 pt-2"
              >
                <div className="flex-1 relative flex items-center">
                  <span className="absolute left-3 font-mono text-emerald-400 font-bold text-sm select-none">$</span>
                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder="e.g. scate, scate --o out.json, scate --help"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-emerald-500 rounded-lg pl-8 pr-4 py-2.5 font-mono text-xs sm:text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isRunning || !commandInput.trim()}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors disabled:cursor-not-allowed shadow"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Execute</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Live Terminal Output Window */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs text-zinc-400 font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-600/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-amber-600/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-emerald-600/80 inline-block" />
                  <span className="ml-2 font-medium text-zinc-300">Terminal Output</span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  {history.length} command{history.length === 1 ? '' : 's'} executed
                </div>
              </div>

              <div className="p-5 font-mono text-xs sm:text-sm leading-relaxed overflow-x-auto min-h-[300px] max-h-[500px] overflow-y-auto space-y-6">
                {history.length === 0 && !isRunning && (
                  <div className="text-zinc-500 italic py-8 text-center">
                    Click any preset button above or type <code className="text-emerald-400">scate</code> and press Execute.
                  </div>
                )}

                {history.map((item, idx) => (
                  <div key={idx} className="space-y-2 border-b border-zinc-800/60 pb-5 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">$</span>
                        <span className="text-white font-semibold">{item.command}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span>{item.timestamp}</span>
                        <button
                          onClick={() => handleCopy(stripAnsi(item.output), idx)}
                          className="hover:text-zinc-300 flex items-center gap-1 text-[11px] bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800"
                        >
                          {copiedIndex === idx ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy output</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <pre className="text-xs text-zinc-200 bg-zinc-900/80 p-4 rounded-lg border border-zinc-800/80 overflow-x-auto font-mono whitespace-pre leading-relaxed">
                      {stripAnsi(item.output)}
                    </pre>

                    {item.jsonOutput && (
                      <div className="mt-3 p-4 rounded-lg bg-zinc-900 border border-emerald-900/50 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                          <FileJson className="w-4 h-4" />
                          <span>Generated JSON Output:</span>
                        </div>
                        <pre className="text-xs text-emerald-300/90 bg-zinc-950 p-3 rounded border border-zinc-800 overflow-x-auto">
                          {item.jsonOutput}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}

                {isRunning && (
                  <div className="flex items-center gap-2 text-zinc-400 text-xs py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Running scanner...</span>
                  </div>
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          </>
        ) : (
          /* GitHub Auto-PR Workflow Tab */
          <div className="space-y-6">
            {/* Overview Card */}
            <div className="bg-gradient-to-br from-zinc-900 to-purple-950/20 border border-zinc-800 rounded-xl p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-purple-950/60 border border-purple-800/50 text-purple-300 text-xs font-mono">
                    <Sparkles className="w-3 h-3" />
                    Gemini 3.8 Flash Powered
                  </div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    GitHub Issue Auto-Fixer &amp; Pull Request Bot
                  </h2>
                  <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed">
                    When you push this repository to GitHub and an issue is created, GitHub Actions calls the Gemini API to analyze the repository, formulate the fix, run <code className="text-xs bg-zinc-900 px-1 rounded text-purple-300">npm test</code>, and open a Pull Request automatically!
                  </p>
                </div>
                <div className="hidden sm:flex items-center gap-2 text-zinc-500 font-mono text-xs bg-zinc-900 px-3 py-2 rounded-lg border border-zinc-800">
                  <Github className="w-4 h-4 text-white" />
                  .github/workflows/ai-issue-fixer.yml
                </div>
              </div>

              {/* Architecture steps */}
              <div className="grid sm:grid-cols-4 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1">
                  <span className="text-xs font-mono text-purple-400 font-semibold">1. User opens Issue</span>
                  <p className="text-xs text-zinc-400">Describes bug or request on GitHub.</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1">
                  <span className="text-xs font-mono text-purple-400 font-semibold">2. Gemini Analyzes</span>
                  <p className="text-xs text-zinc-400">Reads codebase &amp; writes precise code changes.</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1">
                  <span className="text-xs font-mono text-purple-400 font-semibold">3. Test Gate</span>
                  <p className="text-xs text-zinc-400">Runs <code className="text-[10px] text-zinc-300">npm test</code> to ensure no regression.</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 space-y-1">
                  <span className="text-xs font-mono text-emerald-400 font-semibold">4. Auto-PR Created</span>
                  <p className="text-xs text-zinc-400">Pushes branch and creates PR linked to issue.</p>
                </div>
              </div>
            </div>

            {/* Live Interactive Test Simulator */}
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Bot className="w-4 h-4 text-purple-400" />
                    Test the AI Resolver in AI Studio Now
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Select a sample issue or type your own to test Gemini's code resolution directly against this workspace.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {SAMPLE_ISSUES.map((sample, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setIssueTitle(sample.title);
                      setIssueBody(sample.body);
                    }}
                    className="text-xs bg-zinc-800/90 hover:bg-zinc-800 px-3 py-1.5 rounded-lg border border-zinc-700/80 text-zinc-300 transition-colors"
                  >
                    Sample #{idx + 1}: {sample.title}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Issue Title</label>
                  <input
                    type="text"
                    value={issueTitle}
                    onChange={(e) => setIssueTitle(e.target.value)}
                    placeholder="e.g. Support .env.default as a template env file"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-300 block mb-1">Issue Description</label>
                  <textarea
                    rows={3}
                    value={issueBody}
                    onChange={(e) => setIssueBody(e.target.value)}
                    placeholder="Describe the issue or requested fix..."
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500 rounded-lg px-3 py-2 text-xs sm:text-sm text-zinc-100 focus:outline-none resize-none font-mono"
                  />
                </div>
                <button
                  onClick={testAiIssueSolver}
                  disabled={isAiSolving || !issueTitle.trim()}
                  className="px-5 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 active:bg-purple-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors disabled:cursor-not-allowed shadow"
                >
                  {isAiSolving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Gemini is analyzing &amp; fixing issue...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Simulate AI Fix with Gemini</span>
                    </>
                  )}
                </button>
              </div>

              {/* Fix Result Card */}
              {aiResult && (
                <div className={`p-4 rounded-xl border space-y-3 ${
                  aiResult.success ? 'bg-purple-950/20 border-purple-800/60' : 'bg-rose-950/20 border-rose-800/60'
                }`}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {aiResult.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-rose-400" />
                    )}
                    <span>Gemini Resolution Result</span>
                  </div>
                  <div className="text-xs text-zinc-300 space-y-1">
                    <p className="font-semibold text-zinc-200">Explanation:</p>
                    <p className="bg-zinc-900/90 p-3 rounded-lg border border-zinc-800 leading-relaxed font-mono">
                      {aiResult.explanation}
                    </p>
                  </div>
                  {aiResult.modifiedFiles.length > 0 && (
                    <div className="text-xs text-zinc-300 space-y-1">
                      <p className="font-semibold text-zinc-200">Modified Files:</p>
                      <ul className="list-disc list-inside space-y-0.5 font-mono text-purple-300">
                        {aiResult.modifiedFiles.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Setup Guide */}
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-zinc-400" />
                Files Prepared in This Repository
              </h3>
              <ul className="text-xs font-mono text-zinc-300 space-y-2">
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>.github/workflows/ai-issue-fixer.yml</span>
                  <span className="text-zinc-500 font-sans">— Workflow triggers on issue open/label</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>scripts/ai-issue-fixer.ts</span>
                  <span className="text-zinc-500 font-sans">— Autonomous agent script using @google/genai</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  <span>scripts/test-gemini-resolver.ts</span>
                  <span className="text-zinc-500 font-sans">— Verification &amp; connectivity test</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
