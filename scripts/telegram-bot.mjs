import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Bot, Keyboard } from 'grammy';
import {
  createOpenAiLlmClient,
  handleHybridCustomerMessage,
  redactLearningText,
} from '../src/index.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required. Create .env from .env.example.');
  process.exit(1);
}

const bot = new Bot(token);
const sessions = new Map();
const orders = await loadJsonArray(process.env.RESHIP_ORDERS_JSON);
const products = await loadJsonArray(process.env.RESHIP_PRODUCTS_JSON);
const operatorChatId = process.env.OPERATOR_CHAT_ID || null;
const llmConfig = buildLlmConfig();

bot.command(['start', 'help'], async (ctx) => {
  await replyWithBrain(ctx, '/start');
});

bot.on('message:text', async (ctx) => {
  await replyWithBrain(ctx, ctx.message.text);
});

bot.on('message', async (ctx) => {
  await ctx.reply('Пока понимаю только текстовые сообщения. Напишите вопрос одним сообщением.');
});

bot.catch((error) => {
  console.error('Telegram bot error:', error.error);
});

console.log('ReShipPomoshink Telegram bot started.');
console.log(`Orders source: ${orders.length ? `${orders.length} records` : 'empty'}. Products source: ${products.length ? `${products.length} records` : 'empty'}.`);
console.log(`LLM provider: ${llmConfig.provider}, model: ${llmConfig.model}, shadow: ${envBool('LLM_SHADOW', true) ? 'on' : 'off'}.`);
await bot.start({
  onStart: (info) => {
    console.log(`Listening as @${info.username}.`);
  },
});

async function replyWithBrain(ctx, message) {
  const chatId = String(ctx.chat.id);
  const session = sessions.get(chatId) || {};
  const customer = buildTelegramCustomer(ctx);

  const result = await handleHybridCustomerMessage({
    message,
    session,
    customer,
    orders,
    products,
    source: 'telegram',
    llm: {
      shadow: envBool('LLM_SHADOW', true),
      enabled: envBool('LLM_ENABLED', true),
      client: llmConfig.client,
      model: llmConfig.model,
    },
    analytics: {
      enabled: envBool('ANALYTICS_ENABLED', true),
      dir: process.env.ANALYTICS_DIR || 'learning/events',
    },
    learning: {
      enabled: envBool('LEARNING_ENABLED', true),
      dir: process.env.LEARNING_DIR || 'learning/inbox',
    },
  });

  sessions.set(chatId, result.nextSession || {});

  await ctx.reply(result.answer, {
    reply_markup: buildKeyboard(result.suggestedReplies),
  });

  if (result.needsHandoff && operatorChatId) {
    await notifyOperator(ctx, result, message);
  }
}

function buildLlmConfig() {
  const provider = String(process.env.LLM_PROVIDER || 'mock').trim().toLowerCase();

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY is required when LLM_PROVIDER=openai.');
      process.exit(1);
    }

    return {
      provider,
      model: process.env.OPENAI_MODEL || 'gpt-5-mini',
      client: createOpenAiLlmClient({
        maxOutputTokens: process.env.OPENAI_MAX_OUTPUT_TOKENS,
        temperature: process.env.OPENAI_TEMPERATURE,
        reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'minimal',
      }),
    };
  }

  return {
    provider: 'mock',
    model: 'mock-support-brain-v1',
    client: undefined,
  };
}

function buildTelegramCustomer(ctx) {
  const from = ctx.from || {};
  return {
    telegramId: from.id ? `tg-${from.id}` : undefined,
    telegramUsername: from.username || undefined,
    firstName: from.first_name || undefined,
    lastName: from.last_name || undefined,
  };
}

function buildKeyboard(suggestedReplies = []) {
  const replies = suggestedReplies.filter(Boolean).slice(0, 3);
  if (!replies.length) return { remove_keyboard: true };

  const keyboard = new Keyboard();
  for (const reply of replies) {
    keyboard.text(reply).row();
  }

  return keyboard.resized();
}

async function notifyOperator(ctx, result, message) {
  const from = ctx.from || {};
  const username = from.username ? `@${from.username}` : 'без username';
  const text = [
    'Нужен оператор ReShip.',
    `Клиент: ${username}, chat_id=${ctx.chat.id}`,
    `Причина: ${result.handoffReason || 'none'}`,
    `Intent: ${result.intent}/${result.action}`,
    `Сообщение: ${redactLearningText(message)}`,
  ].join('\n');

  try {
    await bot.api.sendMessage(operatorChatId, text);
  } catch (error) {
    console.error('Operator notification failed:', error);
  }
}

async function loadJsonArray(filePath) {
  if (!filePath) return [];

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Could not load JSON array from ${filePath}:`, error.message);
    return [];
  }
}

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(value);
}
