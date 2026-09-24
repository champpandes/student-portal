(function (App) {
  'use strict';

  const state = App.state;

  // ============================================================
  // ANNOUNCEMENTS
  // ============================================================
  App.loadAnnouncement = async function () {
    try {
      const res = await App.apiCall({ action: "getAnnouncement" });
      const aInput = document.getElementById('admin-announcement-input');
      const sBanner = document.getElementById('student-announcement-banner');
      const sText = document.getElementById('student-announcement-text');
      const sMeta = document.getElementById('student-announcement-meta');

      if (res.success && res.message) {
        if (aInput) aInput.value = res.message;
        if (sBanner && sText) {
          sText.textContent = res.message;
          if (sMeta) {
            sMeta.textContent = res.timestamp ? 'Posted: ' + res.timestamp : '';
          }
          sBanner.classList.remove('hidden');
          sBanner.classList.add('flex');
        }
      } else {
        if (aInput) aInput.value = '';
        if (sBanner) {
          sBanner.classList.add('hidden');
          sBanner.classList.remove('flex');
        }
      }
      App.loadComments();
    } catch (e) {
      console.error("Could not fetch announcements", e);
      App.showToast("Could not load announcements.", "error");
    }
  };

  App.broadcastAnnouncement = async function () {
    const btn = document.getElementById('broadcast-btn');
    const input = document.getElementById('admin-announcement-input');
    const msg = input.value.trim();
    if (!msg) {
      App.showToast("Announcement cannot be empty.", "error");
      return;
    }
    const original = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    const res = await App.apiCall({
      action: "saveAnnouncement", pin: state.adminPin, message: msg
    }, { retries: 1 });

    if (res.success) {
      App.showToast("Announcement broadcasted!");
      App.loadAnnouncementHistory();
    } else {
      App.showToast(res.message || "Failed to broadcast.", "error");
    }

    btn.innerText = original;
    btn.disabled = false;
  };

  App.loadAnnouncementHistory = async function () {
    const container = document.getElementById('announcement-history');
    if (!container) return;

    container.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-4">Loading…</div>';

    try {
      const res = await App.apiCall({
        action: "getAnnouncementHistory",
        pin: state.adminPin
      }, { retries: 1 });

      if (!res.success || !res.history || res.history.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-400 italic text-center py-8">No past announcements yet.</div>';
        return;
      }

      container.innerHTML = res.history.map(item => {
        const active = item.active;
        const badge = active
          ? '<span class="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md">Active</span>'
          : '<span class="text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">Archived</span>';

        return '<div class="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm" data-row="' + item.rowIndex + '">' +
          '<div class="flex items-center justify-between mb-1.5">' +
            badge +
            '<button type="button" data-action="delete-ann" data-row="' + item.rowIndex + '" ' +
                    'class="text-[10px] font-bold text-rose-600 hover:bg-rose-50 px-2 py-1 rounded transition-colors">Delete</button>' +
          '</div>' +
          '<p class="text-sm text-slate-800 font-medium whitespace-pre-wrap break-words mb-1">' + App.esc(item.message) + '</p>' +
          '<div class="text-[10px] text-slate-400 font-semibold">' +
            App.esc(item.timestamp) +
            (item.postedBy ? ' &bull; ' + App.esc(item.postedBy) : '') +
          '</div>' +
        '</div>';
      }).join('');
    } catch (e) {
      console.error(e);
      container.innerHTML = '<div class="text-xs text-rose-500 italic text-center py-4">Failed to load history.</div>';
    }
  };

  App.deleteAnnouncement = async function (rowIndex) {
    if (!confirm("Delete this announcement from history? This cannot be undone.")) return;

    const res = await App.apiCall({
      action: "deleteAnnouncement",
      pin: state.adminPin,
      rowIndex: rowIndex
    }, { retries: 1 });

    if (res.success) {
      App.showToast("Announcement deleted.");
      App.loadAnnouncementHistory();
      App.loadAnnouncement();
    } else {
      App.showToast(res.message || "Failed to delete.", "error");
    }
  };

  // ============================================================
  // COMMENTS
  // ============================================================
  App.loadComments = async function () {
    try {
      const res = await App.apiCall({ action: "getComments" });
      const studentFeed = document.getElementById('comments-feed');
      const adminFeed = document.getElementById('admin-comments-feed');
      if (!res.success || !res.comments) return;

      const buildStudent = c => {
        const name = c.studentNumber === "TEACHER_ADMIN"
          ? "Teacher Admin"
          : 'Student ID: ' + App.esc(c.studentNumber);
        return '<div class="bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl text-xs shadow-sm">' +
          '<div class="flex justify-between items-center mb-1">' +
            '<span class="font-bold text-indigo-900">' + name + '</span>' +
            '<span class="text-[10px] text-slate-400">' + App.esc(c.timestamp) + '</span>' +
          '</div>' +
          '<p class="text-slate-700 font-medium">' + App.esc(c.text) + '</p>' +
        '</div>';
      };

      const buildAdmin = c => {
        const name = c.studentNumber === "TEACHER_ADMIN"
          ? "Teacher Admin"
          : (App.esc(c.studentName) + ' (' + App.esc(c.studentNumber) + ')');
        return '<div class="bg-white border border-slate-200/80 p-2.5 rounded-xl text-xs shadow-sm">' +
          '<div class="flex justify-between items-center mb-1">' +
            '<span class="font-bold text-indigo-900">' + name + '</span>' +
            '<span class="text-[10px] text-slate-400">' + App.esc(c.timestamp) + '</span>' +
          '</div>' +
          '<p class="text-slate-700 font-medium">' + App.esc(c.text) + '</p>' +
        '</div>';
      };

      const empty = '<div class="text-xs text-slate-400 italic">No comments yet. Start the conversation!</div>';
      if (studentFeed) studentFeed.innerHTML = res.comments.length ? res.comments.map(buildStudent).join('') : empty;
      if (adminFeed) adminFeed.innerHTML = res.comments.length ? res.comments.map(buildAdmin).join('') : empty;
    } catch (e) {
      console.error("Could not fetch comments", e);
      App.showToast("Could not load comments.", "error");
    }
  };

  App.submitStudentComment = async function () {
    const btn = document.getElementById('student-send-comment-btn');
    const input = document.getElementById('new-comment-input');
    const text = input.value.trim();
    if (!text) return;

    const original = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    const studentNo = state.currentStudentData ? state.currentStudentData.studentNumber : "UNKNOWN";
    const res = await App.apiCall({
      action: "postComment", studentNumber: studentNo, commentText: text
    }, { retries: 1 });

    if (res.success) {
      input.value = "";
      App.showToast("Comment posted!");
      App.loadComments();
    } else {
      App.showToast(res.message || "Failed to post comment.", "error");
    }
    btn.innerText = original;
    btn.disabled = false;
  };

  App.submitAdminComment = async function () {
    const btn = document.getElementById('admin-send-comment-btn');
    const input = document.getElementById('admin-new-comment-input');
    const text = input.value.trim();
    if (!text) return;

    const original = btn.innerText;
    btn.innerText = "Sending...";
    btn.disabled = true;

    const res = await App.apiCall({
      action: "postComment", studentNumber: "TEACHER_ADMIN", commentText: text
    }, { retries: 1 });

    if (res.success) {
      input.value = "";
      App.showToast("Reply posted!");
      App.loadComments();
    } else {
      App.showToast(res.message || "Failed to post reply.", "error");
    }
    btn.innerText = original;
    btn.disabled = false;
  };

  App.clearClassComments = async function () {
    if (!confirm("Clear all comments from the discussion thread? This cannot be undone.")) return;
    const res = await App.apiCall({ action: "clearComments", pin: state.adminPin }, { retries: 1 });
    if (res.success) { App.showToast("Discussion thread cleared!"); App.loadComments(); }
    else App.showToast(res.message || "Failed to clear comments.", "error");
  };

})(window.App);