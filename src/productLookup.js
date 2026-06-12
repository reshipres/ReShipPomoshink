import { extractProductSlug, normalizeText } from './normalize.js';

const PRODUCT_QUERY_STOPWORDS = new Set([
  'а',
  'беру',
  'в',
  'вообще',
  'все',
  'вы',
  'возьму',
  'где',
  'да',
  'другой',
  'другая',
  'другое',
  'дизайн',
  'дизайна',
  'есть',
  'есть ли',
  'и',
  'или',
  'как',
  'кстати',
  'купить',
  'куплю',
  'ли',
  'можно',
  'на',
  'наличии',
  'наличие',
  'оформить',
  'оформлю',
  'она',
  'оно',
  'ощущения',
  'по',
  'приятные',
  'подскажите',
  'проверить',
  'руке',
  'счет',
  'счёт',
  'сколько',
  'стоит',
  'стоимость',
  'тогда',
  'товар',
  'цвет',
  'цвета',
  'хочу',
  'цена',
  'этот',
  'этого',
  'эту',
  'заказать',
  'закажу',
]);

export function findProductContext(query, products = []) {
  const value = String(query || '').trim();
  if (!value || !products.length) return null;

  const exactMatches = findExactProductMatches(value, products);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return { lookupStatus: 'multiple' };

  const fuzzyMatches = findFuzzyProductMatches(value, products);
  if (fuzzyMatches.length === 1) return fuzzyMatches[0];
  if (fuzzyMatches.length > 1) return { lookupStatus: 'multiple' };

  return { lookupStatus: 'not_found' };
}

function findExactProductMatches(query, products) {
  const slug = extractProductSlug(query);
  if (!slug) return [];

  const normalizedSlug = normalizeSlug(slug);
  return products.filter((product) => normalizeSlug(product.slug) === normalizedSlug);
}

function findFuzzyProductMatches(query, products) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = productQueryTokens(normalizedQuery);
  if (!queryTokens.length) return [];

  return products.filter((product) => {
    const keys = productKeys(product);

    if (keys.some((key) => key.length >= 3 && (
      normalizedQuery === key
      || normalizedQuery.includes(key)
      || key.includes(normalizedQuery)
    ))) {
      return true;
    }

    return keys.some((key) => queryTokens.every((token) => key.includes(token)));
  });
}

function productKeys(product) {
  return [
    product.name,
    product.slug,
    ...(Array.isArray(product.aliases) ? product.aliases : []),
  ]
    .map((value) => normalizeText(String(value || '').replace(/-/g, ' ')))
    .filter(Boolean);
}

function productQueryTokens(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map(canonicalProductToken)
    .filter((token) => token.length >= 2 && !PRODUCT_QUERY_STOPWORDS.has(token));
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalProductToken(token) {
  if (/^черн/i.test(token)) return 'black';
  if (/^бел/i.test(token)) return 'white';
  if (/^красн/i.test(token)) return 'red';
  if (/^син/i.test(token)) return 'blue';
  if (/^розов/i.test(token)) return 'pink';
  if (/^фиолет/i.test(token)) return 'purple';
  if (/^желт/i.test(token)) return 'yellow';
  if (/^зел/i.test(token)) return 'green';
  if (/^(оранж|рыж)/i.test(token)) return 'orange';

  return token;
}
