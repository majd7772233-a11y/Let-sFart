import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket as WsNodeSocket } from 'ws';
import { extractLocalWsUpgrade } from './env.ts';
import { createLocalWorkerEnv, type LocalWebSocket } from './local/nodeDoRuntime.ts';
import { routeWorkerRequest } from './router.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function toWebRequest(req: express.Request | http.IncomingMessage): Promise<Request> {
  const host = req.headers.host || `localhost:${PORT}`;
  const url = `http://${host}${req.url || '/'}`;
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (Array.isArray(val)) {
      for (const item of val) headers.append(key, item);
    } else if (typeof val === 'string') {
      headers.set(key, val);
    }
  }

  const method = req.method || 'GET';
  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  return new Request(url, {
    method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
  });
}

function bridgeBrowserWsToLocalPair(browserWs: WsNodeSocket, clientPairSocket: LocalWebSocket): void {
  clientPairSocket.addEventListener('message', (ev) => {
    if (browserWs.readyState === browserWs.OPEN) {
      const msgEv = ev as MessageEvent;
      browserWs.send(msgEv.data);
    }
  });

  clientPairSocket.addEventListener('close', (ev) => {
    const closeEv = ev as CloseEvent;
    if (browserWs.readyState === browserWs.OPEN || browserWs.readyState === browserWs.CONNECTING) {
      browserWs.close(closeEv.code || 1000, closeEv.reason || '');
    }
  });

  browserWs.on('message', (data, isBinary) => {
    let payload: string | ArrayBuffer;
    if (!isBinary) {
      payload = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString('utf8')
            : String(data);
    } else if (data instanceof ArrayBuffer) {
      payload = data;
    } else if (Array.isArray(data)) {
      payload = new Uint8Array(Buffer.concat(data)).slice().buffer;
    } else if (Buffer.isBuffer(data)) {
      payload = new Uint8Array(data).slice().buffer;
    } else {
      payload = String(data);
    }
    clientPairSocket.send(payload);
  });

  browserWs.on('close', (code, reasonBuf) => {
    clientPairSocket.close(code || 1000, reasonBuf?.toString() || '');
  });

  browserWs.on('error', () => {
    clientPairSocket.close(1011, 'WS_ERROR');
  });
}

async function startLocalServer(): Promise<void> {
  const { env } = createLocalWorkerEnv();
  const app = express();

  // Route API & internal block paths directly through the Cloudflare Worker router
  app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/internal' || req.path.startsWith('/internal/')) {
      try {
        const webReq = await toWebRequest(req);
        const workerRes = await routeWorkerRequest(webReq, env);
        res.status(workerRes.status);
        workerRes.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        const text = await workerRes.text();
        res.send(text);
      } catch (err) {
        console.error('Worker route error:', err);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'خطأ في الخادم المحلي.' } });
      }
      return;
    }
    next();
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: PROJECT_ROOT,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(PROJECT_ROOT, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const urlPath = (req.url || '').split('?')[0];
    if (!urlPath.startsWith('/ws/')) {
      socket.destroy();
      return;
    }

    try {
      const webReq = await toWebRequest(req);
      const workerRes = await routeWorkerRequest(webReq, env);
      const upgrade = extractLocalWsUpgrade(workerRes);

      if (!upgrade) {
        const body = await workerRes.text();
        socket.write(
          `HTTP/1.1 ${workerRes.status} Error\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${body}`,
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (browserWs) => {
        bridgeBrowserWsToLocalPair(browserWs, upgrade.webSocket as unknown as LocalWebSocket);
      });
    } catch {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Crazy Raft Worker/DO local server listening on http://localhost:${PORT}`);
  });
}

startLocalServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
