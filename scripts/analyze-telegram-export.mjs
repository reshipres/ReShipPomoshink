import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { handleMessage } from '../src/index.js';

const archivePath = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const includeExamples = process.argv.includes('--examples');
const exampleLimit = Number(process.env.EXAMPLE_LIMIT || 8);

const patternRules = [
  ['acknowledgement_like', (text) => /(^|\s)(спасибо|спс|благодарю|хорошо|окей|ок|понял|поняла|понятно|ясно|ага|угу|супер|отлично|договорились|верно)(\s|$|[!.,])/i.test(text)],
  ['standalone_lookup_like', (text) => /^\s*(?:\+?\d[\d\s().-]{8,}\d|rs-\d{8}-[a-z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,}|\d{4,})\s*$/i.test(text)],
  ['delivery_payload_like', (text) => /(фио|получатель|телефон|почта|email|e-mail|пвз|пункт выдачи|регион|область|город|адрес|улица|дом|квартир|подъезд|этаж|отделени)/i.test(text) && /(\+?\d[\d\s().-]{8,}\d|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test(text)],
  ['site_or_checkout_issue', (text) => /(сайт|корзин|оформ|личн(ый|ом).*кабинет|промокод|кнопк).*(не работает|ошибк|не могу|не получается|не открывается|не отображ|проблем)|не могу.*(оформить|заказать)/i.test(text)],
  ['external_purchase_like', (text) => /(https?:\/\/|www\.|выкуп|байер|poizon|пойзон|taobao|1688|得物|dewu|китай|товар\s+по\s+ссылк)/i.test(text)],
  ['timing_question_like', (text) => /(сколько.*ждать|как долго|долго.*ждать|сроки|срок.*(достав|отправ|предзаказ|ожидан)|когда будет|когда ждать|примерно когда|сегодня|завтра)/i.test(text)],
  ['negative_or_problem_like', (text) => /(почему|ничего|нету|не приш|не отвечает|не могу|проблем|деньги|ошибк|задерж|обман|долго|жалоб)/i.test(text)],
  ['product_reference_like', (text) => /(wlmouse|g-wolves|gwolves|lamzu|finalmouse|vaxee|ninjutso|pulsar|atk|vxe|sora|op1|xm2|u2|htx|hsk|beast|waizowl|wooting|endgame|logitech|meow gaming|maya|fenrir|apex|omron|xsoft|soft|mid|коврик|ковер|мышь|мышка|клавиатур|глайд|скейт|свитч|switch|цвет|черн|бел)/i.test(text)],
];

if (!archivePath) {
  console.error('Usage: npm run analyze:telegram -- /path/to/DataExport.zip [--examples]');
  process.exit(1);
}

const resultEntry = findResultEntry(archivePath);
const exportData = JSON.parse(readZipEntry(archivePath, resultEntry));
const chats = exportData.chats?.list || [];
const ownerId = inferOwnerId(chats);

const totals = {
  chats: chats.length,
  personalChats: 0,
  incomingTextMessages: 0,
  outgoingTextMessages: 0,
};

const intentCounts = {};
const actionCounts = {};
const handoffReasonCounts = {};
const patternCounts = {};
const otherPatternCounts = {};
const patternExamples = {};
const otherPatternExamples = {};
const otherExamples = [];

for (const chat of chats) {
  if (chat.type !== 'personal_chat') continue;
  totals.personalChats += 1;

  let session = {};

  for (const message of chat.messages || []) {
    if (message.type !== 'message') continue;

    const text = plainText(message.text).trim();
    if (!text) continue;

    if (String(message.from_id) === ownerId) {
      totals.outgoingTextMessages += 1;
      session = {};
      continue;
    }

    totals.incomingTextMessages += 1;

    const result = handleMessage({ message: text, session });
    session = result.nextSession || {};
    const isOther = result.intent === 'other';

    increment(intentCounts, result.intent);
    increment(actionCounts, result.action);
    increment(handoffReasonCounts, result.handoffReason || 'none');

    if (includeExamples && isOther && otherExamples.length < exampleLimit) {
      otherExamples.push(redact(text));
    }

    for (const [name, matches] of patternRules) {
      if (!matches(text)) continue;
      increment(patternCounts, name);

      if (isOther) {
        increment(otherPatternCounts, name);
      }

      if (includeExamples) {
        patternExamples[name] ||= [];
        if (patternExamples[name].length < exampleLimit) {
          patternExamples[name].push(redact(text));
        }

        if (isOther) {
          otherPatternExamples[name] ||= [];
          if (otherPatternExamples[name].length < exampleLimit) {
            otherPatternExamples[name].push(redact(text));
          }
        }
      }
    }
  }
}

const otherCount = intentCounts.other || 0;
const otherRate = totals.incomingTextMessages > 0
  ? Number((otherCount / totals.incomingTextMessages).toFixed(4))
  : 0;

const report = {
  archive: basename(archivePath),
  resultEntry,
  totals,
  ownerInference: {
    strategy: 'most_frequent_from_id',
    ownerTextMessages: countOwnerMessages(chats, ownerId),
  },
  quality: {
    otherCount,
    otherRate,
  },
  intents: sortObject(intentCounts),
  actions: sortObject(actionCounts),
  handoffReasons: sortObject(handoffReasonCounts),
  learnedPatterns: sortObject(patternCounts),
  otherLearnedPatterns: sortObject(otherPatternCounts),
};

if (includeExamples) {
  report.redactedExamples = patternExamples;
  report.redactedOtherExamples = {
    other: otherExamples,
    ...otherPatternExamples,
  };
}

console.log(JSON.stringify(report, null, 2));

function findResultEntry(archive) {
  const entries = execFileSync('unzip', ['-Z1', archive], { maxBuffer: 20 * 1024 * 1024 })
    .toString('utf8')
    .split(/\r?\n/)
    .filter(Boolean);

  const entry = entries.find((item) => item === 'result.json' || item.endsWith('/result.json'));
  if (!entry) throw new Error('Telegram result.json was not found in the archive.');

  return entry;
}

function readZipEntry(archive, entry) {
  return execFileSync('unzip', ['-p', archive, entry], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
}

function inferOwnerId(chats) {
  const counts = new Map();

  for (const chat of chats) {
    for (const message of chat.messages || []) {
      if (message.type !== 'message' || !message.from_id) continue;
      const key = String(message.from_id);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const [owner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!owner) throw new Error('Could not infer owner id from Telegram export.');

  return owner;
}

function countOwnerMessages(chats, ownerId) {
  let count = 0;

  for (const chat of chats) {
    for (const message of chat.messages || []) {
      if (message.type === 'message' && String(message.from_id) === ownerId && plainText(message.text).trim()) {
        count += 1;
      }
    }
  }

  return count;
}

function plainText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }

  return '';
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort((a, b) => b[1] - a[1]));
}

function redact(value) {
  return String(value)
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[URL]')
    .replace(/@[\w_]+/g, '[USER]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, '[PHONE]')
    .replace(/rs-\d{8}-[a-z0-9]+/gi, '[ORDER]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[UUID]')
    .replace(/\b\d{4,}\b/g, '[NUM]')
    .replace(/\b[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,3}\b/g, '[NAME]')
    .replace(/\s+/g, ' ')
    .trim();
}
