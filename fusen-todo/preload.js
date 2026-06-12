const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),
  saveCategories: (categories) => ipcRenderer.invoke('save-categories', categories),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  reminderAction: (taskId, action) =>
    ipcRenderer.send('reminder-action', { taskId, action }),
  onTasksUpdated: (cb) =>
    ipcRenderer.on('tasks-updated', (_e, tasks) => cb(tasks))
});
