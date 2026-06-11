import { handleMessage } from './engine.js';
import { findLatestOrderContext, findOrderContext } from './orderLookup.js';
import { findProductContext } from './productLookup.js';
import { extractOrderHint } from './normalize.js';

export function handleCustomerMessage({
  message,
  session = {},
  customer = {},
  orders = [],
  products = [],
} = {}) {
  const first = handleMessage({ message, session });
  const orderContext = resolveOrderContext(first, message, customer, orders, session);

  if (orderContext) {
    const second = handleMessage({
      message,
      session: first.nextSession,
      orderContext,
    });

    return {
      ...second,
      nextSession: enrichSessionWithOrder(second.nextSession, orderContext),
      systemLookup: {
        type: 'order',
        status: orderContext.lookupStatus || 'found',
      },
    };
  }

  const productContext = resolveProductContext(first, products, session);
  if (productContext) {
    const second = handleMessage({
      message,
      session: first.nextSession,
      productContext,
    });

    return {
      ...second,
      nextSession: enrichSessionWithProduct(second.nextSession, productContext),
      systemLookup: {
        type: 'product',
        status: productContext.lookupStatus || 'found',
      },
    };
  }

  return {
    ...first,
    nextSession: clearLastOrderOnSwitch(first.nextSession, first.contextRequest),
  };
}

function resolveOrderContext(result, message, customer, orders, session) {
  const request = result.contextRequest;
  if (request?.type !== 'order') return null;

  const hint = request.hint || null;
  if (!hint) {
    if (request.strategy === 'latest_or_hint' || request.strategy === 'latest') {
      return findLatestOrderContext(customer, orders) || findLastOrderContext(session, orders);
    }

    return null;
  }

  const directMatch = findOrderContext(hint || message, orders);
  if (directMatch.lookupStatus !== 'not_found') return directMatch;

  if (messageLooksLikeOrderFollowup(message)) {
    return findLastOrderContext(session, orders)
      || findLatestOrderContext(customer, orders)
      || directMatch;
  }

  return directMatch;
}

function resolveProductContext(result, products, session) {
  const request = result.contextRequest;
  if (request?.type === 'product') {
    if (!request.hint) {
      return findLastProductContext(session, products);
    }

    const variantSummaryContext = resolveProductVariantSummaryContext(request.hint, session, products);
    if (variantSummaryContext) return variantSummaryContext;

    const productContext = findProductContext(request.hint, products);
    if (productContext.lookupStatus === 'multiple') {
      return resolveContextualProductVariant(request.hint, session, products) || productContext;
    }

    if (productContext.lookupStatus === 'not_found') {
      return resolveProductVariantContext(request.hint, session, products) || productContext;
    }

    return productContext;
  }

  if (result.intent === 'order_help') {
    if (result.hint) return findProductContext(result.hint, products);
    return findLastProductContext(session, products);
  }

  return null;
}

function resolveProductVariantSummaryContext(hint, session, products) {
  if (!messageLooksLikeProductVariantSummary(hint)) return null;

  const baseProduct = findLastProductContext(session, products);
  if (!baseProduct) return null;

  return {
    lookupStatus: 'variant_summary',
    variantRequest: hint,
    baseProduct,
  };
}

function resolveContextualProductVariant(hint, session, products) {
  const baseProduct = findLastProductContext(session, products);
  const brand = firstProductWord(baseProduct?.name);
  if (!brand) return null;

  const productContext = findProductContext(`${brand} ${hint}`, products);
  if (productContext?.lookupStatus !== 'not_found' && productContext?.lookupStatus !== 'multiple') {
    return productContext;
  }

  return null;
}

function resolveProductVariantContext(hint, session, products) {
  if (!messageLooksLikeProductVariantFollowup(hint)) return null;

  const baseProduct = findLastProductContext(session, products);
  if (!baseProduct) return null;

  return {
    lookupStatus: 'variant_not_found',
    variantRequest: hint,
    baseProduct,
  };
}

function enrichSessionWithProduct(session, productContext) {
  if (!isFoundProductContext(productContext)) return session;

  return {
    ...session,
    lastProductLookup: {
      name: productContext.name || null,
      slug: productContext.slug || null,
    },
  };
}

function enrichSessionWithOrder(session, orderContext) {
  if (!isFoundOrderContext(orderContext)) return session;

  return {
    ...session,
    lastOrderLookup: {
      orderNumber: orderContext.orderNumber || null,
      crmOrderNumber: orderContext.crmOrderNumber || null,
      shortId: orderContext.shortId || null,
      orderId: orderContext.orderId || null,
      cdekTrackingNumber: orderContext.cdekTrackingNumber || null,
    },
  };
}

function clearLastOrderOnSwitch(session, contextRequest) {
  if (contextRequest?.type === 'order' && contextRequest.strategy === 'ask_for_hint') {
    const nextSession = { ...session };
    delete nextSession.lastOrderLookup;
    return nextSession;
  }

  return session;
}

function findLastOrderContext(session, orders) {
  const lookup = session?.lastOrderLookup || {};
  const identifiers = [
    lookup.crmOrderNumber,
    lookup.shortId,
    lookup.orderNumber,
    lookup.orderId,
    lookup.cdekTrackingNumber,
  ].filter(Boolean);

  for (const identifier of identifiers) {
    const orderContext = findOrderContext(identifier, orders);
    if (orderContext.lookupStatus !== 'not_found' && orderContext.lookupStatus !== 'multiple') {
      return orderContext;
    }
  }

  return null;
}

function findLastProductContext(session, products) {
  const lookup = session?.lastProductLookup || {};
  const identifiers = [
    lookup.slug,
    lookup.name,
  ].filter(Boolean);

  for (const identifier of identifiers) {
    const productContext = findProductContext(identifier, products);
    if (productContext.lookupStatus !== 'not_found' && productContext.lookupStatus !== 'multiple') {
      return productContext;
    }
  }

  return null;
}

function isFoundOrderContext(orderContext) {
  const lookupStatus = orderContext?.lookupStatus || orderContext?.resultStatus || null;
  if (['not_found', 'multiple', 'ambiguous'].includes(lookupStatus)) return false;

  return Boolean(orderContext?.orderNumber
    || orderContext?.crmOrderNumber
    || orderContext?.shortId
    || orderContext?.orderId
    || orderContext?.cdekTrackingNumber);
}

function isFoundProductContext(productContext) {
  const lookupStatus = productContext?.lookupStatus || productContext?.resultStatus || null;
  if (['not_found', 'multiple', 'ambiguous', 'variant_not_found', 'variant_summary'].includes(lookupStatus)) return false;

  return Boolean(productContext?.name || productContext?.slug);
}

function messageLooksLikeProductVariantSummary(message) {
  return /((какие|какой|есть|доступн).{0,32}(цвет|расцветк|вариант)|(цвет|расцветк|вариант).{0,32}(есть|доступн|какие|какой)|друг(ие|ой|ая|ое)\s+(цвет|расцветк|вариант))/i.test(message);
}

function messageLooksLikeProductVariantFollowup(message) {
  return /(цвет|друг(ой|ая|ое)|черн|бел|красн|син|розов|фиолет|желт|зел|оранж|black|white|red|blue|pink|purple|yellow|green|orange)/i.test(message);
}

function firstProductWord(value) {
  return String(value || '').trim().split(/\s+/).find(Boolean) || null;
}

function messageLooksLikeOrderFollowup(message) {
  if (extractOrderHint(message)) return false;

  return /(когда|приед|прид[её]т|доставк|где|забрать|получ|выдач|сдэк|cdek|трек|статус|едет|ид[её]т|самовывоз|адрес|пункт|пвз)/i.test(message);
}
