import test from "node:test";
import assert from "node:assert/strict";
import {
  parseData,
  selectData,
  getDataColumns,
  parseDelimited,
  parseCsv,
  stringifyCsv,
  selectJson,
  parseXml,
  exportRows,
  fetchData,
  decodeText,
} from "../src/data/index.js";
import { nodeText, xmlTable } from "../src/data/xml.js";
import {
  createProject,
  validateProject,
  serializeProject,
  deserializeProject,
  createProjectStore,
} from "../src/state/projects.js";

test("CSV preserves commas, embedded quotes, multiline fields, empty cells and CRLF", () => {
  const original = [
    ["name", "value", "empty"],
    ["Ada, Lovelace", 'Line 1\r\nLine "2"', ""],
    ["", "", ""],
    ["Helena", " leading space ", "trailing "],
  ];
  const encoded = stringifyCsv(original);
  assert.deepEqual(parseDelimited(encoded), original);
  assert.deepEqual(parseDelimited("a,b,\r\n"), [["a", "b", ""]]);
  assert.deepEqual(parseDelimited("\ufeffa,b\n"), [["a", "b"]]);
  assert.throws(() => parseDelimited('a,"unfinished\n'), /not closed/);
  assert.throws(() => parseDelimited('"a"oops,b'), /closing quote/);
});

test("CSV delimiter detection ignores delimiters in quotes and preserves ragged-row diagnostics", () => {
  const result = parseCsv(
    'Name;Name;Value\nAda;Byron;"one,two,three"\nGrace;Hopper',
  );
  assert.equal(result.delimiter, ";");
  assert.deepEqual(result.columns, ["Name", "Name (2)", "Value"]);
  assert.deepEqual(result.rows, [
    ["Ada", "Byron", "one,two,three"],
    ["Grace", "Hopper", ""],
  ]);
  assert.equal(result.warnings.length, 1);
});

test("data views select CSV columns and restore the exact source without mutation", async () => {
  const source = "Name,Email\r\nAda,ada@example.com\r\nGrace,grace@example.net";
  const data = await parseData(source, { name: "people.csv" });
  const view = selectData(data, { column: "Email" });
  assert.equal(view.text, "ada@example.com\ngrace@example.net");
  assert.equal(data.text, source);
  assert.equal(selectData(view).text, source);
  assert.equal(
    selectData(data, { column: "Email", includeHeader: true }).text,
    "Email\nada@example.com\ngrace@example.net",
  );
  assert.deepEqual(selectData(data, { header: false }).rows[0], [
    "Name",
    "Email",
  ]);
  assert.throws(() => selectData(data, { column: "missing" }), /not found/);
});

test("JSON Pointer supports escaped keys, zero values, arrays and explicit wildcard traversal", async () => {
  const value = {
    users: [
      { email: "ada@example.com", active: false },
      { email: "grace@example.net", active: true },
    ],
    "a/b": { "~value": 0 },
    zero: null,
  };
  assert.deepEqual(selectJson(value, "/a~1b/~0value"), [0]);
  assert.deepEqual(selectJson(value, "/users/*/active"), [false, true]);
  assert.deepEqual(selectJson(value, "/users/00/email"), []);
  assert.deepEqual(selectJson(value, "/zero"), [null]);
  assert.throws(() => selectJson(value, "/bad~9"), /escapes/);
  assert.throws(() => selectJson(value, "users"), /JSON Pointer/);
  const data = await parseData(JSON.stringify(value), { format: "json" });
  assert.equal(
    selectData(data, { path: "/users/*/email" }).text,
    "ada@example.com\ngrace@example.net",
  );
  assert.equal(
    selectData(data, { path: "/users", column: "email" }).text,
    "ada@example.com\ngrace@example.net",
  );
  const lines = await parseData(
    '{"email":"a@example.com"}\n\n{"email":"b@example.com"}\n',
    { name: "mail.jsonl" },
  );
  assert.equal(lines.rows.length, 2);
  assert.equal(
    selectData(lines, { column: "email" }).text,
    "a@example.com\nb@example.com",
  );
});

test("successive JSON/XML projections always rebuild from the original source", async () => {
  const json = await parseData('[{"name":"Ada","email":"ada@example.com"}]', {
    format: "json",
  });
  const nameOnly = selectData(json, { column: "name" });
  assert.deepEqual(getDataColumns(nameOnly), ["name", "email"]);
  assert.equal(
    selectData(nameOnly, { column: "email" }).text,
    "ada@example.com",
  );
  const restored = selectData(nameOnly);
  assert.deepEqual(restored.columns, ["name", "email"]);
  assert.equal(restored.text, json.sourceText);
  const xml = await parseData(
    "<users><name>Ada</name><email>ada@example.com</email></users>",
    { format: "xml" },
  );
  const valueOnly = selectData(xml, { column: "Value" });
  assert.deepEqual(getDataColumns(valueOnly), ["Path", "Element", "Value"]);
  assert.equal(
    selectData(valueOnly, { column: "Element" }).text,
    "name\nemail",
  );
  assert.equal(selectData(valueOnly).text, xml.sourceText);
});

test("XML reading handles namespaces, mixed content, CDATA, numeric entities and repeated elements", async () => {
  const xml =
    '<r:root xmlns:r="urn:demo"><item id="x&amp;y">Ada &amp; <![CDATA[<Grace>]]> &#x1F642;</item><item>Bob</item></r:root>';
  const root = parseXml(xml);
  assert.equal(root.name, "r:root");
  assert.equal(root.children[0].attributes.id, "x&y");
  assert.equal(nodeText(root.children[0]), "Ada & <Grace> 🙂");
  assert.deepEqual(xmlTable(root).rows, [
    ["/r:root/item[1]", "item", "Ada & <Grace> 🙂"],
    ["/r:root/item[2]", "item", "Bob"],
  ]);
  assert.throws(() => parseXml("<x><a></x>"), /does not match/);
  assert.throws(
    () => parseXml('<!DOCTYPE x [<!ENTITY test "value">]><x>&test;</x>'),
    /DTD/,
  );
  assert.throws(() => parseXml("<x>&#0;</x>"), /invalid character/);
  const data = await parseData(xml, { name: "data.xml" });
  assert.equal(
    selectData(data, { column: "Value" }).text,
    "Ada & <Grace> 🙂\nBob",
  );
});

test("file parsing decodes UTF-16 and rejects malformed or oversized data explicitly", async () => {
  const text = "Email\nżółw@example.pl";
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16.set([255, 254]);
  const view = new DataView(utf16.buffer);
  for (let index = 0; index < text.length; index++)
    view.setUint16(2 + index * 2, text.charCodeAt(index), true);
  assert.equal(decodeText(utf16).text, text);
  const file = new File([utf16], "emails.csv", { type: "text/csv" });
  const result = await parseData(file);
  assert.equal(result.encoding, "utf-16le");
  assert.equal(result.rows[0][0], "żółw@example.pl");
  await assert.rejects(() => parseData("abcdef", { maxBytes: 3 }), /limit/);
  await assert.rejects(
    () => parseData("{", { format: "json" }),
    /not valid JSON/,
  );
  await assert.rejects(
    () => parseData(new File(["binary"], "old.xls")),
    /older binary/,
  );
});

test("CSV and JSON exports preserve arbitrary match values and optionally protect spreadsheet formulas", () => {
  const rows = [
    { match: "=1+2", index: 0 },
    { match: 'a,"b"\nc', index: 5 },
  ];
  const csv = exportRows(rows);
  assert.deepEqual(parseDelimited(csv.text), [
    ["match", "index"],
    ["=1+2", "0"],
    ['a,"b"\nc', "5"],
  ]);
  assert.equal(
    parseDelimited(exportRows(rows, { excelSafe: true }).text)[1][0],
    "'=1+2",
  );
  assert.deepEqual(
    JSON.parse(
      exportRows([["x", 1]], { columns: ["value", "index"], format: "json" })
        .text,
    ),
    [{ value: "x", index: 1 }],
  );
});

function memoryStorage() {
  const items = new Map();
  return {
    get length() {
      return items.size;
    },
    key(index) {
      return [...items.keys()][index] ?? null;
    },
    getItem(key) {
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      items.set(key, String(value));
    },
    removeItem(key) {
      items.delete(key);
    },
  };
}

test("project import/export preserves .NET options, user workspace state and datasets, without request headers", async () => {
  const data = await parseData(
    '{"__proto__":"an ordinary JSON key","email":"ada@example.com"}',
    { format: "json" },
  );
  data.source = {
    kind: "url",
    url: "https://example.test/data",
    headers: { Authorization: "secret" },
    fetchedAt: new Date().toISOString(),
  };
  const project = createProject({
    name: "Named captures",
    patterns: [
      {
        id: "p1",
        name: "Mail",
        pattern: "(?<email>\\w+@\\w+)",
        options: 578,
        color: "#123abc",
        enabled: false,
        replacement: "${email}",
      },
    ],
    datasets: [data],
    workspace: {
      tests: [{ input: "Ada", expected: true }],
      inspectorTab: "reference",
      custom: { zoom: 1.25 },
    },
    layout: { panels: ["data", "matches"] },
  });
  const imported = deserializeProject(serializeProject(project));
  assert.deepEqual(imported.patterns, project.patterns);
  assert.deepEqual(imported.workspace, project.workspace);
  assert.deepEqual(imported.layout, project.layout);
  assert.equal(imported.datasets[0].raw.__proto__, "an ordinary JSON key");
  assert.equal(imported.datasets[0].source.headers, undefined);
  assert.equal(imported.activeDatasetId, data.id);
  assert.notEqual(
    deserializeProject(serializeProject(project), { newId: true }).id,
    project.id,
  );
  assert.throws(() => validateProject({ version: 999 }), /not supported/);
  assert.throws(
    () => validateProject({ patterns: [{ id: "a" }, { id: "a" }] }),
    /unique/,
  );
});

test("saved projects and datasets survive fresh adapters, list independently and detect conflicting writes", async () => {
  const localStorage = memoryStorage();
  const store = createProjectStore({ indexedDB: null, localStorage });
  const data = await parseData("ada@example.com", {
    format: "text",
    name: "Emails",
  });
  const project = createProject({ name: "Saved project", datasets: [data] });
  const saved = await store.saveProject(project);
  await store.saveDataset(data);
  const reopened = createProjectStore({ indexedDB: null, localStorage });
  assert.equal((await reopened.listProjects())[0].name, "Saved project");
  assert.equal((await reopened.listDatasets())[0].name, "Emails");
  assert.deepEqual(
    (await reopened.loadProject(saved.id)).patterns,
    saved.patterns,
  );
  const changed = await reopened.loadProject(saved.id);
  changed.name = "Updated project";
  const secondSave = await reopened.saveProject(changed, {
    expectedUpdatedAt: saved.updatedAt,
  });
  assert.ok(secondSave.updatedAt > saved.updatedAt);
  await assert.rejects(
    () => store.saveProject(saved, { expectedUpdatedAt: saved.updatedAt }),
    (error) => error.code === "storage-conflict",
  );
  await reopened.deleteProject(saved.id);
  assert.equal(await reopened.loadProject(saved.id), null);
  assert.equal((await reopened.listDatasets()).length, 1);
  await reopened.deleteDataset(data.id);
  assert.deepEqual(await reopened.listDatasets(), []);
  assert.equal((await reopened.status()).backend, "localstorage");
});

test("storage failures never report a save as successful", async () => {
  const localStorage = memoryStorage();
  const originalSet = localStorage.setItem;
  localStorage.setItem = (key, value) => {
    if (!key.endsWith("storage-probe"))
      throw new DOMException("Full", "QuotaExceededError");
    originalSet(key, value);
  };
  const store = createProjectStore({ indexedDB: null, localStorage });
  await assert.rejects(
    () => store.saveProject(createProject()),
    (error) => error.code === "storage-quota",
  );
  assert.equal(localStorage.length, 0);
  await assert.rejects(
    () =>
      createProjectStore({
        indexedDB: null,
        localStorage: null,
      }).listProjects(),
    (error) => error.code === "storage-unavailable",
  );
});

test("online sources use explicit GET, honor headers and do not persist them", async (context) => {
  let request;
  context.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, options };
    return new Response('[{"email":"ada@example.com"}]', {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  });
  const data = await fetchData("https://example.test/api/people", {
    headers: { Authorization: "Bearer ephemeral" },
  });
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.credentials, "omit");
  assert.equal(
    request.options.headers.get("Authorization"),
    "Bearer ephemeral",
  );
  assert.equal(data.format, "json");
  assert.equal(data.source.url, "https://example.test/api/people");
  assert.equal(data.source.headers, undefined);
  assert.equal(selectData(data, { column: "email" }).text, "ada@example.com");
  await assert.rejects(() => fetchData("file:///private"), /HTTP or HTTPS/);
  await assert.rejects(
    () => fetchData("https://user:password@example.test"),
    /authentication/,
  );
});

test("online download limits apply to streaming content with no content-length", async (context) => {
  let cancelled = false;
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("abcdef"));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(
    () => fetchData("https://example.test/data.txt", { maxBytes: 3 }),
    (error) => error.code === "data-limit",
  );
  assert.equal(cancelled, true);
});
