(function (root) {
  'use strict';

  const commonJS = typeof module === 'object' && module.exports;
  const XLSX = commonJS ? require('./vendor/xlsx.mini.min') : root.XLSX;
  const timeHeader = /^(?:time|tempo)(?:\s*(?:\[\s*s\s*\]|\(\s*s\s*\)|_s))?$/i;
  const missingValue = /^(?:nan|n\/?a|#n\/a)$/i;
  const numericText = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i;

  function parseNumber(value, location) {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || missingValue.test(text)) return null;
      if (numericText.test(text)) {
        const number = Number(text.replace(',', '.'));
        if (Number.isFinite(number)) return number;
      }
    }
    throw new Error(location + ': valore numerico non valido.');
  }

  function addSheet(records, sheet, sheetName, metric, epochId) {
    if (!sheet) throw new Error('Impossibile leggere il foglio «' + sheetName + '».');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
    const header = rows.shift() ?? [];
    const names = Array.from(header, value => String(value ?? '').trim());
    const timeColumns = names.flatMap((label, index) => timeHeader.test(label) ? [index] : []);
    if (timeColumns.length !== 1) {
      throw new Error('Foglio «' + sheetName + '»: serve una sola colonna Time [s].');
    }

    const [timeColumn] = timeColumns;
    const subjects = new Map();
    for (const [column, name] of names.entries()) {
      if (!name || column === timeColumn) continue;
      if (subjects.has(name)) throw new Error('Foglio «' + sheetName + '»: soggetto duplicato «' + name + '».');
      subjects.set(name, { column, values: [] });
    }
    if (!subjects.size || !rows.length) {
      throw new Error('Foglio «' + sheetName + '»: mancano soggetti o campioni.');
    }

    const time = [];
    for (const row of rows) {
      const location = 'Foglio «' + sheetName + '», campione ' + (time.length + 1);
      const t = parseNumber(row[timeColumn], location + ', tempo');
      if (t === null || t < 0 || (time.length && t <= time.at(-1))) {
        throw new Error(location + ': i tempi devono essere non negativi e strettamente crescenti.');
      }
      time.push(t);
      for (const [name, { column, values }] of subjects) {
        values.push(parseNumber(row[column], location + ', «' + name + '»'));
      }
    }

    for (const [name, { values }] of subjects) {
      if (values.every(value => value === null)) continue;
      if (!records.has(name)) records.set(name, new Map());
      const epochs = records.get(name);
      if (!epochs.has(epochId)) epochs.set(epochId, { id: epochId, metrics: Object.create(null) });
      epochs.get(epochId).metrics[metric] = { time, values };
    }
  }

  function read(buffer) {
    const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (signature.length < 4 || signature[0] !== 80 || signature[1] !== 75 ||
        signature[2] !== 3 || signature[3] !== 4) {
      throw new Error('Il file non è un documento XLSX leggibile.');
    }
    let workbook;
    try {
      workbook = XLSX.read(buffer, { nodim: true, cellHTML: false, cellFormula: false, cellText: false });
    } catch {
      throw new Error('Impossibile leggere il documento XLSX.');
    }
    const records = new Map();
    const seen = new Set();
    for (const sheetName of workbook.SheetNames) {
      const separator = sheetName.lastIndexOf('@');
      if (separator === -1) continue;
      const metric = sheetName.slice(0, separator).trim();
      const epoch = sheetName.slice(separator + 1).trim();
      if (!metric || !epoch) throw new Error('Nome foglio non valido: «' + sheetName + '». Usa «Metrica @ Epoca».');
      const key = JSON.stringify([metric, epoch]);
      if (seen.has(key)) throw new Error('Metrica ed epoca duplicate nel foglio «' + sheetName + '».');
      seen.add(key);
      addSheet(records, workbook.Sheets[sheetName], sheetName, metric, epoch);
    }
    if (!seen.size) throw new Error('Nessun foglio nel formato «Metrica @ Epoca».');
    if (!records.size) throw new Error('Il documento XLSX non contiene valori numerici per i soggetti.');

    return {
      schema_version: 1,
      time_unit: 's',
      recordings: Array.from(records, ([subject, epochs]) => ({
        id: subject,
        subject,
        epochs: Array.from(epochs.values())
      }))
    };
  }

  if (commonJS) module.exports = { read };
  else root.MetricsLegacyXlsx = { read };
})(globalThis);
