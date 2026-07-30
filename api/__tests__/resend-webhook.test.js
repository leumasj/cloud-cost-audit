// api/__tests__/resend-webhook.test.js
// Jest tests for the Resend delivery-status webhook handler.
//
// Strategy: jest.resetModules() + jest.doMock() per test, mirroring
// webhook.test.js — module-level initialisation (Resend(key), createClient(...))
// must pick up fresh mocks each run.
'use strict';

const { EventEmitter } = require('events');

// ── Mock state — reassigned in beforeEach ─────────────────────────────────────
let mockVerify;
let mockSend;
let mockUpdate;
let mockEq;
let mockSelect;
let mockCaptureException;

// ── Request / response helpers ────────────────────────────────────────────────

function makeReq(method = 'POST', rawBody = Buffer.from('{}')) {
  const emitter = new EventEmitter();
  emitter.method  = method;
  emitter.headers = {
    'svix-id':        'msg_test',
    'svix-timestamp': '1234567890',
    'svix-signature': 'v1,test-sig',
  };
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

function makeEvent(type, dataOverrides = {}) {
  return {
    type,
    data: {
      email_id: 'email_test_123',
      ...dataOverrides,
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetModules();

  mockVerify           = jest.fn();
  mockSend              = jest.fn().mockResolvedValue({ data: { id: 'sent_id' } });
  mockSelect            = jest.fn().mockResolvedValue({ data: [{ id: 'job-1', email: 'buyer@example.com', product_type: 'blueprint' }], error: null });
  mockEq                = jest.fn(() => ({ select: mockSelect }));
  mockUpdate            = jest.fn(() => ({ eq: mockEq }));
  mockCaptureException  = jest.fn();

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: () => ({ update: mockUpdate }),
    }),
  }));

  jest.doMock('resend', () => ({
    Resend: jest.fn(() => ({
      webhooks: { verify: mockVerify },
      emails:   { send: mockSend },
    })),
  }));

  jest.doMock('../lib/_sentry', () => ({ captureException: mockCaptureException }));
});

function loadHandler() {
  return require('../resend-webhook');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('rejects non-POST methods with 405', async () => {
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq('GET'), res);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Method not allowed' }));
});

test('returns 400 on invalid signature', async () => {
  mockVerify.mockImplementation(() => { throw new Error('No matching signature found'); });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.stringContaining('No matching signature found') })
  );
  expect(mockCaptureException).toHaveBeenCalled();
});

test('acknowledges untracked event types (e.g. email.sent) without touching the DB', async () => {
  mockVerify.mockReturnValue(makeEvent('email.sent'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, skipped: 'email.sent' }));
  expect(mockUpdate).not.toHaveBeenCalled();
});

test('updates actual_delivery_status to "delivered" on email.delivered', async () => {
  mockVerify.mockReturnValue(makeEvent('email.delivered'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockUpdate).toHaveBeenCalledWith({ actual_delivery_status: 'delivered' });
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, matched: true, status: 'delivered' }));
  expect(mockSend).not.toHaveBeenCalled(); // no admin alert for a healthy delivery
});

test('updates actual_delivery_status to "delayed" on email.delivery_delayed', async () => {
  mockVerify.mockReturnValue(makeEvent('email.delivery_delayed'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockUpdate).toHaveBeenCalledWith({ actual_delivery_status: 'delayed' });
  expect(mockSend).not.toHaveBeenCalled();
});

test('on email.bounced: updates status and sends an admin alert', async () => {
  mockVerify.mockReturnValue(makeEvent('email.bounced'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockUpdate).toHaveBeenCalledWith({ actual_delivery_status: 'bounced' });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ to: ['admin@kloudaudit.eu'], subject: expect.stringContaining('bounced') })
  );
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'bounced' }));
});

test('on email.complained: updates status and sends an admin alert', async () => {
  mockVerify.mockReturnValue(makeEvent('email.complained'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(mockUpdate).toHaveBeenCalledWith({ actual_delivery_status: 'complained' });
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ to: ['admin@kloudaudit.eu'], subject: expect.stringContaining('complained') })
  );
});

test('does not let an admin-alert send failure break the webhook response', async () => {
  mockVerify.mockReturnValue(makeEvent('email.bounced'));
  mockSend.mockRejectedValue(new Error('Resend API down'));
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, matched: true, status: 'bounced' }));
});

test('returns matched:false when no delivery_queue row has that resend_email_id', async () => {
  mockVerify.mockReturnValue(makeEvent('email.delivered'));
  mockSelect.mockResolvedValue({ data: [], error: null });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, matched: false }));
  expect(mockSend).not.toHaveBeenCalled();
});

test('acknowledges with 200 and error:no_email_id when the payload has no email_id', async () => {
  mockVerify.mockReturnValue({ type: 'email.delivered', data: {} });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, error: 'no_email_id' }));
  expect(mockUpdate).not.toHaveBeenCalled();
});

test('returns 200 with error:update_failed on a DB error — does not throw', async () => {
  mockVerify.mockReturnValue(makeEvent('email.delivered'));
  mockSelect.mockResolvedValue({ data: null, error: { message: 'connection timeout' } });
  const handler = loadHandler();
  const res = makeRes();
  await handler(makeReq(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, error: 'update_failed' }));
  expect(mockCaptureException).toHaveBeenCalled();
});
