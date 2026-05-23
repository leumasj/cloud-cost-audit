// api/__tests__/webhook.test.js
// Jest tests for the Stripe webhook payment path.
//
// Strategy: jest.resetModules() + jest.doMock() per test so that module-level
// initialisation (stripe(key), createClient(...)) picks up fresh mocks each time.
'use strict';

const { EventEmitter } = require('events');

// ── Mock state — reassigned in beforeEach ─────────────────────────────────────
let mockInsert;
let mockConstructEvent;
let mockCaptureException;

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(method = 'POST', rawBody = Buffer.from('{}')) {
  const emitter = new EventEmitter();
  emitter.method  = method;
  emitter.headers = { 'stripe-signature': 'test-sig' };
  // Emit after current tick so getRawBody's listeners are registered first
  setImmediate(() => {
    emitter.emit('data', rawBody);
    emitter.emit('end');
  });
  return emitter;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

// ── Checkout event factory ────────────────────────────────────────────────────

function makeCheckoutEvent(sessionOverrides = {}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id:             'cs_test_123',
        customer_email: null,
        amount_total:   11900,
        currency:       'pln',
        metadata: {
          email: 'buyer@example.com',
          type:  'blueprint',
        },
        ...sessionOverrides,
      },
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetModules();

  mockInsert           = jest.fn().mockResolvedValue({ error: null });
  mockConstructEvent   = jest.fn();
  mockCaptureException = jest.fn();

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({ from: () => ({ insert: mockInsert }) }),
  }));

  jest.doMock('stripe', () =>
    jest.fn(() => ({ webhooks: { constructEvent: mockConstructEvent } }))
  );

  jest.doMock('../lib/_sentry', () => ({ captureException: mockCaptureException }));
});

function loadHandler() {
  return require('../webhook');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('rejects non-POST methods with 405', async () => {
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq('GET'), res);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Method not allowed' }));
});

test('returns 400 on invalid Stripe signature', async () => {
  mockConstructEvent.mockImplementation(() => { throw new Error('No signatures found'); });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.stringContaining('No signatures found') })
  );
  expect(mockCaptureException).toHaveBeenCalled();
});

test('acknowledges non-checkout events with 200 and skipped flag', async () => {
  mockConstructEvent.mockReturnValue({ type: 'payment_intent.created', data: { object: {} } });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ received: true, skipped: 'payment_intent.created' })
  );
  expect(mockInsert).not.toHaveBeenCalled();
});

test('returns 200 with error:no_email when both metadata.email and customer_email are absent', async () => {
  mockConstructEvent.mockReturnValue(
    makeCheckoutEvent({ metadata: { type: 'blueprint' }, customer_email: null })
  );
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ received: true, error: 'no_email' })
  );
  expect(mockInsert).not.toHaveBeenCalled();
});

test('queues a blueprint order and returns queued:true', async () => {
  mockConstructEvent.mockReturnValue(makeCheckoutEvent());
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockInsert).toHaveBeenCalledWith(
    expect.objectContaining({
      stripe_session_id: 'cs_test_123',
      email:             'buyer@example.com',
      product_type:      'blueprint',
      status:            'pending',
    })
  );
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ received: true, queued: true, productType: 'blueprint' })
  );
});

test('maps bundle type to "bundle" — not coerced to "blueprint"', async () => {
  mockConstructEvent.mockReturnValue(
    makeCheckoutEvent({ metadata: { email: 'buyer@example.com', type: 'bundle' } })
  );
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockInsert).toHaveBeenCalledWith(
    expect.objectContaining({ product_type: 'bundle' })
  );
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ productType: 'bundle' })
  );
});

test('returns 200 with duplicate:true on unique-constraint violation (23505)', async () => {
  mockConstructEvent.mockReturnValue(makeCheckoutEvent());
  mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ received: true, duplicate: true })
  );
});

test('returns 200 with error:queue_failed on generic DB error — does not throw', async () => {
  mockConstructEvent.mockReturnValue(makeCheckoutEvent());
  mockInsert.mockResolvedValue({ error: { code: '500', message: 'connection timeout' } });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ received: true, error: 'queue_failed' })
  );
  expect(mockCaptureException).toHaveBeenCalled();
});
