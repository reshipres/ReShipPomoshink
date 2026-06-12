import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { handleCustomerMessage, handleHybridCustomerMessage } from '../src/index.js';

const orders = JSON.parse(readFileSync(new URL('../fixtures/system-orders.json', import.meta.url), 'utf8'));
const products = JSON.parse(readFileSync(new URL('../fixtures/system-products.json', import.meta.url), 'utf8'));
const anonymousMode = process.argv.includes('--anonymous');
const hybridMode = process.argv.includes('--hybrid');
const learningMode = process.argv.includes('--learn');
const analyticsMode = process.argv.includes('--analytics');
const customer = anonymousMode ? {} : {
  id: 'customer-ivanov',
  telegramId: 'tg-ivanov',
  phone: '+7 999 123 45 67',
};

let session = {};

console.log(anonymousMode
  ? 'ReShipPomoshink CLI. Анонимный клиент: ищу заказы и товары только по введенным данным. Ctrl+C для выхода.'
  : 'ReShipPomoshink CLI. Известный клиент: могу сам найти последний заказ, также ищу заказы и товары по введенным данным. Ctrl+C для выхода.');
if (hybridMode) {
  const logs = [
    learningMode ? 'learning inbox пишет кандидатов в learning/inbox' : 'learning inbox выключен',
    analyticsMode ? 'analytics пишет все диалоги в learning/events' : 'analytics выключен',
  ];
  console.log(`Hybrid mode: mock LLM включен в shadow-режиме, ${logs.join(', ')}.`);
}

if (!input.isTTY) {
  const messages = readFileSync(0, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const message of messages) {
    console.log(`you> ${message}`);
    await respond(message);
  }
} else {
  const rl = readline.createInterface({ input, output });

  while (true) {
    let message;
    try {
      message = await rl.question('you> ');
    } catch {
      break;
    }

    await respond(message);
  }

  rl.close();
}

async function respond(message) {
  const result = hybridMode
    ? await handleHybridCustomerMessage({
      message,
      session,
      customer,
      orders,
      products,
      source: 'cli',
      learning: {
        enabled: learningMode,
      },
      analytics: {
        enabled: analyticsMode,
      },
    })
    : handleCustomerMessage({ message, session, customer, orders, products });

  session = result.nextSession;
  console.log(`bot> ${result.answer}`);
  const lookup = result.systemLookup ? ` lookup=${result.systemLookup.type}/${result.systemLookup.status}` : '';
  const hybrid = result.llmFallback ? ` llm=${result.llmFallback.status} mode=${result.hybridMode}` : '';
  console.log(`meta> ${result.intent}/${result.action} confidence=${Math.round(result.confidence * 100)}%${lookup}${hybrid}`);
}
