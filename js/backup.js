(function (App) {
  'use strict';

  const state = App.state;

  App.downloadFullBackup = async function () {
    const btn = document.getElementById('backup-download-btn');
    const original = btn.innerHTML;
    btn.innerHTML = '⏳ Preparing…';
    btn.disabled = true;

    try {
      const res = await App.apiCall({
        action: "backupAll",
        pin: state.adminPin
      }, { retries: 1, timeout: 120000 });

      if (!res.success || !res.backup) {
        throw new Error(res.message || 'Backup failed.');
      }

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = 'portal-backup-' + stamp + '.json';

      const blob = new Blob([JSON.stringify(res.backup, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      App.showToast("Backup downloaded: " + filename);
    } catch (e) {
      console.error(e);
      App.showToast(e.message || 'Backup failed.', 'error');
    }

    btn.innerHTML = original;
    btn.disabled = false;
  };

  App.openBackupRestore = function () {
    const input = document.getElementById('backup-file-input');
    if (!input) return;
    input.value = '';
    input.click();
  };

  App.handleBackupRestoreFile = function (file) {
    if (!file) return;

    const confirmMsg =
      "⚠️ RESTORE FROM BACKUP\n\n" +
      "This will COMPLETELY WIPE all current subject sheets, comments, and announcements " +
      "from your Google Sheet and replace them with the contents of this backup file.\n\n" +
      "There is no undo. Make sure you've downloaded a fresh backup first.\n\n" +
      "File: " + file.name + "\n\n" +
      "Type OK to proceed.";

    if (!confirm(confirmMsg)) {
      App.showToast("Restore cancelled.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        App.showToast("Invalid backup file: not valid JSON.", "error");
        return;
      }

      if (!parsed.subjectData || typeof parsed.subjectData !== 'object') {
        App.showToast("Invalid backup file: missing subjectData.", "error");
        return;
      }

      const btn = document.getElementById('backup-restore-btn');
      const original = btn.innerHTML;
      btn.innerHTML = '⏳ Restoring…';
      btn.disabled = true;

      try {
        const res = await App.apiCall({
          action: "restoreAll",
          pin: state.adminPin,
          backup: parsed
        }, { retries: 0, timeout: 180000 });

        if (!res.success) throw new Error(res.message || 'Restore failed.');

        App.showToast("Restore complete. Reloading…");
        App.invalidateAllCache();
        setTimeout(() => window.location.reload(), 1500);
      } catch (err) {
        console.error(err);
        App.showToast(err.message || 'Restore failed.', 'error');
        btn.innerHTML = original;
        btn.disabled = false;
      }
    };
    reader.onerror = () => App.showToast("Could not read the file.", "error");
    reader.readAsText(file);
  };

  // ============================================================
  // RECOMPUTE ALL GRADES
  // ============================================================
  App.recomputeAllGrades = async function () {
    const msg =
      "Recompute all grades?\n\n" +
      "The server will walk every subject sheet and:\n" +
      "  • Clamp any quarter grade below 60 up to 60\n" +
      "  • Recompute the Final column from quarter grades\n" +
      "  • Recompute the Remarks column\n" +
      "  • Fix stale totals inside breakdown data\n\n" +
      "Valid grades (60 and above, and empty cells) are never changed.\n" +
      "Safe to run anytime.\n\n" +
      "Continue?";

    if (!confirm(msg)) return;

    const btn = document.getElementById('recompute-btn');
    const original = btn.innerHTML;
    btn.innerHTML = '⏳ Recomputing…';
    btn.disabled = true;

    try {
      const res = await App.apiCall({
        action: "recomputeAllGrades",
        pin: state.adminPin
      }, { retries: 0, timeout: 180000 });

      if (!res.success) throw new Error(res.message || "Recompute failed.");

      App.invalidateAllCache();
      state.allAdminGradesCache = {};
      await App.loadAdminDashboard();

      if (!res.totalFixed || res.totalFixed === 0) {
        App.showToast("Recompute complete. No anomalies found.");
      } else {
        const summary = (res.report || [])
          .map(r => r.subject + ": " + r.fixed)
          .join("\n");
        console.log("Recompute report:\n" + summary);
        App.showToast("Fixed " + res.totalFixed + " row(s). Details in console.");
      }
    } catch (e) {
      console.error(e);
      App.showToast(e.message || "Recompute failed.", "error");
    }

    btn.innerHTML = original;
    btn.disabled = false;
  };

})(window.App);