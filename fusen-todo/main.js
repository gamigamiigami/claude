const { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// リマインドポップアップを縦に積むための管理
const reminderWindows = [];

const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');

const DEFAULT_CATEGORIES = [
  { name: '学級', color: '#ffd9e8' },
  { name: '授業', color: '#d4e9ff' },
  { name: '部活', color: '#d9f5d0' },
  { name: '学校', color: '#fff3b8' },
  { name: 'その他', color: '#eee0ff' }
];

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    // 旧形式(タスクの配列のみ)からの移行
    if (Array.isArray(raw)) {
      return { tasks: raw, categories: [...DEFAULT_CATEGORIES] };
    }
    return {
      tasks: raw.tasks || [],
      categories:
        raw.categories && raw.categories.length
          ? raw.categories
          : [...DEFAULT_CATEGORIES]
    };
  } catch {
    return { tasks: [], categories: [...DEFAULT_CATEGORIES] };
  }
}

function saveData(data) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2), 'utf8');
}

function loadTasks() {
  return loadData().tasks;
}

function saveTasks(tasks) {
  const data = loadData();
  data.tasks = tasks;
  saveData(data);
}

// 繰り返しタスクの「完了」: 期限と通知時間を次の回(未来)まで進める
function advanceRepeat(task) {
  const step = (d) => {
    if (task.repeat === 'daily') d.setDate(d.getDate() + 1);
    else if (task.repeat === 'weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  };
  const advancePast = (d, endOfDay) => {
    do {
      step(d);
    } while (
      (endOfDay ? new Date(d).setHours(23, 59, 59, 999) : d.getTime()) <=
      Date.now()
    );
    return d;
  };
  const pad = (n) => String(n).padStart(2, '0');
  if (task.deadline) {
    const d = advancePast(new Date(task.deadline + 'T00:00:00'), true);
    task.deadline = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (task.notifyAt) {
    task.notifyAt = advancePast(new Date(task.notifyAt), false).toISOString();
    task.notified = false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 360,
    minHeight: 480,
    title: 'ToDo丸',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#fff7c0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  // 閉じてもタスクトレイに常駐し、リマインドは動き続ける
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function trayIcon() {
  // フクロウ先生アイコンがあればそれを使う
  const fromFile = nativeImage.createFromPath(
    path.join(__dirname, 'build', 'icon.png')
  );
  if (!fromFile.isEmpty()) {
    return fromFile.resize({ width: 16, height: 16 });
  }
  // 予備: 付箋っぽい黄色い四角を描いた16x16アイコン
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const fold = x + y > size + 9; // 右下の折れ
      buf[i] = fold ? 230 : edge ? 180 : 255;     // B
      buf[i + 1] = fold ? 215 : edge ? 200 : 235; // G
      buf[i + 2] = fold ? 140 : edge ? 120 : 130; // R
      buf[i + 3] = 255;                           // A
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('ToDo丸(常駐中)');
  const menu = Menu.buildFromTemplate([
    { label: '開く', click: () => mainWindow.show() },
    { type: 'separator' },
    {
      label: '終了',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow.show());
}

// ===== リマインド =====

function showReminder(task) {
  const display = screen.getPrimaryDisplay();
  const { width: sw } = display.workAreaSize;
  const w = 360;
  const h = 170;
  const margin = 12;
  const slot = reminderWindows.length;

  const win = new BrowserWindow({
    width: w,
    height: h,
    x: sw - w - margin,
    y: margin + slot * (h + 10),
    frame: false,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#fff7c0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // 全画面アプリやゲームより前面に出すレベル
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile('reminder.html', { query: { task: JSON.stringify(task) } });
  win.once('ready-to-show', () => win.showInactive());

  reminderWindows.push(win);
  win.on('closed', () => {
    const i = reminderWindows.indexOf(win);
    if (i !== -1) reminderWindows.splice(i, 1);
  });
}

// 15秒ごとに通知時刻を過ぎた未通知タスクを確認する
function startScheduler() {
  setInterval(() => {
    const tasks = loadTasks();
    const now = Date.now();
    let changed = false;
    for (const task of tasks) {
      if (
        !task.done &&
        task.notify &&
        task.notifyAt &&
        !task.notified &&
        new Date(task.notifyAt).getTime() <= now
      ) {
        task.notified = true;
        changed = true;
        showReminder(task);
      }
    }
    if (changed) {
      saveTasks(tasks);
      if (mainWindow) mainWindow.webContents.send('tasks-updated', tasks);
    }
  }, 15 * 1000);
}

// ===== IPC =====

ipcMain.handle('get-data', () => loadData());

ipcMain.handle('save-tasks', (_e, tasks) => {
  saveTasks(tasks);
  return true;
});

ipcMain.handle('save-categories', (_e, categories) => {
  const data = loadData();
  data.categories = categories;
  saveData(data);
  return true;
});

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('set-autostart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return true;
});

ipcMain.handle('open-url', (_e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// リマインドポップアップからの操作
ipcMain.on('reminder-action', (e, { taskId, action }) => {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (task) {
    if (action === 'done') {
      if (task.repeat && task.repeat !== 'none') {
        advanceRepeat(task);
      } else {
        task.done = true;
      }
    } else if (action === 'snooze') {
      task.notified = false;
      task.notifyAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    }
    saveTasks(tasks);
    if (mainWindow) mainWindow.webContents.send('tasks-updated', tasks);
  }
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close();
});

// ===== 起動 =====

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createMainWindow();
    createTray();
    startScheduler();
  });
}

app.on('window-all-closed', () => {
  // トレイ常駐のため何もしない(終了はトレイメニューから)
});
