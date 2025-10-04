const path = require('path');

function dataPath(...parts) {
  // If running inside Electron packaged app, prefer app.getPath('userData') or
  // a data folder next to the executable. We try to detect Electron by process.versions.electron
  try {
    if (process && process.versions && process.versions.electron) {
      // Defer require to avoid loading electron in pure node environments
      const { app } = require('electron');
      if (app && app.isPackaged) {
        // store app-writable data next to the executable in a 'data' folder
        return path.join(path.dirname(process.execPath), 'data', ...parts);
      }
      // in dev electron (not packaged) use app.getAppPath()
      const base = app && app.getAppPath ? app.getAppPath() : path.join(__dirname, '..');
      return path.join(base, ...parts);
    }
  } catch (e) {
    // ignore
  }

  // When packaged with pkg, process.pkg exists and execPath points to the exe.
  if (process && process.pkg) {
    return path.join(path.dirname(process.execPath), 'data', ...parts);
  }

  // In development use the src/ folder layout: src is one level up from utils
  return path.join(__dirname, '..', ...parts);
}

module.exports = { dataPath };
