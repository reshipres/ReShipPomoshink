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

export function hasPhoneNumber(message = '') {
  return /\+?\d[\d\s().-]{8,}\d/i.test(String(message));
}

export function hasEmail(message = '') {
  return /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(String(message));
}

export function hasUrl(message = '') {
  return /(?:https?:\/\/|www\.)\S+/i.test(String(message));
}

export function hasExternalUrl(message = '') {
  return hasUrl(message) && !/reship\.pro/i.test(String(message));
}

export function extractOrderHint(message = '') {
  const patterns = [
    /RS-\d{8}-[A-Z0-9]{5,32}/i,
    /(?:№|#)?\s*\b\d{1,8}_[A-ZА-Я0-9]{1,12}\b/i,
    /\+?\d[\d\s().-]{8,}\d/i,
    /\b\d{3,8}R\b/i,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\b\d{4,12}\b/,
  ];

  for (const pattern of patterns) {
    const match = String(message).match(pattern);
    if (match) return normalizeOrderHint(match[0]);
  }

  return null;
}

export function extractProductSlug(message = '') {
  const match = String(message).match(/(?:reship\.pro\/product\/|\/product\/)([a-z0-9][a-z0-9-]{2,160})/i);
  return match?.[1]?.toLowerCase() || null;
}

export function looksLikeStandaloneOrderLookup(message = '') {
  const value = String(message).trim();
  if (!value) return false;
  if (extractOrderHint(value)) return true;

  const text = normalizeText(value);
  if (/^\d{3,8}r$/i.test(text)) return true;

  const words = value.split(/\s+/).filter(Boolean);
  const looksLikeFullName = words.length >= 2
    && words.length <= 4
    && words.every((word) => /^[А-ЯЁA-Z][а-яёa-z-]{2,}$/u.test(word));

  return looksLikeFullName;
}

export function looksLikeDeliveryDataPayload(message = '') {
  const value = String(message);
  const text = normalizeText(value);

  const hasContact = hasPhoneNumber(value)
    || hasEmail(value)
    || /(^|\s)(фио|получатель|телефон|почта|email|e-mail)(\s|$)/i.test(value);

  const hasDeliveryWords = /(пвз|пункт выдачи|сдэк|cdek|регион|область|город|адрес|улица|дом|квартир|подъезд|этаж|индекс|отделени)/i.test(value);
  const hasStructuredLines = value.split(/\n|;/).filter((line) => line.trim()).length >= 3;
  const hasAddressShape = /\b(ул|улица|проспект|пр-т|шоссе|переулок|дом|д\.|кв\.|корп|строение)\b/i.test(value);

  return (hasContact && hasDeliveryWords)
    || (hasContact && hasStructuredLines)
    || (hasPhoneNumber(value) && hasAddressShape)
    || (/фио\s*:/i.test(value) && /(город|адрес|пвз|пункт выдачи)/i.test(value))
    || (hasPhoneNumber(value) && /\b(москва|санкт-петербург|спб|область)\b/i.test(text));
}

export function looksLikeProductReference(message = '') {
  const value = String(message);
  const text = normalizeText(value);

  if (extractProductSlug(value) || hasUrl(value)) return true;

  return /(wlmouse|g-wolves|gwolves|lamzu|finalmouse|vaxee|ninjutso|pulsar|atk|vxe|sora|op1|xm2|u2|htx|hsk|beast|mini|max|black|white|red|blue|pink|purple|yellow|green|orange|waizowl|wooting|endgame|logitech|meow gaming|maya|fenrir|apex|omron|xsoft|soft|mid|коврик|ковер|мышь|мышка|клавиатур|глайд|скейт|свитч|switch|микрик|энкодер|цвет|черн|бел|красн|син|розов|фиолет|желт|зел|оранж)/i.test(text);
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
    'спасибо',
    'хорошо',
    'хорошо спасибо',
    'ок',
    'окей',
    'понял',
    'поняла',
    'понятно',
    'ясно',
    'ага',
    'да',
    'нет',
  ]);

  if (stopPhrases.has(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  return text.length >= 2 && text.length <= 80 && words.length <= 4 && /[a-zа-я0-9]/i.test(text);
}

function normalizeOrderHint(value) {
  return String(value || '').trim().replace(/^[#№]\s*/u, '');
}
