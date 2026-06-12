import { extractOrderHint, normalizeDigits, normalizeText } from './normalize.js';

export function findOrderContext(query, orders = []) {
  const value = String(query || '').trim();
  if (!value) return { lookupStatus: 'not_found' };

  const exactMatches = findExactIdentifierMatches(value, orders);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return multipleOrderContext(exactMatches);

  const nameMatches = findNameMatches(value, orders);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) return multipleOrderContext(nameMatches);

  return { lookupStatus: 'not_found' };
}

export function findLatestOrderContext(customer = {}, orders = []) {
  const matches = findCustomerOrders(customer, orders);
  if (!matches.length) return null;

  return [...matches].sort(compareLatestOrder)[0];
}

function findExactIdentifierMatches(query, orders) {
  const hint = extractOrderHint(query) || query;
  const normalizedHint = normalizeIdentifier(hint);
  const digits = normalizeDigits(hint);

  return orders.filter((order) => {
    const identifiers = [
      order.orderNumber,
      order.crmOrderNumber,
      order.shortId,
      order.orderId,
      order.cdekTrackingNumber,
    ].filter(Boolean);

    const exactTextMatch = identifiers.some((identifier) => normalizeIdentifier(identifier) === normalizedHint);
    if (exactTextMatch) return true;

    if (digits.length < 7) return false;

    const phoneDigits = normalizeDigits(order.recipientPhone || '');
    const trackingDigits = normalizeDigits(order.cdekTrackingNumber || '');

    return Boolean(phoneDigits && phoneDigits.endsWith(digits.slice(-10)))
      || Boolean(trackingDigits && trackingDigits === digits);
  });
}

function findCustomerOrders(customer, orders) {
  const customerId = normalizeIdentifier(customer.id || customer.customerId);
  const telegramId = normalizeIdentifier(customer.telegramId || customer.telegramUserId);
  const phoneDigits = normalizeDigits(customer.phone || customer.recipientPhone || '');
  const email = normalizeIdentifier(customer.email);

  if (!customerId && !telegramId && !phoneDigits && !email) return [];

  return orders.filter((order) => {
    if (customerId && normalizeIdentifier(order.customerId || order.userId) === customerId) return true;
    if (telegramId && normalizeIdentifier(order.customerTelegramId || order.telegramUserId) === telegramId) return true;
    if (email && normalizeIdentifier(order.customerEmail || order.email) === email) return true;

    if (phoneDigits.length >= 7) {
      const recipientPhone = normalizeDigits(order.recipientPhone || '');
      const customerPhone = normalizeDigits(order.customerPhone || '');
      const needle = phoneDigits.slice(-10);

      return Boolean(recipientPhone && recipientPhone.endsWith(needle))
        || Boolean(customerPhone && customerPhone.endsWith(needle));
    }

    return false;
  });
}

function compareLatestOrder(left, right) {
  const leftTime = orderTime(left);
  const rightTime = orderTime(right);

  return rightTime - leftTime;
}

function orderTime(order) {
  const rawDate = order.updatedAt || order.createdAt || order.paidAt || order.orderDate || '';
  const time = Date.parse(rawDate);

  return Number.isFinite(time) ? time : 0;
}

function findNameMatches(query, orders) {
  const words = nameQueryWords(query);
  if (!words.length || words.some((word) => /\d/.test(word))) return [];

  return orders.filter((order) => {
    const fullName = normalizeText(order.recipientFullName || '');
    const lastName = normalizeText(order.recipientLastName || '');
    const nameTokens = [...new Set([
      ...fullName.split(/\s+/),
      ...lastName.split(/\s+/),
    ].filter(Boolean))];

    if (!nameTokens.length) return false;

    return nameWordsMatchOrder(words, nameTokens);
  });
}

function nameWordsMatchOrder(words, nameTokens) {
  const matchedWords = words.filter((word) => nameTokens.some((token) => nameTokenMatches(word, token)));
  const matchedTokens = new Set(matchedWords.map((word) => nameTokens.find((token) => nameTokenMatches(word, token))));

  if (words.length === 1) return matchedWords.length === 1;
  if (words.length === 2) return matchedWords.length === 2 && matchedTokens.size === 2;
  if (matchedTokens.size < 2) return false;

  return words
    .filter((word) => !matchedWords.includes(word))
    .every((word) => looksLikePatronymic(word));
}

function nameQueryWords(query) {
  const ignoredWords = new Set([
    'по',
    'фамилия',
    'фамилии',
    'фио',
    'имя',
    'получатель',
    'получателя',
    'получателю',
    'получателем',
    'получателе',
    'мой',
    'моя',
    'мое',
    'моё',
    'моего',
    'моему',
    'меня',
    'зовут',
  ]);

  return normalizeText(query)
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !ignoredWords.has(word));
}

function nameTokenMatches(queryWord, nameToken) {
  if (queryWord === nameToken) return true;
  return queryWord.length >= 5 && nameToken.startsWith(queryWord);
}

function looksLikePatronymic(word) {
  return /(?:вич|вна|ична|оглы|кызы)$/i.test(word);
}

function multipleOrderContext(matches) {
  return {
    lookupStatus: 'multiple',
    candidates: matches.map(orderReference),
  };
}

function orderReference(order) {
  return {
    orderNumber: order.orderNumber || null,
    crmOrderNumber: order.crmOrderNumber || null,
    shortId: order.shortId || null,
    orderId: order.orderId || null,
    cdekTrackingNumber: order.cdekTrackingNumber || null,
    deliveryMethod: order.deliveryMethod || null,
    status: order.status || order.crmStatusSlug || order.crmStatusGroup || null,
    cdekOrderStatus: order.cdekOrderStatus || null,
    updatedAt: order.updatedAt || null,
    createdAt: order.createdAt || null,
  };
}

function normalizeIdentifier(value) {
  return transliterateIdentifier(value)
    .trim()
    .toLowerCase()
    .replace(/^[#№]\s*/u, '')
    .replace(/[\s_-]+/g, '');
}

function transliterateIdentifier(value) {
  const map = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sh',
    ы: 'y',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  return String(value || '').replace(/[а-яё]/gi, (char) => {
    const lower = char.toLowerCase();
    return map[lower] || char;
  });
}
