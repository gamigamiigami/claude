const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  reminderAction: (taskId, action) =>
    ipcRenderer.send('reminder-action', { taskId, action }),
  onTasksUpdated: (cb) =>
    ipcRenderer.on('tasks-updated', (_e, tasks) => cb(tasks))
});
