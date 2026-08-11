import React from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';

const SendModuleModal = ({
  isOpen,
  onClose,
  sessions,
  selectedSessionId,
  setSelectedSessionId,
  onSend,
  isLoading,
  moduleId,
  modules,
  activeAssignments = [],
  onClearAssignment,
  onClearAllAssignments,
}) => {
  if (!isOpen) return null;
  
  const selectedModule = moduleId && modules ? modules.find(m => m._id === moduleId) : null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-medium text-gray-900">Send Module to Students</h3>
        </div>
        
        <div className="px-6 py-4">
          {selectedModule && (
            <div className="mb-4">
              <p className="text-sm text-gray-500">Selected module:</p>
              <p className="font-medium">{selectedModule.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {selectedModule.questions.length} question{selectedModule.questions.length !== 1 ? 's' : ''}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Date {selectedModule.date ? new Date(selectedModule.date).toLocaleDateString() : '-'}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Batch {selectedModule.targetBatch || 'All'} · {selectedModule.startTime || '09:00'} – {selectedModule.endTime || '12:00'}
              </p>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-blue-50 rounded-md">
            <p className="text-sm text-blue-800">
              <span className="font-medium">Note:</span> This will make the module available to students in the configured batch during the scheduled time window ({selectedModule?.startTime || '09:00'} – {selectedModule?.endTime || '12:00'}).
            </p>
          </div>

          <div className="mt-4 border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 flex items-center justify-between">
              <p className="text-sm font-medium text-gray-800">Currently Active</p>
              {!!activeAssignments.length && (
                <button
                  type="button"
                  onClick={onClearAllAssignments}
                  disabled={isLoading}
                  className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                >
                  Clear all
                </button>
              )}
            </div>
            {activeAssignments.length ? (
              <div className="divide-y max-h-44 overflow-y-auto">
                {activeAssignments.map((assignment) => (
                  <div key={assignment._id} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{assignment.moduleName}</p>
                      <p className="text-xs text-gray-500">
                        {assignment.startTime && assignment.endTime
                          ? `${assignment.startTime} – ${assignment.endTime}`
                          : assignment.slotKey || '-'} · Batch {assignment.targetBatch || 'All'} · Ends {assignment.endsAt ? new Date(assignment.endsAt).toLocaleString() : '-'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onClearAssignment?.(assignment._id)}
                      disabled={isLoading}
                      className="shrink-0 px-2 py-1 rounded border border-red-200 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-3 py-4 text-sm text-gray-500">No active modules right now.</p>
            )}
          </div>
        </div>
        
        <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 border rounded-md text-gray-700 bg-white hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={isLoading}
            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Sending...
              </>
            ) : (
              <>
                <PaperAirplaneIcon className="h-4 w-4 mr-1" />
                Send to Students
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendModuleModal;
