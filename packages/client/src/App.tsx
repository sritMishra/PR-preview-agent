import { useEffect, useState } from 'react';

// Placeholder screen for Phase 0. It pings the server through the Vite proxy
// so we can confirm client → server wiring before any real UI exists.
export function App() {
  const [health, setHealth] = useState<string>('checking…');

  useEffect(() => {
    fetch('/api/health')
      .then(async (res) => {
        // A response arrived — the server (or proxy) IS reachable. Distinguish
        // a bad status (e.g. 404/500) from a healthy 200 before parsing JSON.
        if (!res.ok) {
          setHealth(`server: error (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        setHealth(data.ok ? 'server: ok' : 'server: not ok');
      })
      // .catch only fires for genuine network failures (nothing answered).
      .catch(() => setHealth('server: unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>PR Review Agent</h1>
      <p>Approval UI — coming in Phase 5.</p>
      <p>{health}</p>
    </main>
  );
}
