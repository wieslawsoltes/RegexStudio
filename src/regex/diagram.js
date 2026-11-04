/** Pure SVG railroad rendering. No HTML from a pattern is trusted. */
let diagramSerial = 0;
const escapeXml = value => {
  // XML cannot carry NUL, most controls, or isolated UTF-16 surrogates.
  let valid = '';
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && source.charCodeAt(index + 1) >= 0xdc00 && source.charCodeAt(index + 1) <= 0xdfff) {
      valid += source[index] + source[++index];
    } else if (code < 32 && ![9, 10, 13].includes(code) || code >= 0xd800 && code <= 0xdfff || code === 0xfffe || code === 0xffff) {
      valid += `\\u${code.toString(16).padStart(4, '0')}`;
    } else valid += source[index];
  }
  return valid.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
};
const short = (value, max = 28) => {
  const characters = Array.from(String(value ?? '').replaceAll('\n', '↵').replaceAll('\r', '␍').replaceAll('\t', '⇥'));
  return characters.length > max ? characters.slice(0, max - 1).join('') + '…' : characters.join('');
};
const ignored = node => ['comment', 'whitespace', 'options'].includes(node.type);

export function renderRailroad(analysis, { selectedId = null, maxLabelLength = 28, id = null } = {}) {
  if (!analysis?.tree) return '';
  const prefix = id ? String(id).replace(/[^\w-]/g, '') : `railroad-${++diagramSerial}`;
  const context = { selectedId, maxLabelLength, prefix };
  const body = layout(analysis.tree.body || analysis.tree, context);
  const width = Math.ceil(body.width + 104);
  const height = Math.ceil(body.height + 62);
  const center = body.height / 2 + 40;
  const direction = analysis.summary?.direction === 'right-to-left' ? 'Syntax order · matching searches right to left' : 'Read the pattern from left to right';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="regex-railroad" role="img" aria-labelledby="${prefix}-title ${prefix}-description" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="max-width:100%;height:auto;display:block;overflow:visible">
    <title id="${prefix}-title">Pattern structure</title>
    <desc id="${prefix}-description">${escapeXml(direction)}. Branches are alternatives and loops are repetitions. Select an element to inspect its source. This is a syntax diagram; optimized .NET execution steps are shown in the simulator.</desc>
    <style>
      .regex-railroad{font-family:var(--font-ui,Inter,"Segoe UI",system-ui,sans-serif);color:var(--text,#243246)}
      .regex-railroad .rr-rail{fill:none;stroke:var(--diagram-rail,#95a8b9);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
      .regex-railroad .rr-arrow{fill:var(--diagram-rail,#95a8b9);stroke:none}
      .regex-railroad .rr-node{cursor:pointer;outline:none}
      .regex-railroad .rr-box{fill:var(--diagram-node,#f0f8f6);stroke:var(--diagram-border,#9acabd);stroke-width:1.2}
      .regex-railroad .rr-node[data-kind="character-class"]>.rr-box,.regex-railroad .rr-node[data-kind="class-escape"]>.rr-box{fill:var(--diagram-class,#edf4ff);stroke:var(--diagram-class-border,#adc3e9)}
      .regex-railroad .rr-node[data-kind="anchor"]>.rr-box{fill:var(--diagram-anchor,#f2f3f7);stroke:var(--diagram-anchor-border,#c2c8d4)}
      .regex-railroad .rr-node[data-kind="backreference"]>.rr-box{fill:var(--diagram-assertion,#f6efff);stroke:var(--diagram-assertion-border,#c8b6e6)}
      .regex-railroad .rr-frame{fill:none;stroke:var(--diagram-frame,#b7c8cf);stroke-width:1;stroke-dasharray:4 4}
      .regex-railroad .rr-assertion{stroke:var(--diagram-assertion-border,#b59ed6);fill:var(--diagram-assertion-fill,rgba(157,119,214,.025))}
      .regex-railroad .rr-atomic{stroke-width:2;stroke-dasharray:none}
      .regex-railroad .rr-label{font:12px var(--font-mono,"Cascadia Code","SFMono-Regular",Consolas,monospace);fill:var(--text,#243246);text-anchor:middle;dominant-baseline:central;pointer-events:none}
      .regex-railroad .rr-note{font-size:10px;font-weight:550;fill:var(--muted,#61758a);text-anchor:middle;pointer-events:none}
      .regex-railroad .rr-caption{font-size:10px;letter-spacing:.03em;fill:var(--muted,#61758a)}
      .regex-railroad .rr-node:hover>.rr-box,.regex-railroad .rr-node:focus>.rr-box,.regex-railroad .rr-selected>.rr-box{stroke:var(--accent,#087e74);stroke-width:2.3}
      .regex-railroad .rr-node:hover>.rr-frame,.regex-railroad .rr-node:focus>.rr-frame,.regex-railroad .rr-selected>.rr-frame{stroke:var(--accent,#087e74);stroke-width:2}
      .regex-railroad .rr-marker{fill:var(--accent,#087e74);stroke:none}
    </style>
    <text class="rr-caption" x="16" y="16">${escapeXml(direction)}</text>
    <circle class="rr-marker" cx="19" cy="${center}" r="4"/>
    ${rail(`M 23 ${center} H 52`)}
    ${body.render(52, 40)}
    ${rail(`M ${52 + body.width} ${center} H ${width - 23}`)}
    <circle class="rr-rail" cx="${width - 19}" cy="${center}" r="5"/>
    <circle class="rr-marker" cx="${width - 19}" cy="${center}" r="2"/>
  </svg>`;
}

function rail(path, extra = '') { return `<path class="rr-rail" d="${path}" ${extra}/>`; }

function attrs(node, context) {
  return `class="rr-node${context.selectedId === node.id ? ' rr-selected' : ''}" data-node-id="${escapeXml(node.id)}" data-start="${node.start}" data-end="${node.end}" data-kind="${escapeXml(node.type)}" tabindex="0" role="button" aria-label="${escapeXml(`${node.label || node.type}: ${node.raw}`)}"`;
}

function title(node) { return `<title>${escapeXml(node.description || node.raw)}</title>`; }

function layout(node, context, depth = 0) {
  if (!node || depth > 100) return emptyLayout();
  if (node.type === 'pattern') return layout(node.body, context, depth + 1);
  if (node.type === 'sequence') {
    const children = node.children.filter(child => !ignored(child)).map(child => layout(child, context, depth + 1));
    if (!children.length) return emptyLayout();
    const gap = 18;
    const width = children.reduce((sum, child) => sum + child.width, 0) + (children.length - 1) * gap;
    const height = Math.max(...children.map(child => child.height));
    return { width, height, render(x, y) {
      let offset = x;
      return children.map((child, index) => {
        const content = child.render(offset, y + (height - child.height) / 2);
        offset += child.width;
        const connector = index < children.length - 1 ? rail(`M ${offset} ${y + height / 2} h ${gap}`) : '';
        offset += gap;
        return content + connector;
      }).join('');
    } };
  }
  if (node.type === 'alternation') {
    const branches = node.children.map(child => layout(child, context, depth + 1));
    return branchLayout(node, branches, context);
  }
  if (node.type === 'conditional') {
    const branches = [layout(node.yes, context, depth + 1), layout(node.no, context, depth + 1)];
    const label = `if ${short(node.condition.reference || node.condition.text, 22)}`;
    return branchLayout(node, branches, context, ['yes', 'no'], label);
  }
  if (node.type === 'quantifier') {
    const child = layout(node.body, context, depth + 1);
    const width = Math.max(child.width + 64, 130);
    const height = child.height + 72;
    const count = node.min === node.max ? `${node.min}×` : `${node.min}…${node.max === null ? '∞' : node.max}×`;
    return { width, height, render(x, y) {
      const mid = y + height / 2;
      const childX = x + (width - child.width) / 2;
      const childY = y + 36;
      const bypass = node.min === 0 ? rail(`M ${x} ${mid} C ${x + 16} ${mid} ${x + 8} ${y + 19} ${x + 25} ${y + 19} H ${x + width - 25} C ${x + width - 8} ${y + 19} ${x + width - 16} ${mid} ${x + width} ${mid}`) : '';
      const loop = node.max === null || node.max > 1 ? rail(`M ${childX + child.width} ${mid} C ${x + width - 5} ${mid} ${x + width - 9} ${y + height - 13} ${x + width - 25} ${y + height - 13} H ${x + 25} C ${x + 9} ${y + height - 13} ${x + 5} ${mid} ${childX} ${mid}`, node.lazy ? 'stroke-dasharray="3 3"' : '') + `<path class="rr-arrow" d="M ${x + width / 2 + 4} ${y + height - 16} l -6 3 6 3 z"/>` : '';
      return `<g ${attrs(node, context)}>${title(node)}<rect class="rr-frame" x="${x + 2}" y="${y + 1}" width="${width - 4}" height="${height - 2}" rx="10" opacity="0"/>${bypass}${rail(`M ${x} ${mid} H ${childX}`)}${rail(`M ${childX + child.width} ${mid} H ${x + width}`)}${loop}<text class="rr-note" x="${x + width / 2}" y="${y + 10}">${escapeXml(count)} ${node.lazy ? 'lazy' : 'greedy'}</text>${child.render(childX, childY)}</g>`;
    } };
  }
  if (node.type === 'group') {
    const child = layout(node.body, context, depth + 1);
    const label = short(node.label, 40);
    const width = Math.max(child.width + 36, label.length * 5.8 + 28);
    const height = child.height + 52;
    const assertion = node.kind.includes('look');
    return { width, height, render(x, y) {
      const mid = y + height / 2;
      const childX = x + (width - child.width) / 2;
      return `<g ${attrs(node, context)}>${title(node)}<rect class="rr-frame${assertion ? ' rr-assertion' : ''}${node.kind === 'atomic' ? ' rr-atomic' : ''}" x="${x + 4}" y="${y + 9}" width="${width - 8}" height="${height - 18}" rx="9"/><text class="rr-note" x="${x + width / 2}" y="${y + 21}">${escapeXml(label)}</text>${rail(`M ${x} ${mid} H ${childX}`, assertion ? 'stroke-dasharray="3 3"' : '')}${rail(`M ${childX + child.width} ${mid} H ${x + width}`, assertion ? 'stroke-dasharray="3 3"' : '')}${child.render(childX, y + 26)}</g>`;
    } };
  }
  if (ignored(node)) return emptyLayout();
  const label = short(node.type === 'literal' ? node.value : node.raw || node.label, context.maxLabelLength);
  const subtitle = node.type === 'literal' ? '' : short(node.label, context.maxLabelLength);
  const width = Math.max(46, Math.max(label.length * 7.4, subtitle.length * 5.8) + 24);
  const height = subtitle ? 48 : 36;
  return { width, height, render(x, y) {
    const rounded = node.type === 'anchor' ? height / 2 : 7;
    return `<g ${attrs(node, context)}>${title(node)}<rect class="rr-box" x="${x}" y="${y}" width="${width}" height="${height}" rx="${rounded}"/><text class="rr-label" x="${x + width / 2}" y="${y + (subtitle ? 17 : height / 2)}">${escapeXml(label || 'empty')}</text>${subtitle ? `<text class="rr-note" x="${x + width / 2}" y="${y + 36}">${escapeXml(subtitle)}</text>` : ''}</g>`;
  } };
}

function branchLayout(node, branches, context, labels = [], heading = '') {
  const spacing = 24;
  const labelHeight = heading ? 20 : 0;
  const width = Math.max(...branches.map(branch => branch.width), heading.length * 6) + 64;
  const height = branches.reduce((sum, branch) => sum + branch.height, 0) + spacing * (branches.length - 1) + 20 + labelHeight;
  return { width, height, render(x, y) {
    let offset = y + 10 + labelHeight;
    const mid = y + height / 2;
    const paths = branches.map((branch, index) => {
      const branchY = offset + branch.height / 2;
      const childX = x + (width - branch.width) / 2;
      const left = rail(`M ${x} ${mid} C ${x + 19} ${mid} ${x + 11} ${branchY} ${x + 28} ${branchY} H ${childX}`);
      const right = rail(`M ${childX + branch.width} ${branchY} H ${x + width - 28} C ${x + width - 11} ${branchY} ${x + width - 19} ${mid} ${x + width} ${mid}`);
      const content = branch.render(childX, offset);
      const label = labels[index] ? `<text class="rr-note" x="${x + 19}" y="${branchY - 7}">${escapeXml(labels[index])}</text>` : '';
      offset += branch.height + spacing;
      return left + right + content + label;
    }).join('');
    return `<g ${attrs(node, context)}>${title(node)}<rect class="rr-frame" x="${x + 1}" y="${y + 1}" width="${width - 2}" height="${height - 2}" rx="9" opacity="0"/>${heading ? `<text class="rr-note" x="${x + width / 2}" y="${y + 12}">${escapeXml(heading)}</text>` : ''}${paths}</g>`;
  } };
}

function emptyLayout() { return { width: 38, height: 26, render: (x, y) => rail(`M ${x} ${y + 13} h 38`) }; }

/** Source-linked graph data for alternative renderers, tools, and exports. */
export function buildPatternGraph(analysis) {
  const nodes = [];
  const edges = [];
  function walk(node, parent = null, order = 0) {
    nodes.push({ id: node.id, type: node.type, kind: node.kind, label: node.label, source: node.raw, start: node.start, end: node.end });
    if (parent) edges.push({ source: parent.id, target: node.id, order, relation: parent.type === 'alternation' ? 'alternative' : parent.type === 'quantifier' ? 'repeat' : 'contains' });
    (node.children || []).forEach((child, index) => walk(child, node, index));
  }
  if (analysis?.tree) walk(analysis.tree);
  return { nodes, edges, offsets: 'utf-16', kind: 'pattern-structure' };
}
