// Player-2 helper for the on-device test gate. Runs on the CI host (Node, which
// has crypto/EventTarget so partysocket works). Registers a second user, creates
// the lobby (becoming owner), prints `LOBBY_CODE=<code>` for the workflow to
// capture, then — once the device (player 1) has joined — starts the game and
// stays connected so the in-progress game persists while the device plays.
import PartySocket from 'partysocket';

const API = process.env.PLAYER2_API_BASE ?? 'http://127.0.0.1:8787';
const HOST = process.env.PLAYER2_PARTY_HOST ?? '127.0.0.1:8787';
const username = process.env.PLAYER2_USER ?? `p2_${Date.now().toString(36)}`;
const password = 'password1';

async function main() {
  const reg = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!reg.ok) throw new Error(`register failed: HTTP ${reg.status}`);
  const { userId, token } = await reg.json();

  const lob = await fetch(`${API}/api/lobbies`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!lob.ok) throw new Error(`createLobby failed: HTTP ${lob.status}`);
  const { code } = await lob.json();

  // The workflow greps this exact line to pass the code to Maestro.
  console.log(`LOBBY_CODE=${code}`);

  const socket = new PartySocket({
    host: HOST,
    party: 'lobby',
    room: code,
    query: { playerId: userId, username },
  });

  let started = false;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'get_state' }));
  });
  socket.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'state_update' && !started) {
      const players = msg.state?.players ?? [];
      if (players.length >= 2) {
        started = true;
        socket.send(JSON.stringify({ type: 'start_game' }));
        console.log('player2: sent start_game');
      }
    }
  });

  // Keep the process (and the WS) alive until the workflow kills it.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
