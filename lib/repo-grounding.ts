// Repo grounding: loads repo-local policy, taxonomy, and calibration examples
// from .changeRisk/ and assembles them into a prompt block for the model.
// This uses Node.js fs (not Edge-compatible) intentionally — repo grounding
// reads from the deployed filesystem, which requires the Node.js runtime on
// Vercel. Edge Runtime would be inappropriate here.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const GROUNDING_DIR = '.changeRisk';
const PRIMARY_FILES = ['README.md', 'project.md', 'risk-taxonomy.md', 'policy.yaml'];
const EXAMPLES_DIR = 'examples';

export type RepoGrounding = {
  available: boolean;
  promptBlock: string | null;
  sourceFiles: string[];
};

async function readOptionalFile(filePath: string) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function formatSection(relativePath: string, content: string) {
  return [`File: ${relativePath}`, content.trim()].join('\n');
}

export async function loadRepoGrounding(): Promise<RepoGrounding> {
  const rootDir = process.cwd();
  const groundingDir = path.join(rootDir, GROUNDING_DIR);
  const sections: string[] = [];
  const sourceFiles: string[] = [];

  for (const fileName of PRIMARY_FILES) {
    const relativePath = path.join(GROUNDING_DIR, fileName);
    const content = await readOptionalFile(path.join(rootDir, relativePath));

    if (!content?.trim()) {
      continue;
    }

    sections.push(formatSection(relativePath, content));
    sourceFiles.push(relativePath);
  }

  try {
    const exampleDir = path.join(groundingDir, EXAMPLES_DIR);
    const entries = await readdir(exampleDir, { withFileTypes: true });
    const exampleNames = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const fileName of exampleNames) {
      const relativePath = path.join(GROUNDING_DIR, EXAMPLES_DIR, fileName);
      const content = await readOptionalFile(path.join(rootDir, relativePath));

      if (!content?.trim()) {
        continue;
      }

      sections.push(formatSection(relativePath, content));
      sourceFiles.push(relativePath);
    }
  } catch {
    // The grounding pack is optional.
  }

  if (!sections.length) {
    return {
      available: false,
      promptBlock: null,
      sourceFiles: [],
    };
  }

  return {
    available: true,
    promptBlock: [
      'Repository grounding pack:',
      'Use this repo-specific context to calibrate severity and ask better missing-information questions.',
      'Treat it as policy and examples, not as proof that the current artifact contains a given fact.',
      '',
      sections.join('\n\n'),
    ].join('\n'),
    sourceFiles,
  };
}
