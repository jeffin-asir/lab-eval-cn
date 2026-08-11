import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { PlusIcon } from '@heroicons/react/24/outline';
import {
  PAYLOAD_TYPES, buildReadSkipPattern, byteRangeForSourceSelection, encodePayload,
  getPayloadByteSpans, newBuilderCase, serializeBuilderCases, testcasesToBuilder, parseEscapeSequence,
} from './testcaseBuilderUtils';

const stableJson = (value) => JSON.stringify(value || {});
const safeCount = (value) => Math.max(0, Math.min(50, Number.parseInt(value, 10) || 0));

function stringifyTestcasesFile(questionKey, cases) {
  return JSON.stringify({ [questionKey || 'q1']: cases || {} }, null, 2);
}

function parseTestcasesFile(text, questionKey) {
  const parsed = JSON.parse(text || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('testcases.json must be a JSON object keyed by question ID.');
  const keys = Object.keys(parsed);
  const key = parsed[questionKey] !== undefined ? questionKey : keys[0] || questionKey || 'q1';
  if (!parsed[key] || Array.isArray(parsed[key]) || typeof parsed[key] !== 'object') throw new Error(`Expected an object of testcases under "${key}".`);
  return { parsed, questionKey: key, testcases: parsed[key] };
}

export default function TestcaseBuilder({ testcases, testcasesFile, questionKey, socketConfig, setValue }) {
  const sockets = { clients: safeCount(socketConfig?.clients ?? 1), servers: safeCount(socketConfig?.servers ?? 1) };
  const endpoints = useMemo(() => [
    ...Array.from({ length: sockets.clients }, (_, index) => `client${index + 1}`),
    ...Array.from({ length: sockets.servers }, (_, index) => `server${index + 1}`),
  ], [sockets.clients, sockets.servers]);
  const defaultDirection = endpoints.length > 1 ? `${endpoints[0]}_to_${endpoints[1]}` : '';
  const [tab, setTab] = useState('builder');
  const [cases, setCases] = useState(() => testcasesToBuilder(testcases, defaultDirection));
  const [jsonText, setJsonText] = useState(() => testcasesFile || stringifyTestcasesFile(questionKey, testcases));
  const [jsonError, setJsonError] = useState('');
  const [builderError, setBuilderError] = useState('');
  const [skipMode, setSkipMode] = useState({});
  const lastSignature = useRef(stableJson(testcases));

  // Keep imports, Reset, and JSON-tab edits reflected in the builder without
  // overwriting a teacher while their own builder edit is being serialized.
  useEffect(() => {
    const signature = stableJson(testcases);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;
    setJsonText(testcasesFile || stringifyTestcasesFile(questionKey, testcases));
    setCases(testcasesToBuilder(testcases, defaultDirection));
  }, [testcases, testcasesFile, questionKey, defaultDirection]);

  const publishCases = (next) => {
    try {
      const serialized = serializeBuilderCases(next);
      lastSignature.current = stableJson(serialized);
      setCases(next);
      const file = stringifyTestcasesFile(questionKey, serialized);
      setJsonText(file);
      setBuilderError('');
      setValue('testcases', serialized, { shouldDirty: true });
      setValue('testcasesFile', file, { shouldDirty: true });
    } catch (error) {
      setCases(next);
      setBuilderError(error.message);
    }
  };

  const updateCommunication = (caseIndex, communicationIndex, patch) => {
    const next = cases.map((testcase, tcIndex) => tcIndex !== caseIndex ? testcase : {
      ...testcase,
      communications: testcase.communications.map((communication, commIndex) => commIndex !== communicationIndex
        ? communication : { ...communication, ...patch }),
    });
    publishCases(next);
  };

  const removeCommunication = (caseIndex, communicationIndex) => publishCases(cases.map((testcase, tcIndex) => tcIndex !== caseIndex ? testcase : ({
    ...testcase, communications: testcase.communications.filter((_, index) => index !== communicationIndex),
  })));

  const useJsonInBuilder = () => {
    try {
      const result = parseTestcasesFile(jsonText, questionKey);
      lastSignature.current = stableJson(result.testcases);
      // Preserve the exact text typed by the teacher.  The builder is merely
      // a best-effort view of that file, never a normalizer of it.
      setValue('testcasesFile', jsonText, { shouldDirty: true });
      setValue('testcases', result.testcases, { shouldDirty: true });
      if (result.questionKey !== questionKey) setValue('questionKey', result.questionKey, { shouldDirty: true });
      setCases(testcasesToBuilder(result.testcases, defaultDirection));
      setJsonError('');
      setTab('builder');
    } catch (error) {
      setJsonError(`Invalid JSON: ${error.message}`);
    }
  };

  return <div className="border rounded-lg bg-white overflow-hidden">
    <div className="flex border-b bg-gray-50 px-3 pt-2 gap-2">
      <button type="button" onClick={() => setTab('builder')} className={`px-3 py-2 text-sm font-medium rounded-t ${tab === 'builder' ? 'bg-white border border-b-white -mb-px text-indigo-700' : 'text-gray-600'}`}>Guided builder</button>
      <button type="button" onClick={() => setTab('json')} className={`px-3 py-2 text-sm font-medium rounded-t ${tab === 'json' ? 'bg-white border border-b-white -mb-px text-indigo-700' : 'text-gray-600'}`}>testcases.json</button>
    </div>

    {tab === 'json' ? <div className="p-4">
      <p className="text-sm text-gray-600 mb-3">This is the complete saved <code>testcases.json</code>. Manual edits are authoritative; applying them updates the guided view.</p>
      <Editor height="360px" language="json" value={jsonText} onChange={(value) => { setJsonText(value ?? ''); setJsonError(''); }} options={{ minimap: { enabled: false }, fontSize: 13 }} />
      {jsonError && <p className="text-sm text-red-600 mt-2">{jsonError}</p>}
      <button type="button" onClick={useJsonInBuilder} className="mt-3 px-3 py-2 rounded bg-indigo-600 text-white text-sm">Apply JSON</button>
    </div> : <div className="p-4 space-y-4">
      <div className="text-sm text-gray-600">
        First declare the sockets used by this question. Add communications in the order they should be observed. Every payload is saved as a hexadecimal literal; `[0]` reads the whole payload, and a selected skip range becomes a negative byte count.
      </div>
      <div className="grid sm:grid-cols-2 gap-3 rounded border bg-indigo-50/50 p-3">
        <label className="text-sm font-medium">Number of client sockets
          <input type="number" min="0" max="50" value={sockets.clients} onChange={(event) => setValue('testcaseSocketConfig', { ...sockets, clients: safeCount(event.target.value) }, { shouldDirty: true })} className="block mt-1 w-full border rounded px-2 py-2" />
        </label>
        <label className="text-sm font-medium">Number of server sockets
          <input type="number" min="0" max="50" value={sockets.servers} onChange={(event) => setValue('testcaseSocketConfig', { ...sockets, servers: safeCount(event.target.value) }, { shouldDirty: true })} className="block mt-1 w-full border rounded px-2 py-2" />
        </label>
        <p className="sm:col-span-2 text-xs text-gray-600">A proxy uses one client socket and one server socket; include both in the counts.</p>
      </div>
      {!endpoints.length && <span className="block text-amber-700 text-sm">Set at least one client or server socket to create communications.</span>}
      {builderError && <div className="rounded bg-red-50 text-red-700 p-3 text-sm">{builderError}</div>}
      {cases.map((testcase, caseIndex) => <section key={testcase.id} className="border rounded-lg">
        <div className="flex justify-between items-center px-4 py-3 bg-gray-50 border-b">
          <h4 className="font-semibold">Test Case {caseIndex + 1}</h4>
          <button type="button" onClick={() => publishCases(cases.filter((_, index) => index !== caseIndex))} className="text-sm text-red-600">Remove testcase</button>
        </div>
        <div className="p-4 space-y-4">
          {testcase.communications.map((communication, communicationIndex) => <CommunicationCard
            key={communication.id}
            communication={communication}
            endpoints={endpoints}
            skipEnabled={!!skipMode[communication.id]}
            onSkipMode={(enabled) => setSkipMode((previous) => ({ ...previous, [communication.id]: enabled }))}
            onChange={(patch) => updateCommunication(caseIndex, communicationIndex, patch)}
            onRemove={() => removeCommunication(caseIndex, communicationIndex)}
          />)}
          <button type="button" onClick={() => publishCases(cases.map((item, index) => index !== caseIndex ? item : ({ ...item, communications: [...item.communications, { ...newBuilderCase(defaultDirection).communications[0] }] })))} className="inline-flex items-center text-sm px-3 py-2 border rounded">
            <PlusIcon className="w-4 h-4 mr-1" /> Add communication
          </button>
        </div>
      </section>)}
      <button type="button" onClick={() => publishCases([...cases, newBuilderCase(defaultDirection)])} className="inline-flex items-center px-3 py-2 bg-indigo-600 text-white rounded text-sm">
        <PlusIcon className="w-4 h-4 mr-1" /> Add testcase
      </button>
    </div>}
  </div>;
}

function CommunicationCard({ communication, endpoints, skipEnabled, onSkipMode, onChange, onRemove }) {
  let preview = '';
  let previewError = '';
  try {
    const bytes = encodePayload(communication);
    preview = `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    preview += `  •  pattern ${JSON.stringify(buildReadSkipPattern(bytes.length, communication.skippedBytes))}`;
  } catch (error) { previewError = error.message; }
  const canSelectSkip = communication.type === 'string' || communication.type === 'character';
  const addSelectionAsSkippedBytes = (start, end, value) => {
    if (!skipEnabled || !canSelectSkip || start === end) return;
    const range = byteRangeForSourceSelection(value, start, end);
    const existing = communication.skippedBytes || [];
    if (!existing.some((item) => item.start === range.start && item.end === range.end)) onChange({ skippedBytes: [...existing, range] });
  };
  return <article className="rounded border p-3 bg-white">
    <div className="grid md:grid-cols-2 gap-3">
      <label className="text-sm font-medium">Communication direction
        <div className="flex items-center gap-2 mt-1">
          <select value={communication.direction.split('_to_')[0] || ''} onChange={(event) => onChange({ direction: `${event.target.value}_to_${communication.direction.split('_to_')[1] || ''}` })} className="w-full border rounded px-2 py-2">
            <option value="">From</option>
            {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
          </select>
          <span className="text-gray-500">to</span>
          <select value={communication.direction.split('_to_')[1] || ''} onChange={(event) => onChange({ direction: `${communication.direction.split('_to_')[0] || ''}_to_${event.target.value}` })} className="w-full border rounded px-2 py-2">
            <option value="">To</option>
            {endpoints.map((endpoint) => <option key={endpoint} value={endpoint}>{endpoint}</option>)}
          </select>
        </div>
      </label>
      <label className="text-sm font-medium">Payload data type
        <select value={communication.type} onChange={(event) => onChange({ type: event.target.value, skippedBytes: [] })} className="block mt-1 w-full border rounded px-2 py-2">
          {PAYLOAD_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    {communication.type === 'typedArray' && <label className="block text-sm font-medium mt-3">Array element type
      <select value={communication.elementType} onChange={(event) => onChange({ elementType: event.target.value })} className="block mt-1 border rounded px-2 py-2">
        {PAYLOAD_TYPES.filter(([type]) => !['typedArray', 'integerArray', 'custom', 'hex'].includes(type)).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>}
    <label className="block text-sm font-medium mt-3">Payload
      {canSelectSkip ? <>
        <textarea
          value={communication.value}
          onChange={(event) => onChange({ value: event.target.value })}
          onMouseUp={(event) => addSelectionAsSkippedBytes(event.currentTarget.selectionStart, event.currentTarget.selectionEnd, event.currentTarget.value)}
          rows={6}
          className="block mt-1 w-full font-mono text-sm border rounded p-2 focus:ring-2 focus:ring-indigo-400"
          placeholder="Enter ASCII payload"
        />
        <EscapeSequencePreview value={communication.value} />
        {!!communication.skippedBytes?.length && <SkippedTextPreview value={communication.value} skippedBytes={communication.skippedBytes} />}
      </> : <textarea value={communication.value} onChange={(event) => onChange({ value: event.target.value })} rows={4} className="block mt-1 w-full font-mono text-sm border rounded p-2" placeholder={communication.type === 'custom' ? '[{"type":"integer","value":42},{"type":"string","value":"OK"}]' : communication.type.includes('Array') ? '[1, 2, 3]' : 'Enter payload'} />}
    </label>
    <div className="mt-2 flex flex-wrap gap-3 items-center text-xs">
      <label className={`inline-flex items-center gap-2 ${canSelectSkip ? '' : 'text-gray-400'}`}>
        <input type="checkbox" checked={skipEnabled} disabled={!canSelectSkip} onChange={(event) => onSkipMode(event.target.checked)} /> Enable skip-byte drag selection
      </label>
      {canSelectSkip && <span className="text-gray-500">Turn it on, select text in the payload, and release to mark its ASCII bytes as skipped. Skipped text is highlighted amber.</span>}
      {!!communication.skippedBytes?.length && <button type="button" onClick={() => onChange({ skippedBytes: [] })} className="text-indigo-600">Clear skipped selections</button>}
    </div>
    {communication.type === 'custom' && <p className="text-xs text-gray-500 mt-2">Custom fields are encoded in listed order. Supported field types: string, character, integer, float, double, boolean, hex.</p>}
    <div className={`mt-3 rounded p-2 font-mono text-xs break-all ${previewError ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>{previewError || preview}</div>
    <button type="button" onClick={onRemove} className="mt-3 text-sm text-red-600">Remove communication</button>
  </article>;
}

function getEscapePreviewParts(value = '') {
  const parts = [];
  let index = 0;

  while (index < value.length) {
    const character = value[index];
    if (character !== '\\') {
      parts.push({ text: character, highlight: false });
      index += 1;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      parts.push({ text: '\\', highlight: false });
      index += 1;
      continue;
    }

    if (next === '\\') {
      parts.push({ text: '\\', highlight: false });
      index += 2;
      continue;
    }

    const parsed = parseEscapeSequence(value, index);
    if (!parsed) {
      parts.push({ text: '\\', highlight: false });
      index += 1;
      continue;
    }

    if (parsed.label === '\\') {
      parts.push({ text: '\\', highlight: false });
    } else {
      parts.push({ text: parsed.label, highlight: true });
    }
    index += parsed.length;
  }

  return parts;
}

function EscapeSequencePreview({ value = '' }) {
  const parts = getEscapePreviewParts(value);
  if (!parts.length) return null;
  return <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
    <p className="mb-1 font-sans text-slate-600">Escape preview</p>
    <div className="whitespace-pre-wrap break-words font-mono">
      {parts.map((part, index) => part.highlight ? (
        <span key={index} className="bg-sky-100 text-sky-800 rounded px-0.5">{part.text}</span>
      ) : (
        <span key={index}>{part.text}</span>
      ))}
    </div>
  </div>;
}

function SkippedTextPreview({ value, skippedBytes = [] }) {
  const renderParts = () => {
    const byteSpans = getPayloadByteSpans(value);
    const totalBytes = byteSpans.at(-1)?.byteEnd || 0;
    const ranges = [...skippedBytes]
      .map(({ start, end }) => ({ start: Math.max(0, start), end: Math.min(totalBytes, end) }))
      .filter(({ start, end }) => end > start)
      .sort((a, b) => a.start - b.start);
    const isSkipped = ({ byteStart, byteEnd }) => ranges.some((range) => range.start < byteEnd && range.end > byteStart);

    return byteSpans.map((span) => {
      const sourceText = value.slice(span.sourceStart, span.sourceEnd);
      return isSkipped(span)
        ? <mark key={span.sourceStart} className="bg-amber-200 text-gray-900 rounded px-0.5">{sourceText}</mark>
        : <span key={span.sourceStart}>{sourceText}</span>;
    });
  };
  return <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-gray-700">
    <p className="mb-1 font-sans text-amber-900">Skipped text preview (amber portions are not matched)</p>
    <div className="whitespace-pre-wrap break-words font-mono">{renderParts()}</div>
  </div>;
}
