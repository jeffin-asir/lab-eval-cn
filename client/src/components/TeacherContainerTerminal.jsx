import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { WS_BASE } from '../config';

// Uses the same xterm/FitAddon terminal stack as the student workspace, but
// connects to the teacher-only Docker shell endpoint.
export default function TeacherContainerTerminal({ containerId, shellUser = 'networklab' }) {
  const hostRef = useRef(null);

  useEffect(() => {
    if (!containerId || !hostRef.current) return undefined;
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, theme: { background: '#020617', foreground: '#e2e8f0' } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    const socket = new WebSocket(`${WS_BASE}/ws/docker-shell?containerId=${encodeURIComponent(containerId)}&shellUser=${encodeURIComponent(shellUser)}`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'data') terminal.write(message.data);
        if (message.type === 'error') terminal.writeln(`\r\n*** ${message.message} ***`);
        if (message.type === 'end') terminal.writeln('\r\n*** Shell closed ***');
      } catch { terminal.write(event.data); }
    };
    socket.onopen = () => socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(hostRef.current);
    return () => { observer.disconnect(); input.dispose(); resize.dispose(); socket.close(); terminal.dispose(); };
  }, [containerId, shellUser]);

  return <div ref={hostRef} className="h-[28rem] w-full rounded bg-slate-950 p-2" />;
}
