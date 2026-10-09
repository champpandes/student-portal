(function (App) {
  'use strict';

  const state = App.state;

  let editingOriginalName = '';

  // ============================================================
  // Render the section list
  // ============================================================
  App.renderSectionsList = function () {
    const list = document.getElementById('sections-list-ui');
    if (!list) return;

    const sections = state.sectionsCache || [];
    if (sections.length === 0) {
      list.innerHTML = '<li class="p-8 text-center text-slate-400 text-sm font-medium">No sections yet. Add one above.</li>';
      return;
    }

    list.innerHTML = sections.map(name =>
      '<li class="px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50/60 transition-colors">' +
        '<div class="font-bold text-slate-800 text-sm">' + App.esc(name) + '</div>' +
        '<div class="flex items-center gap-2 shrink-0">' +
          '<button type="button" data-action="edit" data-section="' + App.esc(name) + '" ' +
                  'class="px-3.5 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-lg text-xs font-bold transition-colors border border-slate-200/60">Rename</button>' +
          '<button type="button" data-action="delete" data-section="' + App.esc(name) + '" ' +
                  'class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors border border-rose-100">Delete</button>' +
        '</div>' +
      '</li>'
    ).join('');
  };

  // ============================================================
  // Reset form
  // ============================================================
  App.resetSectionForm = function () {
    document.getElementById('new-section-input').value = '';
    document.getElementById('editing-original-section').value = '';
    editingOriginalName = '';

    const btn = document.getElementById('section-submit-btn');
    btn.innerText = '+ Add Section';
    btn.className = "w-full sm:w-auto bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md shadow-indigo-600/20 transition-all whitespace-nowrap";
    document.getElementById('section-cancel-edit-btn').classList.add('hidden');
  };

  // ============================================================
  // Prepare edit
  // ============================================================
  App.prepareEditSection = function (name) {
    document.getElementById('new-section-input').value = name;
    document.getElementById('editing-original-section').value = name;
    editingOriginalName = name;

    const btn = document.getElementById('section-submit-btn');
    btn.innerText = 'Rename Section';
    btn.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md transition-all whitespace-nowrap";
    document.getElementById('section-cancel-edit-btn').classList.remove('hidden');
    document.getElementById('new-section-input').focus();
    document.getElementById('new-section-input').select();
  };

  // ============================================================
  // Save (add or rename)
  // ============================================================
  App.handleSaveSection = async function () {
    const btn = document.getElementById('section-submit-btn');
    const name = document.getElementById('new-section-input').value.trim();
    if (!name) {
      App.showToast("Enter a section name.", "error");
      return;
    }

    await App.withButtonLoading(btn, async () => {
      const isRename = !!editingOriginalName;
      const res = await App.apiCall({
        action: "manageSection",
        pin: state.adminPin,
        subAction: isRename ? "rename" : "add",
        name: name,
        oldName: editingOriginalName
      }, { retries: 1 });

      if (!res.success) {
        App.showToast(res.message || "Failed to save section.", "error");
        return;
      }

      if (res.sections) {
        state.sectionsCache = res.sections;
        sessionStorage.removeItem('sp_sections_cache');
      }

      App.populateSectionDropdownsUI(state.sectionsCache);
      App.renderSectionsList();

      App.showToast(isRename ? "Section renamed to '" + name + "'." : "Section '" + name + "' added.");
      App.resetSectionForm();
    }, { text: 'Saving...' });
  };

  // ============================================================
  // Delete
  // ============================================================
  App.handleDeleteSection = async function (name) {
    if (!confirm("Delete section '" + name + "'?\n\nStudents already assigned to this section will not be affected, but no new students can be enrolled into it.\n\nProceed?")) return;

    const list = document.getElementById('sections-list-ui');
    const btns = list.querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; b.classList.add('opacity-60', 'cursor-wait'); });

    try {
      const res = await App.apiCall({
        action: "manageSection",
        pin: state.adminPin,
        subAction: "delete",
        name: name
      }, { retries: 1 });

      if (!res.success) {
        App.showToast(res.message || "Failed to delete section.", "error");
        return;
      }

      if (res.sections) {
        state.sectionsCache = res.sections;
        sessionStorage.removeItem('sp_sections_cache');
      }

      App.populateSectionDropdownsUI(state.sectionsCache);
      App.renderSectionsList();

      App.showToast("Section '" + name + "' deleted.");
    } catch (e) {
      App.showToast(e.message || "Failed to delete section.", "error");
    } finally {
      btns.forEach(b => {
        if (document.contains(b)) {
          b.disabled = false;
          b.classList.remove('opacity-60', 'cursor-wait');
        }
      });
    }
  };

})(window.App);