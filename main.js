const { app, BrowserWindow, session, desktopCapturer, shell, ipcMain } = require('electron');
const { autoUpdater } = require("electron-updater");
const axios = require('axios');
const net = require('net');

const PROXY_PORT = 12345;
const dnsCache = {};

// Donanım ve Medya Bayrakları
app.commandLine.appendSwitch('enable-media-stream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns');

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

function createWindow() {
    const currentVersion = app.getVersion();
    
    const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#292b2f', //beyaz ekran sorunu fix
    show: false,
    paintWhenInitiallyHidden: true,
    title: `Cordiss v${currentVersion}`,
    icon: __dirname + '/icon.ico',
    autoHideMenuBar: true,
    webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: __dirname + '/preload.js'
        }
    });

    //beyaz ekran sorunu fix
    win.loadURL(`data:text/html,
    <style>
    body{
        margin:0;
        background:#292b2f;
    }
    </style>
    <body></body>
    `);

    //beyaz ekran sorunu fix
    win.once('ready-to-show', () => {
        win.show();
    });


    // Discord başlığı değiştirmeye çalışırsa engelle ve kendi başlığımızı koru
    win.on('page-title-updated', (e) => {
        e.preventDefault();
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (!url.startsWith('https://discord.com/')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allow = ['media', 'audioCapture', 'videoCapture', 'notifications', 'display-capture'];
        callback(allow.includes(permission));
    });

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
            callback({ video: sources[0], audio: 'loopback' });
        });
    });

    session.defaultSession.setProxy({
        proxyRules: `http://127.0.0.1:${PROXY_PORT}`,
        proxyBypassRules: '<local>'
    }).then(() => {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        win.loadURL('https://discord.com/app', { userAgent: userAgent });
    });

    // Destek butonu CSS ve JS
    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(`
            #cordiss-support-btn { position: relative; display: flex; justify-content: center; width: 72px; margin-bottom: 8px; }
            #cordiss-support-pill {
                position: absolute; left: 0; top: 50%; transform: translateY(-50%);
                width: 4px; height: 0px; background-color: white;
                border-radius: 0 4px 4px 0; transition: height 0.2s ease;
            }
            #cordiss-support-btn:hover #cordiss-support-pill { height: 20px; }
            .cordiss-tooltip {
                position: absolute; left: 80px; top: 50%; transform: translateY(-50%);
                background-color: #111214; color: #dbdee1; padding: 8px 12px;
                border-radius: 8px; font-family: sans-serif; font-size: 14px; font-weight: bold;
                white-space: nowrap; pointer-events: none; opacity: 0;
                transition: opacity 0.1s, transform 0.1s;
                box-shadow: 0 4px 10px rgba(0,0,0,0.3); z-index: 1000;
            }
            #cordiss-support-btn:hover .cordiss-tooltip { opacity: 1; transform: translateY(-50%) translateX(5px); }
            div[class*="listItem"]:has([aria-label*="Download"]) { display: none !important; }
        `);

        win.webContents.executeJavaScript(`
            (function() {
                const injectButtons = () => {
                    if (document.getElementById('cordiss-support-btn')) return;
                    const separator = document.querySelector('.guildSeparator__252b6')?.parentElement;
                    if (!separator) return;

                    const supContainer = document.createElement('div');
                    supContainer.id = 'cordiss-support-btn';
                    supContainer.className = 'listItem__650eb';
                    supContainer.innerHTML = \`
                        <div id="cordiss-support-pill"></div>
                        <div class="cordiss-tooltip">Destek Sunucusu</div>
                        <div class="listItemWrapper__91816">
                            <div style="width: 40px; height: 40px; cursor: pointer; background-color: #23a559; color: white; display: flex; align-items: center; justify-content: center; border-radius: 12px; transition: 0.2s;" onmouseover="this.style.borderRadius='30%'" onmouseout="this.style.borderRadius='50%'">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm1 15h-2v-2h2v2zm1.007-5.541l-.81.682c-.628.53-1.197 1.259-1.197 2.859h-2c0-2.031.905-3.328 1.959-4.216l.813-.685C12.443 9.534 13 9.135 13 8.5c0-.827-.673-1.5-1.5-1.5S10 7.673 10 8.5H8c0-1.93 1.57-3.5 3.5-3.5S15 6.57 15 8.5c0 1.206-.671 2.051-1.993 2.959z"/></svg>
                            </div>
                        </div>\`;
                    supContainer.onclick = () => { window.location.href = 'https://discord.gg/UQSSTUytjt'; };
                    separator.insertAdjacentElement('afterend', supContainer);
                };
                const observer = new MutationObserver(() => injectButtons());
                observer.observe(document.body, { childList: true, subtree: true });
                injectButtons();
            })();
        `);
    });
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {

    // Zaten açıksa yeni açılanı kapat
    app.quit();

} else {

    app.on('second-instance', () => {

        // Açık olan pencereyi öne getir
        const allWindows = BrowserWindow.getAllWindows();

        if (allWindows.length > 0) {

            const win = allWindows[0];

            if (win.isMinimized())
                win.restore();

            win.focus();
        }
    });

}
// --- APP OLAYLARI VE GÜNCELLEME ---
app.whenReady().then(() => {
    createWindow();
    autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.on('update-downloaded', () => {
    const updateWin = new BrowserWindow({
        width: 440,
        height: 250,
        alwaysOnTop: true,
        frame: false, // Kenarlıkları kaldırır
        transparent: true, // Köşeleri yumuşatmak için transparan zemin
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    updateWin.center();

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    font-family: 'gg sans', 'Noto Sans', sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background: rgba(0, 0, 0, 0); /* Ana pencere şeffaf */
                }
                .container {
                    width: 400px;
                    background-color: #313338; /* Discord koyu gri */
                    color: #f2f3f5;
                    border-radius: 8px;
                    box-shadow: 0 8px 16px rgba(0,0,0,0.4);
                    position: relative;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    animation: fadeIn 0.3s ease-out;
                    -webkit-app-region: drag; /* Pencereyi taşınabilir yapar */
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .close-btn {
                    position: absolute;
                    top: 12px;
                    right: 12px;
                    cursor: pointer;
                    color: #b5bac1;
                    transition: color 0.2s;
                    -webkit-app-region: no-drag;
                }
                .close-btn:hover { color: #ffffff; }
                h3 {
                    margin: 0 0 12px 0;
                    font-size: 20px;
                    color: #ffffff;
                }
                p {
                    font-size: 15px;
                    line-height: 20px;
                    color: #dbdee1;
                    margin-bottom: 28px;
                }
                .footer {
                    display: flex;
                    justify-content: flex-end;
                    gap: 12px;
                    -webkit-app-region: no-drag;
                }
                button {
                    padding: 10px 24px;
                    border-radius: 3px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background-color 0.2s, transform 0.1s;
                    border: none;
                }
                .btn-install {
                    background-color: #5865f2; /* Discord Blurple */
                    color: white;
                }
                .btn-install:hover { background-color: #4752c4; }
                .btn-install:active { transform: scale(0.96); }
                .btn-later {
                    background-color: transparent;
                    color: white;
                }
                .btn-later:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="close-btn" onclick="window.close()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </div>
                <h3>Yeni Güncelleme Hazır!</h3>
                <p>Cordiss'in yeni sürümü indirildi. Yenilikleri görmek için şimdi kurup yeniden başlatabilirsiniz.</p>
                <div class="footer">
                    <button class="btn-later" onclick="window.close()">Daha Sonra</button>
                    <button class="btn-install" onclick="install()">Şimdi Kur</button>
                </div>
            </div>

            <script>
                const { ipcRenderer } = require('electron');
                function install() { 
                    ipcRenderer.send('quit-and-install'); 
                }
            </script>
        </body>
        </html>
    `;

    updateWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
});

ipcMain.on('quit-and-install', () => {
    autoUpdater.quitAndInstall();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});