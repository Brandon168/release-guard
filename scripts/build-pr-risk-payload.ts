import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type Args = {
  base?: string;
  head?: string;
  output?: string;
};

type GitHubEvent = {
  pull_request?: {
    title?: string;
    body?: string | null;
    base?: {
      ref?: string;
      sha?: string;
    };
    head?: {
      ref?: string;
      sha?: string;
    };
  };
};

function parseArgs(argv: string[]) {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base' && next) {
      args.base = next;
      index += 1;
    } else if (arg === '--head' && next) {
      args.head = next;
      index += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      index += 1;
    }
  }

  return args;
}

function readGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    return {} satisfies GitHubEvent;
  }

  try {
    return JSON.parse(readFileSync(eventPath, 'utf8')) as GitHubEvent;
  } catch {
    return {} satisfies GitHubEvent;
  }
}

function getDiff(base: string, head: string) {
  return execFileSync('git', ['diff', '--unified=3', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

const args = parseArgs(process.argv.slice(2));
const event = readGitHubEvent();
const baseSha = args.base ?? event.pull_request?.base?.sha;
const headSha = args.head ?? event.pull_request?.head?.sha;

if (!baseSha || !headSha) {
  console.error(
    'Missing base/head commit SHAs. Pass --base and --head, or run inside pull_request GitHub Actions.',
  );
  process.exit(2);
}

const payload = {
  title: event.pull_request?.title ?? '',
  body: event.pull_request?.body ?? '',
  baseRef: event.pull_request?.base?.ref ?? '',
  headRef: event.pull_request?.head?.ref ?? '',
  diff: getDiff(baseSha, headSha),
};

const serialized = JSON.stringify(payload, null, 2);

if (args.output) {
  writeFileSync(args.output, serialized);
} else {
  console.log(serialized);
}
