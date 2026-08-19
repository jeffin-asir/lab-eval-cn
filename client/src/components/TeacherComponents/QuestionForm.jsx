import { useState } from 'react';
import { Controller } from 'react-hook-form';
import axios from 'axios';
import { API_BASE } from '../../config';
import { FormSection, FormLabel, ErrorMessage } from '../FormComponents';
import TiptapEditor from '../TiptapEditor';
import Editor from "@monaco-editor/react";
import { PlusIcon } from '@heroicons/react/24/outline';
import TestcaseBuilder from './TestcaseBuilder';
import EvalScriptBuilder from './EvalScriptBuilder';
import { newEvalScriptState, blocksToEvalBody } from './evalScriptBuilderUtils';

const SUPPORTED_LANGUAGES = [
  { key: 'c', label: 'C' },
  { key: 'java', label: 'Java' },
];

// Import JSON reads a file straight off disk, bypassing the backend's
// toJSON normalization — so a JSON export from before this feature (base
// name with an extension baked in, precode as a single string) needs the
// same legacy handling applied here on the client.
function normalizeFiles(rawFiles) {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles.map((f) => {
    const name = (f.name || '').replace(/\.(c|java)$/i, '');
    const legacyLang = /\.java$/i.test(f.name || '') ? 'java' : 'c';
    let precode;
    if (typeof f.precode === 'string') {
      precode = { c: '', java: '', [legacyLang]: f.precode };
    } else {
      precode = { c: '', java: '', ...(f.precode || {}) };
    }
    return { ...f, name, precode };
  });
}

const defaultStarterState = newEvalScriptState(2);
const defaultSampleEvalScript = blocksToEvalBody(defaultStarterState, [
  { name: 'server', tag: 's1' },
  { name: 'client', tag: 'c1' },
]);

const QuestionForm = ({
  handleFormSubmit,
  onSubmit,
  register,
  errors,
  control,
  reset,
  initialQuestion,
  editingQuestionId,
  isLoading,
  watchedValues,
  setValue,
}) => {
  const files = watchedValues.files || [];
  const resources = watchedValues.resources || [];
  // Which language tab (C/Java) is currently showing in each file's editor —
  // purely local UI state, not part of the saved question.
  const [activeLangByIdx, setActiveLangByIdx] = useState({});

  const addFile = () => {
    const name = prompt('File name, without extension (e.g. server):');
    if (!name) return;
    const tag = prompt('Tag for this file (e.g. s1, c1, c2):');
    if (!tag) return;
    setValue('files', [
      ...files,
      { name: name.replace(/\.(c|java)$/i, ''), tag, precode: { c: '', java: '' } },
    ]);
  };

  const removeFile = (idx) => {
    setValue('files', files.filter((_, i) => i !== idx));
  };

  const updateFile = (idx, field, value) => {
    const next = [...files];
    next[idx] = { ...next[idx], [field]: value };
    setValue('files', next);
  };

  const updateFilePrecode = (idx, lang, value) => {
    const current = files[idx]?.precode || {};
    updateFile(idx, 'precode', { ...current, [lang]: value });
  };

  const activeLangFor = (idx) => activeLangByIdx[idx] || 'c';

  return (
    <form onSubmit={handleFormSubmit(onSubmit)} className="space-y-8">
      <FormSection title="Basic Information">
        <div>
          <FormLabel htmlFor="title" required>Question Title</FormLabel>
          <input
            id="title"
            {...register('title', { required: 'Title is required' })}
            className="w-full border rounded-md px-3 py-2"
            placeholder="TCP Echo Server"
          />
          {errors.title && <ErrorMessage>{errors.title.message}</ErrorMessage>}
        </div>

        <div>
          <FormLabel>Learning resources (shown in sessions and practice, never in exams)</FormLabel>
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={async (event) => {
              const resource = event.target.files?.[0];
              if (!resource) return;
              try {
                const formData = new FormData();
                formData.append('resource', resource);
                const { data } = await axios.post(`${API_BASE}/api/questions/upload-resource`, formData);
                setValue('resources', [...resources, data], { shouldDirty: true });
              } catch (err) {
                alert(err.response?.data?.error || 'Could not upload resource.');
              } finally {
                event.target.value = '';
              }
            }}
            className="block w-full text-sm border rounded-md p-2"
          />
          {resources.length > 0 && <ul className="mt-2 text-sm text-gray-700 space-y-1">
            {resources.map((resource, index) => <li key={`${resource.url}-${index}`} className="flex gap-2 items-center">
              <a href={resource.url} target="_blank" rel="noreferrer" className="text-indigo-600 underline">{resource.name}</a>
              <button type="button" className="text-red-600" onClick={() => setValue('resources', resources.filter((_, i) => i !== index), { shouldDirty: true })}>Remove</button>
            </li>)}
          </ul>}
        </div>

        <div>
          <FormLabel htmlFor="description" required>Description</FormLabel>
          <Controller
            name="description"
            control={control}
            rules={{ required: 'Description is required' }}
            render={({ field }) => (
              <TiptapEditor value={field.value} onChange={field.onChange} />
            )}
          />
          {errors.description && <ErrorMessage>{errors.description.message}</ErrorMessage>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor="questionKey">Question Key</FormLabel>
            <input
              id="questionKey"
              {...register('questionKey')}
              className="w-full border rounded-md px-3 py-2"
              placeholder="q1"
            />
            <p className="text-xs text-gray-500 mt-1">Used in testcases.json and CSV (q1, q2, …)</p>
          </div>
          <div>
            <FormLabel htmlFor="maxMarks">Max Marks (teacher assigns manually)</FormLabel>
            <input
              id="maxMarks"
              type="number"
              {...register('maxMarks', { valueAsNumber: true })}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
        </div>
      </FormSection>

      <FormSection title="Code Files">
        <p className="text-sm text-gray-600 mb-3">
          Each file has a custom tag (s1, c1, c2, …) used in testcases and to be referenced easily
          in evaluation. Give each file a base name only, without an extension — the student's
          own language choice (C or Java) decides which extension and which boilerplate below
          they actually get.
        </p>
        <button
          type="button"
          onClick={addFile}
          className="inline-flex items-center px-3 py-1.5 border rounded text-sm mb-4"
        >
          <PlusIcon className="w-4 h-4 mr-1" /> Add File
        </button>

        {files.map((file, idx) => {
          const activeLang = activeLangFor(idx);
          return (
            <div key={idx} className="mb-4 border rounded-lg overflow-hidden">
              <div className="flex gap-3 items-center px-4 py-2 bg-gray-100">
                <input
                  value={file.name}
                  onChange={(e) => updateFile(idx, 'name', e.target.value.replace(/\.(c|java)$/i, ''))}
                  className="border rounded px-2 py-1 text-sm flex-1"
                  placeholder="server"
                />
                <input
                  value={file.tag}
                  onChange={(e) => updateFile(idx, 'tag', e.target.value)}
                  className="border rounded px-2 py-1 text-sm w-24"
                  placeholder="s1"
                />
                <button type="button" onClick={() => removeFile(idx)} className="text-red-500 text-sm">Remove</button>
              </div>
              <div className="flex gap-1 px-4 pt-2 bg-white border-b">
                {SUPPORTED_LANGUAGES.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveLangByIdx((prev) => ({ ...prev, [idx]: key }))}
                    className={`px-3 py-1.5 text-xs font-medium rounded-t-md border border-b-0 ${
                      activeLang === key
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="h-48">
                <Editor
                  height="100%"
                  language={activeLang}
                  value={file.precode?.[activeLang] || ''}
                  onChange={(v) => updateFilePrecode(idx, activeLang, v ?? '')}
                  options={{ minimap: { enabled: false }, fontSize: 13 }}
                />
              </div>
            </div>
          );
        })}
      </FormSection>

      <FormSection title="Evaluation Data (copied to container at run time)">
        <div className="mb-4">
          <FormLabel>Input file (stdin lines for INPUT command)</FormLabel>
          <Controller
            name="input"
            control={control}
            render={({ field }) => (
              <Editor
                height="120px"
                language="plaintext"
                value={field.value || ''}
                onChange={field.onChange}
                options={{ minimap: { enabled: false }, fontSize: 13 }}
              />
            )}
          />
        </div>

        <div className="mb-4">
          <FormLabel>Testcase builder</FormLabel>
          <TestcaseBuilder
            testcases={watchedValues.testcases}
            testcasesFile={watchedValues.testcasesFile}
            questionKey={watchedValues.questionKey}
            socketConfig={watchedValues.testcaseSocketConfig}
            setValue={setValue}
          />
        </div>

        <div>
          <FormLabel>Evaluation flow (nice.sh)</FormLabel>
          <input type="hidden" {...register('evalScript')} />
          <p className="text-sm text-gray-600 mb-2">
            Drag blocks to mirror how you would run programs manually. The saved
            {' '}
            <code className="text-xs bg-gray-100 px-1 rounded">evalScript</code>
            {' '}
            is the full saved <code className="text-xs bg-gray-100 px-1 rounded">nice.sh</code>. The backend uploads it unchanged at run time.
          </p>
          <EvalScriptBuilder
            evalScript={watchedValues.evalScript}
            niceScript={watchedValues.niceScript}
            evalScriptBlocks={watchedValues.evalScriptBlocks}
            questionKey={watchedValues.questionKey || 'q1'}
            files={files}
            testcaseSocketConfig={watchedValues.testcaseSocketConfig}
            testcases={watchedValues.testcases}
            setValue={setValue}
          />
        </div>
      </FormSection>

      <FormSection title="Import JSON">
        <input
          type="file"
          accept=".json"
          className="text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              try {
                const data = JSON.parse(ev.target.result);
                reset({
                  title: data.title || '',
                  description: data.description || '',
                  questionKey: data.questionKey || 'q1',
                  maxMarks: data.maxMarks || 15,
                  files: normalizeFiles(data.files || []),
                  testcases: data.testcases || {},
                  testcasesFile: data.testcasesFile || JSON.stringify({ [data.questionKey || 'q1']: data.testcases || {} }, null, 2),
                  testcaseSocketConfig: data.testcaseSocketConfig || { clients: 1, servers: 1 },
                  input: data.input || '',
                  evalScript: data.evalScript || data.evalscripts?.['nice.sh'] || defaultSampleEvalScript,
                  niceScript: data.niceScript || data.evalscripts?.['nice.sh'] || '',
                  evalScriptBlocks: data.evalScriptBlocks ?? null,
                });
              } catch (err) {
                alert('Invalid JSON: ' + err.message);
              }
            };
            reader.readAsText(file);
          }}
        />
      </FormSection>

      <div className="pt-4 border-t flex space-x-4">
        <button type="button" onClick={() => reset(initialQuestion)} className="flex-1 py-2 border rounded-md bg-gray-100">
          Clear Form
        </button>
        {editingQuestionId && (
          <button
            type="button"
            onClick={async () => {
              const response = await axios.get(`http://localhost:5001/api/questions/${editingQuestionId}`);
              reset(response.data);
            }}
            className="flex-1 py-2 border rounded-md bg-gray-100"
          >
            Reset to DB
          </button>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2.5 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-70"
      >
        {isLoading ? 'Saving…' : editingQuestionId ? 'Update Question' : 'Upload Question'}
      </button>
    </form>
  );
};

export default QuestionForm;
