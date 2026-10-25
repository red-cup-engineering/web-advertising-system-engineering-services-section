import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_CREATIVE_CATALOG } from '../src/catalog.mjs';
import { listEligibleCreatives } from '../src/advertising.mjs';
import { createAdServerWorker } from '../src/web/worker.mjs';

const expected = {
  "pig-game-cultivation-20261025": "https://parlor.561.group/pig/",
  "farkle-game-cultivation-20261025": "https://parlor.561.group/farkle/",
  "yacht-game-cultivation-20261025": "https://parlor.561.group/yacht/",
  "chutes-game-cultivation-20261025": "https://parlor.561.group/chutes/",
  "reels-game-cultivation-20261025": "https://parlor.561.group/reels/",
  "stoke-game-cultivation-20261025": "https://stoke.561.group/",
  "flickering-delve-game-cultivation-20261025": "https://flickering.561.group/"
};
const prepared = HOUSE_CREATIVE_CATALOG.filter(c => Object.hasOwn(expected, c.id));
const now = new Date('2026-10-25T12:00:00.000Z');
const base = 'https://ads.561.group';
const query = (path, c, property = 'koios-news', context = 'games') =>
  base + path + '?' + new URLSearchParams({
    slot: 'afterArticle', property, context, creative: c.id
  });
const sink = () => {
  const writes = [], activity = [];
  return {writes, activity, env: {
    AD_RECEIPTS: {put: async (...args) => { writes.push(args); }},
    AD_ACTIVITY: {writeDataPoint: point => activity.push(point)}
  }};
};

test('seven title invitations retain exact destinations and are inactive source records', () => {
  assert.equal(prepared.length, 7);
  assert.equal(new Set(HOUSE_CREATIVE_CATALOG.map(c => c.id)).size, HOUSE_CREATIVE_CATALOG.length);
  for (const c of prepared) {
    assert.equal(c.status, 'coming-soon');
    assert.equal(c.relationship, 'house');
    assert.equal(c.href, expected[c.id]);
    assert.deepEqual(c.properties, ['koios-news', 'play-561-group']);
    assert.deepEqual(c.slots, ['afterArticle', 'footer']);
    assert.deepEqual(c.allowedContexts, ['games', 'culture-entertainment']);
    assert.equal(listEligibleCreatives({catalog:[c],slot:'afterArticle',property:'koios-news',context:['games'],now}).length,0);
  }
});

test('prepared game campaigns cannot serve, record a view or redirect before destination receiving', async () => {
  for (const c of prepared) {
    const worker = createAdServerWorker({catalog:[c],nowMs:()=>now.getTime()});
    const s = sink();
    for (const [path,method] of [['/ad','GET'],['/view','POST'],['/click','GET']]) {
      const response = await worker.fetch(new Request(query(path,c),{method}),s.env);
      assert.equal(response.status,404,c.id+path);
      assert.equal(response.headers.get('location'),null);
    }
    assert.deepEqual(s.writes,[]);
    assert.deepEqual(s.activity,[]);
  }
});

test('hypothetically received copies use existing contextual house delivery with zero paid writes', async () => {
  for (const original of prepared) {
    // Qualification input only: the source catalog remains coming-soon.
    const c = {...original,status:'live'};
    for (const property of ['koios-news','play-561-group']) {
      const worker = createAdServerWorker({catalog:[c],nowMs:()=>now.getTime()});
      const s = sink();
      const ad = await worker.fetch(new Request(query('/ad',c,property)),s.env);
      assert.equal(ad.status,200);
      const shown = (await ad.json()).creative;
      assert.equal(shown.id,c.id);
      assert.equal(shown.relationship,'house');
      assert.equal(shown.linkRel,null);
      assert.equal((await worker.fetch(new Request(query('/view',c,property),{method:'POST'}),s.env)).status,202);
      const click = await worker.fetch(new Request(query('/click',c,property)),s.env);
      assert.equal(click.status,302);
      assert.equal(click.headers.get('location'),expected[c.id]);
      assert.equal(click.headers.get('x-561-receipt-status'),'not-applicable');
      assert.deepEqual(s.writes,[]);
      assert.equal(s.activity.length,3);
    }
    assert.equal(original.status,'coming-soon');
  }
});

test('game invitations refuse unrelated pages, publishers and self-promotion', async () => {
  for (const original of prepared) {
    const c = {...original,status:'live'};
    for (const [property,context] of [['koios-news','science'],['koios-news',''],['unknown-publisher','games'],[c.property,'games']]) {
      const worker = createAdServerWorker({catalog:[c],nowMs:()=>now.getTime()});
      const s = sink();
      for (const [path,method] of [['/ad','GET'],['/view','POST'],['/click','GET']]) {
        const response = await worker.fetch(new Request(query(path,c,property,context),{method}),s.env);
        assert.equal(response.status,404,c.id+path);
      }
      assert.deepEqual(s.writes,[]);
      assert.deepEqual(s.activity,[]);
    }
  }
});
