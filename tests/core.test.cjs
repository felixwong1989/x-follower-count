const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'network-core.js'), 'utf8'), context);
const core = { ...context.XFollowerCore, ...context.XFollowerNetworkCore };
const plain = value => JSON.parse(JSON.stringify(value));

test('nested GraphQL users, zero counts, duplicate handles, and newer core shape', () => {
  const payload = { data: { entries: [
    { user_results: { result: { __typename: 'User', legacy: { screen_name: 'Alice', followers_count: 12345 } } } },
    { core: { screen_name: 'Bob' }, legacy: { followers_count: 0 } },
    { screen_name: 'ALICE', public_metrics: { followers_count: '12346' } }
  ] } };
  const users = plain(core.collectUsers(payload));
  assert.equal(users.length, 2);
  assert.equal(users.find(user => user.handle === 'bob').followers, 0);
  assert.equal(users.find(user => user.handle === 'alice').followers, 12346);
});

test('does not associate unrelated nested counts or deleted/tombstoned users', () => {
  const payload = [
    { screen_name: 'wrong', nested: { followers_count: 300 } },
    { legacy: { screen_name: 'invalid-handle!', followers_count: 1 } },
    { legacy: { screen_name: 'missing' } },
    { legacy: { screen_name: 'negative', followers_count: -1 } },
    { legacy: { screen_name: 'fraction', followers_count: 1.5 } },
    { legacy: { screen_name: 'nullable', followers_count: null } },
    { __typename: 'UserUnavailable' }
  ];
  assert.deepEqual(plain(core.collectUsers(payload)), []);
});

test('current X relationship_counts schema, zero, and migration precedence', () => {
  const payload = { data: { user: { result: { __typename: 'User', timeline: { entries: [
    { user_results: { result: { __typename: 'User', core: { screen_name: 'CurrentX' }, relationship_counts: { followers: 3484, following: 853 } } } },
    { core: { screen_name: 'ZeroNew' }, relationship_counts: { followers: 0, following: 100 }, legacy: { followers_count: 99 } },
    { core: { screen_name: 'MissingNew' }, relationship_counts: { following: 500 } }
  ] } } } } };
  assert.deepEqual(plain(core.collectUsers(payload)), [
    { handle: 'currentx', followers: 3484 },
    { handle: 'zeronew', followers: 0 }
  ]);
});

test('cyclic data is safe and missing is distinct from zero', () => {
  const payload = { screen_name: 'zero', followers_count: 0 };
  payload.self = payload;
  assert.deepEqual(plain(core.collectUsers(payload)), [{ handle: 'zero', followers: 0 }]);
  assert.equal(core.count(undefined), null);
  assert.equal(core.count('0'), 0);
  assert.equal(core.count(''), null);
  assert.equal(core.count(Infinity), null);
});

test('Chinese labels retain exact small values and compact larger values', () => {
  assert.equal(core.formatCount(0), '0');
  assert.equal(core.formatCount(9999), '9,999');
  assert.equal(core.formatCount(10000), '1万');
  assert.equal(core.formatCount(12500), '1.3万');
  assert.equal(core.formatCount(123400000), '1.2亿');
});

test('manifest restricts access to X and registers the network hook at document_start in MAIN', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[1].world, 'ISOLATED');
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  for (const entry of manifest.content_scripts) for (const file of [...entry.js, ...(entry.css || [])]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', file)), file);
  }
});
