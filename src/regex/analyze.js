import { RegexOptions, inlineOptionValues } from './options.js';

/**
 * A source-preserving .NET regex reader for explanations and structure diagrams.
 * Matching and authoritative validation belong to System.Text.RegularExpressions.
 * Offsets are UTF-16 code units, just like .NET Match.Index and DOM selections.
 */
export function analyzePattern(pattern = '', options = 0, limits = {}) {
  const parser = new PatternReader(String(pattern), Number(options) || 0, limits);
  return parser.read();
}

const isDigit = value => value !== undefined && value >= '0' && value <= '9';
const isOctal = value => value !== undefined && value >= '0' && value <= '7';
const isHex = value => value !== undefined && /^[0-9a-f]$/i.test(value);
const isIgnoredSpace = value => value !== undefined && ' \t\n\r\f'.includes(value);
const isTrivia = node => node.type === 'comment' || node.type === 'whitespace' || node.type === 'options';
const displayText = value => value.replaceAll('\n', '↵').replaceAll('\r', '␍').replaceAll('\t', '⇥').replaceAll('\0', '␀');

class PatternReader {
  constructor(pattern, options, limits) {
    this.pattern = pattern;
    this.initialOptions = options;
    this.options = options;
    this.pos = 0;
    this.nextId = 0;
    this.tokenId = 0;
    this.tokens = [];
    this.warnings = [];
    this.captures = [];
    this.numericEscapes = [];
    this.conditionals = [];
    this.complete = true;
    this.maxDepth = Math.min(256, Math.max(8, limits.maxDepth ?? 96));
    this.maxNodes = Math.min(100_000, Math.max(100, limits.maxNodes ?? 10_000));
    this.maxLength = Math.min(1_000_000, Math.max(1024, limits.maxLength ?? 100_000));
    this.stop = Math.min(pattern.length, this.maxLength);
    this.limitReported = false;
  }

  node(type, start, end, fields = {}) {
    return { id: `node-${this.nextId++}`, type, kind: type, start, end, raw: this.pattern.slice(start, end), options: this.options, children: [], ...fields };
  }

  token(node, start = node.start, end = node.end, kind = node.type, fields = {}) {
    const token = {
      id: `token-${this.tokenId++}`, nodeId: node.id, start, end,
      text: this.pattern.slice(start, end), raw: this.pattern.slice(start, end),
      type: kind, kind, label: '', description: '', ...fields,
    };
    this.tokens.push(token);
    return token;
  }

  warn(code, message, start, end = start + 1, severity = 'warning') {
    if (!this.warnings.some(item => item.code === code && item.start === start)) {
      this.warnings.push({ code, message, start, end: Math.min(this.pattern.length, end), severity });
    }
  }

  read() {
    const tree = this.node('pattern', 0, this.pattern.length);
    tree.body = this.expression(0);
    tree.children = [tree.body];
    if (this.stop < this.pattern.length) {
      this.complete = false;
      this.warn('analysis-length-limit', `The structure view is limited to the first ${this.maxLength.toLocaleString('en-US')} UTF-16 code units. The .NET engine still receives the complete pattern.`, this.stop, this.pattern.length, 'info');
    }
    const captureGroups = this.assignCaptureNumbers();
    const nodes = [];
    const explanations = [];
    const visit = (node, depth) => {
      const information = describeNode(node);
      Object.assign(node, information);
      nodes.push(node);
      if (node.type !== 'pattern' && node.type !== 'sequence' && node.type !== 'whitespace') {
        explanations.push({
          id: node.id, nodeId: node.id, start: node.start, end: node.end,
          text: node.raw, raw: node.raw, kind: node.type, type: node.type,
          title: information.label, label: information.label,
          description: information.description, depth,
        });
      }
      for (const child of node.children || []) visit(child, depth + (node.type === 'pattern' || node.type === 'sequence' ? 0 : 1));
      for (const child of node.trivia || []) visit(child, depth + 1);
    };
    visit(tree, 0);
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const token of this.tokens) {
      const node = byId.get(token.nodeId);
      if (node) {
        if (!token.label) token.label = node.label;
        if (!token.description) token.description = node.description;
      }
    }
    this.addSemanticNotes(nodes);
    const consumingNodes = nodes.filter(node => ['literal', 'character-class', 'class-escape', 'escape', 'dot', 'backreference'].includes(node.type));
    const nullable = isNullable(tree.body);
    const summary = {
      text: this.summary(captureGroups.length, nullable),
      captureCount: captureGroups.length,
      tokenCount: this.tokens.filter(token => !['comment', 'whitespace', 'group-close'].includes(token.type)).length,
      nodeCount: nodes.length,
      alternatives: nodes.filter(node => node.type === 'alternation').reduce((count, node) => count + node.children.length - 1, 0),
      repetitions: nodes.filter(node => node.type === 'quantifier').length,
      assertions: nodes.filter(node => node.type === 'anchor' || node.type === 'group' && node.kind.includes('look')).length,
      canMatchEmpty: nullable,
      consumesText: consumingNodes.length > 0,
      direction: (this.initialOptions & RegexOptions.RightToLeft) ? 'right-to-left' : 'left-to-right',
    };
    return {
      pattern: this.pattern, options: this.initialOptions, tree, nodes,
      tokens: this.tokens.sort((a, b) => a.start - b.start || a.end - b.end),
      explanations, warnings: this.warnings, summary, captureGroups,
      validSyntaxEstimate: !this.warnings.some(warning => warning.severity === 'error'),
      analysisComplete: this.complete, offsets: 'utf-16',
      validationAuthority: '.NET 10 System.Text.RegularExpressions',
    };
  }

  summary(captureCount, nullable) {
    if (!this.pattern) return 'An empty pattern matches the empty space at each input position.';
    let result = captureCount ? `${captureCount} capture ${captureCount === 1 ? 'group keeps' : 'groups keep'} parts of each match.` : 'Find matching text without saving extra capture groups.';
    if (nullable === true) result += ' It has a path that consumes no characters; assertions still determine whether that path succeeds.';
    if (this.initialOptions & RegexOptions.RightToLeft) result += ' Search runs from right to left.';
    return result;
  }

  expression(depth, closing = '') {
    const start = this.pos;
    const branches = [this.sequence(depth, closing)];
    const separators = [];
    while (this.pos < this.stop && this.pattern[this.pos] === '|') {
      separators.push(this.pos++);
      branches.push(this.sequence(depth, closing));
    }
    if (branches.length === 1) return branches[0];
    const node = this.node('alternation', start, this.pos, { children: branches });
    for (const position of separators) this.token(node, position, position + 1, 'alternation');
    return node;
  }

  sequence(depth, closing) {
    const start = this.pos;
    const children = [];
    while (this.pos < this.stop) {
      const character = this.pattern[this.pos];
      if (character === '|' || (closing && character === closing)) break;
      if (this.nextId >= this.maxNodes || depth >= this.maxDepth) {
        const remainder = this.consumeUnexplained(closing);
        children.push(remainder);
        break;
      }
      const trivia = this.trivia();
      if (trivia) { children.push(trivia); continue; }
      const quantifier = this.quantifierAt(this.pos);
      if (quantifier) {
        const begin = this.pos;
        this.pos = quantifier.end;
        const node = this.node('unknown', begin, this.pos, { reason: 'orphan-quantifier' });
        this.token(node, begin, this.pos, 'invalid');
        this.warn('orphan-quantifier', 'This quantifier has no preceding expression to repeat. .NET does not support possessive quantifiers such as ++; use an atomic group when that behavior is intended.', begin, this.pos, 'error');
        children.push(node);
        continue;
      }
      let atom = this.atom(depth);
      const between = [];
      let ignored;
      while ((ignored = this.trivia())) between.push(ignored);
      const repetition = this.quantifierAt(this.pos);
      if (repetition && !isTrivia(atom)) {
        const quantifierStart = this.pos;
        this.pos = repetition.end;
        // .NET permits ignored whitespace/comments between a quantifier and its lazy suffix.
        const afterQuantifier = [];
        while ((ignored = this.trivia())) afterQuantifier.push(ignored);
        let lazy = false;
        if (this.pattern[this.pos] === '?') { this.pos++; lazy = true; }
        const node = this.node('quantifier', atom.start, this.pos, {
          min: repetition.min, max: repetition.max, greedy: !lazy, lazy,
          quantifierStart, quantifierEnd: repetition.end, body: atom, children: [atom],
          trivia: between.concat(afterQuantifier),
        });
        this.token(node, quantifierStart, repetition.end, 'quantifier');
        if (lazy) this.token(node, this.pos - 1, this.pos, 'lazy', { label: 'Prefer fewer repeats', description: 'Try the smallest number of repetitions first; expand only if the rest of the expression needs it.' });
        if (node.max !== null && node.min > node.max) this.warn('quantifier-range', 'The repetition minimum is larger than its maximum.', quantifierStart, repetition.end, 'error');
        if (node.min > 0x7fffffff || node.max !== null && node.max > 0x7fffffff) this.warn('quantifier-overflow', '.NET repetition counts must fit in a signed 32-bit integer.', quantifierStart, repetition.end, 'error');
        atom = node;
      } else {
        // Keep trivia in source order when it does not participate in a quantifier.
        this.pushSequenceNode(children, atom);
        children.push(...between);
        continue;
      }
      this.pushSequenceNode(children, atom);
    }
    return this.node('sequence', start, this.pos, { children });
  }

  pushSequenceNode(children, node) {
    const previous = children.at(-1);
    if (previous?.type === 'literal' && node.type === 'literal' && previous.end === node.start && previous.options === node.options) {
      previous.end = node.end;
      previous.raw += node.raw;
      previous.value += node.value;
      for (let index = this.tokens.length - 1; index >= 0; index--) {
        if (this.tokens[index].start < node.start) break;
        if (this.tokens[index].nodeId === node.id) this.tokens[index].nodeId = previous.id;
      }
    } else children.push(node);
  }

  consumeUnexplained(closing) {
    const start = this.pos;
    let nested = 0;
    let inClass = false;
    while (this.pos < this.stop) {
      const character = this.pattern[this.pos];
      if (character === '\\') { this.pos = Math.min(this.stop, this.pos + 2); continue; }
      if (character === '[') inClass = true;
      else if (character === ']' && inClass) inClass = false;
      else if (!inClass) {
        if (character === '(') nested++;
        if (character === ')') {
          if (!nested && closing === ')') break;
          nested--;
        }
      }
      this.pos++;
    }
    this.complete = false;
    if (!this.limitReported) {
      this.warn('analysis-complexity-limit', 'The structure view stops expanding this very large or deeply nested expression. Exact matching is still handled by the .NET engine.', start, this.pos, 'info');
      this.limitReported = true;
    }
    const node = this.node('unknown', start, this.pos, { reason: 'analysis-limit' });
    this.token(node);
    return node;
  }

  trivia() {
    const start = this.pos;
    if (start >= this.stop) return null;
    if (this.pattern.startsWith('(?#', start)) {
      const end = this.pattern.indexOf(')', start + 3);
      this.pos = end >= 0 && end < this.stop ? end + 1 : this.stop;
      const node = this.node('comment', start, this.pos, { value: this.pattern.slice(start + 3, end >= 0 ? end : this.pos) });
      this.token(node);
      if (end < 0 || end >= this.stop) this.warn('unclosed-comment', 'This comment is missing its closing parenthesis.', start, this.pos, 'error');
      return node;
    }
    if (!(this.options & RegexOptions.IgnorePatternWhitespace)) return null;
    if (isIgnoredSpace(this.pattern[start])) {
      while (this.pos < this.stop && isIgnoredSpace(this.pattern[this.pos])) this.pos++;
      const node = this.node('whitespace', start, this.pos);
      this.token(node);
      return node;
    }
    if (this.pattern[start] === '#') {
      while (this.pos < this.stop && this.pattern[this.pos] !== '\n') this.pos++;
      const node = this.node('comment', start, this.pos, { value: this.pattern.slice(start + 1, this.pos) });
      this.token(node);
      return node;
    }
    return null;
  }

  quantifierAt(position) {
    const character = this.pattern[position];
    if (character === '*') return { min: 0, max: null, end: position + 1 };
    if (character === '+') return { min: 1, max: null, end: position + 1 };
    if (character === '?') return { min: 0, max: 1, end: position + 1 };
    if (character !== '{' || !isDigit(this.pattern[position + 1])) return null;
    let cursor = position + 1;
    while (isDigit(this.pattern[cursor])) cursor++;
    const min = Number(this.pattern.slice(position + 1, cursor));
    let max = min;
    if (this.pattern[cursor] === ',') {
      const numberStart = ++cursor;
      while (isDigit(this.pattern[cursor])) cursor++;
      max = cursor === numberStart ? null : Number(this.pattern.slice(numberStart, cursor));
    }
    if (this.pattern[cursor] !== '}' || cursor >= this.stop) return null;
    return { min, max, end: cursor + 1 };
  }

  atom(depth) {
    const start = this.pos;
    const character = this.pattern[this.pos];
    if (character === '(') return this.group(depth);
    if (character === '[') return this.characterClass(depth);
    if (character === '\\') return this.escape(false);
    this.pos++;
    let node;
    if (character === '.') node = this.node('dot', start, this.pos);
    else if (character === '^' || character === '$') node = this.node('anchor', start, this.pos, { value: character });
    else if (character === ')') {
      node = this.node('unknown', start, this.pos, { reason: 'unmatched-close' });
      this.warn('unmatched-parenthesis', 'This closing parenthesis has no opening group.', start, this.pos, 'error');
    } else node = this.node('literal', start, this.pos, { value: character });
    this.token(node);
    return node;
  }

  escape(inClass, emit = true) {
    const start = this.pos++;
    if (this.pos >= this.stop) {
      const node = this.node('unknown', start, this.pos, { reason: 'unfinished-escape' });
      this.warn('unfinished-escape', 'A backslash must be followed by an escape or a literal character.', start, this.pos, 'error');
      if (emit) this.token(node, start, this.pos, 'invalid');
      return node;
    }
    const code = this.pattern[this.pos++];
    let type = 'escape';
    const fields = { code, inClass, value: code };
    if ('dDsSwW'.includes(code)) {
      type = 'class-escape';
    } else if ('pP'.includes(code) && this.pattern[this.pos] === '{') {
      const nameStart = ++this.pos;
      while (this.pos < this.stop && this.pattern[this.pos] !== '}') this.pos++;
      fields.category = this.pattern.slice(nameStart, this.pos);
      fields.negated = code === 'P';
      if (this.pattern[this.pos] === '}') this.pos++;
      else this.warn('unclosed-unicode-category', 'This Unicode category escape needs a closing brace.', start, this.pos, 'error');
      type = 'class-escape';
    } else if (!inClass && 'AbBGZz'.includes(code)) {
      type = 'anchor';
      fields.value = `\\${code}`;
    } else if (!inClass && code === 'k' && ['<', "'"].includes(this.pattern[this.pos])) {
      const delimiter = this.pattern[this.pos++] === '<' ? '>' : "'";
      const nameStart = this.pos;
      while (this.pos < this.stop && this.pattern[this.pos] !== delimiter) this.pos++;
      fields.reference = this.pattern.slice(nameStart, this.pos);
      if (this.pattern[this.pos] === delimiter) this.pos++;
      else this.warn('unclosed-backreference', 'This named backreference is missing its closing delimiter.', start, this.pos, 'error');
      type = 'backreference';
    } else if (!inClass && ['<', "'"].includes(code)) {
      // .NET also recognizes \<name> and \'name' backreference syntax.
      const delimiter = code === '<' ? '>' : "'";
      const nameStart = this.pos;
      while (this.pos < this.stop && this.pattern[this.pos] !== delimiter) this.pos++;
      if (this.pattern[this.pos] === delimiter && this.pos > nameStart) {
        fields.reference = this.pattern.slice(nameStart, this.pos++);
        type = 'backreference';
      } else {
        this.pos = start + 2;
        fields.value = code;
      }
    } else if (code === 'x' || code === 'u') {
      const count = code === 'u' ? 4 : 2;
      const hexStart = this.pos;
      while (this.pos < Math.min(this.stop, hexStart + count) && isHex(this.pattern[this.pos])) this.pos++;
      const value = this.pattern.slice(hexStart, this.pos);
      fields.value = value.length === count ? String.fromCharCode(parseInt(value, 16)) : this.pattern.slice(start, this.pos);
      fields.characterCode = value.length === count ? parseInt(value, 16) : null;
      if (value.length !== count) this.warn('incomplete-hex-escape', `The \\${code} escape needs exactly ${count} hexadecimal digits in .NET.`, start, this.pos, 'error');
    } else if (code === 'c') {
      const control = this.pattern[this.pos];
      if (control !== undefined && this.pos < this.stop) {
        this.pos++;
        fields.value = String.fromCharCode(control.toUpperCase().charCodeAt(0) ^ 64);
        fields.control = control;
      } else this.warn('incomplete-control-escape', 'A control escape needs a character after \\c.', start, this.pos, 'error');
    } else if (isDigit(code)) {
      if (code === '0' || inClass) {
        let count = 1;
        while (count < 3 && this.pos < this.stop && isOctal(this.pattern[this.pos])) { this.pos++; count++; }
        fields.value = String.fromCharCode(parseInt(this.pattern.slice(start + 1, this.pos), 8) & 255);
        fields.octal = true;
      } else {
        while (this.pos < this.stop && isDigit(this.pattern[this.pos])) this.pos++;
        fields.reference = this.pattern.slice(start + 1, this.pos);
        fields.numeric = true;
        type = 'numeric-escape';
      }
    } else {
      const values = { a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
      if (Object.hasOwn(values, code)) fields.value = values[code];
      else if (/^[A-Za-z]$/.test(code) && !(this.options & RegexOptions.ECMAScript)) {
        this.warn('unrecognized-escape', `\\${code} is not a recognized .NET escape. The .NET engine will provide the definitive parse error.`, start, this.pos, 'error');
      }
    }
    const node = this.node(type, start, this.pos, fields);
    if (type === 'numeric-escape') this.numericEscapes.push(node);
    if (emit) this.token(node);
    return node;
  }

  characterClass(depth, emit = true) {
    const start = this.pos++;
    const negated = this.pattern[this.pos] === '^';
    if (negated) this.pos++;
    const parts = [];
    let first = true;
    let closed = false;
    let subtraction = null;
    while (this.pos < this.stop) {
      const character = this.pattern[this.pos];
      if (character === ']' && !first) { this.pos++; closed = true; break; }
      if (character === '-' && this.pattern[this.pos + 1] === '[' && !first && depth < this.maxDepth) {
        this.pos++;
        subtraction = this.characterClass(depth + 1, false);
        parts.push({ type: 'subtraction', start: subtraction.start - 1, end: subtraction.end, raw: this.pattern.slice(subtraction.start - 1, subtraction.end), node: subtraction });
        if (this.pattern[this.pos] !== ']') this.warn('class-subtraction-position', 'A .NET character-class subtraction must be the last item in its character class.', subtraction.start, this.pos, 'error');
        first = false;
        continue;
      }
      if (character === '\\') {
        const escaped = this.escape(true, false);
        parts.push({ type: escaped.type, start: escaped.start, end: escaped.end, raw: escaped.raw, value: escaped.value, code: escaped.code, category: escaped.category });
      } else {
        parts.push({ type: 'literal', start: this.pos, end: this.pos + 1, raw: character, value: character });
        this.pos++;
      }
      first = false;
    }
    if (!closed) this.warn('unclosed-character-class', 'This character class is missing its closing bracket.', start, this.pos, 'error');
    // Ranges are structural details, not a second overlapping token stream.
    const ranges = [];
    for (let index = 1; index < parts.length - 1; index++) {
      if (parts[index].type === 'literal' && parts[index].value === '-' && parts[index - 1].value !== undefined && parts[index + 1].value !== undefined) {
        ranges.push({ from: parts[index - 1].value, to: parts[index + 1].value, start: parts[index - 1].start, end: parts[index + 1].end });
      }
    }
    const node = this.node('character-class', start, this.pos, { negated, parts, ranges, subtraction, closed });
    if (emit) this.token(node);
    return node;
  }

  group(depth) {
    const start = this.pos++;
    const outerOptions = this.options;
    let kind = (outerOptions & RegexOptions.ExplicitCapture) ? 'noncapturing' : 'capturing';
    let name = null;
    let subtractName = null;
    let enabled = '';
    let disabled = '';
    if (this.pattern[this.pos] === '?') {
      this.pos++;
      const prefix = this.pattern[this.pos];
      if (prefix === '(') return this.conditional(start, depth, outerOptions);
      if (prefix === ':') { kind = 'noncapturing'; this.pos++; }
      else if (prefix === '=') { kind = 'positive-lookahead'; this.pos++; }
      else if (prefix === '!') { kind = 'negative-lookahead'; this.pos++; }
      else if (prefix === '>') { kind = 'atomic'; this.pos++; }
      else if (prefix === '<' && ['=', '!'].includes(this.pattern[this.pos + 1])) {
        kind = this.pattern[this.pos + 1] === '=' ? 'positive-lookbehind' : 'negative-lookbehind';
        this.pos += 2;
      } else if (prefix === '<' || prefix === "'") {
        const delimiter = prefix === '<' ? '>' : "'";
        const nameStart = ++this.pos;
        while (this.pos < this.stop && ![delimiter, ')'].includes(this.pattern[this.pos])) this.pos++;
        const specifier = this.pattern.slice(nameStart, this.pos);
        if (this.pattern[this.pos] === delimiter) this.pos++;
        else this.warn('unclosed-group-name', 'This group name is missing its closing delimiter.', start, this.pos, 'error');
        const dash = specifier.indexOf('-');
        if (dash >= 0) { kind = 'balancing'; name = specifier.slice(0, dash) || null; subtractName = specifier.slice(dash + 1); }
        else { kind = 'named'; name = specifier; }
        if (kind === 'named' && !name || kind === 'balancing' && !subtractName) this.warn('empty-group-name', 'A capture or balancing-group reference needs a name or number.', start, this.pos, 'error');
      } else {
        let removing = false;
        let sawOption = false;
        while (this.pos < this.stop) {
          const option = this.pattern[this.pos];
          if (option === '-') { removing = true; this.pos++; continue; }
          if (!Object.hasOwn(inlineOptionValues, option)) break;
          sawOption = true;
          if (removing) { disabled += option; this.options &= ~inlineOptionValues[option]; }
          else { enabled += option; this.options |= inlineOptionValues[option]; }
          this.pos++;
        }
        if (sawOption && this.pattern[this.pos] === ')') {
          this.pos++;
          const node = this.node('options', start, this.pos, { enabled, disabled, scoped: false });
          this.token(node);
          return node;
        }
        if (sawOption && this.pattern[this.pos] === ':') { kind = 'options'; this.pos++; }
        else {
          kind = 'unknown';
          this.complete = false;
          this.warn('unknown-group', 'This group prefix is not part of the supported .NET explanation grammar. Execute the pattern for the authoritative .NET diagnostic.', start, Math.min(this.pos + 1, this.stop));
        }
      }
    }
    const openEnd = this.pos;
    const node = this.node('group', start, start, { kind, name, subtractName, enabled, disabled, scoped: kind === 'options' });
    this.token(node, start, openEnd, 'group-open');
    if (kind === 'capturing' || kind === 'named' || kind === 'balancing' && name) this.captures.push(node);
    const body = this.expression(depth + 1, ')');
    node.body = body;
    node.children = [body];
    if (this.pattern[this.pos] === ')') {
      this.token(node, this.pos, this.pos + 1, 'group-close', { label: 'End group', description: 'Finish this group or assertion.' });
      this.pos++;
    } else this.warn('unclosed-group', 'This group is missing its closing parenthesis.', start, this.pos, 'error');
    node.end = this.pos;
    node.raw = this.pattern.slice(start, this.pos);
    this.options = outerOptions;
    return node;
  }

  conditional(start, depth, outerOptions) {
    const node = this.node('conditional', start, start);
    this.token(node, start, this.pos, 'group-open', { label: 'Conditional choice', description: 'Choose a branch according to a previous capture or a zero-width assertion.' });
    const conditionStart = this.pos;
    const simple = /^\(([\p{L}\p{M}\p{N}_]+)\)/u.exec(this.pattern.slice(this.pos, this.stop));
    let conditionNode = null;
    if (simple) {
      this.pos += simple[0].length;
      node.condition = { kind: 'reference-or-expression', reference: simple[1], text: simple[1], start: conditionStart, end: this.pos };
      this.token(node, conditionStart, this.pos, 'condition', { label: 'Test condition', description: `Test the capture “${simple[1]}” if that group is defined; otherwise .NET treats this as an expression test.` });
    } else if (this.pattern[this.pos + 1] === '?') {
      conditionNode = this.group(depth + 1);
      node.condition = { kind: 'assertion', text: conditionNode.raw, start: conditionStart, end: this.pos, node: conditionNode };
    } else {
      this.pos++;
      const conditionOptions = this.options;
      conditionNode = this.expression(depth + 1, ')');
      if (this.pattern[this.pos] === ')') this.pos++;
      else this.warn('unclosed-condition', 'This conditional test is missing a closing parenthesis.', conditionStart, this.pos, 'error');
      this.options = conditionOptions;
      node.condition = { kind: 'expression', text: this.pattern.slice(conditionStart + 1, this.pos - 1), start: conditionStart, end: this.pos, node: conditionNode };
      this.token(node, conditionStart, conditionStart + 1, 'condition-open');
      if (this.pattern[this.pos - 1] === ')') this.token(node, this.pos - 1, this.pos, 'condition-close');
    }
    const body = this.expression(depth + 1, ')');
    const branches = body.type === 'alternation' ? body.children : [body];
    node.yes = branches[0];
    node.no = branches[1] || null;
    node.body = body;
    node.children = conditionNode ? [conditionNode, body] : [body];
    if (branches.length > 2) this.warn('conditional-branches', 'A .NET conditional has at most two branches: yes and no.', body.start, body.end, 'error');
    if (this.pattern[this.pos] === ')') {
      this.token(node, this.pos, this.pos + 1, 'group-close', { label: 'End condition', description: 'Finish the conditional branches.' });
      this.pos++;
    } else this.warn('unclosed-group', 'This conditional group is missing its closing parenthesis.', start, this.pos, 'error');
    node.end = this.pos;
    node.raw = this.pattern.slice(start, this.pos);
    this.options = outerOptions;
    this.conditionals.push(node);
    return node;
  }

  assignCaptureNumbers() {
    let next = 1;
    const byNumber = new Map();
    const names = new Map();
    const note = (node, number, name) => {
      node.number = number;
      node.captureName = name;
      if (!byNumber.has(number)) byNumber.set(number, { number, name, start: node.start, end: node.end, nodeId: node.id, occurrences: [] });
      byNumber.get(number).occurrences.push({ nodeId: node.id, start: node.start, end: node.end });
    };
    for (const node of this.captures) {
      if (node.kind === 'capturing') note(node, next, String(next++));
      else if (/^\d+$/.test(node.name)) {
        const number = Number(node.name);
        if (!number || number > 0x7fffffff) this.warn('capture-number', 'Explicit capture numbers must be positive signed 32-bit integers.', node.start, node.end, 'error');
        note(node, number, String(number));
      }
    }
    for (const node of this.captures) {
      if (node.kind === 'capturing' || /^\d+$/.test(node.name)) continue;
      if (!names.has(node.name)) {
        while (byNumber.has(next)) next++;
        names.set(node.name, next++);
      }
      note(node, names.get(node.name), node.name);
    }
    for (const node of this.numericEscapes) {
      const number = Number(node.reference);
      if (byNumber.has(number)) {
        node.type = node.kind = 'backreference';
        node.number = number;
        node.captureName = byNumber.get(number).name;
        for (const token of this.tokens) if (token.nodeId === node.id) token.kind = token.type = 'backreference';
      } else {
        node.type = node.kind = 'numeric-escape';
      }
    }
    for (const node of this.conditionals) {
      if (node.condition.kind !== 'reference-or-expression') continue;
      const reference = node.condition.reference;
      node.condition.kind = names.has(reference) || /^\d+$/.test(reference) && byNumber.has(Number(reference)) ? 'capture' : 'expression';
    }
    return [...byNumber.values()].sort((a, b) => a.number - b.number);
  }

  addSemanticNotes(nodes) {
    if (this.initialOptions & RegexOptions.NonBacktracking) {
      const unsupported = nodes.filter(node => node.type === 'backreference' || node.type === 'conditional' || node.type === 'group' && ['atomic', 'balancing', 'positive-lookahead', 'negative-lookahead', 'positive-lookbehind', 'negative-lookbehind'].includes(node.kind) || node.type === 'anchor' && node.value === '\\G');
      for (const node of unsupported) this.warn('nonbacktracking-construct', `${node.label} generally requires .NET’s backtracking engine. The NonBacktracking engine rejects this construct unless parsing optimizations remove it; the runtime result is authoritative.`, node.start, node.end);
      if (this.initialOptions & (RegexOptions.RightToLeft | RegexOptions.ECMAScript)) this.warn('nonbacktracking-options', 'NonBacktracking cannot be combined with RightToLeft or ECMAScript in .NET.', 0, this.pattern.length, 'error');
      if (this.captures.some(node => nodes.some(parent => parent.type === 'quantifier' && parent.start <= node.start && parent.end >= node.end))) {
        this.warn('nonbacktracking-captures', 'With NonBacktracking, a repeated group keeps its final capture; the backtracking engine can retain its capture history.', 0, this.pattern.length, 'info');
      }
    }
    if (this.initialOptions & RegexOptions.ECMAScript) {
      const allowed = RegexOptions.ECMAScript | RegexOptions.IgnoreCase | RegexOptions.Multiline | RegexOptions.Compiled | RegexOptions.CultureInvariant;
      if (this.initialOptions & ~allowed) this.warn('ecmascript-options', '.NET ECMAScript mode only combines with IgnoreCase, Multiline, Compiled, and CultureInvariant.', 0, this.pattern.length, 'error');
    }
    const containsVariableRepeat = node => {
      if (node.type === 'group' && node.kind === 'atomic') return false;
      if (node.type === 'quantifier' && node.max !== node.min) return true;
      return node.children?.some(containsVariableRepeat) || false;
    };
    if (!(this.initialOptions & RegexOptions.NonBacktracking)) {
      for (const node of nodes) {
        if (node.type === 'quantifier' && node.max !== node.min && containsVariableRepeat(node.body)) {
          this.warn('nested-repetition', 'Nested variable repetitions can create substantial backtracking on some failing inputs. Inspect the execution trace and retain a timeout; this is a heuristic, not a measured performance result.', node.start, node.end);
        }
      }
    }
  }
}

export function describeNode(node) {
  const has = option => (node.options & option) !== 0;
  if (node.type === 'pattern') return { label: 'Pattern', description: 'The whole regular expression. The structure view describes syntax; the .NET execution trace shows actual optimized engine instructions.' };
  if (node.type === 'sequence') return { label: 'In sequence', description: 'Match these elements in order. RightToLeft changes the engine’s evaluation direction.' };
  if (node.type === 'literal') return { label: `“${displayText(node.value)}”`, description: `Match the literal ${node.value.length === 1 ? 'character' : 'text'} “${displayText(node.value)}”${has(RegexOptions.IgnoreCase) ? ', ignoring letter case using the selected culture' : ', with the same case'}.` };
  if (node.type === 'dot') return { label: 'Any character', description: has(RegexOptions.Singleline) ? 'Match one UTF-16 character, including a line feed, because Singleline is enabled.' : 'Match one UTF-16 character except a line feed (\\n). A carriage return (\\r) still matches.' };
  if (node.type === 'character-class') {
    const rangeText = node.ranges.map(range => `${displayText(range.from)}–${displayText(range.to)}`).join(', ');
    return { label: node.negated ? 'Except this set' : 'One from this set', description: `Match exactly one UTF-16 character ${node.negated ? 'outside' : 'from'} ${node.raw}.${rangeText ? ` Ranges: ${rangeText}.` : ''}${node.subtraction ? ` Subtract the characters in ${node.subtraction.raw} from the outer set.` : ''} Whitespace and # are literal inside a character class.` };
  }
  if (node.type === 'class-escape') {
    if (node.category) return { label: `${node.negated ? 'Not ' : ''}${node.category}`, description: `Match one character ${node.negated ? 'outside' : 'in'} the .NET Unicode category or named block “${node.category}”.` };
    const ecma = has(RegexOptions.ECMAScript);
    const descriptions = {
      d: ['Digit', ecma ? 'Match one ASCII digit, 0–9, in ECMAScript mode.' : 'Match one Unicode decimal digit (\\p{Nd}), including digits beyond 0–9.'],
      D: ['Not a digit', ecma ? 'Match one character other than an ASCII digit.' : 'Match one character that is not a Unicode decimal digit.'],
      w: ['Word character', ecma ? 'Match one ECMAScript word character (letters A–Z/a–z, 0–9, or underscore; case options can affect comparisons).' : 'Match one .NET Unicode word character: a letter, nonspacing mark, decimal digit, or connector punctuation such as underscore.'],
      W: ['Not a word character', 'Match one character outside the word-character set selected by the .NET options.'],
      s: ['Whitespace', ecma ? 'Match an ECMAScript whitespace character: space, tab, line feed, carriage return, form feed, or vertical tab.' : 'Match one Unicode whitespace character, including spaces, tabs, and line breaks.'],
      S: ['Not whitespace', 'Match one character that is not in the whitespace set selected by the .NET options.'],
    };
    const [label, description] = descriptions[node.code] || ['Character class', 'Match a character from this escape’s .NET character set.'];
    return { label, description };
  }
  if (node.type === 'anchor') {
    const data = {
      '^': ['Start', has(RegexOptions.Multiline) ? 'Assert the start of the input or the position immediately after a line feed. This consumes no text.' : 'Assert the start of the input. This consumes no text.'],
      '$': ['End', has(RegexOptions.Multiline) ? 'Assert the end of input or the position before a line feed. A preceding carriage return is not skipped; use \\r?$ for CRLF lines.' : 'Assert the end of input, or the position before a final line feed. Use \\z to require the absolute end.'],
      '\\A': ['Absolute start', 'Assert the beginning of the input, regardless of Multiline. Consume no text.'],
      '\\z': ['Absolute end', 'Assert the absolute end of the input, regardless of Multiline. Consume no text.'],
      '\\Z': ['End before final LF', 'Assert the end of input or the position before its final line feed. Consume no text.'],
      '\\G': ['Contiguous match', 'Assert the position where this matching operation starts, or where the preceding match ended during successive matching.'],
      '\\b': ['Word boundary', 'Assert a boundary between a word character and a non-word character, or the start/end beside a word character. Consume no text.'],
      '\\B': ['Not a word boundary', 'Assert a position that is not a word boundary. Consume no text.'],
    };
    const [label, description] = data[node.value] || ['Anchor', 'Check an input position without consuming text.'];
    return { label, description };
  }
  if (node.type === 'escape') {
    const names = { '\n': 'Line feed', '\r': 'Carriage return', '\t': 'Tab', '\b': 'Backspace', '\f': 'Form feed', '\v': 'Vertical tab', '\x07': 'Bell', '\x1b': 'Escape character', '\0': 'Null character' };
    const label = names[node.value] || `Literal “${displayText(node.value)}”`;
    return { label, description: `${node.octal ? 'Interpret this octal escape, then match' : node.characterCode != null ? 'Decode this hexadecimal escape, then match' : 'Match'} ${label.toLowerCase()}.${node.inClass && node.code === 'b' ? ' Inside a character class, \\b means backspace rather than a word boundary.' : ''}` };
  }
  if (node.type === 'numeric-escape') return { label: 'Numeric escape', description: `The .NET parser resolves ${node.raw} using the available capture numbers and ECMAScript setting. It can be an octal escape or an invalid backreference; the engine result is authoritative.` };
  if (node.type === 'backreference') return { label: `Same as ${node.captureName || node.reference}`, description: `Match the text most recently captured by group “${node.captureName || node.reference}”, using the active comparison options. This refers to captured text, not to the group’s pattern.` };
  if (node.type === 'quantifier') {
    let count;
    if (node.min === 0 && node.max === 1) count = 'Optional';
    else if (node.min === node.max) count = `Exactly ${node.min}`;
    else if (node.max === null) count = `${node.min} or more`;
    else count = `${node.min}–${node.max}`;
    return { label: `${count}${node.lazy ? ' · lazy' : ''}`, description: `Repeat the preceding expression ${node.min === node.max ? `exactly ${node.min} ${node.min === 1 ? 'time' : 'times'}` : node.max === null ? `at least ${node.min} ${node.min === 1 ? 'time' : 'times'}, without a fixed maximum` : `between ${node.min} and ${node.max} times`}. ${node.lazy ? 'Try fewer repetitions first, increasing only when the rest of the pattern needs it.' : 'Try more repetitions first, giving them back when the rest of a backtracking pattern needs it.'}` };
  }
  if (node.type === 'alternation') return { label: 'Either path', description: `Try one of ${node.children.length} alternatives. In the backtracking engine, the first alternative that lets the whole expression succeed wins; it is not necessarily the longest.` };
  if (node.type === 'group') {
    const capture = node.captureName || node.name || node.number;
    const descriptions = {
      capturing: [`Capture ${capture ?? ''}`.trim(), `Save the text matched by this group as group ${capture ?? 'numbered by the .NET engine'}. A repeated group can retain multiple captures in Group.Captures.`],
      named: [`Capture “${capture}”`, `Save this group’s matched text under “${capture}”${node.number ? ` (number ${node.number})` : ''}. Read it with match.Groups[${JSON.stringify(String(capture))}].`],
      noncapturing: ['Group together', 'Treat these elements as one unit without creating a capture. Quantifiers and alternatives can apply to the whole group.'],
      'positive-lookahead': ['Must follow', 'Assert that this expression matches ahead of the current position, without consuming that text. Successful positive assertions can retain captures.'],
      'negative-lookahead': ['Must not follow', 'Assert that this expression does not match ahead of the current position. Consume no text.'],
      'positive-lookbehind': ['Must precede', 'Assert that this expression matches behind the current position. .NET evaluates the lookbehind from right to left without consuming the surrounding match’s text.'],
      'negative-lookbehind': ['Must not precede', 'Assert that this expression does not match behind the current position. Consume no text.'],
      atomic: ['Commit this group', 'Once this group succeeds, do not backtrack into it to try other internal choices. A later failure can still make the outer expression backtrack.'],
      balancing: ['Balance captures', `Remove the most recent capture from group “${node.subtractName}”${node.name ? ` and store the intervening interval in “${node.name}”` : ''}. Fail if that capture stack is empty. This can track nested delimiters.`],
      options: ['Local options', `Apply ${optionChangeDescription(node.enabled, node.disabled)} inside this group, then restore the enclosing options.`],
      unknown: ['Group', 'This group is shown structurally. Ask the .NET engine to validate its syntax.'],
    };
    const [label, description] = descriptions[node.kind] || descriptions.unknown;
    return { label, description };
  }
  if (node.type === 'conditional') return { label: 'If / otherwise', description: node.condition.kind === 'capture' ? `If capture group “${node.condition.reference}” has a current capture, use the first branch; otherwise use the second branch${node.no ? '.' : ' (empty when omitted).'}` : `Test ${node.condition.text} without consuming text. Use the first branch if the test succeeds, otherwise the second branch${node.no ? '.' : ' (empty when omitted).'}` };
  if (node.type === 'options') return { label: 'Change options', description: `Apply ${optionChangeDescription(node.enabled, node.disabled)} to the remainder of the current enclosing group or pattern.` };
  if (node.type === 'comment') return { label: 'Comment', description: 'Documentation for the reader. It consumes no input and does not participate in matching.' };
  if (node.type === 'whitespace') return { label: 'Ignored whitespace', description: 'Free-spacing mode ignores this pattern whitespace. Escape a space or put it in a character class to match it.' };
  return { label: 'Unexpanded expression', description: node.reason === 'analysis-limit' ? 'The explanation budget was reached. Execute with .NET for matching and validation of the complete pattern.' : 'This part needs a .NET parse diagnostic before it can be explained reliably.' };
}

function optionChangeDescription(enabled, disabled) {
  const labels = { i: 'case-insensitive matching', m: 'line anchors', n: 'explicit captures only', s: 'dot including newlines', x: 'free-spacing mode' };
  return [enabled ? `enable ${[...enabled].map(value => labels[value]).join(', ')}` : '', disabled ? `disable ${[...disabled].map(value => labels[value]).join(', ')}` : ''].filter(Boolean).join('; ');
}

function isNullable(node) {
  if (['pattern', 'sequence'].includes(node.type)) {
    const children = node.children.map(isNullable);
    return children.includes(false) ? false : children.includes(null) ? null : true;
  }
  if (node.type === 'alternation') {
    const children = node.children.map(isNullable);
    return children.includes(true) ? true : children.includes(null) ? null : false;
  }
  if (['anchor', 'options', 'comment', 'whitespace'].includes(node.type)) return true;
  if (node.type === 'quantifier') return node.min === 0 ? true : isNullable(node.body);
  if (node.type === 'group') return node.kind.includes('look') ? true : node.kind === 'balancing' ? null : isNullable(node.body);
  if (node.type === 'conditional') {
    const values = [isNullable(node.yes), node.no ? isNullable(node.no) : true];
    return values.every(value => value === true) ? true : values.every(value => value === false) ? false : null;
  }
  if (node.type === 'literal') return node.value.length === 0;
  if (['backreference', 'numeric-escape', 'unknown'].includes(node.type)) return null;
  return false;
}
