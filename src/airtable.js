const fetch = require('node-fetch');
const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = require('./config');

const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const META_URL = `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}`;

async function request(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Airtable ${res.status}: ${JSON.stringify(body.error || body)}`);
  }
  return body;
}

async function atFetch(path, opts = {}) {
  const url = path.startsWith('https://') ? path : `${BASE_URL}/${path}`;
  return request(url, opts);
}

// List all records from a table, following pagination.
async function listAll(tableIdOrName, params = {}) {
  const records = [];
  let offset = null;
  do {
    const qs = new URLSearchParams();
    if (offset) qs.set('offset', offset);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach(i => qs.append(`${k}[]`, i));
      else qs.set(k, v);
    }
    const data = await atFetch(`${encodeURIComponent(tableIdOrName)}?${qs}`);
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function listTables() {
  const data = await request(`${META_URL}/tables`);
  return data.tables;
}

async function createTable(name, fields) {
  return request(`${META_URL}/tables`, {
    method: 'POST',
    body: JSON.stringify({ name, fields }),
  });
}

// Add a single new column to an existing table.
async function createField(tableId, field) {
  return request(`${META_URL}/tables/${tableId}/fields`, {
    method: 'POST',
    body: JSON.stringify(field),
  });
}

async function createRecords(tableIdOrName, records) {
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const data = await atFetch(encodeURIComponent(tableIdOrName), {
      method: 'POST',
      body: JSON.stringify({ records: chunk.map(f => ({ fields: f })), typecast: true }),
    });
    results.push(...data.records);
  }
  return results;
}

// Update the row matching keyField=keyValue, or create it if absent.
async function upsert(tableIdOrName, keyField, keyValue, fields) {
  const qs = new URLSearchParams({
    filterByFormula: `{${keyField}} = "${keyValue}"`,
    maxRecords: 1,
  });
  const data = await atFetch(`${encodeURIComponent(tableIdOrName)}?${qs}`);
  if (data.records.length > 0) {
    const recId = data.records[0].id;
    return atFetch(`${encodeURIComponent(tableIdOrName)}/${recId}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    });
  }
  return atFetch(encodeURIComponent(tableIdOrName), {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
}

async function listView(tableIdOrName, viewName) {
  return listAll(tableIdOrName, { view: viewName });
}

module.exports = {
  atFetch,
  listAll,
  listTables,
  createTable,
  createField,
  createRecords,
  upsert,
  listView,
};
