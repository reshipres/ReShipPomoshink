const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5-mini';

const OPENAI_SUPPORT_INSTRUCTIONS = [
  'Ты fallback-слой клиентского помощника ReShip.',
  'Сценарный слой остается главным. Твоя задача: разобрать только неуверенный или неоднозначный вопрос.',
  'Отвечай клиенту по-русски, коротко, без канцелярита.',
  'Используй только переданные факты ReShip. Не придумывай статусы заказов, наличие, цены, сроки, скидки, возвраты или обещания.',
  'Если фактов не хватает, верни ask_clarifying_question или handoff_to_operator.',
  'usedFacts должен содержать только id фактов из входа, на которые опирается answer.',
  'Верни только JSON по схеме.',
].join('\n');

export function createOpenAiLlmClient({
  apiKey = process.env.OPENAI_API_KEY,
  baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
  timeoutMs = process.env.OPENAI_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  maxOutputTokens,
  temperature,
  reasoningEffort,
} = {}) {
  const resolvedTimeoutMs = parsePositiveInteger(timeoutMs, 12000);

  return async (payload = {}) => {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai.');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch is required to call OpenAI Responses API.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);

    try {
      const body = buildOpenAiResponseRequest({
        ...payload,
        model: payload.model || DEFAULT_MODEL,
        maxOutputTokens,
        temperature,
        reasoningEffort,
      });
      const response = await fetchImpl(`${trimTrailingSlash(baseUrl)}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      const data = raw ? JSON.parse(raw) : {};

      if (!response.ok) {
        throw new Error(`OpenAI Responses API failed: ${response.status} ${extractErrorMessage(data)}`);
      }

      return parseOpenAiResponseJson(data);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`OpenAI Responses API timed out after ${resolvedTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildOpenAiResponseRequest({
  message,
  deterministicResult = {},
  facts = [],
  factIds = [],
  schema,
  model = DEFAULT_MODEL,
  maxOutputTokens,
  temperature,
  reasoningEffort,
} = {}) {
  const input = {
    message: String(message || ''),
    deterministicResult: compactDeterministicResult(deterministicResult),
    facts: facts.map(compactFact),
    factIds: factIds.map(String),
  };
  const request = {
    model,
    instructions: OPENAI_SUPPORT_INSTRUCTIONS,
    input: JSON.stringify(input),
    store: false,
    max_output_tokens: parsePositiveInteger(maxOutputTokens, 700),
    text: {
      format: {
        type: 'json_schema',
        name: 'reship_support_decision',
        strict: true,
        schema: toOpenAiStructuredSchema(schema),
      },
    },
  };

  const parsedTemperature = parseOptionalNumber(temperature);
  if (parsedTemperature != null) {
    request.temperature = parsedTemperature;
  }

  const effort = String(reasoningEffort || '').trim();
  if (effort) {
    request.reasoning = { effort };
  }

  return request;
}

export function parseOpenAiResponseJson(response = {}) {
  const text = extractOutputText(response).trim();
  if (!text) {
    throw new Error('OpenAI response did not include output text.');
  }

  return JSON.parse(stripJsonFence(text));
}

function compactDeterministicResult(result = {}) {
  return {
    intent: result.intent || 'other',
    action: result.action || 'ask_clarifying_question',
    confidence: Number(result.confidence || 0),
    needsHandoff: Boolean(result.needsHandoff),
    handoffReason: result.handoffReason || null,
    answer: result.answer || '',
    contextRequest: result.contextRequest || null,
  };
}

function compactFact(fact = {}) {
  return {
    id: fact.id,
    title: fact.title,
    intents: fact.intents,
    text: fact.text,
  };
}

function toOpenAiStructuredSchema(schema = {}) {
  return stripUnsupportedSchemaKeywords(schema);
}

function stripUnsupportedSchemaKeywords(value) {
  if (Array.isArray(value)) {
    return value.map(stripUnsupportedSchemaKeywords);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const next = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'minimum' || key === 'maximum') continue;
    next[key] = stripUnsupportedSchemaKeywords(nested);
  }
  return next;
}

function extractOutputText(response = {}) {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const parts = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text);
      }
    }
  }
  return parts.join('');
}

function stripJsonFence(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
}

function extractErrorMessage(data) {
  return data?.error?.message || data?.message || 'unknown_error';
}

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
