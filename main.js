const { app, BrowserWindow, ipcMain, dialog, protocol, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec, spawn } = require('child_process');
const express = require('express');

let mainWindow;
let wallpaperWindow;
let tray = null;
const mediaPort = 3344;
const liveDir = path.join(__dirname, 'live');

// Start Local Media Server
function startMediaServer() {
    const server = express();
    server.use('/', express.static(liveDir));
    server.listen(mediaPort, () => {
        console.log(`[MediaServer] Serving live wallpaper assets at http://localhost:${mediaPort}`);
    });
}

function createWindows() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    mainWindow = new BrowserWindow({
        width: 1000,
        height: 600,
        show: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
        resizable: false,
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'assets', 'icon.png')
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        mainWindow.hide();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });

    const display = screen.getPrimaryDisplay();
    wallpaperWindow = new BrowserWindow({
        width: display.bounds.width,
        height: display.bounds.height,
        x: 0,
        y: 0,
        show: false,
        frame: false,
        transparent: false,
        type: 'desktop',
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        },
    });

    wallpaperWindow.loadFile('wallpaper.html');

    wallpaperWindow.on('ready-to-show', () => {
        setupWallpaperWindow();
    });
}

function createTray() {
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Control Panel', click: () => {
                mainWindow.show();
                mainWindow.restore();
                mainWindow.focus();
            }
        },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Live Wallpaper Pro');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        mainWindow.show();
        mainWindow.restore();
        mainWindow.focus();
    });
}

function setupWallpaperWindow() {
    if (process.platform !== 'win32') {
        wallpaperWindow.show();
        return;
    }

    const hwnd = wallpaperWindow.getNativeWindowHandle().readInt32LE(0);

    const psScript = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
}
"@
Add-Type -TypeDefinition $code
$progman = [Win32]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[Win32]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result)

$workerw = [IntPtr]::Zero
[Win32]::EnumWindows({
    param($hwnd, $lparam)
    $shell = [Win32]::FindWindowEx($hwnd, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
    if ($shell -ne [IntPtr]::Zero) {
        $script:workerw = [Win32]::FindWindowEx([IntPtr]::Zero, $hwnd, "WorkerW", $null)
    }
    return $true
}, [IntPtr]::Zero)

if ($workerw -ne [IntPtr]::Zero) {
    [Win32]::SetParent([IntPtr]${hwnd}, $workerw)
} else {
    [Win32]::SetParent([IntPtr]${hwnd}, $progman)
}
`;

    try {
        const scriptPath = path.join(app.getPath('temp'), 'attach_wallpaper.ps1');
        fs.writeFileSync(scriptPath, psScript);
        const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath]);

        child.on('exit', () => {
            wallpaperWindow.show();
        });

        child.on('error', (err) => {
            console.error('PowerShell spawn error:', err);
            wallpaperWindow.show();
        });
    } catch (e) {
        console.error('Failed to attach wallpaper window:', e);
        wallpaperWindow.show();
    }
}

app.whenReady().then(async () => {
    await fs.ensureDir(liveDir);
    startMediaServer();
    createWindows();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindows();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

async function getSettings() {
    try {
        if (await fs.pathExists(settingsPath)) {
            return await fs.readJson(settingsPath);
        }
    } catch (e) { console.error(e); }
    return { startup: false, blur: 0 };
}

async function saveSettings(settings) {
    try {
        await fs.writeJson(settingsPath, settings);
        app.setLoginItemSettings({
            openAtLogin: settings.startup,
            path: app.getPath('exe')
        });
    } catch (e) { console.error(e); }
}

// IPC Communication
ipcMain.on('set-wallpaper', async (event, item) => {
    const settings = await getSettings();
    if (wallpaperWindow) {
        wallpaperWindow.webContents.send('update-wallpaper', { ...item, blur: settings.blur });
    }
});

ipcMain.handle('get-settings', async () => {
    return await getSettings();
});

ipcMain.handle('update-settings', async (event, settings) => {
    await saveSettings(settings);
    if (wallpaperWindow) {
        wallpaperWindow.webContents.send('update-blur', settings.blur);
    }
    return true;
});

ipcMain.handle('list-media', async () => {
    await fs.ensureDir(liveDir);
    const files = await fs.readdir(liveDir);
    return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp4', '.webm', '.ogg', '.jpg', '.jpeg', '.png', '.gif'].includes(ext);
    }).map(file => ({
        name: file,
        url: `http://localhost:${mediaPort}/${encodeURIComponent(file)}`,
        type: ['.mp4', '.webm', '.ogg'].includes(path.extname(file).toLowerCase()) ? 'video' : 'image'
    }));
});

ipcMain.handle('import-media', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Media', extensions: ['mp4', 'webm', 'ogg', 'jpg', 'jpeg', 'png', 'gif'] }]
    });

    if (canceled) return null;

    await fs.ensureDir(liveDir);
    const importedFiles = [];
    for (const filePath of filePaths) {
        const fileName = path.basename(filePath);
        const destPath = path.join(liveDir, fileName);
        await fs.copy(filePath, destPath);
        importedFiles.push(fileName);
    }

    return importedFiles;
});
