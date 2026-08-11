import { v4 as uuidv4 } from 'uuid';

export const PAYLOAD_TYPES = [
  ['string', 'String (ASCII)'],
  ['character', 'Character (ASCII)'],
  ['integer', 'Integer (32-bit)'],
  ['float', 'Float (32-bit IEEE 754)'],
  ['double', 'Double (64-bit IEEE 754)'],
  ['boolean', 'Boolean (32-bit 0 or 1)'],
  ['integerArray', 'Array of integers (JSON)'],
  ['typedArray', 'Array of another type (JSON)'],
  ['custom', 'Custom structure (field JSON)'],
  ['hex', 'Raw hexadecimal bytes'],
];

const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function asciiBytes(value) {
  const text = String(value);
  if ([...text].some((character) => character.charCodeAt(0) > 0x7f)) {
    throw new Error('String and character payloads must use ASCII characters only (code 0–127).');
  }
  return Uint8Array.from([...text], (character) => character.charCodeAt(0));
}

export function parseEscapeSequence(value, index) {
  const next = value[index + 1];
  switch (next) {
    case 'n': return { length: 2, text: '\n', label: '<\\n>' };
    case 't': return { length: 2, text: '\t', label: '<\\t>' };
    case 'b': return { length: 2, text: '\b', label: '<\\b>' };
    case 'r': return { length: 2, text: '\r', label: '<\\r>' };
    case 'a': return { length: 2, text: '\x07', label: '<\\a>' };
    case 'f': return { length: 2, text: '\f', label: '<\\f>' };
    case 'v': return { length: 2, text: '\v', label: '<\\v>' };
    case "'": return { length: 2, text: "'", label: "<'\\'>" };
    case '"': return { length: 2, text: '"', label: '<\\">' };
    case '?': return { length: 2, text: '?', label: '<\\?>' };
    case '\\': return { length: 2, text: '\\', label: '\\' };
    case '0': {
      let octal = '';
      let pos = index + 2;
      while (pos < value.length && /[0-7]/.test(value[pos]) && octal.length < 2) {
        octal += value[pos];
        pos += 1;
      }
      const raw = `0${octal}`;
      return { length: 2 + octal.length, text: String.fromCharCode(parseInt(raw, 8)), label: `<\\${raw}>` };
    }
    case 'x': {
      let hex = '';
      let pos = index + 2;
      while (pos < value.length && /[0-9A-Fa-f]/.test(value[pos]) && hex.length < 2) {
        hex += value[pos];
        pos += 1;
      }
      if (!hex) return null;
      return { length: 2 + hex.length, text: String.fromCharCode(parseInt(hex, 16)), label: `<\\x${hex}>` };
    }
    default:
      return null;
  }
}

export function parseEscapedPayloadText(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      output += char;
      continue;
    }
    const next = value[index + 1];
    if (next === undefined) {
      output += '\\';
      continue;
    }
    if (next === '\\') {
      output += '\\';
      index += 1;
      continue;
    }
    const parsed = parseEscapeSequence(value, index);
    if (!parsed) {
      output += '\\';
      continue;
    }
    output += parsed.text;
    index += parsed.length - 1;
  }
  return output;
}

/**
 * Map the text shown in the payload editor to the decoded bytes it produces.
 * An escape such as "\\n" occupies two editor characters, but exactly one
 * decoded byte.  Keeping both ranges lets UI previews highlight byte ranges
 * without treating decoded-byte offsets as source-text offsets.
 */
export function getPayloadByteSpans(value) {
  const text = String(value ?? '');
  const spans = [];
  let sourceOffset = 0;
  let byteOffset = 0;

  const addSpan = (sourceEnd) => {
    spans.push({
      sourceStart: sourceOffset,
      sourceEnd,
      byteStart: byteOffset,
      byteEnd: byteOffset + 1,
    });
    sourceOffset = sourceEnd;
    byteOffset += 1;
  };

  while (sourceOffset < text.length) {
    if (text[sourceOffset] !== '\\') {
      addSpan(sourceOffset + 1);
      continue;
    }

    const next = text[sourceOffset + 1];
    if (next === undefined) {
      addSpan(sourceOffset + 1);
      continue;
    }

    if (next === '\\') {
      addSpan(sourceOffset + 2);
      continue;
    }

    const parsed = parseEscapeSequence(text, sourceOffset);
    if (parsed) {
      addSpan(sourceOffset + parsed.length);
      continue;
    }

    // Invalid escapes are encoded as a literal backslash followed by the
    // next source character, matching parseEscapedPayloadText.
    addSpan(sourceOffset + 1);
  }

  return spans;
}

/**
 * Convert an editor selection to decoded-byte offsets. Selecting either half
 * of an escape token (for example just the "n" in "\\n") selects the whole
 * byte represented by that token.
 */
export function byteRangeForSourceSelection(value, start, end) {
  const selectionStart = Math.max(0, Math.min(Number(start) || 0, String(value ?? '').length));
  const selectionEnd = Math.max(selectionStart, Math.min(Number(end) || 0, String(value ?? '').length));
  const selected = getPayloadByteSpans(value)
    .filter((span) => span.sourceStart < selectionEnd && span.sourceEnd > selectionStart);

  if (!selected.length) {
    const offset = byteOffsetAt(value, selectionStart);
    return { start: offset, end: offset };
  }
  return { start: selected[0].byteStart, end: selected.at(-1).byteEnd };
}

export function formatEscapedPayloadText(value) {
  let output = '';
  for (const character of String(value)) {
    switch (character) {
      case '\\': output += '\\\\'; break;
      case '\r': output += '\\r'; break;
      case '\n': output += '\\n'; break;
      case '\t': output += '\\t'; break;
      case '\b': output += '\\b'; break;
      case '\f': output += '\\f'; break;
      case '\v': output += '\\v'; break;
      case '\0': output += '\\0'; break;
      case '\x07': output += '\\a'; break;
      case '"': output += '\\"'; break;
      case "'": output += "\\'"; break;
      case '?': output += '?'; break;
      default: output += character; break;
    }
  }
  return output;
}

function numberBytes(value, byteLength, setter) {
  const view = new DataView(new ArrayBuffer(byteLength));
  setter(view, Number(value));
  return new Uint8Array(view.buffer);
}

function encodeOne(type, value) {
  switch (type) {
    case 'string': return asciiBytes(parseEscapedPayloadText(value));
    case 'character': {
      const parsedValue = parseEscapedPayloadText(value);
      const chars = Array.from(String(parsedValue));
      if (chars.length !== 1) throw new Error('Character payloads must contain exactly one character.');
      return asciiBytes(chars[0]);
    }
    case 'integer': return numberBytes(value, 4, (view, n) => view.setInt32(0, n, false));
    case 'float': return numberBytes(value, 4, (view, n) => view.setFloat32(0, n, false));
    case 'double': return numberBytes(value, 8, (view, n) => view.setFloat64(0, n, false));
    case 'boolean': return numberBytes(value === true || String(value).toLowerCase() === 'true' ? 1 : 0, 4, (view, n) => view.setInt32(0, n, false));
    case 'hex': {
      const hex = String(value).replace(/^0x/i, '').replace(/\s/g, '');
      if (!hex || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error('Raw hexadecimal must contain complete byte pairs only.');
      return Uint8Array.from(hex.match(/../g).map((pair) => parseInt(pair, 16)));
    }
    default: throw new Error(`Unsupported payload type: ${type}`);
  }
}

/** Convert a teacher payload to the raw bytes that tcpdump captures. */
export function encodePayload({ type, value, elementType = 'string' }) {
  if (type === 'integerArray') {
    const values = JSON.parse(value || '[]');
    if (!Array.isArray(values)) throw new Error('Integer array must be a JSON array.');
    return Uint8Array.from(values.flatMap((item) => Array.from(encodeOne('integer', item))));
  }
  if (type === 'typedArray') {
    const values = JSON.parse(value || '[]');
    if (!Array.isArray(values)) throw new Error('Array payload must be a JSON array.');
    return Uint8Array.from(values.flatMap((item) => Array.from(encodeOne(elementType, item))));
  }
  if (type === 'custom') {
    const fields = JSON.parse(value || '[]');
    if (!Array.isArray(fields)) throw new Error('Custom structure must be a JSON array of { type, value } fields.');
    return Uint8Array.from(fields.flatMap((field) => Array.from(encodeOne(field.type, field.value))));
  }
  return encodeOne(type, value);
}

export function buildReadSkipPattern(totalBytes, skipped = []) {
  const ordered = [...skipped]
    .map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(totalBytes, end) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);
  const merged = ordered.reduce((all, range) => {
    const previous = all[all.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else all.push({ ...range });
    return all;
  }, []);
  if (!merged.length) return [0];
  const pattern = [];
  let position = 0;
  merged.forEach(({ start, end }) => {
    if (start > position) pattern.push(start - position);
    pattern.push(-(end - start));
    position = end;
  });
  if (position < totalBytes) pattern.push(totalBytes - position);
  return pattern;
}

export function serializeBuilderCases(cases) {
  const output = {};
  cases.forEach((testcase, index) => {
    output[`testcase${index + 1}`] = testcase.communications.map((communication) => {
      const [source, destination] = String(communication.direction || '').split('_to_');
      if (!source || !destination) {
        throw new Error(`Test case ${index + 1} has a communication without a source and destination.`);
      }
      const bytes = encodePayload(communication);
      const pattern = buildReadSkipPattern(bytes.length, communication.skippedBytes);
      return [pattern, { [communication.direction]: `0x${toHex(bytes)}` }];
    });
  });
  return output;
}

export function byteOffsetAt(text, characterOffset) {
  // The textarea contains escape notation (for example, "\\n"), while the
  // evaluator sees the decoded byte stream.  A source-character offset is
  // therefore not necessarily a byte offset: "\\n" occupies two editor
  // characters but produces one byte.  Convert the selected prefix first.
  const decoded = parseEscapedPayloadText(String(text).slice(0, characterOffset));
  return asciiBytes(decoded).length;
}

const createBuilderId = () => globalThis.crypto?.randomUUID?.() ?? uuidv4();

const defaultCommunication = (direction = '') => ({
  id: createBuilderId(), direction, type: 'string', elementType: 'string', value: '', skippedBytes: [],
});

export function newBuilderCase(direction = '') {
  return { id: createBuilderId(), communications: [defaultCommunication(direction)] };
}

function decodeText(hex) {
  try {
    const bytes = Uint8Array.from(hex.match(/../g) || [], (pair) => parseInt(pair, 16));
    if (Array.from(bytes).some((byte) => byte > 0x7f)) throw new Error('Not ASCII');
    const text = String.fromCharCode(...bytes);
    return { type: 'string', value: formatEscapedPayloadText(text) };
  } catch {
    return { type: 'hex', value: hex };
  }
}

/** Best-effort conversion keeps legacy JSON editable in the new builder. */
export function testcasesToBuilder(testcases, direction = '') {
  if (!testcases || typeof testcases !== 'object' || Array.isArray(testcases)) return [newBuilderCase(direction)];
  const cases = Object.keys(testcases).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((key) => {
    const communications = (Array.isArray(testcases[key]) ? testcases[key] : []).flatMap((entry) => {
      let pattern = [0];
      let communication = entry;
      if (Array.isArray(entry) && Array.isArray(entry[0]) && entry[1] && typeof entry[1] === 'object') {
        [pattern, communication] = entry;
      }
      if (!communication || typeof communication !== 'object' || Array.isArray(communication)) return [];
      return Object.entries(communication).map(([directionKey, payload]) => {
        const hex = typeof payload === 'string' && /^0x/i.test(payload) ? payload.slice(2).replace(/\s/g, '') : null;
        const decoded = hex ? decodeText(hex) : { type: 'string', value: String(payload ?? '') };
        const skippedBytes = [];
        let position = 0;
        if (Array.isArray(pattern)) pattern.forEach((part) => {
          if (part < 0) skippedBytes.push({ start: position, end: position + Math.abs(part) });
          position += Math.abs(part);
        });
        return { ...defaultCommunication(directionKey), direction: directionKey, ...decoded, skippedBytes };
      });
    });
    return { id: createBuilderId(), communications: communications.length ? communications : [defaultCommunication(direction)] };
  });
  return cases.length ? cases : [newBuilderCase(direction)];
}
