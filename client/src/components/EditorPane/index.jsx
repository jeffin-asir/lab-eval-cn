import { useEffect, useState } from 'react';
import TagAssignmentModal from './TagAssignmentModel';
import EditorTabs from './EditorTabs';
import RunButtons from './RunButtons';
import MonacoEditor from '@monaco-editor/react';
import { 
  CodeBracketIcon,
  EyeIcon,
  CogIcon,
  DocumentPlusIcon,
  BoltIcon,
  WrenchIcon,
  DocumentIcon,
  TagIcon
} from '@heroicons/react/24/outline';

// Monaco 0.52 installs a Safari-specific clipboard listener that calls
// `navigator.clipboard.write()` on every editor click/keypress. In Safari
// (and in HTTP / embedded lab deployments) that API can be absent, which
// throws before Monaco can use its normal legacy-copy fallback. Supplying a
// small standalone clipboard service keeps copy/paste functional where the
// Clipboard API is available and degrades safely to execCommand elsewhere.
// In exam mode its clipboard stays in page memory and never reads or writes
// the operating-system clipboard.
const clipboardService = (() => {
  let text = '';
  let findText = '';
  let examMode = false;

  const legacyCopy = (value) => {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  };

  return {
    async writeText(value, type) {
      if (type) return;
      text = value;
      // In an exam this value is intentionally retained only in page memory.
      if (examMode) return;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(value);
          return;
        }
      } catch {
        // The async Clipboard API is commonly disabled for non-HTTPS lab URLs.
      }
      legacyCopy(value);
    },
    async readText(type) {
      if (type) return '';
      if (examMode) return text;
      try {
        if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
      } catch {
        // Use the in-memory value when browser permissions reject clipboard reads.
      }
      return text;
    },
    async writeFindText(value) { findText = value; },
    async readFindText() { return findText; },
    async readResources() { return []; },
    setExamMode(enabled) {
      if (enabled && !examMode) text = '';
      examMode = enabled;
    },
    setInternalText(value) { text = value || ''; },
    getInternalText() { return text; },
    clearInternalState() { text = ''; },
  };
})();

const editorOverrideServices = { clipboardService };

export default function EditorPane({
  language,
  files,
  setFiles,
  activeFileId,
  setActiveFileId,
  activeFile,
  questionId,
  updateCode,
  addNewFile,
  openFile,
  onRun,
  onEvaluate,
  onSubmit,
  isRunning,
  isEvaluating,
  isSubmitting,
  showQuestion,
  onToggleQuestion,
  showTerminal,
  setShowTerminal,
  onCloseFile,
  saveStatus,
  renameFile,
  updateFileLanguage,
  resetFileToBoilerplate,
  tags,
  tagToFileMap,
  setTagToFileMap,
  isFreeCoding,
  isPractice,
  isExam = false,
  alreadyPassed,
  onSave,
}) {
  const [fontSize, setFontSize] = useState(14);
  const [theme, setTheme] = useState('vs-dark');
  const [showTagModal, setShowTagModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    clipboardService.setExamMode(isExam);
    return () => clipboardService.setExamMode(false);
  }, [isExam]);

  // const activeFile = files.find(f => f.id === activeFileId) || files[0];

  const editorOptions = {
    fontSize,
    minimap: { enabled: true },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    lineNumbers: 'on',
    tabSize: 4,
    insertSpaces: true,
  };

  const languages = [
    { value: 'c', label: 'C', icon: <WrenchIcon className="w-4 h-4 text-gray-700 inline" /> },
    { value: 'java', label: 'Java', icon: <CodeBracketIcon className="w-4 h-4 text-orange-600 inline" /> }
  ];

  const themes = [
    { value: 'vs-dark', label: 'Dark' },
    { value: 'vs-light', label: 'Light' },
    { value: 'hc-black', label: 'High Contrast Dark' }
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center space-x-3">
          <CodeBracketIcon className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">Code Editor</h2>
          {saveStatus === 'saving' && (
            <span className="text-xs text-gray-500 ml-2">Saving...</span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-600 ml-2">Saved ✓</span>
          )}
          {saveStatus === 'idle' && (
            <span className="text-xs text-green-600 ml-2">Saved ✓</span>
          )}
          
          {!showQuestion && onToggleQuestion && (
            <button
              onClick={onToggleQuestion}
              className="flex items-center space-x-1 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
            >
              <EyeIcon className="w-3 h-3" />
              <span>Show Problem</span>
            </button>
          )}
        </div>
          
        <div className="flex items-center space-x-2">
          <button
            onClick={ () => setShowTagModal(true) }
            className="flex items-center space-x-1 px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
            title="Add new file"
          >
            <TagIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Specify Tags</span>
          </button>

          <select
            value={activeFile?.language || language}
            onChange={(e) => {
              const newLang = e.target.value;
              updateFileLanguage(activeFile.id, newLang);
            }}
            className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {languages.map(lang => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => resetFileToBoilerplate?.(activeFile?.id)}
            disabled={!activeFile}
            className="px-2 py-1 text-sm font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Replace this language's code with the teacher-provided boilerplate"
          >
            Reset Code
          </button>

          {/* Settings */}
          <div className="relative">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
              title="Editor settings"
            >
              <CogIcon className="w-4 h-4" />
            </button>

            {showSettings && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <div className="p-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Font Size
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="24"
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-full"
                    />
                    <span className="text-xs text-gray-500">{fontSize}px</span>
                  </div>
                  
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Theme
                    </label>
                    <select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                      className="w-full text-xs border border-gray-300 rounded px-2 py-1"
                    >
                      {themes.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={addNewFile}
            className="flex items-center space-x-1 px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
            title="Add new file"
          >
            <DocumentPlusIcon className="w-4 h-4" />
            <span className="hidden sm:inline">New</span>
          </button>

          <button
            onClick={openFile}
            className="flex items-center space-x-1 px-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
            title="Add new file"
          >
            <DocumentIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Open</span>
          </button>
        </div>
      </div>

      {/* File tabs */}
      
      <EditorTabs
        files={files}
        activeFileId={activeFileId}
        setActiveFileId={setActiveFileId}
        onCloseFile={onCloseFile}
        setFiles={setFiles}
        onRenameFile={renameFile}
      />

      {/* Editor */}
      <div className="flex-1 relative min-h-[100px]">
        {activeFile ? (
          <MonacoEditor
            // Without a distinct `path`, @monaco-editor/react reuses ONE
            // shared text model for every file, and switching files just
            // diffs/replaces that shared model's content as a normal,
            // undoable edit (see its executeEdits + pushUndoStop call).
            // That means every file switch — and every question switch —
            // piles onto a single undo stack for the lifetime of the page,
            // so enough Ctrl+Z eventually walks back through unrelated
            // files/questions and dumps their old content into whatever tab
            // is currently open. Scoping `path` by question + file gives
            // each file its own model with its own independent undo
            // history (and, as a bonus, restores that file's own cursor/
            // undo state when you switch back to it — same as a real IDE).
            path={`${questionId ?? 'unknown-question'}::${activeFile.path || activeFile.id}`}
            language={activeFile.language}
            theme={theme}
            value={activeFile.code}
            options={editorOptions}
            overrideServices={editorOverrideServices}
            onChange={updateCode}
            onMount={(editor, monaco) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                onSave?.();
              });
              if (isExam) {
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC, () => {
                  const selection = editor.getSelection();
                  const model = editor.getModel();
                  if (selection && model) clipboardService.setInternalText(model.getValueInRange(selection));
                });
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX, () => {
                  const selection = editor.getSelection();
                  const model = editor.getModel();
                  if (!selection || !model || selection.isEmpty()) return;
                  clipboardService.setInternalText(model.getValueInRange(selection));
                  editor.executeEdits('exam-private-cut', [{ range: selection, text: '', forceMoveMarkers: true }]);
                });
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV, () => {
                  const selection = editor.getSelection();
                  const model = editor.getModel();
                  if (!selection || !model) return;
                  editor.executeEdits('exam-private-paste', [{
                    range: selection,
                    text: clipboardService.getInternalText(),
                    forceMoveMarkers: true,
                  }]);
                });
              }
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <CodeBracketIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No file selected</p>
              <button
                onClick={addNewFile}
                className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create New File
              </button>
            </div>
          </div>
        )}
      </div>

      <RunButtons
        onRun={onRun}
        onSubmit={onSubmit}
        isRunning={isRunning}
        isSubmitting={isSubmitting}
        activeFile={activeFile}
        showTerminal={showTerminal}
        setShowTerminal={setShowTerminal}
        onEvaluate={onEvaluate}
        isEvaluating={isEvaluating}
        isFreeCoding={isFreeCoding}
        isPractice={isPractice}
        alreadyPassed={alreadyPassed}
      />

      {/* Click outside to close settings */}
      {showSettings && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowSettings(false)}
        />
      )}

      {showTagModal && (
        <TagAssignmentModal
          tags={tags}
          files={files}
          tagToFileMap={tagToFileMap}
          setTagToFileMap={setTagToFileMap}
          onClose={() => setShowTagModal(false)}
        />
      )}
    </div>
    
  );
}
