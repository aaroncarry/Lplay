const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const startPort = Number(process.env.LPLAY_PORT || process.env.PORT || 5173);
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(root, "node_modules", "electron", "cli.js");

let viteProcess;
let electronProcess;
let shuttingDown = false;

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen({ host, port });
  });
}

async function findOpenPort() {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(`No open port found between ${startPort} and ${startPort + 49}.`);
}

function waitForHttp(url, timeoutMs = 30000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}.`));
          return;
        }

        setTimeout(tick, 250);
      });

      request.setTimeout(2000, () => {
        request.destroy();
      });
    };

    tick();
  });
}

function stopChild(child) {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopChild(electronProcess);
  stopChild(viteProcess);
  setTimeout(() => process.exit(code), 250);
}

async function main() {
  const port = await findOpenPort();
  const devServerUrl = `http://${host}:${port}`;
  const env = {
    ...process.env,
    VITE_DEV_SERVER_URL: devServerUrl
  };

  console.log(`[lplay] Starting Vite on ${devServerUrl}`);
  viteProcess = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port), "--strictPort"], {
    cwd: root,
    env,
    stdio: "inherit"
  });

  viteProcess.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[lplay] Vite exited with code ${code ?? 0}`);
      shutdown(code ?? 0);
    }
  });

  await waitForHttp(devServerUrl);

  console.log("[lplay] Opening Electron");
  electronProcess = spawn(process.execPath, [electronBin, "."], {
    cwd: root,
    env,
    stdio: "inherit"
  });

  electronProcess.on("exit", (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`[lplay] ${error.message}`);
  shutdown(1);
});
