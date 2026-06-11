import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { handleCustomerMessage } from '../src/index.js';

const orders = JSON.parse(readFileSync(new URL('../fixtures/system-orders.json', import.meta.url), 'utf8'));
const products = JSON.parse(readFileSync(new URL('../fixtures/system-products.json', import.meta.url), 'utf8'));
const anonymousMode = process.argv.includes('--anonymous');
const customer = anonymousMode ? {} : {
  id: 'customer-ivanov',
  telegramId: 'tg-ivanov',
  phone: '+7 999 123 45 67',
};

const rl = readline.createInterface({ input, output });
let session = {};

console.log(anonymousMode
  ? 'ReShipPomoshink CLI. Анонимный клиент: ищу заказы и товары только по введенным данным. Ctrl+C для выхода.'
  : 'ReShipPomoshink CLI. Известный клиент: могу сам найти последний заказ, также ищу заказы и товары по введенным данным. Ctrl+C для выхода.');

while (true) {
  const message = await rl.question('you> ');
  const result = handleCustomerMessage({ message, session, customer, orders, products });
  session = result.nextSession;
  console.log(`bot> ${result.answer}`);
  const lookup = result.systemLookup ? ` lookup=${result.systemLookup.type}/${result.systemLookup.status}` : '';
  console.log(`meta> ${result.intent}/${result.action} confidence=${Math.round(result.confidence * 100)}%${lookup}`);
}
