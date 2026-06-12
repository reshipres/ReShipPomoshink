import {
  extractEmail,
  extractOrderHint,
  extractProductSlug,
  hasEmail,
  hasPhoneNumber,
  looksLikeProductReference,
  looksLikeStandaloneOrderLookup,
  normalizeDigits,
  normalizeText,
} from './normalize.js';

const DEFAULT_PRODUCTS_API_URL = 'https://reship.pro/api/products/search';
const DEFAULT_PRODUCTS_LIMIT = 20;
const DEFAULT_ORDERS_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 8000;
const PRODUCT_SEARCH_STOPWORDS = new Set([
  'а',
  'вы',
  'есть',
  'есть ли',
  'и',
  'ли',
  'можешь',
  'можно',
  'мышка',
  'мышку',
  'мышь',
  'наличие',
  'посмотреть',
  'посмотри',
  'проверить',
  'проверь',
  'сколько',
  'стоит',
  'товар',
  'цена',
  'что',
]);

const ORDER_SELECT = [
  'id',
  'profile_id',
  'total_amount',
  'status',
  'payment_method',
  'order_number',
  'shipping_address',
  'contact_phone',
  'created_at',
  'updated_at',
  'paid_at',
  'delivery_method',
  'delivery_time',
  'delivery_cost',
  'pvz_code',
  'pvz_address',
  'recipient_first_name',
  'recipient_last_name',
  'recipient_middle_name',
  'telegram',
  'cdek_order_uuid',
  'cdek_tracking_number',
  'cdek_order_status',
  'is_guest_order',
  'customer_name',
  'customer_email',
  'customer_phone',
  'tracking_code',
  'delivery_type',
  'payment_group_id',
  'crm_order_number',
  'crm_status_slug',
  'crm_status_group',
  'crm_stage',
].join(',');

export function createLiveDataClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  const config = buildLiveDataConfig(env);

  return {
    describe() {
      return {
        products: config.products.enabled ? config.products.apiUrl : 'disabled',
        orders: describeOrdersSource(config.orders),
      };
    },

    async resolveContext({ message, session = {}, customer = {} } = {}) {
      const [products, orders] = await Promise.all([
        resolveLiveProducts({ message, session, config, fetchImpl, logger }),
        resolveLiveOrders({ message, session, customer, config, fetchImpl, logger }),
      ]);

      return { products, orders };
    },
  };
}

function buildLiveDataConfig(env) {
  return {
    products: {
      enabled: envBool(env.RESHIP_PRODUCTS_LIVE_ENABLED, true),
      apiUrl: env.RESHIP_PRODUCTS_API_URL || DEFAULT_PRODUCTS_API_URL,
      limit: parsePositiveInt(env.RESHIP_PRODUCTS_SEARCH_LIMIT, DEFAULT_PRODUCTS_LIMIT),
      timeoutMs: parsePositiveInt(env.RESHIP_PRODUCTS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    },
    orders: {
      enabled: envBool(env.RESHIP_ORDERS_LIVE_ENABLED, true),
      lookupUrl: env.RESHIP_ORDERS_LOOKUP_URL || '',
      apiSecret: env.RESHIP_ORDERS_API_SECRET || env.ADMIN_INTERNAL_SECRET || '',
      supabaseUrl: env.SUPABASE_URL || '',
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
      limit: parsePositiveInt(env.RESHIP_ORDERS_LOOKUP_LIMIT, DEFAULT_ORDERS_LIMIT),
      timeoutMs: parsePositiveInt(env.RESHIP_ORDERS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    },
  };
}

async function resolveLiveProducts({ message, session, config, fetchImpl, logger }) {
  if (!config.products.enabled || !fetchImpl || !shouldSearchProducts(message, session)) return [];

  const query = productSearchQuery(message);
  if (!query) return [];

  try {
    const url = new URL(config.products.apiUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(config.products.limit));

    const response = await fetchWithTimeout(fetchImpl, url, {
      timeoutMs: config.products.timeoutMs,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      logger.warn?.(`Live products lookup failed: HTTP ${response.status}`);
      return [];
    }

    const rows = await response.json();
    const products = Array.isArray(rows) ? rows.map(normalizeProductRow).filter(Boolean) : [];
    return filterProductsForRequest(products, message);
  } catch (error) {
    logger.warn?.(`Live products lookup failed: ${error.message}`);
    return [];
  }
}

async function resolveLiveOrders({ message, session, customer, config, fetchImpl, logger }) {
  if (!config.orders.enabled || !fetchImpl || !shouldSearchOrders(message, session, customer)) return [];

  try {
    if (config.orders.lookupUrl) {
      return await lookupOrdersViaApi({ message, session, customer, config, fetchImpl, logger });
    }

    if (config.orders.supabaseUrl && config.orders.supabaseServiceRoleKey) {
      return await lookupOrdersViaSupabase({ message, customer, config, fetchImpl, logger });
    }
  } catch (error) {
    logger.warn?.(`Live orders lookup failed: ${error.message}`);
  }

  return [];
}

async function lookupOrdersViaApi({ message, session, customer, config, fetchImpl, logger }) {
  const response = await fetchWithTimeout(fetchImpl, config.orders.lookupUrl, {
    timeoutMs: config.orders.timeoutMs,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(config.orders.apiSecret ? { 'X-Admin-Secret': config.orders.apiSecret } : {}),
    },
    body: JSON.stringify({
      message,
      customer,
      session: safeSessionForLookup(session),
      limit: config.orders.limit,
    }),
  });

  if (!response.ok) {
    logger.warn?.(`Live orders API lookup failed: HTTP ${response.status}`);
    return [];
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.orders;
  return Array.isArray(rows) ? dedupeOrders(rows.map(normalizeOrderRow).filter(Boolean)) : [];
}

async function lookupOrdersViaSupabase({ message, customer, config, fetchImpl, logger }) {
  const filters = buildSupabaseOrderFilters(message, customer);
  if (!filters.length) return [];

  const groups = chunk(filters, 8);
  const rows = [];

  for (const group of groups) {
    const url = new URL('/rest/v1/orders', normalizedBaseUrl(config.orders.supabaseUrl));
    url.searchParams.set('select', ORDER_SELECT);
    url.searchParams.set('or', `(${group.join(',')})`);
    url.searchParams.set('order', 'updated_at.desc.nullslast,created_at.desc');
    url.searchParams.set('limit', String(config.orders.limit));

    const response = await fetchWithTimeout(fetchImpl, url, {
      timeoutMs: config.orders.timeoutMs,
      headers: {
        Accept: 'application/json',
        apikey: config.orders.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.orders.supabaseServiceRoleKey}`,
      },
    });

    if (!response.ok) {
      logger.warn?.(`Live Supabase orders lookup failed: HTTP ${response.status}`);
      continue;
    }

    const data = await response.json();
    if (Array.isArray(data)) rows.push(...data);
  }

  return dedupeOrders(rows.map(normalizeOrderRow).filter(Boolean));
}

function shouldSearchProducts(message, session = {}) {
  if (looksLikeProductReference(message)) return true;
  if (extractProductSlug(message)) return true;

  const pending = session?.pendingRequest;
  if (pending?.type === 'product' && pending.hint) return true;

  return false;
}

function shouldSearchOrders(message, session = {}, customer = {}) {
  if (extractOrderHint(message) || hasEmail(message) || hasPhoneNumber(message)) return true;
  if (looksLikeStandaloneOrderLookup(message)) return true;
  if (session?.pendingRequest?.type === 'order') return true;
  if (customer?.email || customer?.phone || customer?.id || customer?.telegramId) {
    return /заказ|статус|трек|достав|оплат|пвз|получател/i.test(message);
  }

  return false;
}

function productSearchQuery(message) {
  const slug = extractProductSlug(message);
  if (slug) return slug;

  const tokens = normalizeText(message)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zа-я0-9]+/gi, ''))
    .filter((token) => token.length >= 2 && !PRODUCT_SEARCH_STOPWORDS.has(token));

  return tokens.join(' ') || String(message || '').trim();
}

function buildSupabaseOrderFilters(message, customer = {}) {
  const filters = [];
  const raw = String(message || '').trim();
  const email = extractEmail(raw) || customer.email || null;
  const hint = extractOrderHint(raw);
  const digits = normalizeDigits(raw);

  if (email) {
    const value = postgrestValue(email.toLowerCase());
    filters.push(`customer_email.eq.${value}`);
  }

  for (const value of identifierVariants(hint || raw)) {
    const safe = postgrestLikeValue(value);
    filters.push(
      `crm_order_number.ilike.*${safe}*`,
      `order_number.ilike.*${safe}*`,
      `tracking_code.ilike.*${safe}*`,
      `cdek_tracking_number.ilike.*${safe}*`,
    );
  }

  if (digits.length >= 7) {
    const safe = postgrestLikeValue(digits.slice(-10));
    filters.push(`contact_phone.ilike.*${safe}*`, `customer_phone.ilike.*${safe}*`);
  }

  for (const name of nameLookupTerms(raw)) {
    const safe = postgrestLikeValue(name);
    filters.push(
      `recipient_last_name.ilike.*${safe}*`,
      `customer_name.ilike.*${safe}*`,
    );
  }

  if (customer.email) {
    const value = postgrestValue(String(customer.email).toLowerCase());
    filters.push(`customer_email.eq.${value}`);
  }

  return [...new Set(filters)];
}

function identifierVariants(value) {
  const raw = String(value || '').trim();
  if (!raw || hasEmail(raw)) return [];

  const normalized = normalizeText(raw);
  const transliterated = transliterateIdentifier(normalized);
  const candidates = [
    raw,
    normalized,
    normalized.replace(/[\s_-]+/g, ''),
    transliterated,
    transliterated.replace(/[\s_-]+/g, ''),
  ];

  const numericPrefix = normalized.match(/\b(\d{3,8})\b/)?.[1];
  if (numericPrefix) candidates.push(numericPrefix);

  return [...new Set(candidates.filter((item) => /[0-9a-zа-я]/i.test(item)))].slice(0, 6);
}

function nameLookupTerms(message) {
  if (!looksLikeStandaloneOrderLookup(message) && !/(фио|фамили|получател)/i.test(message)) return [];

  const ignored = new Set(['фио', 'фамилия', 'фамилии', 'получатель', 'получателя', 'мой', 'моя', 'заказ']);
  const words = normalizeText(message)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !ignored.has(word) && !/\d/.test(word));

  return words.slice(0, 3);
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

  return String(value || '').replace(/[а-яё]/gi, (char) => map[char.toLowerCase()] || char);
}

function normalizeProductRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = row.name || row.title;
  if (!name && !row.slug) return null;

  return {
    id: row.id,
    name: name || row.slug,
    slug: row.slug || null,
    code: row.code || row.sku || null,
    sku: row.sku || null,
    quantity: toNumber(row.quantity, row.inStock ? 1 : 0),
    sklad: row.sklad || null,
    price: toNumber(row.price, null),
    oldPrice: toNumber(row.oldPrice ?? row.old_price, null),
    preorderPrice: toNumber(row.preorderPrice ?? row.preorder_price, null),
    isActive: row.isActive ?? row.is_active ?? true,
    aliases: [row.title, row.brand].filter(Boolean),
  };
}

function filterProductsForRequest(products, message) {
  if (!products.length) return products;
  if (!/(мышь|мышк|mouse|superlight|g\s*pro)/i.test(message)) return products;

  const withoutAccessories = products.filter((product) => !isLikelyMouseAccessory(product));
  return withoutAccessories.length ? withoutAccessories : products;
}

function isLikelyMouseAccessory(product) {
  const text = `${product.name || ''} ${product.slug || ''}`;
  return /(glide|ultraglide|ultraice|ultracontrol|corepad|skate|skates|esports\s+tiger|kryos|tiger\s+ice|grip|глайд|глайды|грип|ковр|pad|switch|keyboard|свитч|клавиатур)/i.test(text);
}

function normalizeOrderRow(row) {
  if (!row || typeof row !== 'object') return null;
  const recipientFullName = [
    row.recipient_last_name,
    row.recipient_first_name,
    row.recipient_middle_name,
  ].filter(Boolean).join(' ') || row.customer_name || null;

  const shippingAddress = normalizeShippingAddress(row.shipping_address);

  return {
    orderId: row.id || row.orderId || null,
    orderNumber: row.order_number || row.orderNumber || row.tracking_code || null,
    crmOrderNumber: row.crm_order_number || row.crmOrderNumber || null,
    shortId: row.crm_order_number || row.shortId || null,
    status: row.status || null,
    paymentMethod: row.payment_method || row.paymentMethod || null,
    deliveryMethod: row.delivery_method || row.deliveryMethod || null,
    deliveryType: row.delivery_type || row.deliveryType || null,
    deliveryTime: row.delivery_time || row.deliveryTime || null,
    totalAmount: toNumber(row.total_amount ?? row.totalAmount, null),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
    paidAt: row.paid_at || row.paidAt || null,
    crmStatusSlug: row.crm_status_slug || row.crmStatusSlug || null,
    crmStatusGroup: row.crm_status_group || row.crmStatusGroup || null,
    cdekTrackingNumber: row.cdek_tracking_number || row.cdekTrackingNumber || null,
    cdekOrderStatus: row.cdek_order_status || row.cdekOrderStatus || null,
    pvzCode: row.pvz_code || row.pvzCode || null,
    pvzAddress: row.pvz_address || row.pvzAddress || null,
    deliveryAddress: shippingAddress,
    recipientFullName,
    recipientLastName: row.recipient_last_name || lastNameFromFullName(recipientFullName),
    recipientPhone: row.contact_phone || row.customer_phone || row.recipientPhone || null,
    customerPhone: row.customer_phone || row.contact_phone || null,
    customerEmail: row.customer_email || row.email || null,
    email: row.email || row.customer_email || null,
    customerId: row.profile_id || row.customerId || null,
  };
}

function normalizeShippingAddress(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return null;

  return [
    value.city,
    value.address,
    value.street,
    value.house,
    value.apartment ? `кв. ${value.apartment}` : null,
  ].filter(Boolean).join(', ') || null;
}

function lastNameFromFullName(value) {
  return String(value || '').trim().split(/\s+/)[0] || null;
}

function safeSessionForLookup(session = {}) {
  return {
    lastOrderLookup: session.lastOrderLookup || null,
    lastOrderCandidates: session.lastOrderCandidates || null,
  };
}

function dedupeOrders(orders) {
  const seen = new Set();
  const result = [];

  for (const order of orders) {
    const key = order.orderId || order.crmOrderNumber || order.orderNumber || JSON.stringify(order);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(order);
  }

  return result;
}

async function fetchWithTimeout(fetchImpl, input, { timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    return await fetchImpl(input, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function postgrestValue(value) {
  return String(value || '').replace(/["\\]/g, '');
}

function postgrestLikeValue(value) {
  return postgrestValue(value).replace(/[%*]/g, '');
}

function normalizedBaseUrl(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(value, defaultValue) {
  if (value == null || value === '') return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function describeOrdersSource(config) {
  if (!config.enabled) return 'disabled';
  if (config.lookupUrl) return config.lookupUrl;
  if (config.supabaseUrl && config.supabaseServiceRoleKey) return 'supabase';
  return 'not configured';
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}
