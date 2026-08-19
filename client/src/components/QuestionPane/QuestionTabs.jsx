import { 
  DocumentTextIcon,
  BeakerIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { TabButton } from '../FormComponents';

export default function QuestionTabs({ activeTab, setActiveTab, question, hideSubmissions = false, isFreeCoding = false }) {
  const tabs = [
    {
      id: 'description',
      label: 'Description',
      icon: <DocumentTextIcon className="w-4 h-4" />
    },
    {
      id: 'precode',
      label: 'Pre-Code',
      icon: <BeakerIcon className="w-4 h-4" />
    },
    ...(!isFreeCoding ? [{
      id: 'testcases',
      label: 'Test Cases',
      icon: <BeakerIcon className="w-4 h-4" />,
      badge: question?.testcases
        ? Object.keys(question.testcases).length
        : (Array.isArray(question?.testCases)
          ? question.testCases.length
          : ((question?.testCases?.server?.length || 0) +
             (question?.testCases?.client?.length || 0)))
    }] : []),
    ...(!hideSubmissions ? [{
      id: 'submissions',
      label: 'Submissions',
      icon: <ClockIcon className="w-4 h-4" />
    }] : [])
  ];

  return (
    <div className="relative bg-gray-100">
      <div className="flex relative">
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            curved={true}
          >
            <div className="flex items-center space-x-2">
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="bg-indigo-100 text-indigo-600 text-xs px-2 py-1 rounded-full font-semibold">
                  {tab.badge}
                </span>
              )}
            </div>
          </TabButton>
        ))}
      </div>
    </div>
  );
}
