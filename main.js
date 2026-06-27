const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain } = require('electron');
const { autoUpdater } = require("electron-updater");
const axios = require('axios');
const net = require('net');
const os = require('os');
const path = require('path');

const platform = os.platform();
const PROXY_PORT = 12345;
const dnsCache = {};

// --- DONANIM VE MEDYA BAYRAKLARI ---
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

// ==========================================
// --- 1. PROXY VE DNS SİSTEMİ (DOKUNULMADI) ---
// ==========================================
async function resolveIP(hostname) {
    if (dnsCache[hostname]) return dnsCache[hostname];
    try {
        const response = await axios.get(`https://1.1.1.1/dns-query?name=${hostname}&type=A`, {
            headers: { 'accept': 'application/dns-json' },
            timeout: 3000
        });
        if (response.data && response.data.Answer) {
            const ip = response.data.Answer.find(ans => ans.type === 1)?.data;
            if (ip) {
                dnsCache[hostname] = ip;
                return ip;
            }
        }
    } catch (err) { return hostname; }
}

const server = net.createServer((clientSocket) => {
    clientSocket.once('data', async (data) => {
        const dataStr = data.toString();
        if (dataStr.startsWith('CONNECT')) {
            const hostPort = dataStr.split(' ')[1];
            const [host, port] = hostPort.split(':');
            const targetIP = await resolveIP(host);
            const isDiscord = /discord|discordapp|discord\.gg|dis\.gd/.test(host);

            const serverSocket = net.connect(port || 443, targetIP, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (isDiscord) {
                    clientSocket.on('data', (chunk) => {
                        if (chunk[0] === 0x16 && chunk[1] === 0x03) {
                            serverSocket.write(chunk.slice(0, 1));
                            setTimeout(() => { serverSocket.write(chunk.slice(1)); }, 15);
                        } else { serverSocket.write(chunk); }
                    });
                } else { clientSocket.pipe(serverSocket); }
            });
            serverSocket.on('data', (chunk) => clientSocket.write(chunk));
            serverSocket.on('error', () => clientSocket.destroy());
            serverSocket.on('error', () => serverSocket.destroy());
            clientSocket.on('error', () => serverSocket.destroy());
        }
    });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
    console.log('Proxy server started');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('Proxy zaten çalışıyor.');
    } else {
        console.error(err);
    }
});

// ==========================================
// --- 2. DİSCORD PENCERESİ (SAF, ENJEKSİYONSUZ) ---
// ==========================================
function createWindow() {
    const currentVersion = app.getVersion();

    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#292b2f', // Beyaz ekran sorunu fix
        show: false,
        paintWhenInitiallyHidden: true,
        title: `Cordiss v${currentVersion}`,
        icon: path.join(__dirname, 'icon.png'),
                                  webPreferences: {
                                      nodeIntegration: false,
                                      contextIsolation: true,
                                      // DİKKAT: Artık Discord içine preload.js GÖNDERMİYORUZ.
                                      // Çünkü Discord'a hiçbir şekilde müdahale etmiyoruz.
                                  }
    });

    // Menü çubuğunu (File, Edit, Help) KÖKTEN Kapatır. Alt/Ctrl basılsa da açılmaz.
    win.setMenu(null);

    // Beyaz ekran sorunu fix için ara yükleme
    win.loadURL(`data:text/html,
                <style>body{margin:0; background:#292b2f;}</style><body></body>
                `);

    win.once('ready-to-show', () => {
        win.show();
    });

    // Discord başlığı değiştirmeye çalışırsa engelle ve kendi başlığımızı koru
    win.on('page-title-updated', (e) => {
        e.preventDefault();
    });

    // Sadece Discord linklerine izin ver, diğerlerini varsayılan tarayıcıda aç
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('https://discord.com/')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // İzinler (Kamera, Mikrofon, Ekran Paylaşımı)
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allow = ['media', 'audioCapture', 'videoCapture', 'notifications', 'display-capture'];
        callback(allow.includes(permission));
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            callback({ video: sources[0], audio: 'loopback' });
        });
    });

    // Proxy ve User-Agent Ayarları
    session.defaultSession.setProxy({
        proxyRules: `http://127.0.0.1:${PROXY_PORT}`,
        proxyBypassRules: '<local>'
    }).then(() => {
        let userAgent;
        if (platform === 'win32') {
            userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
        } else if (platform === 'linux') {
            userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36';
        } else {
            userAgent = 'Mozilla/5.0';
        }
        session.defaultSession.setUserAgent(userAgent);
        win.loadURL('https://discord.com/app', { userAgent });
    });

    // NOT: Önceden burada olan CSS ve JS (Destek butonu) enjeksiyonları tamamen SİLİNDİ.
}

// ==========================================
// --- 3. UYGULAMA TEKİL ÇALIŞTIRMA KİLİDİ ---
// ==========================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
            const win = allWindows[0];
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });
}

// ==========================================
// --- 4. APP OLAYLARI VE GÜNCELLEME SİSTEMİ ---
// ==========================================
app.whenReady().then(() => {
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();
});

// Güncelleme İndirildiğinde Ayrı Bir Pencere Açılır (Discord bu pencereyi GÖREMEZ)
autoUpdater.on('update-downloaded', () => {
    const updateWin = new BrowserWindow({
        width: 440,
        height: 250,
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        resizable: false,
        webPreferences: {
            nodeIntegration: false, // Güvenlik için kapatıldı
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js') // Preload artık sadece güncelleyici için kullanılıyor
        }
    });

    updateWin.center();

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
    <style>
    body {
        margin: 0; padding: 0; font-family: 'gg sans', 'Noto Sans', sans-serif;
        display: flex; justify-content: center; align-items: center;
        height: 100vh; background: rgba(0, 0, 0, 0);
    }
    .container {
        width: 400px; background-color: #313338; color: #f2f3f5;
        border-radius: 8px; box-shadow: 0 8px 16px rgba(0,0,0,0.4);
        position: relative; padding: 24px; display: flex; flex-direction: column;
        -webkit-app-region: drag;
    }
    .close-btn {
        position: absolute; top: 12px; right: 12px; cursor: pointer; color: #b5bac1;
        -webkit-app-region: no-drag;
    }
    .close-btn:hover { color: #ffffff; }
    h3 { margin: 0 0 12px 0; font-size: 20px; }
    p { font-size: 15px; color: #dbdee1; margin-bottom: 28px; }
    .footer { display: flex; justify-content: flex-end; gap: 12px; -webkit-app-region: no-drag; }
    button { padding: 10px 24px; border-radius: 3px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
    .btn-install { background-color: #5865f2; color: white; }
    .btn-install:hover { background-color: #4752c4; }
    .btn-later { background-color: transparent; color: white; }
    .btn-later:hover { text-decoration: underline; }
    </style>
    </head>
    <body>
    <div class="container">
    <div class="close-btn" onclick="window.electronAPI.closeWindow()">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </div>
    <h3>Yeni Güncelleme Hazır!</h3>
    <p>Cordiss'in yeni sürümü indirildi. Yenilikleri görmek için şimdi kurup yeniden başlatabilirsiniz.</p>
    <div class="footer">
    <button class="btn-later" onclick="window.electronAPI.closeWindow()">Daha Sonra</button>
    <button class="btn-install" onclick="window.electronAPI.quitAndInstall()">Şimdi Kur</button>
    </div>
    </div>
    </body>
    </html>
    `;

    updateWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
});

// Güncelleme penceresinden gelen sinyaller
ipcMain.on('quit-and-install', () => {
    autoUpdater.quitAndInstall();
});

ipcMain.on('close-update-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
