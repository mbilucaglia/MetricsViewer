const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../js/project');
const {pack,unpack} = globalThis.MetricsProject;

test('project round-trip preserves Unicode, binary media and files with duplicate names', async () => {
  const files = [
    new File([Uint8Array.of(0,255,4)],'stimolo.png',{type:'image/png',lastModified:12}),
    new File([Uint8Array.of(3,0)],'stimolo.png',{type:'image/png',lastModified:14})
  ];
  const state = {epoch:'Caffè ☕',links:[{index:1,epoch:'Caffè ☕'}]};
  const restored = await unpack(pack(state,files));
  assert.deepEqual(restored.state,state);
  for (const [i,file] of restored.files.entries()) {
    assert.equal(file.name,files[i].name);
    assert.equal(file.type,files[i].type);
    assert.equal(file.lastModified,files[i].lastModified);
    assert.deepEqual(await file.arrayBuffer(),await files[i].arrayBuffer());
  }
});

test('project reader rejects unrelated, truncated and unsupported files', async () => {
  const file = pack({},[new File(['abc'],'clip.mp4')]);
  await assert.rejects(unpack(new Blob(['{}'])), /Metrics Viewer/);
  await assert.rejects(unpack(file.slice(0,13)), /danneggiato/);
  await assert.rejects(unpack(file.slice(0,-1)), /danneggiato/);
  const future = new Blob([(await file.text()).replace('"version":1','"version":2')]);
  await assert.rejects(unpack(future), /Versione/);
  assert.deepEqual(await unpack(pack({},[])),{state:{},files:[]});
});
