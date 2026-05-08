const { app, BrowserWindow, session, desktopCapturer, shell } = require('electron');
const axios = require('axios');
const net = require('net');

const PROXY_PORT = 12345;
const dnsCache = {};

// 1. ADIM: Donanım ve Medya Bayrakları
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

// DNS Çözümleyici (DoH)
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

// Lokal Proxy Sunucusu
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
            clientSocket.on('error', () => serverSocket.destroy());
        }
    });
});
server.listen(PROXY_PORT, '127.0.0.1');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Cordiss",
        icon: __dirname + '/icon.ico',
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // --- Linklerin Tarayıcıda Açılması ---
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('https://discord.com/')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    // --- İzinler ---
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allow = ['media', 'audioCapture', 'videoCapture', 'notifications', 'display-capture'];
        if (allow.includes(permission)) {
            callback(true);
        } else {
            callback(false);
        }
    });

    // --- Ekran Paylaşımı ---
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            callback({ video: sources[0], audio: 'loopback' });
        });
    });

    // --- Proxy ve Yükleme ---
    session.defaultSession.setProxy({
        proxyRules: `http://127.0.0.1:${PROXY_PORT}`,
        proxyBypassRules: '<local>'
    }).then(() => {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        win.loadURL('https://discord.com/app', { userAgent: userAgent });
    });

    // --- CSS Temizliği (Hatanın olduğu yer burasıydı, fonksiyonun içine aldım) ---
    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(`
            div[class*="listItem"]:has([aria-label*="Download"]),
            div[class*="listItem"]:has([data-list-item-id*="app-download"]),
            [aria-label*="Download Apps"] {
                display: none !important;
            }
            div[class*="tooltip"]:has([class*="tooltipContent"]:-webkit-any-closest([aria-label*="Download"])),
            div[class*="tooltip"]:has([class*="tooltipContent"]:-webkit-any-closest([data-list-item-id*="app-download"])) {
                display: none !important;
            }
            [class*="browserPlatformNotice"], [class*="downloadAppButton"], [class*="notice"] a[href*="/download"] { 
                display: none !important; 
            }
        `);
    });

    win.webContents.on('did-fail-load', (e, code, desc) => {
        console.log(`Hata: ${desc} (${code})`);
    });
}

// Uygulamayı Başlat
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});