# scate 🔍

> **Environment Variable Hygiene Scanner CLI for Node.js & TypeScript**  
> Scan your project for environment variables — auditing what is defined in `.env*` files against what is actually read in your source code, with autonomous Gemini AI Issue-to-PR resolution.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Autonomous AI Agent](https://img.shields.io/badge/Gemini_API-Auto--PR_Bot-purple.svg)](https://ai.google.dev/)

---

## ⚡ What is `scate`?

`scate` is a **hygiene-audit scanner** (not a secret manager or auto-fixing linter). It:
1. **Discovers** all `.env*` files in your project (`.env`, `.env.local`, `.env.production`, `.env.example`, etc.) using a lightweight, zero-dependency `KEY=VALUE` parser while respecting `.gitignore`.
2. **Performs AST Analysis** on your TypeScript & JavaScript source code using `ts-morph` with a fast text pre-filter pass (does not parse unneeded files).
3. **Correlates** definitions with actual usage into a clean, colorized terminal table or machine-readable JSON report.
4. **Features an Autonomous GitHub Issue-to-PR Bot** powered by Google Gemini: when an issue is created on GitHub, an automated workflow investigates the codebase, generates verified fixes, runs unit tests, and creates a Pull Request automatically!

---

## 🚀 Quick Start

### Installation

Install globally via npm:
```bash
npm install -g scate
```

Or run directly in any project without installing:
```bash
npx scate
```

Or clone and link locally:
```bash
git clone https://github.com/MounieshTech/scate.git
cd scate
npm install
npm link
```

---

## 💻 CLI Usage

```bash
# Scan current directory (default)
scate

# Scan a specific project folder
scate --folder /path/to/project

# Audit one specific env file against code usage
scate --file .env.production

# Export report as JSON instead of printing the table
scate --o report.json
# or
scate -o report.json

# Display help and all available flags
scate --help
```

---

## 📊 Terminal Output Example

```text
┌──────────────────────┬──────────────────────┬────────────────────────┬────────────────────────────┐
│ Variable             │ Defined in           │ Used in                │ Status                     │
├──────────────────────┼──────────────────────┼────────────────────────┼────────────────────────────┤
│ DATABASE_URL         │ .env, .env.local     │ src/db/client.ts:8     │ OK                         │
│ PORT                 │ .env                 │ src/server.ts:14       │ OK                         │
│ STRIPE_SECRET_KEY    │ -                    │ src/billing.ts:25      │ Missing                    │
│ SENTRY_DSN           │ .env.example         │ -                      │ Not filled in locally      │
│ UNUSED_LEGACY_KEY    │ .env                 │ -                      │ Unused                     │
│ [dynamic: configKey] │ -                    │ src/config.ts:32       │ Dynamic — review manually  │
└──────────────────────┴──────────────────────┴────────────────────────┴────────────────────────────┘

Total: 6 variables (2 OK, 1 Missing, 1 Not filled in locally, 1 Unused, 1 Dynamic)
```

---

## 🏷️ The 5 Hygiene Statuses

Every variable is assigned exactly **one** of these 5 statuses, evaluated in this strict priority order:

| Priority | Status | Description |
| :--- | :--- | :--- |
| **1** | `Dynamic — review manually` | Referenced in code via a non-literal key (e.g. `process.env[someVar]`). Safe static verification cannot be guaranteed without manual review. |
| **2** | `OK` | Defined in a real `.env*` file (not `.env.example`) **AND** referenced in source code. |
| **3** | `Missing` | Referenced in source code, but not defined in any real `.env*` file. |
| **4** | `Not filled in locally` | Present in `.env.example` only, absent from every real `.env*` file. |
| **5** | `Unused` | Defined in a real `.env*` file, but never referenced anywhere in code. |

---

## 🔬 Supported Code Access Patterns

`scate` uses `ts-morph` AST parsing to recognize all common environment variable access conventions:

- ✅ **Property Access**: `process.env.VAR_NAME` & `import.meta.env.VAR_NAME`
- ✅ **Literal Element Access**: `process.env['VAR_NAME']` & `process.env["VAR_NAME"]`
- ✅ **Destructuring**: `const { VAR_NAME, OTHER: alias } = process.env`
- ✅ **Vite / ESM**: `const { VITE_PORT } = import.meta.env`
- ✅ **Dynamic / Non-Literal**: `process.env[someVariable]`, computed keys `{ [dyn]: val }`, and rest elements `{ ...rest }` are collected safely without crashing or silent drops.

---

## 🤖 Autonomous GitHub Issue-to-PR Workflow

This repository includes a built-in **Gemini AI Issue Resolver**:
- **Workflow File**: [`.github/workflows/ai-issue-fixer.yml`](.github/workflows/ai-issue-fixer.yml)
- **Agent Script**: [`scripts/ai-issue-fixer.ts`](scripts/ai-issue-fixer.ts)

### How It Works:
1. A developer or user opens an Issue describing a bug (or adds the `auto-fix` label).
2. GitHub Actions wakes up and sends the issue context and codebase files to the Gemini API (`@google/genai`).
3. Gemini writes the necessary file patches.
4. The workflow runs `npm test` to ensure zero regressions.
5. GitHub Actions opens a Pull Request automatically linking back to the issue!

### Setup:
1. Add `GEMINI_API_KEY` to your GitHub repository secrets:  
   **Settings ➔ Secrets and variables ➔ Actions ➔ New repository secret**.
2. Enable Pull Request permissions:  
   **Settings ➔ Actions ➔ General ➔ Workflow permissions ➔ Read and write permissions** + check **Allow GitHub Actions to create and approve pull requests**.

---

## 🧪 Testing & Verification

Run the comprehensive unit & AST integration test suite:

```bash
npm test
```

Build the CLI binary:
```bash
npm run build:cli
```

---

## 📁 Project Architecture

```text
scate/
├── .github/workflows/
│   └── ai-issue-fixer.yml    # Autonomous Issue-to-PR GitHub Action
├── bin/
│   └── scate.js               # CLI executable binary
├── scripts/
│   ├── ai-issue-fixer.ts      # Gemini Autonomous Fixer Agent
│   └── test-gemini-resolver.ts# Gemini connectivity test
├── src/
│   ├── cli.ts                 # Argument parsing (commander)
│   ├── discover-env-files.ts  # Zero-dependency KEY=VALUE parser & discovery
│   ├── scan-source.ts         # Two-pass AST scanner (grep + ts-morph)
│   ├── merge-status.ts        # Priority-ordered status assignment
│   ├── output-table.ts        # cli-table3 terminal table rendering
│   ├── output-json.ts         # JSON output writer
│   └── types.ts               # Shared TypeScript interfaces
├── test/
│   └── scate.test.ts          # Comprehensive Node.js native test runner tests
└── package.json
```

---

## 📄 License

Apache-2.0 © [MounieshTech](https://github.com/MounieshTech)
