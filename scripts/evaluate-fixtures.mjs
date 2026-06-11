import { readFileSync } from 'node:fs';
import { handleMessage } from '../src/index.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/client-phrases.json', import.meta.url), 'utf8'));

let failed = 0;

for (const fixture of fixtures) {
  const result = handleMessage({
    message: fixture.message,
    session: fixture.session || {},
  });

  const ok = result.intent === fixture.intent && result.action === fixture.action;
  const marker = ok ? 'OK' : 'FAIL';
  console.log(`${marker} | "${fixture.message}" -> ${result.intent}/${result.action}`);

  if (!ok) {
    failed += 1;
    console.log(`  expected: ${fixture.intent}/${fixture.action}`);
    console.log(`  answer: ${result.answer}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
  console.log(`\n${failed} fixture(s) failed.`);
} else {
  console.log(`\nAll ${fixtures.length} fixtures passed.`);
}
