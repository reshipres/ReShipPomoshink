import { extractProductSlug, normalizeText } from './normalize.js';

const PRODUCT_QUERY_STOPWORDS = new Set([
  'а',
  'в',
  'все',
  'вы',
  'где',
  'да',
  'есть',
  'есть ли',
  'и',
  'или',
  'ли',
  'на',
  'наличии',
  'наличие',
  'по',
  'подскажите',
  'проверить',
  'сколько',
  'стоит',
  'стоимость',
  'товар',
  'цена',
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
    .filter((token) => token.length >= 2 && !PRODUCT_QUERY_STOPWORDS.has(token));
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}
