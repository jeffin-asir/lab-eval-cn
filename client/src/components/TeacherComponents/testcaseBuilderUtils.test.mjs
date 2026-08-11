import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReadSkipPattern, byteOffsetAt, byteRangeForSourceSelection, getPayloadByteSpans, parseEscapedPayloadText } from './testcaseBuilderUtils.js';

test('parses carriage return and newline escapes', () => {
  assert.equal(parseEscapedPayloadText('Hello\\rWorld'), 'Hello\rWorld');
  assert.equal(parseEscapedPayloadText('Hello\\nWorld'), 'Hello\nWorld');
  assert.equal(parseEscapedPayloadText('Hello\\\\rWorld'), 'Hello\\rWorld');
  assert.equal(parseEscapedPayloadText('Hello\\\\\\rWorld'), 'Hello\\\rWorld');
});

test('handles literal backslash before escape correctly', () => {
  assert.equal(parseEscapedPayloadText('hello\\r\\\\r'), 'hello\r\\r');
});

test('parses full C-style escape sequences', () => {
  const actual = parseEscapedPayloadText('a\\nb\\tc\\rd\\fe\\vf\\a');
  const expected = String.fromCharCode(97, 10, 98, 9, 99, 13, 100, 12, 101, 11, 102, 7);
  assert.equal(actual, expected);
  assert.equal(parseEscapedPayloadText("quote\\'\""), "quote'\"");
  assert.equal(parseEscapedPayloadText('question\\?'), 'question?');
  assert.equal(parseEscapedPayloadText('hex\\x41'), 'hexA');
  assert.equal(parseEscapedPayloadText('octal\\012'), 'octal\n');
});

test('calculates skip ranges in decoded bytes, not escape-source characters', () => {
  const value = 'A\\nBC';
  assert.equal(byteOffsetAt(value, 1), 1);
  assert.equal(byteOffsetAt(value, 3), 2); // A + decoded newline
  assert.deepEqual(buildReadSkipPattern(4, [{ start: byteOffsetAt(value, 1), end: byteOffsetAt(value, 3) }]), [1, -1, 2]);
});

test('maps an escaped source sequence to one decoded-byte preview span', () => {
  assert.deepEqual(getPayloadByteSpans('A\\nB'), [
    { sourceStart: 0, sourceEnd: 1, byteStart: 0, byteEnd: 1 },
    { sourceStart: 1, sourceEnd: 3, byteStart: 1, byteEnd: 2 },
    { sourceStart: 3, sourceEnd: 4, byteStart: 2, byteEnd: 3 },
  ]);
  assert.deepEqual(getPayloadByteSpans('\\x41\\012\\\\'), [
    { sourceStart: 0, sourceEnd: 4, byteStart: 0, byteEnd: 1 },
    { sourceStart: 4, sourceEnd: 8, byteStart: 1, byteEnd: 2 },
    { sourceStart: 8, sourceEnd: 10, byteStart: 2, byteEnd: 3 },
  ]);
});

test('selecting part of an escape selects its entire decoded byte', () => {
  const value = 'Hi\\n';
  assert.deepEqual(byteRangeForSourceSelection(value, 3, 4), { start: 2, end: 3 }); // n
  assert.deepEqual(byteRangeForSourceSelection(value, 2, 3), { start: 2, end: 3 }); // backslash
  assert.deepEqual(byteRangeForSourceSelection(value, 2, 4), { start: 2, end: 3 }); // full escape
});
