import { useState, useEffect } from 'react';
import Submissions from './Submissions';
import TestSelector from './TestSelector';
import QuestionTabs from './QuestionTabs';
import { processCodeBlocks } from '../utils/codeBlockHelper';
import { API_BASE } from '../../config';
import {
  XMarkIcon,
  AcademicCapIcon,
  InformationCircleIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

const STARTER_LANGUAGES = [
  { key: 'c', label: 'C' },
  { key: 'java', label: 'Java' },
];

function starterCodeForLanguages(precode, fileName = '') {
  if (typeof precode === 'string') {
    const language = /\.java$/i.test(fileName) ? 'java' : 'c';
    return [{ key: language, label: language === 'java' ? 'Java' : 'C', code: precode }];
  }
  if (!precode || typeof precode !== 'object') return [];
  return STARTER_LANGUAGES
    .map((language) => ({ ...language, code: precode[language.key] || '' }))
    .filter((language) => language.code);
}

export default function QuestionPane({
  questions,
  activeQuestionIdx,
  setActiveQuestionIdx,
  onClose,
  testCaseResults,
  activeTab: controlledTab,
  setActiveTab: setControlledTab,
  evalMessage,
  submissionRefreshTrigger = 0,
  sessionId = '',
  showResources = false,
  isPractice = false,
  isFreeCoding = false,
}) {
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-gray-500 bg-gradient-to-br from-slate-50 to-white">
        No questions available.
      </div>
    );
  }
  const [internalTab, setInternalTab] = useState('description');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = setControlledTab ?? setInternalTab;
  const question = questions[activeQuestionIdx];
  const [processedDescription, setProcessedDescription] = useState('');
  const questionLocked = question?.isAvailable === false;

  useEffect(() => {
    if (question && question.description) {
      setProcessedDescription(processCodeBlocks(question.description));
    }
  }, [question]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-slate-50 to-white">
      <div className="flex items-center justify-between border-b bg-white">
        <div>
          {questions.map((q, idx) => {
            const locked = q.isAvailable === false;
            return (
              <button
                key={q.id || idx}
                onClick={() => setActiveQuestionIdx(idx)}
                className={`px-4 py-2 font-semibold inline-flex items-center gap-1 ${
                  activeQuestionIdx === idx
                    ? 'border-b-2 border-indigo-600 text-indigo-600 bg-white'
                    : locked
                      ? 'text-gray-400 hover:bg-gray-50'
                      : 'text-gray-600 hover:bg-gray-100'
                }`}
                title={locked ? `Available at ${q.availableAt || 'scheduled time'}` : undefined}
              >
                Q{idx + 1}
                {locked && <LockClosedIcon className="w-3.5 h-3.5" />}
              </button>
            );
          })}
        </div>
        <div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-0.5 mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition-all duration-200 hover:scale-110"
              title="Hide instructions"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-indigo-50 via-white to-purple-50 border-b border-gray-200/50 backdrop-blur-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
            <InformationCircleIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              {question.title}
            </h2>
            <p className="text-xs text-gray-500">Read carefully before coding</p>
          </div>
        </div>
        {!isPractice && !isFreeCoding && <div className="flex items-center space-x-2 text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-full border border-gray-200">
          <AcademicCapIcon className="w-4 h-4 text-blue-500" />
          <span className="font-medium">{question.maxMarks ?? '—'} marks (teacher assigned)</span>
        </div>}
      </div>

      {questionLocked && (
        <div className="mx-4 mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 flex items-center gap-2">
          <LockClosedIcon className="w-4 h-4 shrink-0" />
          <span>
            This question unlocks at <strong>{question.availableAt || 'the scheduled time'}</strong>.
            You can read it now, but run and evaluate stay disabled until then.
          </span>
        </div>
      )}

      <QuestionTabs
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        question={question}
        hideSubmissions={isPractice || isFreeCoding}
        isFreeCoding={isFreeCoding}
      />

      <div className="flex-1 overflow-auto">
        {activeTab === 'description' && (
          <div className="p-6 fade-in-up space-y-4">
            {showResources && question.resources?.length > 0 && (
              <details className="rounded-lg border border-indigo-200 bg-indigo-50 p-3" open>
                <summary className="cursor-pointer font-medium text-indigo-800">Resources & learning materials ({question.resources.length})</summary>
                <ul className="mt-2 list-disc pl-5 text-sm">{question.resources.map((resource, index) => <li key={`${resource.url}-${index}`}><a className="text-indigo-700 underline" href={resource.url.startsWith('http') ? resource.url : `${API_BASE}${resource.url}`} target="_blank" rel="noreferrer">{resource.name}</a></li>)}</ul>
              </details>
            )}
            <div
              className="prose prose-sm max-w-none leading-relaxed text-[15px]"
              dangerouslySetInnerHTML={{ __html: (processedDescription || question.description || '')
                .replace(/(src|href)=["']https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?(\/uploads\/[^"']+)["']/gi, '$1="' + API_BASE + '$3"')
                .replace(/(src|href)=["'](\/uploads\/[^"']+)["']/gi, '$1="' + API_BASE + '$2"') }}
            />
            {question.image && (
              <img
                src={question.image.startsWith('http') ? question.image : `${API_BASE}${question.image}`}
                alt="Question Illustration"
                className="mt-4 rounded-lg border border-gray-200 shadow-sm max-w-full"
                style={{ maxHeight: 320 }}
              />
            )}
          </div>
        )}
        {activeTab === 'precode' && (
          <div className="p-6 fade-in-up space-y-4">
            {(question.files || []).map((f) => (
              <div key={f.tag + f.name}>
                <div className="font-mono text-xs text-gray-500 mb-1">
                  <b>{f.name}</b> (tag: {f.tag})
                </div>
                {starterCodeForLanguages(f.precode, f.name).length ? (
                  starterCodeForLanguages(f.precode, f.name).map((starter) => (
                    <div key={starter.key} className="mb-4">
                      <div className="text-xs font-semibold text-gray-600 mb-1">{starter.label}</div>
                      <pre className="bg-gray-100 border border-gray-200 rounded-lg p-3 text-xs overflow-x-auto">{starter.code}</pre>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500 mb-4">No starter code was provided for this file.</p>
                )}
              </div>
            ))}
          </div>
        )}
        {activeTab === 'testcases' && (
          <div className="fade-in-up">
            <TestSelector
              question={question}
              testCaseResults={testCaseResults}
              evalMessage={evalMessage}
            />
          </div>
        )}
        {activeTab === 'submissions' && !isPractice && !isFreeCoding && (
          <div>
            <Submissions
              questionId={question.id}
              sessionId={sessionId}
              refreshTrigger={submissionRefreshTrigger}
            />
          </div>
        )}
      </div>
    </div>
  );
}
