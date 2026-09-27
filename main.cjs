// MD Reader — Electron main process
// Serves the built React app (dist/) from a local HTTP server so that
// fetch() (docs manifest & bundled docs) works, then opens a native window.
const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        const filePath = path.join(DIST_DIR, urlPath);
        if (!filePath.startsWith(DIST_DIR)) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            // SPA fallback: unknown paths get index.html
            fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, html) => {
              if (e2) {
                res.writeHead(404).end('Not found');
              } else {
                res.writeHead(200, { 'Content-Type': MIME['.html'] });
                res.end(html);
              }
            });
            return;
          }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
          res.end(data);
        });
      } catch {
        res.writeHead(500).end();
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    title: 'MD Reader',
    backgroundColor: '#faf8f1', // 与亮色主题纸黄底色一致，避免启动白闪
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.center();
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  // Open external links in the system browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const server = await serveDist();
    const { port } = server.address();
    createWindow(port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
