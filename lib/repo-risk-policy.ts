import { readFile } from 'node:fs/promises';
import path from 'node:path';

const POLICY_PATH = path.join('.changeRisk', 'policy.yaml');

export type RepoRiskPolicy = {
  available: boolean;
  sourceFile: string | null;
  nonRuntimePaths: string[];
  nonRuntimeExtensions: string[];
};

function normalizeScalar(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseTopLevelList(content: string, sectionName: string) {
  const items: string[] = [];
  let activeSection = '';

  for (const line of content.split('\n')) {
    const sectionMatch = line.match(/^([a-z_]+):\s*$/);

    if (sectionMatch) {
      activeSection = sectionMatch[1] ?? '';
      continue;
    }

    if (activeSection !== sectionName) {
      continue;
    }

    const itemMatch = line.match(/^\s{2}-\s+(.*?)\s*$/);

    if (!itemMatch?.[1]) {
      continue;
    }

    const item = normalizeScalar(itemMatch[1]);

    if (item) {
      items.push(item);
    }
  }

  return items;
}

export async function loadRepoRiskPolicy(): Promise<RepoRiskPolicy> {
  const sourceFile = path.join(process.cwd(), POLICY_PATH);

  try {
    const content = await readFile(sourceFile, 'utf8');

    return {
      available: true,
      sourceFile: POLICY_PATH,
      nonRuntimePaths: parseTopLevelList(content, 'non_runtime_paths'),
      nonRuntimeExtensions: parseTopLevelList(content, 'non_runtime_extensions'),
    };
  } catch {
    return {
      available: false,
      sourceFile: null,
      nonRuntimePaths: [],
      nonRuntimeExtensions: [],
    };
  }
}

function normalizeFilePath(filename: string) {
  return filename.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

export function isNonRuntimePath(
  filename: string,
  policy: Pick<RepoRiskPolicy, 'nonRuntimePaths' | 'nonRuntimeExtensions'>,
) {
  const normalized = normalizeFilePath(filename);
  const lowerName = normalized.toLowerCase();

  if (
    policy.nonRuntimeExtensions.some(extension =>
      lowerName.endsWith(extension.toLowerCase()),
    )
  ) {
    return true;
  }

  return policy.nonRuntimePaths.some(entry => {
    const normalizedEntry = normalizeFilePath(entry);

    if (!normalizedEntry) {
      return false;
    }

    if (normalizedEntry.endsWith('/')) {
      return normalized.startsWith(normalizedEntry);
    }

    return normalized === normalizedEntry;
  });
}
