export type VariableStatus =
  | 'Dynamic — review manually'
  | 'OK'
  | 'Missing'
  | 'Not filled in locally'
  | 'Unused';

export interface EnvVariableDefinition {
  variable: string;
  line: number;
  rawValue: string;
}

export interface EnvFileResult {
  filePath: string;
  absolutePath: string;
  isExample: boolean;
  variables: Map<string, EnvVariableDefinition>;
}

export interface VariableUsage {
  variable: string;
  file: string;
  line: number;
}

export interface DynamicUsage {
  file: string;
  line: number;
  expression: string;
}

export interface UsageResult {
  usages: VariableUsage[];
  dynamicUsages: DynamicUsage[];
  scannedFilesCount: number;
  candidateFilesCount: number;
}

export interface ScateRow {
  variable: string;
  definedIn: string[];
  usedIn: string[];
  status: VariableStatus;
}
