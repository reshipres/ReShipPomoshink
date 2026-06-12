import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLiveDataClient, handleCustomerMessage } from '../src/index.js';

describe('live data client', () => {
  it('loads live product search results and normalizes frontend product fields', async () => {
    const client = createLiveDataClient({
      env: {
        RESHIP_PRODUCTS_API_URL: 'https://example.test/api/products/search',
        RESHIP_PRODUCTS_SEARCH_LIMIT: '5',
        RESHIP_ORDERS_LIVE_ENABLED: 'false',
      },
      fetchImpl: async (url) => {
        assert.equal(url.searchParams.get('q'), 'superlight');
        assert.equal(url.searchParams.get('limit'), '5');
        return jsonResponse([
          {
            id: 'p1',
            title: 'Logitech G PRO X SUPERLIGHT 2 (Black)',
            slug: 'logitech-g-pro-x-superlight-2-black',
            price: 10990,
            oldPrice: 12990,
            quantity: 3,
            sklad: 'Москва',
          },
          {
            id: 'p2',
            title: 'UltraGlide UltraIceRun ICE (Logitech G PRO X SUPERLIGHT 2)',
            slug: 'ultraglide-ultraicerun-ice-logitech-g-pro-x-superlight-2',
            price: 549,
            quantity: 10,
            sklad: 'Москва',
          },
        ]);
      },
      logger: silentLogger(),
    });

    const context = await client.resolveContext({
      message: 'можешь посмотреть мышь superlight',
    });

    assert.equal(context.products.length, 1);
    assert.equal(context.products[0].name, 'Logitech G PRO X SUPERLIGHT 2 (Black)');
    assert.equal(context.products[0].quantity, 3);

    const result = handleCustomerMessage({
      message: 'можешь посмотреть мышь superlight',
      products: context.products,
    });

    assert.equal(result.systemLookup.type, 'product');
    assert.doesNotMatch(result.answer, /Каталог ReShip/);
    assert.match(result.answer, /SUPERLIGHT 2/);
    assert.match(result.answer, /10\s*990/);
  });

  it('loads live Supabase orders by email and lets the brain answer from order context', async () => {
    const client = createLiveDataClient({
      env: {
        RESHIP_PRODUCTS_LIVE_ENABLED: 'false',
        SUPABASE_URL: 'https://supabase.example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      fetchImpl: async (url, options) => {
        assert.equal(url.origin, 'https://supabase.example.test');
        assert.equal(options.headers.apikey, 'service-role-key');
        assert.match(url.searchParams.get('or'), /customer_email\.eq\.boris/);
        assert.doesNotMatch(url.searchParams.get('or'), /(^|[(,])email\.eq/);

        return jsonResponse([
          {
            id: 'order-1',
            order_number: 'RS-20260612-ABCDE',
            crm_order_number: '4213G',
            status: 'PROCESSING',
            delivery_method: 'CDEK_PVZ',
            customer_email: 'boris@example.com',
            contact_phone: '+7 999 111 22 33',
            recipient_first_name: 'Борис',
            recipient_last_name: 'Кириллов',
            recipient_middle_name: 'Иванович',
            cdek_tracking_number: '1234567890',
            created_at: '2026-06-12T10:00:00.000Z',
            updated_at: '2026-06-12T11:00:00.000Z',
          },
        ]);
      },
      logger: silentLogger(),
    });

    const context = await client.resolveContext({
      message: 'можешь найти мой заказ boris@example.com',
    });

    assert.equal(context.orders.length, 1);
    assert.equal(context.orders[0].crmOrderNumber, '4213G');
    assert.equal(context.orders[0].recipientFullName, 'Кириллов Борис Иванович');

    const result = handleCustomerMessage({
      message: 'можешь найти мой заказ boris@example.com',
      orders: context.orders,
    });

    assert.equal(result.systemLookup.type, 'order');
    assert.equal(result.action, 'answer');
    assert.match(result.answer, /Нашел заказ #4213G/);
    assert.match(result.answer, /Трек CDEK: 1234567890/);
  });

  it('transliterates Cyrillic CRM suffixes for live Supabase order lookup', async () => {
    const orFilters = [];
    const client = createLiveDataClient({
      env: {
        RESHIP_PRODUCTS_LIVE_ENABLED: 'false',
        SUPABASE_URL: 'https://supabase.example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      fetchImpl: async (url) => {
        orFilters.push(url.searchParams.get('or'));
        return jsonResponse([]);
      },
      logger: silentLogger(),
    });

    await client.resolveContext({ message: '4213г' });

    assert.ok(orFilters.some((filter) => /4213g/i.test(filter)));
    assert.ok(orFilters.some((filter) => /4213/i.test(filter)));
  });
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function silentLogger() {
  return {
    warn() {},
    log() {},
  };
}
