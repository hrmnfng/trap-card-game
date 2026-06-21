/**
 * Free the ports the Playwright e2e suite owns (Expo web :8081, Worker :8787)
 * before a run. Playwright's `reuseExistingServer: true` will otherwise grab a
 * manual `expo start` / `wrangler dev` you left running — and a manual `expo
 * start` is built from apps/mobile/.env's LAN IP, not the e2e 127.0.0.1 override,
 * so every test fails at login with "Failed to fetch". Clearing the ports first
 * forces Playwright to start its own correctly-configured services.
 *
 * Runs as `pretest:e2e` (auto) and `npm run e2e:clean` (manual). Always exits 0
 * so it never blocks the test run.
 */
import { execSync } from 'node:child_process';

const PORTS = [8081, 8787];

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

if (process.platform === 'win32') {
  // Kill whatever holds the e2e ports, plus any stray expo/wrangler dev trees
  // (covers a wrangler that bound a random port instead of 8787). The CimInstance
  // pass excludes this PowerShell process itself, whose command line contains the
  // match pattern below — otherwise it would kill itself mid-cleanup.
  const ps = [
    `Get-NetTCPConnection -State Listen -EA SilentlyContinue | ? { $_.LocalPort -in ${PORTS.join(',')} } | % { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }`,
    "Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'expo start|wrangler dev' -and $_.ProcessId -ne $PID -and $_.Name -ne 'powershell.exe' } | % { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }",
  ].join('; ');
  run(`powershell -NoProfile -NonInteractive -Command "${ps}"`);
} else {
  // macOS/Linux: free the ports via lsof.
  const killed = [];
  for (const port of PORTS) {
    const pids = run(`lsof -ti tcp:${port}`).split('\n').filter(Boolean);
    for (const pid of pids) {
      run(`kill -9 ${pid}`);
      killed.push(pid);
    }
  }
  console.log(killed.length ? `Killed PIDs: ${[...new Set(killed)].join(', ')}` : 'No e2e dev servers were running.');
}

console.log(`Freed e2e ports ${PORTS.join(', ')}.`);
