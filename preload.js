
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  launchBeamMP: (mode = 'account') => ipcRenderer.invoke('launch-beammp', mode),
  openModsLink: () => ipcRenderer.invoke('open-mods-link'),
  openCommunityLink: (target) => ipcRenderer.invoke('open-community-link', target),
  getBeamMPAuthStatus: () => ipcRenderer.invoke('get-beampm-auth-status'),
  saveBeamMPCredentials: (data) => ipcRenderer.invoke('save-beampm-credentials', data),
  clearBeamMPCredentials: () => ipcRenderer.invoke('clear-beampm-credentials'),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  selectFolder: (settingName) =>
    ipcRenderer.invoke('select-folder', settingName),
  saveSettings: (settings) =>
    ipcRenderer.invoke('save-settings', settings),
  saveLauncherPrefs: (prefs) => ipcRenderer.invoke('save-launcher-prefs', prefs),
  openMaintenanceLocation: (target) => ipcRenderer.invoke('open-maintenance-location', target),
  resetLauncherPrefs: () => ipcRenderer.invoke('reset-launcher-prefs'),

  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (_event, message) => callback(message));
  },

  onBeamMPExit: (callback) => {
    ipcRenderer.on('beammp-exited', () => callback());
  }
});
