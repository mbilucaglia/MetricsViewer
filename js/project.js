/* File layout: signature, little-endian JSON byte length, UTF-8 manifest, original media bytes. */
(function(root) {
  'use strict';
  const signature = 'MVPROJECT\n';
  function requireValid(condition) {
    if (!condition) throw new Error('Progetto incompleto o danneggiato.');
  }
  function pack(state, files) {
    const media = files.map(({name,type,size,lastModified}) => ({name,type,size,lastModified}));
    const manifest = new Blob([JSON.stringify({version:1,state,media})]);
    if (manifest.size > 0xffffffff) throw new Error('Le metriche superano la dimensione supportata.');
    const length = new DataView(new ArrayBuffer(4));
    length.setUint32(0, manifest.size, true);
    return new Blob([signature,length,manifest,...files], {type:'application/octet-stream'});
  }
  async function unpack(blob) {
    const start = signature.length + 4;
    if (await blob.slice(0,signature.length).text() !== signature) throw new Error('Scegli un file progetto di Metrics Viewer (.mvproj).');
    requireValid(blob.size >= start);
    const length = new DataView(await blob.slice(signature.length,start).arrayBuffer()).getUint32(0,true);
    let offset = start + length;
    requireValid(offset <= blob.size);
    const manifest = JSON.parse(await blob.slice(start,offset).text());
    if (manifest.version !== 1) throw new Error('Versione del progetto non supportata.');
    requireValid(Array.isArray(manifest.media));
    const files = manifest.media.map(({name,type,size,lastModified}) => {
      requireValid(typeof name === 'string' && typeof type === 'string' && Number.isSafeInteger(size) && size >= 0 && offset + size <= blob.size);
      const file = new File([blob.slice(offset,offset+size)],name,{type,lastModified});
      offset += size;
      return file;
    });
    requireValid(offset === blob.size);
    return {state:manifest.state,files};
  }
  root.MetricsProject = {pack,unpack,requireValid};
})(globalThis);
