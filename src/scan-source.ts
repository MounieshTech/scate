import fs from 'node:fs';
import path from 'node:path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import type { UsageResult, VariableUsage, DynamicUsage } from './types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.next',
]);

/**
 * Checks if an AST node represents process.env or process?.env
 */
function isProcessEnv(node: Node | undefined): boolean {
  if (!node) return false;

  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isNonNullExpression(node)
  ) {
    return isProcessEnv(node.getExpression());
  }

  if (Node.isPropertyAccessExpression(node)) {
    if (node.getName() === 'env') {
      const subExpr = node.getExpression();
      if (Node.isIdentifier(subExpr) && subExpr.getText() === 'process') {
        return true;
      }
    }
  }

  const raw = node.getText().replace(/\s+/g, '');
  return raw === 'process.env' || raw === 'process?.env';
}

/**
 * Checks if an AST node represents import.meta.env or import.meta?.env
 */
function isImportMetaEnv(node: Node | undefined): boolean {
  if (!node) return false;

  if (
    Node.isParenthesizedExpression(node) ||
    Node.isAsExpression(node) ||
    Node.isTypeAssertion(node) ||
    Node.isNonNullExpression(node)
  ) {
    return isImportMetaEnv(node.getExpression());
  }

  if (Node.isPropertyAccessExpression(node)) {
    if (node.getName() === 'env') {
      const subExpr = node.getExpression();
      if (Node.isMetaProperty(subExpr) || subExpr.getText() === 'import.meta') {
        return true;
      }
    }
  }

  const raw = node.getText().replace(/\s+/g, '');
  return raw === 'import.meta.env' || raw === 'import.meta?.env';
}

/**
 * Scans all source files in targetDir using a two-pass approach:
 * 1. Fast text pre-filter (grep-style for "process.env" or "import.meta.env")
 * 2. ts-morph AST parsing on candidate files only
 */
export async function scanSource(targetDir: string): Promise<UsageResult> {
  const allSourceFiles: string[] = [];

  // Pass 1: Discover all candidate files
  async function collectFiles(currentDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        await collectFiles(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.has(ext)) {
          allSourceFiles.push(fullPath);
        }
      }
    }
  }

  await collectFiles(targetDir);

  const candidateFiles: string[] = [];

  // Grep-style text pre-filter
  for (const filePath of allSourceFiles) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      if (content.includes('process.env') || content.includes('import.meta.env')) {
        candidateFiles.push(filePath);
      }
    } catch {
      // Ignore read errors
    }
  }

  const usages: VariableUsage[] = [];
  const dynamicUsages: DynamicUsage[] = [];

  if (candidateFiles.length === 0) {
    return {
      usages,
      dynamicUsages,
      scannedFilesCount: allSourceFiles.length,
      candidateFilesCount: 0,
    };
  }

  // Pass 2: AST parsing with ts-morph on shortlisted files only
  const project = new Project({
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noEmit: true,
    },
  });

  for (const candidate of candidateFiles) {
    let sourceFile;
    try {
      sourceFile = project.addSourceFileAtPath(candidate);
    } catch {
      continue;
    }

    const relPath = path.relative(targetDir, candidate);

    sourceFile.forEachDescendant((node) => {
      // 1. Property access: process.env.VAR_NAME or import.meta.env.VAR_NAME
      if (Node.isPropertyAccessExpression(node)) {
        const expr = node.getExpression();
        if (isProcessEnv(expr) || isImportMetaEnv(expr)) {
          const varName = node.getName();
          // Avoid matching process.env itself as a variable
          if (varName && varName !== 'env') {
            usages.push({
              variable: varName,
              file: relPath,
              line: node.getStartLineNumber(),
            });
          }
          return;
        }
      }

      // 2. Element access: process.env["VAR_NAME"] or dynamic process.env[someVar]
      if (Node.isElementAccessExpression(node)) {
        const expr = node.getExpression();
        if (isProcessEnv(expr) || isImportMetaEnv(expr)) {
          const arg = node.getArgumentExpression();
          if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
            const varName = arg.getLiteralValue();
            if (varName) {
              usages.push({
                variable: varName,
                file: relPath,
                line: node.getStartLineNumber(),
              });
            }
          } else {
            // Dynamic non-literal access: process.env[someVariable]
            const exprText = arg ? arg.getText() : 'dynamic';
            dynamicUsages.push({
              file: relPath,
              line: node.getStartLineNumber(),
              expression: exprText,
            });
          }
          return;
        }
      }

      // 3. Destructuring in variable declaration: const { VAR_NAME } = process.env
      if (Node.isVariableDeclaration(node)) {
        const init = node.getInitializer();
        if (init && (isProcessEnv(init) || isImportMetaEnv(init))) {
          const nameNode = node.getNameNode();
          if (Node.isObjectBindingPattern(nameNode)) {
            for (const elem of nameNode.getElements()) {
              if (elem.getDotDotDotToken()) {
                // e.g. const { ...rest } = process.env
                dynamicUsages.push({
                  file: relPath,
                  line: elem.getStartLineNumber(),
                  expression: elem.getText(),
                });
                continue;
              }

              const propNameNode = elem.getPropertyNameNode();
              if (propNameNode) {
                if (propNameNode.getKind() === SyntaxKind.ComputedPropertyName) {
                  // Computed property name: { [dyn]: val } = process.env
                  dynamicUsages.push({
                    file: relPath,
                    line: elem.getStartLineNumber(),
                    expression: propNameNode.getText(),
                  });
                } else {
                  // Renamed property: { FOO: renamed } = process.env
                  const varName = propNameNode.getText().replace(/['"]/g, '');
                  if (varName) {
                    usages.push({
                      variable: varName,
                      file: relPath,
                      line: elem.getStartLineNumber(),
                    });
                  }
                }
              } else {
                // Direct property: { FOO } = process.env
                const varName = elem.getNameNode().getText();
                if (varName) {
                  usages.push({
                    variable: varName,
                    file: relPath,
                    line: elem.getStartLineNumber(),
                  });
                }
              }
            }
          }
        }
        return;
      }

      // 4. Assignment destructuring: ({ VAR_NAME } = process.env)
      if (Node.isBinaryExpression(node)) {
        if (node.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
          const right = node.getRight();
          if (isProcessEnv(right) || isImportMetaEnv(right)) {
            const left = node.getLeft();
            if (Node.isObjectLiteralExpression(left)) {
              for (const prop of left.getProperties()) {
                if (Node.isShorthandPropertyAssignment(prop)) {
                  usages.push({
                    variable: prop.getName(),
                    file: relPath,
                    line: prop.getStartLineNumber(),
                  });
                } else if (Node.isPropertyAssignment(prop)) {
                  usages.push({
                    variable: prop.getName().replace(/['"]/g, ''),
                    file: relPath,
                    line: prop.getStartLineNumber(),
                  });
                } else {
                  dynamicUsages.push({
                    file: relPath,
                    line: prop.getStartLineNumber(),
                    expression: prop.getText(),
                  });
                }
              }
            }
          }
        }
      }
    });
  }

  return {
    usages,
    dynamicUsages,
    scannedFilesCount: allSourceFiles.length,
    candidateFilesCount: candidateFiles.length,
  };
}
