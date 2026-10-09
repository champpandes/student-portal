(function (App) {
  'use strict';

  const state = App.state;

  App.downloadFullBackup = async function () {
    const btn = document.getElementById('backup-download-btn');

    await App.withButtonLoading(btn, async () => {
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
    }, { text: 'Preparing...' });
  };

  App.openBackupRestore = function () {
    const input = document.getElementById('backup-file-input');
    if (!input) return;
    input.value = '';
    input.click();
  };

  App.handleBackupRestoreFile = function (file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      let parsed;
      try {
        parsed = JSON.parse(e.target.result);
      } catch (err) {
        App.showToast("Invalid backup file: not valid JSON.", "error");
        return;
      }

      var isOldFormat = parsed.subjectData && typeof parsed.subjectData === 'object';
      var isNewFormat = parsed.subjects || parsed.students || parsed.grades;

      if (!isOldFormat && !isNewFormat) {
        App.showToast("Invalid backup file: no recognizable data.", "error");
        return;
      }

      const btn = document.getElementById('backup-restore-btn');

      // ---- STEP 1: Save current state as a safety backup ----
      let safetyFilename = '';
      try {
        await App.withButtonLoading(btn, async () => {
          App.showToast("Saving a backup of your current data first…");

          const currentRes = await App.apiCall({
            action: "backupAll",
            pin: state.adminPin
          }, { retries: 1, timeout: 120000 });

          if (!currentRes.success || !currentRes.backup) {
            throw new Error(currentRes.message || "Could not save current data.");
          }

          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          safetyFilename = 'portal-pre-restore-' + stamp + '.json';

          const blob = new Blob([JSON.stringify(currentRes.backup, null, 2)], {
            type: 'application/json;charset=utf-8'
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = safetyFilename;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
        }, { text: 'Saving current data...' });
      } catch (err) {
        console.error(err);
        App.showToast("Could not save current data: " + err.message, "error");
        return;
      }

      // ---- STEP 2: Confirm ----
      const confirmMsg =
        "✅ Your current data has been saved as:\n\n" +
        "   " + safetyFilename + "\n\n" +
        "Check your Downloads folder for this file — it's your safety net.\n\n" +
        "Now replace ALL current data with the backup you selected?\n\n" +
        "Selected file: " + file.name;

      if (!confirm(confirmMsg)) {
        App.showToast("Restore cancelled. Safety backup is in Downloads.");
        return;
      }

      // ---- STEP 3: Restore ----
      await App.withButtonLoading(btn, async () => {
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
        }
      }, { text: 'Restoring...' });
    };
    reader.onerror = () => App.showToast("Could not read the file.", "error");
    reader.readAsText(file);
  };

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

    await App.withButtonLoading(btn, async () => {
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
    }, { text: 'Recomputing...' });
  };

})(window.App);