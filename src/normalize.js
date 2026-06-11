export function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[@+]/g, ' ')
    .replace(/[^a-zа-я0-9\s-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

export function extractOrderHint(message = '') {
  const patterns = [
    /RS-\d{8}-[A-Z0-9]{5,32}/i,
    /\+?\d[\d\s().-]{8,}\d/i,
    /\b\d{3,8}R\b/i,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\b\d{4,12}\b/,
  ];

  for (const pattern of patterns) {
    const match = String(message).match(pattern);
    if (match) return match[0].trim();
  }

  return null;
}

export function extractProductSlug(message = '') {
  const match = String(message).match(/(?:reship\.pro\/product\/|\/product\/)([a-z0-9][a-z0-9-]{2,160})/i);
  return match?.[1]?.toLowerCase() || null;
}

export function looksLikeLookupFragment(message = '') {
  const text = normalizeText(message);
  if (!text) return false;
  if (extractOrderHint(message)) return true;

  const stopPhrases = new Set([
    'другой',
    'другая',
    'другое',
    'не этот',
    'не эта',
    'не то',
    'оператор',
    'менеджер',
    'помощь',
    'заказ',
    'статус',
  ]);

  if (stopPhrases.has(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  return text.length >= 2 && text.length <= 80 && words.length <= 4 && /[a-zа-я0-9]/i.test(text);
}
