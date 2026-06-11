import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { handleMessage } from '../src/index.js';

const rl = readline.createInterface({ input, output });
let session = {};

console.log('ReShipPomoshink CLI. Напишите вопрос. Ctrl+C для выхода.');

while (true) {
  const message = await rl.question('you> ');
  const result = handleMessage({ message, session });
  session = result.nextSession;
  console.log(`bot> ${result.answer}`);
  console.log(`meta> ${result.intent}/${result.action} confidence=${Math.round(result.confidence * 100)}%`);
}
