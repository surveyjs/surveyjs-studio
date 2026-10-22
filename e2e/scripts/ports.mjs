// Port check of the e2e runners: Playwright is told never to reuse a server, so a port that is
// taken (a forgotten demo server, a dev server) must stop the run with a clear message first.
import { spawnSync } from "node:child_process";
import { connect } from "node:net";

/** Whether something accepts connections on the port, on either loopback address. */
function isListening(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = connect({ port, host });
      const done = (listening) => {
        socket.destroy();
        resolve(listening);
      };
      socket.setTimeout(1000, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([tryHost("127.0.0.1"), tryHost("::1")]).then((answers) =>
    answers.some(Boolean),
  );
}

const run = (command, args) =>
  spawnSync(command, args, { encoding: "utf8", timeout: 5000, windowsHide: true });

/** The PID that listens on the port, or null when it cannot be found. */
function listeningPid(port) {
  if (process.platform === "win32") {
    const result = run("netstat", ["-ano", "-p", "tcp"]);
    for (const line of (result.stdout ?? "").split(/\r?\n/)) {
      const cells = line.trim().split(/\s+/);
      if (cells[3] === "LISTENING" && cells[1]?.endsWith(`:${port}`)) return Number(cells[4]);
    }
    return null;
  }
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const pid = Number((result.stdout ?? "").split("\n")[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** The program name of the process (no path, no arguments), or null. */
function programName(pid) {
  const result =
    process.platform === "win32"
      ? run("powershell", [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).ProcessName`,
        ])
      : run("ps", ["-p", String(pid), "-o", "comm="]);
  const name = (result.stdout ?? "").trim().split(/[\\/]/).pop() ?? "";
  return /^[\w.+ -]{1,64}$/.test(name) ? name : null;
}

/**
 * `node (PID 123)` for whatever listens on the port; null when unknown. Never a command line:
 * arguments can hold secrets, and this text goes to terminals and CI logs.
 */
function ownerOf(port) {
  try {
    const pid = listeningPid(port);
    if (pid === null) return null;
    const name = programName(pid);
    return name === null ? `PID ${pid}` : `${name} (PID ${pid})`;
  } catch {
    return null;
  }
}

/**
 * The ports that something listens on, with its program name and PID (`null` when it cannot be
 * found). An empty array means every port is free.
 */
export async function checkPorts(ports) {
  const busy = [];
  for (const port of ports) {
    if (await isListening(port)) busy.push({ port, owner: ownerOf(port) });
  }
  return busy;
}

/** `Port 3000 is in use by node (PID 123). Stop it and run again.` */
export function busyMessage({ port, owner }) {
  return `Port ${port} is in use${owner === null ? "" : ` by ${owner}`}. Stop it and run again.`;
}

/** Exits 1 with the message of the first busy port; returns when all are free. */
export async function requireFreePorts(ports) {
  const [first] = await checkPorts(ports);
  if (first) {
    console.error(busyMessage(first));
    process.exit(1);
  }
}
