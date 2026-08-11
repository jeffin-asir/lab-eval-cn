import { PaperAirplaneIcon, PencilIcon } from '@heroicons/react/24/outline';

const ModuleTable = ({ 
  modules, 
  isLabSession, 
  editModule, 
  deleteModule, 
  openSendModuleModal, 
  quickUpdateModule 
}) => {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full bg-white">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Module Name</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lab ID</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Max Marks</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time Window</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            {isLabSession && (
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lab Actions</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {modules.map((m) => (
            <tr key={m._id}>
              <td className="px-6 py-4 whitespace-nowrap">{m.name}</td>
              <td className="px-6 py-4 whitespace-nowrap">{m.lab}</td>
              <td className="px-6 py-4 whitespace-nowrap">
                {m.date ? new Date(m.date).toLocaleDateString() : '-'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                {m.questions.length} question{m.questions.length !== 1 ? 's' : ''}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">{m.maxMarks || '-'}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                {m.targetBatch || 'All'} · {m.startTime || '09:00'} – {m.endTime || '12:00'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <button
                  onClick={() => editModule(m)}
                  className="text-indigo-600 hover:text-indigo-900 mr-2"
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteModule(m._id)}
                  className="text-red-600 hover:text-red-900 ml-2"
                >
                  Delete
                </button>
              </td>
              {isLabSession && (
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => openSendModuleModal(m._id)}
                    className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200 px-3 py-1 rounded-full flex items-center mr-2"
                  >
                    <PaperAirplaneIcon className="h-4 w-4 mr-1" />
                    Send to Students
                  </button>
                  
                  <div className="flex mt-1">
                    <button
                      onClick={() => {
                        const title = prompt("Update module title:", m.name);
                        if (title && title !== m.name) {
                          quickUpdateModule(m._id, { name: title });
                        }
                      }}
                      className="text-gray-600 hover:text-gray-900 flex items-center text-xs mr-3"
                    >
                      <PencilIcon className="h-3 w-3 mr-1" />
                      Quick Edit
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ModuleTable;
