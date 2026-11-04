import { DataError } from "./errors.js";

const xmlName =
  /^[:A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}][:A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}\-.0-9\u00b7\u0300-\u036f\u203f-\u2040]*/u;
const entityValues = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function legalXmlCodePoint(value) {
  return (
    value === 9 ||
    value === 10 ||
    value === 13 ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

export function decodeXmlEntities(text) {
  return text.replace(/&([^;\s<&]*);|&/g, (match, entity) => {
    if (!entity)
      throw new DataError(
        "XML contains an unescaped ampersand.",
        "invalid-xml",
      );
    if (Object.hasOwn(entityValues, entity)) return entityValues[entity];
    const hexadecimal = /^#x[0-9a-f]+$/i.test(entity);
    if (hexadecimal || /^#\d+$/.test(entity)) {
      const value = Number.parseInt(
        entity.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      if (!legalXmlCodePoint(value))
        throw new DataError(
          `XML contains the invalid character reference &${entity};.`,
          "invalid-xml",
        );
      return String.fromCodePoint(value);
    }
    throw new DataError(
      `XML entity &${entity}; is not defined. Only standard and numeric entities are supported.`,
      "unsupported-xml",
    );
  });
}

/** A small, non-validating XML reader for data and OOXML. DTDs are intentionally unsupported. */
export function parseXml(text, { maxDepth = 256, maxNodes = 1_000_000 } = {}) {
  if (typeof text !== "string")
    throw new TypeError("XML data must be a string.");
  text = text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  if (/<!DOCTYPE\b/i.test(text) || /<!ENTITY\b/i.test(text))
    throw new DataError(
      "XML documents with a DTD or custom entities are not supported. Export XML with the values expanded.",
      "unsupported-xml",
    );
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text))
    throw new DataError(
      "XML contains a character that XML 1.0 does not allow.",
      "invalid-xml",
    );
  const stack = [];
  let root = null;
  let index = 0;
  let count = 0;
  const fail = (message) => {
    const line = text.slice(0, index).split("\n").length;
    throw new DataError(`${message} (line ${line}).`, "invalid-xml", { line });
  };
  const white = () => {
    while (/\s/u.test(text[index] || "") && index < text.length) index++;
  };
  const name = () => {
    const match = xmlName.exec(text.slice(index));
    if (!match) fail("Expected an XML element or attribute name");
    index += match[0].length;
    return match[0];
  };
  const appendText = (value) => {
    if (stack.length) stack[stack.length - 1].content.push(value);
    else if (value.trim()) fail("Text is not allowed outside the root element");
  };
  while (index < text.length) {
    if (text[index] !== "<") {
      const end = text.indexOf("<", index);
      const raw = text.slice(index, end < 0 ? text.length : end);
      if (raw.includes("]]>"))
        fail("The sequence ]]> is not allowed in XML text");
      appendText(decodeXmlEntities(raw));
      index = end < 0 ? text.length : end;
    } else if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0) fail("An XML comment is not closed");
      if (text.slice(index + 4, end).includes("--"))
        fail("XML comments cannot contain --");
      index = end + 3;
    } else if (text.startsWith("<![CDATA[", index)) {
      if (!stack.length) fail("CDATA is not allowed outside the root element");
      const end = text.indexOf("]]>", index + 9);
      if (end < 0) fail("A CDATA section is not closed");
      appendText(text.slice(index + 9, end));
      index = end + 3;
    } else if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0) fail("An XML processing instruction is not closed");
      index = end + 2;
    } else if (text.startsWith("</", index)) {
      index += 2;
      const closing = name();
      white();
      if (text[index] !== ">")
        fail("Expected > after the closing element name");
      index++;
      const current = stack.pop();
      if (!current || current.name !== closing)
        fail(
          `Closing element </${closing}> does not match ${current ? `<${current.name}>` : "an open element"}`,
        );
    } else if (text.startsWith("<!", index)) {
      fail("Unsupported XML declaration");
    } else {
      index++;
      const tag = name();
      const attributes = Object.create(null);
      while (index < text.length) {
        const beforeSpace = index;
        white();
        if (text[index] === ">" || text.startsWith("/>", index)) break;
        if (beforeSpace === index)
          fail("Attributes must be separated by whitespace");
        const key = name();
        if (Object.hasOwn(attributes, key))
          fail(`Attribute ${key} appears more than once`);
        white();
        if (text[index++] !== "=") fail(`Expected = after attribute ${key}`);
        white();
        const quote = text[index++];
        if (quote !== '"' && quote !== "'")
          fail(`Attribute ${key} needs quotes around its value`);
        const end = text.indexOf(quote, index);
        if (end < 0) fail(`Attribute ${key} is not closed`);
        const raw = text.slice(index, end);
        if (raw.includes("<"))
          fail("Attribute values cannot contain an unescaped <");
        attributes[key] = decodeXmlEntities(raw.replace(/[\n\t]/g, " "));
        index = end + 1;
      }
      const closed = text.startsWith("/>", index);
      if (!closed && text[index] !== ">")
        fail(`Element <${tag}> is not closed`);
      index += closed ? 2 : 1;
      const node = {
        name: tag,
        localName: tag.split(":").at(-1),
        attributes,
        children: [],
        content: [],
      };
      if (++count > maxNodes)
        throw new DataError(
          `The XML file exceeds the ${maxNodes.toLocaleString()} element import limit.`,
          "data-limit",
        );
      if (stack.length) {
        stack[stack.length - 1].children.push(node);
        stack[stack.length - 1].content.push(node);
      } else if (root) fail("XML must contain exactly one root element");
      else root = node;
      if (!closed) {
        stack.push(node);
        if (stack.length > maxDepth)
          throw new DataError(
            `XML nesting exceeds ${maxDepth} levels.`,
            "data-limit",
          );
      }
    }
  }
  if (stack.length) fail(`Element <${stack.at(-1).name}> is not closed`);
  if (!root) throw new DataError("The XML document is empty.", "invalid-xml");
  return root;
}

export function childrenNamed(node, localName) {
  return node?.children.filter((child) => child.localName === localName) || [];
}
export function firstChild(node, localName) {
  return node?.children.find((child) => child.localName === localName);
}
export function nodeText(node) {
  return node
    ? node.content
        .map((item) => (typeof item === "string" ? item : nodeText(item)))
        .join("")
    : "";
}
export function* descendants(node, localName) {
  for (const child of node?.children || []) {
    if (!localName || child.localName === localName) yield child;
    yield* descendants(child, localName);
  }
}

export function xmlTable(root, { maxRows = 100_000 } = {}) {
  const rows = [];
  const visit = (node, path) => {
    if (!node.children.length) {
      if (rows.length >= maxRows)
        throw new DataError(
          `The XML file exceeds the ${maxRows.toLocaleString()} extracted-value limit.`,
          "data-limit",
        );
      rows.push([path, node.name, nodeText(node)]);
    }
    const totals = new Map();
    const seen = new Map();
    node.children.forEach((child) =>
      totals.set(child.name, (totals.get(child.name) || 0) + 1),
    );
    for (const child of node.children) {
      seen.set(child.name, (seen.get(child.name) || 0) + 1);
      const suffix =
        totals.get(child.name) > 1 ? `[${seen.get(child.name)}]` : "";
      visit(child, `${path}/${child.name}${suffix}`);
    }
  };
  visit(root, `/${root.name}`);
  return { columns: ["Path", "Element", "Value"], rows };
}

/** Full browser XPath 1.0, including predicates, attributes, namespaces and scalar results. */
export function selectXml(
  text,
  xpath,
  { namespaces = {}, markup = false } = {},
) {
  if (!xpath?.trim()) return [text];
  if (typeof DOMParser === "undefined")
    throw new DataError(
      "XPath selection requires a browser with DOMParser and XPath support.",
      "xpath-unavailable",
    );
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(text))
    throw new DataError(
      "XPath selection does not accept DTDs or custom XML entities.",
      "unsupported-xml",
    );
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (
    document.getElementsByTagNameNS(
      "http://www.mozilla.org/newlayout/xml/parsererror.xml",
      "parsererror",
    ).length
  )
    throw new DataError("The XML document is not well formed.", "invalid-xml");
  if (typeof document.evaluate !== "function")
    throw new DataError(
      "This browser does not support XPath.",
      "xpath-unavailable",
    );
  const resolver = (prefix) =>
    Object.hasOwn(namespaces, prefix)
      ? namespaces[prefix]
      : prefix === "d"
        ? document.documentElement.namespaceURI
        : document.documentElement.lookupNamespaceURI(prefix);
  let result;
  try {
    result = document.evaluate(xpath, document, resolver, 0, null);
  } catch (error) {
    throw new DataError(
      `Cannot evaluate this XPath: ${error.message}. Use prefix d: for the document's default namespace.`,
      "invalid-xpath",
    );
  }
  if (result.resultType === 1) return [String(result.numberValue)];
  if (result.resultType === 2) return [result.stringValue];
  if (result.resultType === 3) return [String(result.booleanValue)];
  const value = (node) =>
    markup && node.nodeType === 1
      ? new XMLSerializer().serializeToString(node)
      : (node.nodeValue ?? node.textContent ?? "");
  const values = [];
  if (result.resultType === 8 || result.resultType === 9)
    return result.singleNodeValue ? [value(result.singleNodeValue)] : [];
  if (result.resultType === 6 || result.resultType === 7) {
    for (let index = 0; index < result.snapshotLength; index++)
      values.push(value(result.snapshotItem(index)));
  } else {
    let node;
    while ((node = result.iterateNext())) values.push(value(node));
  }
  return values;
}
