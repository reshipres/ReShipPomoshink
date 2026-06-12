import { buildLearningReport, formatLearningReport, readLearningInbox } from '../src/learningReport.js';

const options = parseArgs(process.argv.slice(2));
const { events, invalidLines } = await readLearningInbox({ dir: options.dir });
const report = buildLearningReport(events, {
  invalidLines,
  topLimit: options.limit,
});

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatLearningReport(report));
}

function parseArgs(args) {
  const result = {
    dir: 'learning/inbox',
    json: false,
    limit: 12,
  };

  for (const arg of args) {
    if (arg === '--json') {
      result.json = true;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      const limit = Number(arg.slice('--limit='.length));
      if (Number.isInteger(limit) && limit > 0) result.limit = limit;
      continue;
    }

    if (!arg.startsWith('--')) {
      result.dir = arg;
    }
  }

  return result;
}
