// Blocks until the dev Postgres accepts connections, so `db:migrate` never races
// the container's startup. Parses host/port out of DATABASE_URL.
import net from 'node:net';

const url = new URL(
  process.env.DATABASE_URL ?? 'postgresql://workshopos:workshopos@localhost:5433/workshopos',
);
const host = url.hostname;
const port = Number(url.port || 5432);
const deadline = Date.now() + 60_000;

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

while (Date.now() < deadline) {
  if (await tryConnect()) {
    console.log(`db ready at ${host}:${port}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

console.error(`db not reachable at ${host}:${port} after 60s`);
process.exit(1);
