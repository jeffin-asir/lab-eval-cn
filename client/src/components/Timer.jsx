import { useState, useEffect, useRef } from 'react';

// `endsAt` and `serverTime` are returned together by the API.  We use the
// browser's monotonic clock only to advance that server-time snapshot, so
// changing the computer's date/time cannot change when the test expires.
export default function Timer({ duration, totalDuration, endsAt, serverTime, onExpire }) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const deadline = endsAt ? new Date(endsAt).getTime() : null;
    const serverNow = serverTime ? new Date(serverTime).getTime() : null;
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const getRemainingSeconds = () => {
      if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return Math.max(0, duration || 0);
      const currentTick = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const currentServerTime = serverNow + (currentTick - startedAt);
      return Math.max(0, Math.ceil((deadline - currentServerTime) / 1000));
    };

    setTimeLeft(getRemainingSeconds());
    const timer = window.setInterval(() => setTimeLeft(getRemainingSeconds()), 250);
    return () => window.clearInterval(timer);
  }, [duration, endsAt, serverTime]);

  useEffect(() => {
    if (timeLeft <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      onExpire?.();
    }
  }, [timeLeft, onExpire]);

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getColorClass = () => {
    if (timeLeft <= 300) return 'text-red-600 font-bold animate-pulse'; // 5 minutes
    if (timeLeft <= 900) return 'text-orange-600 font-black'; // 15 minutes
    return 'text-gray-700 font-bold';
  };

  const getProgressPercentage = () => {
    const total = totalDuration || duration || 1;
    return Math.max(0, Math.min(100, (Math.max(0, timeLeft) / total) * 100));
  };

  const getProgressColor = () => {
    if (timeLeft <= 300) return 'from-red-500 to-red-600';
    if (timeLeft <= 900) return 'from-orange-500 to-orange-600';
    return 'from-blue-500 to-indigo-600';
  };

  return (
    <div className="flex items-center space-x-3">
      <div className={`text-md font-mono ${getColorClass()} select-none`}>
        {formatTime(timeLeft)}
      </div>
      
      {/* progress indicator */}
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden shadow-inner">
        <div 
          className={`h-full transition-all duration-1000 ease-out bg-gradient-to-r ${getProgressColor()} relative overflow-hidden`}
          style={{ width: `${getProgressPercentage()}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
        </div>
      </div>
      
      {/* Time status indicator */}
      <div className={`w-3 h-3 rounded-full ${
        timeLeft <= 300 ? 'bg-red-500 animate-pulse' :
        timeLeft <= 900 ? 'bg-orange-500' : 'bg-green-500'
      }`}></div>
    </div>
  );
}
