import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_CREATIVE_CATALOG } from '../src/catalog.mjs';
import { listEligibleCreatives } from '../src/advertising.mjs';
import { createAdServerWorker } from '../src/web/worker.mjs';

const creative = HOUSE_CREATIVE_CATALOG.find(c => c.id === 'assist-public-guides-20261025');
const now = new Date('2026-10-25T12:00:00Z');
const publishers = [
  { slot: 'afterArticle', property: 'koios-news', context: 'technology' },
  { slot: 'footer', property: 'play-561-group', context: 'games' },
];
const address = (route, context) => 'https://ads.561.group' + route + '?' + new URLSearchParams({ ...context, creative: creative.id });
const sinks = () => {
  const writes = [], points = [];
  return { writes, points, env: {
    AD_RECEIPTS: { put: async (...args) => writes.push(args) },
    AD_ACTIVITY: { writeDataPoint: point => points.push(point) },
  } };
};

test('ASSIST promotion names its received browser destination and bounded campaign term', () => {
  assert.ok(creative);
  assert.equal(creative.status, 'live');
  assert.equal(creative.relationship, 'house');
  assert.equal(creative.href, 'https://assist-561.briskolm35.chatgpt.site/');
  assert.equal(creative.expiresAt, '2026-11-25T00:00:00Z');
  assert.deepEqual(creative.properties, ['koios-news', 'play-561-group']);
  assert.deepEqual(creative.slots, ['afterArticle', 'footer']);
  assert.equal(new Set(HOUSE_CREATIVE_CATALOG.map(c => c.id)).size, HOUSE_CREATIVE_CATALOG.length);

});

test('the received ASSIST creative uses original Koios and Play routes, aggregate counts and no paid receipts', async () => {
  const live = creative;
  const worker = createAdServerWorker({ catalog: [live], nowMs: () => now.getTime() });
  for (const context of publishers) {
    const sink = sinks();
    const ad = await worker.fetch(new Request(address('/ad', context)), sink.env);
    assert.equal(ad.status, 200);
    const payload = await ad.json();
    assert.equal(payload.creative.id, creative.id);
    assert.equal(payload.creative.href, creative.href);
    assert.equal(payload.creative.relationship, 'house');
    assert.equal(Object.hasOwn(payload, 'receipt'), false);
    assert.equal((await worker.fetch(new Request(address('/view', context), { method: 'POST' }), sink.env)).status, 202);
    const click = await worker.fetch(new Request(address('/click', context), { redirect: 'manual' }), sink.env);
    assert.equal(click.status, 302);
    assert.equal(click.headers.get('location'), creative.href);
    assert.equal(click.headers.get('x-561-receipt-status'), 'not-applicable');
    assert.deepEqual(sink.writes, []);
    assert.deepEqual(sink.points, ['creative-response', 'client-visible-opportunity', 'outbound-redirect'].map(event => ({
      indexes: [context.property], blobs: [event, context.slot, creative.id, 'house'], doubles: [1],
    })));
  }
});

test('ASSIST context, publisher, self-promotion and exact expiry refusals create no events', async () => {
  const live = creative;
  for (const context of [
    { ...publishers[0], context: 'science' },
    { ...publishers[0], context: '' },
    { ...publishers[0], property: 'unselected-publisher' },
    { ...publishers[0], property: creative.property },
  ]) {
    assert.deepEqual(listEligibleCreatives({ catalog: [live], ...context, now }), []);
    const worker = createAdServerWorker({ catalog: [live], nowMs: () => now.getTime() });
    const sink = sinks();
    for (const [route, method] of [['/ad', 'GET'], ['/view', 'POST'], ['/click', 'GET']])
      assert.equal((await worker.fetch(new Request(address(route, context), { method }), sink.env)).status, 404);
    assert.deepEqual(sink.writes, []); assert.deepEqual(sink.points, []);
  }
  const expired = createAdServerWorker({ catalog: [live], nowMs: () => Date.parse(creative.expiresAt) });
  const sink = sinks();
  for (const [route, method] of [['/ad', 'GET'], ['/view', 'POST'], ['/click', 'GET']])
    assert.equal((await expired.fetch(new Request(address(route, publishers[0]), { method }), sink.env)).status, 404);
  assert.deepEqual(sink.writes, []); assert.deepEqual(sink.points, []);
});
