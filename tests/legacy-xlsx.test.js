const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const XLSX = require('../js/vendor/xlsx.mini.min');
const { read } = require('../js/legacy-xlsx');
const { validate, merge } = require('../js/core');

const asArrayBuffer = buffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

function workbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return asArrayBuffer(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
}

test('imports the historical XLSX fixture with the original times and measurements', () => {
  const input = fs.readFileSync(require.resolve('../EEG_TimeSeries_demo_sintetico_2_stimoli.xlsx'));
  const imported = validate(read(asArrayBuffer(input)));
  const reference = require('../metrics_demo_2_stimoli.json');
  assert.equal(imported.recordings.length, 35);
  for (const record of imported.recordings) {
    const expected = reference.recordings.find(item => item.subject === record.subject);
    assert.equal(record.epochs.length, 2);
    for (const epoch of record.epochs) {
      assert.equal(Object.keys(epoch.metrics).length, 8);
      const target = expected.epochs.find(item => item.id === epoch.id);
      for (const [metric, series] of Object.entries(epoch.metrics)) {
        assert.deepEqual(series, target.metrics[metric]);
      }
    }
  }
});

test('handles blank cells, different column orders and mixing with JSON', () => {
  const data = read(workbookBuffer({
    Metadata: [['Notes'], ['Ignored']],
    'AWI @ A': [['S1', 'Time [s]', 'Empty', '02'], [1, 0, null, 2], [null, 0.3, null, 3], ['4,2', 1, null, 'NaN']],
    'WL @ B': [['Tempo (s)', 'S1'], [2, 12]]
  }));
  assert.deepEqual(data.recordings.map(r => r.subject), ['S1', '02']);
  assert.deepEqual(data.recordings[0].epochs[0].metrics.AWI, {
    time: [0, 0.3, 1], values: [1, null, 4.2]
  });
  assert.deepEqual(data.recordings[1].epochs[0].metrics.AWI.values, [2, 3, null]);
  const json = { ...data, recordings: [{ ...data.recordings[0], id: 'other', subject: 'other' }] };
  assert.equal(merge([data, json]).recordings.length, 3);
});

test('rejects unsupported spreadsheets, malformed times and unreadable input', () => {
  assert.throws(() => read(workbookBuffer({ Sheet1: [['Time [s]', 'Subject'], [1, 2]] })), /Nessun foglio/);
  assert.throws(() => read(workbookBuffer({ 'AWI @ A': [['S1', 'Time [s]'], [2, 1], [3, 1]] })), /strettamente crescenti/);
  assert.throws(() => read(asArrayBuffer(Buffer.from('not XLSX'))), /non è un documento XLSX/);
});
