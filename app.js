const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwjoi5ItKz5p17T2G-aiA1df52_Vsucl9HuLONQoyXvxOVEUQ2iQYWxzNDrKpl4WwVh/exec";

let availableSubjects = []; 
let currentAdminData = [];
let currentStudentData = null;
let adminPin = "";
let pendingImportData = [];
let activeManageStudentId = null;
let activeAdminSubject = "All"; 
let activeManageSubject = "";
let activeStudentSubject = "";
let activeQuarterFilter = "All";
let subjectDescriptions = JSON.parse(localStorage.getItem('subjectDescriptions') || '{}');

const screens = { login: document.getElementById('login-screen'), admin: document.getElementById('admin-dashboard'), student: document.getElementById('student-dashboard'), breakdown: document.getElementById('breakdown-screen') };

// --- TOP NAVBAR TOGGLE FUNCTION FOR MOBILE ---
function toggleSidebar() {
    if (window.innerWidth < 768) {
        const topMenu = document.getElementById('mobile-top-nav-menu');
        if (topMenu) topMenu.classList.toggle('hidden');
    } else {
        const sidebar = document.getElementById('admin-sidebar');
        if (sidebar) sidebar.classList.toggle('collapsed');
    }
}

// --- TOAST NOTIFICATION SYSTEM ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const bg = type === 'success' ? 'bg-emerald-600' : (type === 'error' ? 'bg-rose-600' : 'bg-slate-800');
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    
    toast.className = `${bg} text-white px-5 py-3.5 rounded-2xl shadow-lg transform transition-all duration-300 translate-y-10 opacity-0 flex items-center gap-3 text-sm font-bold w-max max-w-sm border border-white/10`;
    toast.innerHTML = `<span class="text-lg">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    requestAnimationFrame(() => toast.classList.remove('translate-y-10', 'opacity-0'));
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- ADMIN SIDEBAR TAB ROUTING ---
function switchAdminTab(tabName, btnElement) {
    document.querySelectorAll('.admin-tab-content').forEach(tab => tab.classList.add('hidden-screen'));
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.className = "admin-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all hover:bg-slate-800 text-slate-400 hover:text-white";
    });

    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) activeTab.classList.remove('hidden-screen');
    
    if (btnElement) {
        btnElement.className = "admin-tab-btn w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all bg-indigo-600 text-white shadow-md shadow-indigo-600/20";
    }

    if (window.innerWidth < 768) {
        const topMenu = document.getElementById('mobile-top-nav-menu');
        if (topMenu) topMenu.classList.add('hidden');
    }

    if (tabName === 'grading-sheet') {
        const sections = [...new Set(currentAdminData.map(s => s.section))].filter(Boolean).sort();
        populateGradingSheetSections(sections);
        updateGradingSheetPreview();
    }
}

// --- ACTIVITY TIMESTAMP & AUDIT LOG HELPER ---
function updateLastSavedTimestamp() {
    const badge = document.getElementById('last-saved-badge');
    const text = document.getElementById('last-saved-text');
    if (!badge || !text) return;

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    text.innerText = timeString;
    badge.classList.remove('hidden');
}

// --- ANNOUNCEMENT & COMMENT THREAD LOGIC ---
async function loadAnnouncement() {
    try {
        const res = await apiCall({ action: "getAnnouncement" });
        if (res.success && res.message) {
            const aInput = document.getElementById('admin-announcement-input');
            if (aInput) aInput.value = res.message;
            
            const sBanner = document.getElementById('student-announcement-banner');
            const sText = document.getElementById('student-announcement-text');
            if (sBanner && sText) {
                sText.innerText = res.message;
                sBanner.classList.remove('hidden');
            }
        } else {
            const sBanner = document.getElementById('student-announcement-banner');
            if (sBanner) sBanner.classList.add('hidden');
        }
        loadComments();
    } catch (e) { console.error("Could not fetch announcements"); }
}

async function broadcastAnnouncement(btn) {
    const input = document.getElementById('admin-announcement-input');
    const msg = input.value.trim();
    
    btn.innerText = "Sending..."; btn.disabled = true;

    const res = await apiCall({ action: "saveAnnouncement", pin: adminPin, message: msg });
    if (res.success) showToast("Announcement broadcasted to all students!");
    else showToast("Failed to broadcast.", "error");
    
    btn.innerText = "Broadcast"; btn.disabled = false;
}

async function loadComments() {
    try {
        const res = await apiCall({ action: "getComments" });
        const studentFeed = document.getElementById('comments-feed');
        const adminFeed = document.getElementById('admin-comments-feed');
        
        if (res.success && res.comments) {
            const studentCommentsHTML = res.comments.length === 0 
                ? `<div class="text-xs text-white/70 italic">No comments yet. Start the conversation!</div>` 
                : res.comments.map(c => {
                    const displayName = c.studentNumber === "TEACHER_ADMIN" ? "Teacher Admin" : `Student ID: ${c.studentNumber}`;
                    return `
                        <div class="bg-white/95 backdrop-blur-sm p-2.5 rounded-xl text-xs shadow-xs">
                            <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-indigo-900">${displayName}</span>
                                <span class="text-[10px] text-slate-400">${c.timestamp}</span>
                            </div>
                            <p class="text-slate-700 font-medium">${c.text}</p>
                        </div>
                    `;
                }).join('');

            const adminCommentsHTML = res.comments.length === 0 
                ? `<div class="text-xs text-slate-400 italic">No comments yet.</div>` 
                : res.comments.map(c => {
                    const displayName = c.studentNumber === "TEACHER_ADMIN" ? "Teacher Admin" : `${c.studentName} (${c.studentNumber})`;
                    return `
                        <div class="bg-white border border-slate-200/80 p-2.5 rounded-xl text-xs shadow-xs">
                            <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-indigo-900">${displayName}</span>
                                <span class="text-[10px] text-slate-400">${c.timestamp}</span>
                            </div>
                            <p class="text-slate-700 font-medium">${c.text}</p>
                        </div>
                    `;
                }).join('');

            if (studentFeed) studentFeed.innerHTML = studentCommentsHTML;
            if (adminFeed) adminFeed.innerHTML = adminCommentsHTML;
        }
    } catch (e) { console.error("Could not fetch comments"); }
}

async function submitStudentComment() {
    const input = document.getElementById('new-comment-input');
    const text = input.value.trim();
    if (!text) return;

    const studentNo = currentStudentData ? currentStudentData.studentNumber : "UNKNOWN";
    const res = await apiCall({ action: "postComment", studentNumber: studentNo, commentText: text });
    if (res.success) {
        input.value = "";
        showToast("Comment posted!");
        loadComments();
    } else {
        showToast("Failed to post comment.", "error");
    }
}

async function submitAdminComment() {
    const input = document.getElementById('admin-new-comment-input');
    const text = input.value.trim();
    if (!text) return;

    const res = await apiCall({ action: "postComment", studentNumber: "TEACHER_ADMIN", commentText: text });
    if (res.success) {
        input.value = "";
        showToast("Reply posted!");
        loadComments();
    } else {
        showToast("Failed to post reply.", "error");
    }
}

async function clearClassComments() {
    if (!confirm("Are you sure you want to clear all comments from the discussion thread? This cannot be undone.")) return;

    const res = await apiCall({ action: "clearComments", pin: adminPin });
    if (res.success) {
        showToast("Discussion thread cleared!");
        loadComments();
    } else {
        showToast("Failed to clear comments.", "error");
    }
}

window.onload = async () => { 
    await fetchSubjects(); 
    loadComments(); 
    await fetchAllSectionsForDropdowns();
};

async function fetchAllSectionsForDropdowns() {
    try {
        const res = await apiCall({ action: "getAllGrades", pin: adminPin || "6589", subject: "All" });
        if (res && Array.isArray(res)) {
            const sections = [...new Set(res.map(s => s.section))].filter(Boolean).sort();
            populateSectionDropdownsUI(sections);
        }
    } catch(e) {
        console.error("Could not load sections for dropdowns");
    }
}

function populateSectionDropdownsUI(sections) {
    const defaultSections = sections.length > 0 ? sections : ["Section A", "Section B", "Block 1", "Block 2"];
    const optionsHTML = defaultSections.map(sec => `<option value="${sec}">${sec}</option>`).join('');

    const regSecSelect = document.getElementById('reg-student-section');
    const addSecSelect = document.getElementById('new-student-section');
    const panelSecSelect = document.getElementById('panel-student-section');

    if (regSecSelect) regSecSelect.innerHTML = `<option value="">Select section...</option>` + optionsHTML;
    if (addSecSelect) addSecSelect.innerHTML = `<option value="">Select section...</option>` + optionsHTML;
    if (panelSecSelect) panelSecSelect.innerHTML = optionsHTML;
}

async function fetchSubjects() {
    try {
        const res = await apiCall({ action: "getSubjects" });
        if (res.success) {
            availableSubjects = res.subjects || [];
            populateSubjectUIs();
            renderSubjectsListUI();
        }
    } catch (err) { 
        console.error("Could not fetch subjects."); 
        document.getElementById('admin-subject-filter').innerHTML = `<option>Error Connecting</option>`;
    }
}

function populateSubjectUIs() {
    const adminFilter = document.getElementById('admin-subject-filter');
    const importSubject = document.getElementById('import-subject');
    const addCheckboxes = document.getElementById('add-subject-checkboxes');
    const regCheckboxes = document.getElementById('reg-subject-checkboxes');
    const gsSubject = document.getElementById('gs-subject');

    if (availableSubjects.length === 0) {
        if(adminFilter) adminFilter.innerHTML = `<option value="All">No Subjects Added Yet</option>`;
        if(importSubject) importSubject.innerHTML = `<option>No Subjects Available</option>`;
        if(gsSubject) gsSubject.innerHTML = `<option>No Subjects Available</option>`;
        if(addCheckboxes) addCheckboxes.innerHTML = `<span class="text-sm font-bold text-rose-500">Please add a subject first.</span>`;
        if(regCheckboxes) regCheckboxes.innerHTML = `<span class="text-sm font-bold text-rose-500">No classes available.</span>`;
        return;
    }

    const optionsHTML = availableSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
    const checkboxesHTML = availableSubjects.map(s => `<label class="font-medium text-sm text-slate-600 flex items-center cursor-pointer"><input type="checkbox" value="${s}" class="mr-1.5 accent-indigo-600 w-4 h-4" checked> ${s}</label>`).join('');

    if(adminFilter) {
        adminFilter.innerHTML = `<option value="All">All Subjects</option>` + optionsHTML;
        adminFilter.value = activeAdminSubject;
    }
    if(importSubject) importSubject.innerHTML = optionsHTML;
    if(gsSubject) {
        gsSubject.innerHTML = optionsHTML;
        updateGradingSheetPreview();
    }
    if(addCheckboxes) addCheckboxes.innerHTML = checkboxesHTML;
    if(regCheckboxes) regCheckboxes.innerHTML = checkboxesHTML;
}

function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden-screen'));
    screens[screenName].classList.remove('hidden-screen');
}

document.getElementById('login-btn').addEventListener('click', async () => {
    const btn = document.getElementById('login-btn');
    const inputVal = document.getElementById('login-input').value.trim();
    if (!inputVal) return;

    btn.innerText = "Authenticating..."; btn.disabled = true;
    document.getElementById('login-error').classList.add('hidden-screen');

    try {
        if (inputVal.length <= 6 && !isNaN(inputVal) && !inputVal.includes("-")) {
            const res = await apiCall({ action: "adminLogin", pin: inputVal });
            if (res.success) {
                adminPin = inputVal;
                showToast(`Welcome back!`);
                loadAnnouncement();
                await loadAdminDashboard();
                showScreen('admin');
            } else { throw new Error("Invalid Teacher PIN."); }
        } else {
            const res = await apiCall({ action: "getStudent", studentNumber: inputVal });
            if (res && res.subjects && Object.keys(res.subjects).length > 0) {
                currentStudentData = res;
                
                document.getElementById('student-info-header').innerText = `ID: ${res.studentNumber} • ${res.name}`;
                document.getElementById('print-student-name').innerText = res.name;
                
                initializeStudentDropdowns(Object.keys(res.subjects));
                
                showToast(`Logged in as ${res.name}`);
                loadAnnouncement();
                showScreen('student');
            } else { throw new Error("Student not found or has no enrolled subjects."); }
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
    btn.innerText = "Log In"; btn.disabled = false;
});

document.querySelectorAll('.logout-btn').forEach(btn => btn.addEventListener('click', () => {
    document.getElementById('login-input').value = ""; 
    adminPin = ""; 
    currentStudentData = null; 
    localStorage.clear();
    showScreen('login');
}));

function renderSubjectsListUI() {
    const listUI = document.getElementById('subjects-list-ui');
    if (!listUI) return;
    if (availableSubjects.length === 0) { 
        listUI.innerHTML = `<li class="p-8 text-center text-slate-400 text-sm font-medium">No subjects found in curriculum.</li>`; 
        return; 
    }
    
    listUI.innerHTML = availableSubjects.map(s => {
        const desc = subjectDescriptions[s] || '';
        return `
            <li class="px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 hover:bg-slate-50/60 transition-colors">
                <div class="overflow-hidden pr-2">
                    <div class="font-bold text-slate-800 text-sm">${s}</div>
                    <div class="text-xs text-slate-500 font-medium mt-0.5">Description: <span class="italic text-indigo-600 font-semibold">${desc || 'None assigned'}</span></div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="prepareEditSubject('${s}')" class="px-3.5 py-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-lg text-xs font-bold transition-colors border border-slate-200/60">Edit</button>
                    <button onclick="handleDeleteSubject('${s}')" class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors border border-rose-100">Delete</button>
                </div>
            </li>
        `;
    }).join('');
}

function prepareEditSubject(subjectName) {
    const nameInput = document.getElementById('new-subject-input');
    const descInput = document.getElementById('new-subject-desc-input');
    const originalField = document.getElementById('editing-original-subject');
    const submitBtn = document.getElementById('subject-submit-btn');
    const cancelBtn = document.getElementById('subject-cancel-edit-btn');

    nameInput.value = subjectName;
    descInput.value = subjectDescriptions[subjectName] || '';
    originalField.value = subjectName;

    submitBtn.innerText = "Update Subject";
    submitBtn.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-emerald-700 shadow-md transition-all whitespace-nowrap";
    cancelBtn.classList.remove('hidden');

    nameInput.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSubjectForm() {
    const nameInput = document.getElementById('new-subject-input');
    const descInput = document.getElementById('new-subject-desc-input');
    const originalField = document.getElementById('editing-original-subject');
    const submitBtn = document.getElementById('subject-submit-btn');
    const cancelBtn = document.getElementById('subject-cancel-edit-btn');

    nameInput.value = '';
    descInput.value = '';
    originalField.value = '';

    submitBtn.innerText = "+ Add Subject";
    submitBtn.className = "w-full sm:w-auto bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-indigo-700 shadow-md shadow-indigo-600/20 transition-all whitespace-nowrap";
    cancelBtn.classList.add('hidden');
}

async function handleSaveSubject() {
    const nameInput = document.getElementById('new-subject-input'); 
    const descInput = document.getElementById('new-subject-desc-input');
    const originalField = document.getElementById('editing-original-subject');
    
    const newName = nameInput.value.trim();
    const descVal = descInput.value.trim();
    const oldName = originalField.value;

    if (!newName) {
        showToast("Please enter a subject name.", "error");
        return;
    }

    if (oldName) {
        if (newName !== oldName) {
            const res = await apiCall({ action: "manageSubject", pin: adminPin, subAction: "update", oldName: oldName, newName: newName });
            if (!res.success) {
                showToast(res.message || "Failed to update subject name.", "error");
                return;
            }
            if (subjectDescriptions[oldName]) {
                delete subjectDescriptions[oldName];
            }
        }
        subjectDescriptions[newName] = descVal;
        localStorage.setItem('subjectDescriptions', JSON.stringify(subjectDescriptions));
        showToast(`Subject '${newName}' updated successfully!`);
        resetSubjectForm();
        await fetchSubjects();
        renderSubjectsListUI();
        await loadAdminDashboard();
    } else {
        const res = await apiCall({ action: "manageSubject", pin: adminPin, subAction: "add", subjectName: newName });
        if (res.success) { 
            subjectDescriptions[newName] = descVal;
            localStorage.setItem('subjectDescriptions', JSON.stringify(subjectDescriptions));
            resetSubjectForm();
            showToast(`Subject '${newName}' added successfully!`);
            await fetchSubjects(); 
            renderSubjectsListUI(); 
            await loadAdminDashboard(); 
        } else {
            showToast(res.message || "Failed to add subject", 'error');
        }
    }
}

async function handleDeleteSubject(name) {
    if(!confirm(`WARNING: Deleting '${name}' will also delete ALL grades for this subject across the entire database. This cannot be undone.\n\nProceed?`)) return;
    const res = await apiCall({ action: "manageSubject", pin: adminPin, subAction: "delete", subjectName: name });
    if (res.success) { 
        delete subjectDescriptions[name];
        localStorage.setItem('subjectDescriptions', JSON.stringify(subjectDescriptions));
        if(activeAdminSubject === name) activeAdminSubject = "All"; 
        showToast(`Subject '${name}' deleted forever.`, 'success');
        await fetchSubjects(); renderSubjectsListUI(); await loadAdminDashboard(); 
    } else { 
        showToast("Failed to delete subject.", "error"); 
    }
}

document.getElementById('admin-subject-filter').addEventListener('change', async (e) => {
    activeAdminSubject = e.target.value;
    await loadAdminDashboard();
});

async function loadAdminDashboard() {
    const tbody = document.getElementById('admin-table-body');
    const mobileList = document.getElementById('admin-mobile-card-list');
    const syncIndicator = document.getElementById('sync-indicator');
    
    if (availableSubjects.length === 0) {
        tbody.innerHTML = `<tr><td class="p-8 text-center text-slate-400 font-bold" colspan="9">Please add a subject to start managing students.</td></tr>`;
        mobileList.innerHTML = `<div class="p-8 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-100">Please add a subject to start managing students.</div>`;
        return;
    }

    const cacheKey = `adminData_${adminPin}_${activeAdminSubject}`;
    const cachedData = localStorage.getItem(cacheKey);

    if (cachedData) {
        try {
            currentAdminData = JSON.parse(cachedData);
            populateSectionFilter(); 
            updateSummaryMetrics(currentAdminData);
            applyAdminFilters();
            if(syncIndicator) { syncIndicator.classList.remove('hidden'); syncIndicator.classList.add('flex'); }
        } catch(e) { console.error("Cache read error."); }
    } else {
        const skeletonRow = `
            <tr class="animate-pulse border-b border-slate-100">
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-20"></div></td>
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-32 mb-1"></div><div class="h-3 bg-slate-100 rounded w-24"></div></td>
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
                <td class="p-4"><div class="h-4 bg-slate-200 rounded w-8 mx-auto"></div></td>
                <td class="p-4"><div class="h-5 bg-slate-300 rounded w-10 mx-auto"></div></td>
                <td class="p-4"><div class="h-5 bg-slate-200 rounded-full w-16 mx-auto"></div></td>
                <td class="p-4"><div class="h-8 bg-slate-200 rounded-lg w-20 mx-auto"></div></td>
            </tr>
        `;
        tbody.innerHTML = skeletonRow.repeat(6);
        mobileList.innerHTML = `<div class="p-8 text-center text-slate-400 font-bold bg-white rounded-2xl animate-pulse">Loading students...</div>`;
    }
    
    try {
        const res = await apiCall({ action: "getAllGrades", pin: adminPin, subject: activeAdminSubject });
        if (res && Array.isArray(res)) {
            localStorage.setItem(cacheKey, JSON.stringify(res)); 
            currentAdminData = res; 
            populateSectionFilter(); 
            updateSummaryMetrics(currentAdminData);
            applyAdminFilters(); 
            updateLastSavedTimestamp();
            
            const sections = [...new Set(res.map(s => s.section))].filter(Boolean).sort();
            populateSectionDropdownsUI(sections);
            populateGradingSheetSections(sections);
        }
    } catch (error) {
        if (!cachedData) {
            tbody.innerHTML = `<tr><td class="p-8 text-center text-rose-500 font-bold" colspan="9">Network Error. Could not load data.</td></tr>`;
            mobileList.innerHTML = `<div class="p-8 text-center text-rose-500 font-bold bg-white rounded-2xl">Network Error. Could not load data.</div>`;
        } else {
            showToast("Offline: Showing cached data.", "error");
        }
    } finally {
        if(syncIndicator) { syncIndicator.classList.add('hidden'); syncIndicator.classList.remove('flex'); }
    }
}

function updateSummaryMetrics(data) {
    const total = data.length;
    document.getElementById('stat-total-students').innerText = total;

    if (total === 0) {
        document.getElementById('stat-passing-rate').innerText = "0%";
        document.getElementById('stat-class-average').innerText = "-";
        return;
    }

    const passedCount = data.filter(s => s.remarks === 'Passed').length;
    const passingRate = Math.round((passedCount / total) * 100);
    document.getElementById('stat-passing-rate').innerText = `${passingRate}%`;

    const finals = data.map(s => Number(s.final)).filter(f => !isNaN(f) && f > 0);
    if (finals.length > 0) {
        const avg = Math.round(finals.reduce((a, b) => a + b, 0) / finals.length);
        document.getElementById('stat-class-average').innerText = avg;
    } else {
        document.getElementById('stat-class-average').innerText = "-";
    }
}

function filterByQuarter(q) {
    activeQuarterFilter = q;
    document.querySelectorAll('.quarter-pill').forEach(btn => {
        btn.className = "quarter-pill px-4 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 shadow-sm shrink-0 transition-all hover:bg-slate-50";
    });
    const activeBtn = document.getElementById(`q-pill-${q}`);
    if (activeBtn) {
        activeBtn.className = "quarter-pill px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white shadow-sm shrink-0 transition-all";
    }

    ['1st', '2nd', '3rd', '4th'].forEach(qtr => {
        document.querySelectorAll(`.col-q-${qtr}`).forEach(el => {
            if (q === 'All' || q === qtr) el.classList.remove('hidden');
            else el.classList.add('hidden');
        });
    });

    applyAdminFilters();
}

function renderAdminTable(dataToRender) {
    const tbody = document.getElementById('admin-table-body');
    tbody.innerHTML = "";
    if (dataToRender.length === 0) { tbody.innerHTML = `<tr><td class="p-8 text-center text-slate-400 font-bold" colspan="9">No students found for this subject.</td></tr>`; return; }

    dataToRender.forEach((student) => {
        const tr = document.createElement('tr'); tr.className = "hover:bg-indigo-50/30 transition-colors group";
        
        const remarksUI = student.remarks === 'Passed' 
            ? '<span class="badge-passed px-2.5 py-1 rounded-md text-[11px] font-bold"><svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> PASSED</span>' 
            : (student.remarks === 'Failed' 
                ? '<span class="badge-failed px-2.5 py-1 rounded-md text-[11px] font-bold"><svg class="w-3.5 h-3.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> FAILED</span>' 
                : '<span class="text-slate-400">-</span>');

        tr.innerHTML = `
            <td class="p-4 font-semibold text-slate-600">${student.studentNumber}</td>
            <td class="p-4">
                <div class="font-bold text-slate-800">${student.name}</div>
                <div class="text-[11px] font-bold text-slate-400 mt-0.5">${student.section} &bull; <span class="text-indigo-500">${student.subject}</span></div>
            </td>
            <td class="p-4 text-center cursor-pointer text-indigo-600 font-bold hover:text-indigo-800 col-q col-q-1st ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '1st' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '1st')">${student.q1 || '-'}</td>
            <td class="p-4 text-center cursor-pointer text-indigo-600 font-bold hover:text-indigo-800 col-q col-q-2nd ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '2nd' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '2nd')">${student.q2 || '-'}</td>
            <td class="p-4 text-center cursor-pointer text-indigo-600 font-bold hover:text-indigo-800 col-q col-q-3rd ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '3rd' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '3rd')">${student.q3 || '-'}</td>
            <td class="p-4 text-center cursor-pointer text-indigo-600 font-bold hover:text-indigo-800 col-q col-q-4th ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '4th' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '4th')">${student.q4 || '-'}</td>
            <td class="p-4 text-center font-black">${student.final || '-'}</td>
            <td class="p-4">${remarksUI}</td>
            <td class="p-4 text-center">
                <button onclick="openSlidePanel('${student.studentNumber}', '${student.subject}')" class="text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-600 hover:text-white transition-colors border border-indigo-100">Manage</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderAdminMobileCards(dataToRender) {
    const mobileList = document.getElementById('admin-mobile-card-list');
    mobileList.innerHTML = "";
    if (dataToRender.length === 0) { mobileList.innerHTML = `<div class="p-6 text-center text-slate-400 font-bold bg-white rounded-2xl border border-slate-100">No students found.</div>`; return; }

    dataToRender.forEach((student, index) => {
        const remarksUI = student.remarks === 'Passed' 
            ? '<span class="badge-passed px-2.5 py-1 rounded-md text-[11px] font-bold"><svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> PASSED</span>' 
            : (student.remarks === 'Failed' 
                ? '<span class="badge-failed px-2.5 py-1 rounded-md text-[11px] font-bold"><svg class="w-3.5 h-3.5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> FAILED</span>' 
                : '<span class="text-slate-400 font-semibold">-</span>');

        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl border border-slate-200/80 shadow-sm p-4 transition-all";
        card.innerHTML = `
            <div class="flex items-center justify-between cursor-pointer select-none" onclick="toggleMobileCard(${index})">
                <div class="overflow-hidden pr-2">
                    <div class="text-xs font-bold text-slate-400">ID: ${student.studentNumber}</div>
                    <div class="text-base font-bold text-slate-800 truncate">${student.name}</div>
                    <div class="text-[11px] font-semibold text-indigo-500 mt-0.5">${student.section} &bull; ${student.subject}</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <div class="text-right">
                        <div class="text-[10px] uppercase font-bold text-slate-400">Final</div>
                        <div class="text-lg font-black text-indigo-600">${student.final || '-'}</div>
                    </div>
                    <div id="mobile-arrow-${index}" class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 transition-transform duration-200">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                    </div>
                </div>
            </div>

            <div id="mobile-drawer-${index}" class="hidden pt-4 mt-4 border-t border-slate-100">
                <div class="grid grid-cols-4 gap-2 mb-4 text-center">
                    <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '1st' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '1st')">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">1st Qtr</div>
                        <div class="text-sm font-black text-slate-700 mt-0.5">${student.q1 || '-'}</div>
                    </div>
                    <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '2nd' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '2nd')">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">2nd Qtr</div>
                        <div class="text-sm font-black text-slate-700 mt-0.5">${student.q2 || '-'}</div>
                    </div>
                    <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '3rd' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '3rd')">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">3rd Qtr</div>
                        <div class="text-sm font-black text-slate-700 mt-0.5">${student.q3 || '-'}</div>
                    </div>
                    <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-100 ${activeQuarterFilter !== 'All' && activeQuarterFilter !== '4th' ? 'hidden' : ''}" onclick="openAdminBreakdown(this, '${student.studentNumber}', '${student.subject}', '4th')">
                        <div class="text-[10px] font-bold text-slate-400 uppercase">4th Qtr</div>
                        <div class="text-sm font-black text-slate-700 mt-0.5">${student.q4 || '-'}</div>
                    </div>
                </div>
                <div class="flex items-center justify-between pt-2">
                    <div>${remarksUI}</div>
                    <button onclick="openSlidePanel('${student.studentNumber}', '${student.subject}')" class="text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 hover:text-white transition-colors border border-indigo-100 shadow-sm">Manage Grades</button>
                </div>
            </div>
        `;
        mobileList.appendChild(card);
    });
}

function toggleMobileCard(index) {
    const drawer = document.getElementById(`mobile-drawer-${index}`);
    const arrow = document.getElementById(`mobile-arrow-${index}`);
    if (drawer.classList.contains('hidden')) {
        drawer.classList.remove('hidden');
        arrow.style.transform = 'rotate(180deg)';
        arrow.classList.add('bg-indigo-50', 'text-indigo-600');
    } else {
        drawer.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
        arrow.classList.remove('bg-indigo-50', 'text-indigo-600');
    }
}

document.getElementById('admin-search').addEventListener('input', applyAdminFilters);
document.getElementById('section-filter').addEventListener('change', applyAdminFilters);

function applyAdminFilters() {
    const search = document.getElementById('admin-search').value.toLowerCase();
    const sec = document.getElementById('section-filter').value;
    const filtered = currentAdminData.filter(s => (s.name.toLowerCase().includes(search) || s.studentNumber.toString().includes(search)) && (sec === "All" || s.section === sec));
    updateSummaryMetrics(filtered);
    renderAdminTable(filtered);
    renderAdminMobileCards(filtered);
}

function populateSectionFilter() {
    const sections = [...new Set(currentAdminData.map(s => s.section))].filter(Boolean).sort();
    document.getElementById('section-filter').innerHTML = `<option value="All">All Sections</option>` + sections.map(s => `<option value="${s}">${s}</option>`).join('');
}

function populateGradingSheetSections(sections) {
    const gsSec = document.getElementById('gs-section');
    if (!gsSec) return;
    const currentVal = gsSec.value;
    const defaultSecs = sections.length > 0 ? sections : ["Section A", "Section B", "Block 1", "Block 2"];
    gsSec.innerHTML = `<option value="All">All Sections</option>` + defaultSecs.map(sec => `<option value="${sec}">${sec}</option>`).join('');
    if (currentVal) gsSec.value = currentVal;
}

let sortDirectionNo = 1; let sortDirectionName = 1;
function sortByStudentNo() {
    sortDirectionNo *= -1; 
    currentAdminData.sort((a, b) => {
        const noA = String(a.studentNumber).toLowerCase(); const noB = String(b.studentNumber).toLowerCase();
        if (noA < noB) return -1 * sortDirectionNo; if (noA > noB) return 1 * sortDirectionNo; return 0;
    });
    document.getElementById('student-no-sort-icon').innerHTML = sortDirectionNo === 1 ? '&#8593;' : '&#8595;';
    document.getElementById('name-sort-icon').innerHTML = '&#8597;'; applyAdminFilters(); 
}

function sortByName() {
    sortDirectionName *= -1;
    currentAdminData.sort((a, b) => {
        const nameA = String(a.name).toLowerCase(); const nameB = String(b.name).toLowerCase();
        if (nameA < nameB) return -1 * sortDirectionName; if (nameA > nameB) return 1 * sortDirectionName; return 0;
    });
    document.getElementById('name-sort-icon').innerHTML = sortDirectionName === 1 ? '&#8593;' : '&#8595;';
    document.getElementById('student-no-sort-icon').innerHTML = '&#8597;'; applyAdminFilters();
}

// ==========================================
// STUDENT DASHBOARD
// ==========================================

function initializeStudentDropdowns(subjectsArr) {
    const sySelect = document.getElementById('student-sy-selector');
    const subjSelect = document.getElementById('student-subject-selector');
    
    let years = new Set();
    let hasSYFormat = false;
    
    subjectsArr.forEach(s => {
        const match = s.match(/\(SY.*?\)/i);
        if (match) {
            years.add(match[0]);
            hasSYFormat = true;
        } else {
            years.add("General Subjects");
        }
    });

    if (hasSYFormat) {
        sySelect.classList.remove('hidden');
        const sortedYears = Array.from(years).sort().reverse();
        sySelect.innerHTML = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
        changeStudentSY(sortedYears[0]); 
    } else {
        sySelect.classList.add('hidden');
        subjSelect.innerHTML = subjectsArr.map(s => `<option value="${s}">${s}</option>`).join('');
        changeStudentSubject(subjectsArr[0]);
    }
}

function changeStudentSY(selectedYear) {
    const subjSelect = document.getElementById('student-subject-selector');
    const allSubjects = Object.keys(currentStudentData.subjects);
    let filteredSubjects = [];
    
    if (selectedYear === "General Subjects") {
        filteredSubjects = allSubjects.filter(s => !s.match(/\(SY.*?\)/i));
    } else {
        filteredSubjects = allSubjects.filter(s => s.includes(selectedYear));
    }

    if(filteredSubjects.length === 0) {
        subjSelect.innerHTML = `<option>No subjects found</option>`;
        document.getElementById('student-main-grades').innerHTML = '';
        return;
    }

    subjSelect.innerHTML = filteredSubjects.map(s => `<option value="${s}">${s.replace(` ${selectedYear}`, '').replace(`${selectedYear}`, '')}</option>`).join('');
    changeStudentSubject(filteredSubjects[0]);
}

function changeStudentSubject(subject) { 
    activeStudentSubject = subject; 
    
    const cleanLabel = subject.replace(/\(SY.*?\)/i, '').trim();
    document.getElementById('print-subject-label').innerText = `Subject: ${cleanLabel}`;
    
    renderStudentDashboard(subject); 
}

function renderStudentDashboard(subject) {
    const g = currentStudentData.subjects[subject].grades;
    
    const getRemarksUI = (rem) => rem === 'Passed' 
        ? '<span class="badge-passed px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-sm"><svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> PASSED</span>' 
        : (rem === 'Failed' 
            ? '<span class="badge-failed px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold shadow-sm"><svg class="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> FAILED</span>' 
            : '<span class="text-slate-400 font-semibold">-</span>');

    document.getElementById('student-main-grades').innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-6">
            <div onclick="openBreakdown('1st', '${subject}')" class="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md flex flex-col items-center justify-center cursor-pointer transition-colors"><span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">1st Quarter</span><span class="text-2xl sm:text-3xl font-black text-slate-800">${g.q1 || '-'}</span></div>
            <div onclick="openBreakdown('2nd', '${subject}')" class="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md flex flex-col items-center justify-center cursor-pointer transition-colors"><span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">2nd Quarter</span><span class="text-2xl sm:text-3xl font-black text-slate-800">${g.q2 || '-'}</span></div>
            <div onclick="openBreakdown('3rd', '${subject}')" class="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md flex flex-col items-center justify-center cursor-pointer transition-colors"><span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">3rd Quarter</span><span class="text-2xl sm:text-3xl font-black text-slate-800">${g.q3 || '-'}</span></div>
            <div onclick="openBreakdown('4th', '${subject}')" class="bg-white border border-slate-200 hover:border-indigo-300 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md flex flex-col items-center justify-center cursor-pointer transition-colors"><span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 sm:mb-2">4th Quarter</span><span class="text-2xl sm:text-3xl font-black text-slate-800">${g.q4 || '-'}</span></div>
            <div class="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl p-4 sm:p-5 shadow-md flex flex-col items-center justify-center text-white"><span class="text-[10px] sm:text-xs font-bold text-indigo-100 uppercase tracking-wider mb-1 sm:mb-2">Final Grade</span><span class="text-3xl sm:text-4xl font-black">${g.final || '-'}</span></div>
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center"><span class="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 sm:mb-3">Status</span>${getRemarksUI(g.remarks)}</div>
        </div>
    `;
}

async function openAdminBreakdown(cell, studentNumber, subject, quarter) {
    const originalText = cell.innerText;
    cell.innerText = "...";
    try {
        const res = await apiCall({ action: "getStudent", studentNumber: studentNumber });
        if (res && res.studentNumber) { currentStudentData = res; openBreakdown(quarter, subject); }
    } catch (e) { showToast("Could not load breakdown.", "error"); } finally { cell.innerText = originalText; }
}

function openBreakdown(quarter, subject) {
    const breakdown = currentStudentData.subjects[subject].breakdowns.find(b => b.quarter.toString().includes(quarter.replace(/\D/g, '')));
    document.getElementById('breakdown-title').innerText = `${quarter} Quarter Details`;
    document.getElementById('breakdown-subject-label').innerText = `${subject.replace(/\(SY.*?\)/i, '').trim()} Component View`;

    if (!breakdown) { document.getElementById('breakdown-content').innerHTML = `<div class="p-8 text-slate-400 text-center font-medium">Breakdown not available yet.</div>`; showScreen('breakdown'); return; }

    let html = `
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 sm:gap-4" id="breakdown-grid-row">
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="quizzes"><span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Quizzes</span><span class="text-xl sm:text-2xl font-black text-slate-800 value-text">${breakdown.quizzes}</span></div>
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="participation"><span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Participation</span><span class="text-xl sm:text-2xl font-black text-slate-800 value-text">${breakdown.participation}</span></div>
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="attendance"><span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Attendance</span><span class="text-xl sm:text-2xl font-black text-slate-800 value-text">${breakdown.attendance}</span></div>
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center" data-field="exams"><span class="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">Exams</span><span class="text-xl sm:text-2xl font-black text-slate-800 value-text">${breakdown.exams}</span></div>
            <div class="col-span-2 sm:col-span-1 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center"><span class="text-[10px] sm:text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1 sm:mb-2">Total</span><span class="text-2xl sm:text-3xl font-black text-indigo-700" id="bd-total">${breakdown.total}</span></div>
        </div>
    `;
    if (adminPin !== "") html += `<div class="mt-8 pt-6 border-t border-slate-100 flex justify-end no-print"><button onclick="toggleBreakdownEdit(this, '${quarter}', '${subject}')" class="w-full sm:w-auto bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-xl hover:bg-slate-50 shadow-sm font-semibold transition-colors text-sm">Edit Breakdown</button></div>`;
    document.getElementById('breakdown-content').innerHTML = html; showScreen('breakdown');
}

async function toggleBreakdownEdit(btn, quarter, subject) {
    const gridRow = document.getElementById('breakdown-grid-row');
    if (!btn.innerText.includes("Save")) {
        ['quizzes', 'participation', 'attendance', 'exams'].forEach(f => {
            const t = gridRow.querySelector(`div[data-field="${f}"] .value-text`);
            t.innerHTML = `<input type="number" class="w-16 sm:w-20 border-2 border-indigo-200 rounded-lg px-2 py-1 text-center bg-white outline-none text-base" value="${t.innerText === '-' ? '' : t.innerText}">`;
        });
        btn.innerText = "Save Changes"; btn.className = "w-full sm:w-auto bg-emerald-600 text-white px-6 py-2.5 rounded-xl hover:bg-emerald-700 shadow-md font-semibold transition-colors text-sm";
    } else {
        btn.innerText = "Saving..."; btn.disabled = true;
        const bd = {}; ['quizzes', 'participation', 'attendance', 'exams'].forEach(f => bd[f] = Number(gridRow.querySelector(`div[data-field="${f}"] .value-text input`).value || 0));
        const res = await apiCall({ action: "saveBreakdown", pin: adminPin, studentNumber: currentStudentData.studentNumber, subject: subject, quarter: quarter, breakdown: bd });
        if (res.success) {
            document.getElementById('bd-total').innerText = res.newTotal;
            ['quizzes', 'participation', 'attendance', 'exams'].forEach(f => gridRow.querySelector(`div[data-field="${f}"] .value-text`).innerHTML = bd[f]);
            btn.innerText = "Edit Breakdown"; btn.className = "w-full sm:w-auto bg-white border border-slate-200 text-slate-700 px-6 py-2.5 rounded-xl hover:bg-slate-50 font-semibold transition-colors text-sm"; btn.disabled = false;
            showToast("Breakdown successfully updated.");
            updateLastSavedTimestamp();
            await loadAdminDashboard();
        } else { showToast("Failed to save changes.", "error"); btn.innerText = "Save Changes"; btn.disabled = false; }
    }
}

document.getElementById('back-to-dashboard-btn').addEventListener('click', () => adminPin !== "" ? showScreen('admin') : showScreen('student'));

// ==========================================
// EXPORT CSV BACKUP
// ==========================================
function exportTableToCSV(filename) {
    if (!currentAdminData || currentAdminData.length === 0) {
        showToast("No data available to export.", "error");
        return;
    }

    let csv = [];
    csv.push(["Student Number", "Full Name", "Section", "Subject", "1st Quarter", "2nd Quarter", "3rd Quarter", "4th Quarter", "Final Grade", "Remarks"].join(","));

    currentAdminData.forEach(student => {
        let row = [
            `"${student.studentNumber || ''}"`,
            `"${(student.name || '').replace(/"/g, '""')}"`,
            `"${(student.section || '').replace(/"/g, '""')}"`,
            `"${(student.subject || '').replace(/"/g, '""')}"`,
            student.q1 || '',
            student.q2 || '',
            student.q3 || '',
            student.q4 || '',
            student.final || '',
            `"${student.remarks || ''}"`
        ];
        csv.push(row.join(","));
    });

    const csvFile = new Blob([csv.join("\n")], { type: "text/csv" });
    const downloadLink = document.createElement("a");
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = "none";
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    showToast("Backup exported successfully!");
}

// ==========================================
// OFFICIAL GRADING SHEET GENERATOR & PREVIEW
// ==========================================
function buildGradingSheetHTML(subject, section, semester) {
    let students = currentAdminData.filter(s => s.subject === subject && (section === 'All' || s.section === section));
    
    if (students.length === 0) {
        return `<div class="p-8 text-center text-slate-400 bg-white rounded-xl font-bold">No students found matching this Subject and Section.</div>`;
    }

    const syMatch = subject.match(/\(SY.*?\)/i);
    let schoolYear = "";
    if (syMatch) {
        schoolYear = syMatch[0].replace(/- Sem \d/i, "").replace(/[()]/g, "").trim();
    }

    const cleanSubject = subject.replace(/\s*\(SY.*?\)/i, "").trim();
    const description = subjectDescriptions[subject] || '----------------';

    const pageSize = 35;
    let pagesHTML = '';
    
    for (let i = 0; i < students.length; i += pageSize) {
        const chunk = students.slice(i, i + pageSize);
        
        let rowsHTML = '';
        for (let idx = 0; idx < pageSize; idx++) {
            const student = chunk[idx];
            const num = i + idx + 1;
            
            if (student) {
                rowsHTML += `
                    <tr>
                        <td>${num}</td>
                        <td style="text-align: left; padding-left: 6px;">${student.name}</td>
                        <td>${student.q1 || ''}</td>
                        <td>${student.q2 || ''}</td>
                        <td>${student.q3 || ''}</td>
                        <td>${student.q4 || ''}</td>
                        <td>${student.final || ''}</td>
                        <td>${student.final || ''}</td>
                        <td>${student.remarks || ''}</td>
                    </tr>
                `;
            } else {
                rowsHTML += `
                    <tr>
                        <td>${num}</td>
                        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>
                `;
            }
        }

        pagesHTML += `
            <div class="gs-preview-page">
                <div style="text-align: center; font-weight: bold; font-size: 15px;">Pili Capital College, Inc.</div>
                <div style="text-align: center; font-size: 11px; margin-bottom: 2px;">San Isidro, Pili, Camarines Sur</div>
                <div style="text-align: center; font-weight: bold; font-size: 13px; margin-bottom: 15px; text-decoration: underline;">COLLEGE GRADING SHEET</div>
                
                <table style="width: 100%; font-size: 11px; margin-bottom: 10px;">
                    <tr>
                        <td style="text-align: left; border: none;"><b>Subject:</b> ${cleanSubject}</td>
                        <td style="text-align: right; border: none;"><b>Semester:</b> ${semester}</td>
                    </tr>
                    <tr>
                        <td style="text-align: left; border: none;"><b>Description:</b> ${description}</td>
                        <td style="text-align: right; border: none;"><b>School Year:</b> ${schoolYear || '----------------'}</td>
                    </tr>
                </table>

                <table class="gs-table">
                    <thead>
                        <tr>
                            <th rowspan="2" style="width: 30px;">#</th>
                            <th rowspan="2">Name of Student</th>
                            <th rowspan="2" style="width: 50px;">Prelims</th>
                            <th rowspan="2" style="width: 50px;">Midterm</th>
                            <th rowspan="2" style="width: 50px;">Semi Final</th>
                            <th rowspan="2" style="width: 50px;">Finals</th>
                            <th colspan="2" style="width: 90px;">Gen. Ave.</th>
                            <th rowspan="2" style="width: 70px;">Remarks</th>
                        </tr>
                        <tr>
                            <th style="width: 45px;">GWA</th>
                            <th style="width: 45px;">EQV.</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHTML}
                    </tbody>
                </table>

                <table style="width: 100%; margin-top: 45px; font-size: 11px; border: none;">
                    <tr>
                        <td style="text-align: left; border: none;">Submitted by: <b>Carl Harry M. Pandes</b></td>
                        <td style="text-align: left; border: none;">Received by: _______________________</td>
                    </tr>
                </table>
            </div>
        `;
    }
    return pagesHTML;
}

function updateGradingSheetPreview() {
    const subjectElem = document.getElementById('gs-subject');
    const sectionElem = document.getElementById('gs-section');
    const semesterElem = document.getElementById('gs-semester');
    const container = document.getElementById('gs-preview-container');
    
    if (!subjectElem || !sectionElem || !semesterElem || !container) return;

    const subject = subjectElem.value;
    const section = sectionElem.value;
    const semester = semesterElem.value;
    
    container.innerHTML = buildGradingSheetHTML(subject, section, semester);
}

function printGradingSheets() {
    const subject = document.getElementById('gs-subject').value;
    const section = document.getElementById('gs-section').value;
    const semester = document.getElementById('gs-semester').value;
    
    document.getElementById('grading-sheet-print-area').innerHTML = buildGradingSheetHTML(subject, section, semester);
    window.print();
}

// ==========================================
// SLIDE PANEL (CRUD)
// ==========================================
function openSlidePanel(studentNo, subject) {
    const student = currentAdminData.find(s => String(s.studentNumber) === String(studentNo) && s.subject === subject);
    if (!student) return;
    
    activeManageStudentId = studentNo;
    activeManageSubject = subject;

    ['old-student-id', 'student-id'].forEach(id => document.getElementById(`panel-${id}`).value = student.studentNumber);
    document.getElementById('panel-old-student-subject').value = subject;
    document.getElementById('panel-student-name').value = student.name; 
    document.getElementById('panel-student-section').value = student.section;
    document.getElementById('panel-student-subject').innerHTML = availableSubjects.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('panel-student-subject').value = subject;
    document.getElementById('panel-subject-label').innerText = activeManageSubject;
    ['q1','q2','q3','q4'].forEach(q => document.getElementById(`panel-${q}`).value = student[q] || '');
    document.getElementById('panel-header-name').innerText = student.name; document.getElementById('panel-header-id').innerText = `ID: ${student.studentNumber}`;
    
    const b = document.getElementById('slide-panel-backdrop'); const p = document.getElementById('slide-panel');
    b.classList.remove('hidden-screen'); setTimeout(() => { b.classList.remove('opacity-0'); p.classList.remove('translate-x-full'); }, 10);
}

function closeSlidePanel() { document.getElementById('slide-panel').classList.add('translate-x-full'); document.getElementById('slide-panel-backdrop').classList.add('opacity-0'); setTimeout(() => document.getElementById('slide-panel-backdrop').classList.add('hidden-screen'), 300); }

async function savePanelInfo() {
    const btn = document.getElementById('panel-save-info-btn'); btn.innerText = "Saving..."; btn.disabled = true;
    const newId = document.getElementById('panel-student-id').value.trim();
    const oldId = document.getElementById('panel-old-student-id').value;
    const newSubject = document.getElementById('panel-student-subject').value;
    const oldSubject = document.getElementById('panel-old-student-subject').value;

    const newData = { studentNumber: newId, name: document.getElementById('panel-student-name').value.trim(), section: document.getElementById('panel-student-section').value, subject: newSubject };
    const res = await apiCall({ action: "updateStudentInfo", pin: adminPin, oldStudentNumber: oldId, oldSubject: oldSubject, newData: newData });
    
    if (res.success) { 
        await loadAdminDashboard(); activeManageStudentId = newId; activeManageSubject = newSubject;
        document.getElementById('panel-old-student-id').value = newId; document.getElementById('panel-old-student-subject').value = newSubject;
        document.getElementById('panel-subject-label').innerText = newSubject; btn.innerText = "Saved"; 
        showToast("Profile successfully updated.");
        updateLastSavedTimestamp();
    } else { showToast(res.message, "error"); }
    setTimeout(() => { btn.innerText = "Update Profile & Subject"; btn.disabled = false; }, 1500);
}

async function savePanelGrades() {
    const btn = document.getElementById('panel-save-grades-btn'); btn.innerText = "Saving..."; btn.disabled = true;
    const grades = { q1: document.getElementById('panel-q1').value, q2: document.getElementById('panel-q2').value, q3: document.getElementById('panel-q3').value, q4: document.getElementById('panel-q4').value };
    const res = await apiCall({ action: "saveGrades", pin: adminPin, studentNumber: activeManageStudentId, subject: activeManageSubject, grades: grades });
    if (res.success) { 
        await loadAdminDashboard(); btn.innerText = "Saved"; 
        showToast("Grades explicitly saved.", "success");
        updateLastSavedTimestamp();
    } else { showToast(res.message, "error"); }
    setTimeout(() => { btn.innerText = "Save Grades"; btn.disabled = false; }, 1500);
}

async function deleteStudentFromPanel() { 
    if(confirm("Erase student profile completely? This cannot be undone.")) { 
        const res = await apiCall({ action: "deleteStudent", pin: adminPin, studentNumber: activeManageStudentId }); 
        if (res.success) { 
            showToast("Student deleted permanently.");
            updateLastSavedTimestamp();
            await loadAdminDashboard(); closeSlidePanel(); 
        } else { showToast(res.message, "error"); } 
    } 
}

function openAddStudentModal() { document.getElementById('add-student-modal').classList.remove('hidden-screen'); }
function closeAddStudentModal() { document.getElementById('add-student-modal').classList.add('hidden-screen'); }

async function saveNewStudent() {
    const id = document.getElementById('new-student-id').value.trim(), name = document.getElementById('new-student-name').value.trim(), sec = document.getElementById('new-student-section').value;
    const subjects = Array.from(document.querySelectorAll('#add-subject-checkboxes input:checked')).map(cb => cb.value);
    if (!id || !name || !sec || subjects.length === 0) { showToast("Fill all fields and select a section/subject.", "error"); return; }
    document.getElementById('save-new-student-btn').innerText = "Saving...";
    const res = await apiCall({ action: "addStudent", pin: adminPin, studentData: { studentNumber: id, name: name, section: sec, enrolledSubjects: subjects } });
    if(res.success) { 
        showToast(`Student ${name} successfully enrolled.`);
        closeAddStudentModal(); await loadAdminDashboard(); 
        updateLastSavedTimestamp();
        document.getElementById('new-student-id').value = '';
        document.getElementById('new-student-name').value = '';
    } else {
        showToast(res.message || "Failed to save new student.", "error");
    }
    document.getElementById('save-new-student-btn').innerText = "Save Student";
}

// ==========================================
// SMART PASTE / CSV LOGIC
// ==========================================
function toggleImportUI() {
    const action = document.getElementById('import-action').value;
    if (action === 'grades') {
        document.getElementById('import-quarter-container').classList.remove('hidden');
        document.getElementById('col-mapping-register').classList.add('hidden');
        document.getElementById('col-mapping-grades').classList.remove('hidden');
    } else {
        document.getElementById('import-quarter-container').classList.add('hidden');
        document.getElementById('col-mapping-register').classList.remove('hidden');
        document.getElementById('col-mapping-grades').classList.add('hidden');
    }
}

function openImportModal() { 
    document.getElementById('import-modal').classList.remove('hidden-screen'); 
    document.getElementById('transfer-status').classList.add('hidden'); 
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('progress-container').classList.add('hidden');
    document.getElementById('preview-btn').classList.remove('hidden'); 
    document.getElementById('confirm-btn').classList.add('hidden');
    document.getElementById('import-cancel-btn').innerText = "Cancel";
    document.getElementById('import-cancel-btn').disabled = false;
    
    document.getElementById('csv-file-input').value = '';
    document.getElementById('smart-paste-input').value = '';
    
    document.getElementById('col-id-reg').value = ''; document.getElementById('col-name').value = ''; document.getElementById('col-sec').value = '';
    document.getElementById('col-id-grades').value = ''; document.getElementById('col-quiz').value = ''; document.getElementById('col-part').value = ''; document.getElementById('col-att').value = ''; document.getElementById('col-exam').value = '';
    pendingImportData = [];
    toggleImportUI();
}

function closeImportModal() { document.getElementById('import-modal').classList.add('hidden-screen'); }
const readCSVFile = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = () => rej(new Error()); r.readAsText(file); });

function parseCSV(str) { 
    const result = []; let cell = ''; let inQuotes = false; 
    for (let i = 0; i < str.length; i++) { 
        const char = str[i]; 
        if (char === '"' && str[i+1] === '"') { cell += '"'; i++; } 
        else if (char === '"') { inQuotes = !inQuotes; } 
        else if (char === ',' && !inQuotes) { result.push(cell.trim()); cell = ''; } 
        else { cell += char; } 
    } 
    result.push(cell.trim()); 
    return result; 
}

const getCol = id => {
    const val = document.getElementById(id).value.trim().toUpperCase();
    if(!val) return -1;
    return val.charCodeAt(0) - 65;
};

async function previewDataTransfer() {
    const action = document.getElementById('import-action').value;
    const fileInput = document.getElementById('csv-file-input'); 
    const pasteInput = document.getElementById('smart-paste-input').value;
    const status = document.getElementById('transfer-status');
    const previewSection = document.getElementById('preview-section');
    const thead = document.getElementById('preview-thead');
    const tbody = document.getElementById('preview-table-body');
    const btn = document.getElementById('preview-btn');

    status.classList.add('hidden'); previewSection.classList.add('hidden'); pendingImportData = [];

    if (!fileInput.files.length && !pasteInput.trim()) { 
        showToast("Please provide CSV file or paste data.", "error"); return; 
    }
    
    btn.innerHTML = "Reading..."; btn.disabled = true;

    try {
        const subj = document.getElementById('import-subject').value;
        let rawRows = [];
        let isPaste = false;
        
        if (pasteInput.trim()) {
            rawRows = pasteInput.trim().split('\n');
            isPaste = true;
        } else {
            rawRows = (await readCSVFile(fileInput.files[0])).split('\n');
        }

        tbody.innerHTML = '';
        const startRow = isPaste ? 0 : 1;

        if (action === 'register') {
            const cId = getCol('col-id-reg'), cName = getCol('col-name'), cSec = getCol('col-sec');
            if (cId < 0 || cName < 0) throw new Error("ID and Name columns are required.");
            
            thead.innerHTML = `<tr><th class="p-3 font-bold">Student No.</th><th class="p-3 font-bold">Name</th>${cSec >= 0 ? '<th class="p-3 font-bold">Section</th>' : ''}</tr>`;

            for (let i = startRow; i < rawRows.length; i++) {
                if (!rawRows[i].trim()) continue;
                const cols = isPaste ? rawRows[i].split('\t').map(c => c.trim().replace(/^"|"$/g, '')) : parseCSV(rawRows[i]);
                
                if (cols[cId] && cols[cName]) {
                    if(String(cols[cId]).toLowerCase().includes('student')) continue;
                    const cleanNo = String(cols[cId]).trim();
                    const sec = cSec >= 0 ? (cols[cSec] || "").trim() : "";
                    
                    pendingImportData.push({ studentNumber: cleanNo, name: cols[cName].trim(), section: sec, enrolledSubjects: [subj] });
                    
                    let rowHTML = `<tr class="hover:bg-slate-50 transition-colors"><td class="p-3 border-b border-slate-100 font-semibold">${cleanNo}</td><td class="p-3 border-b border-slate-100 font-bold text-slate-700">${cols[cName].trim()}</td>`;
                    if(cSec >= 0) rowHTML += `<td class="p-3 border-b border-slate-100 text-slate-500">${sec}</td>`;
                    rowHTML += `</tr>`;
                    tbody.innerHTML += rowHTML;
                }
            }
        } else if (action === 'grades') {
            const cId = getCol('col-id-grades');
            const cQz = getCol('col-quiz');
            const cPa = getCol('col-part');
            const cAt = getCol('col-att');
            const cEx = getCol('col-exam');

            if (cId < 0) throw new Error("Student ID column is required.");
            if (cQz < 0 && cPa < 0 && cAt < 0 && cEx < 0) throw new Error("Please map at least one grade category.");

            let headHTML = `<tr><th class="p-3 font-bold">Student No.</th>`;
            if(cQz >= 0) headHTML += `<th class="p-3 font-bold text-center">Quizzes</th>`;
            if(cPa >= 0) headHTML += `<th class="p-3 font-bold text-center">Part.</th>`;
            if(cAt >= 0) headHTML += `<th class="p-3 font-bold text-center">Att.</th>`;
            if(cEx >= 0) headHTML += `<th class="p-3 font-bold text-center">Exams</th>`;
            headHTML += `</tr>`;
            thead.innerHTML = headHTML;

            for (let i = startRow; i < rawRows.length; i++) {
                if (!rawRows[i].trim()) continue;
                const cols = isPaste ? rawRows[i].split('\t').map(c => c.trim().replace(/^"|"$/g, '')) : parseCSV(rawRows[i]);
                
                if (cols[cId]) {
                    if(String(cols[cId]).toLowerCase().includes('student')) continue;

                    const cleanNo = String(cols[cId]).trim();
                    const qz = cQz >= 0 ? (Number(cols[cQz]) || 0) : null;
                    const pa = cPa >= 0 ? (Number(cols[cPa]) || 0) : null;
                    const at = cAt >= 0 ? (Number(cols[cAt]) || 0) : null;
                    const ex = cEx >= 0 ? (Number(cols[cEx]) || 0) : null;

                    pendingImportData.push({ studentNumber: cleanNo, quizzes: qz, participation: pa, attendance: at, exams: ex });
                    
                    let rowHTML = `<tr class="hover:bg-slate-50 transition-colors"><td class="p-3 border-b border-slate-100 font-semibold">${cleanNo}</td>`;
                    if(cQz >= 0) rowHTML += `<td class="p-3 border-b border-slate-100 font-bold text-slate-700 text-center">${qz}</td>`;
                    if(cPa >= 0) rowHTML += `<td class="p-3 border-b border-slate-100 font-bold text-slate-700 text-center">${pa}</td>`;
                    if(cAt >= 0) rowHTML += `<td class="p-3 border-b border-slate-100 font-bold text-slate-700 text-center">${at}</td>`;
                    if(cEx >= 0) rowHTML += `<td class="p-3 border-b border-slate-100 font-bold text-slate-700 text-center">${ex}</td>`;
                    rowHTML += `</tr>`;
                    tbody.innerHTML += rowHTML;
                }
            }
        }

        if (pendingImportData.length > 0) {
            status.innerText = `Found ${pendingImportData.length} valid entries to process.`; 
            status.className = "bg-emerald-50 border-emerald-200 text-emerald-700 mt-4 p-3 rounded-xl font-bold text-sm text-center";
            status.classList.remove('hidden'); previewSection.classList.remove('hidden');
            btn.classList.add('hidden'); document.getElementById('confirm-btn').classList.remove('hidden');
        } else {
            showToast("No valid data found. Check columns.", "error");
        }
    } catch (e) { 
        showToast(e.message, "error");
    }
    btn.innerHTML = "Preview Data"; btn.disabled = false;
}

async function confirmDataTransfer() {
    const btn = document.getElementById('confirm-btn'), cancelBtn = document.getElementById('import-cancel-btn');
    const status = document.getElementById('transfer-status'), progressContainer = document.getElementById('progress-container');
    
    btn.classList.add('hidden'); cancelBtn.disabled = true; status.classList.add('hidden'); progressContainer.classList.remove('hidden');
    
    const action = document.getElementById('import-action').value;
    const subj = document.getElementById('import-subject').value;
    const qtr = document.getElementById('import-quarter').value;
    const totalItems = pendingImportData.length; let successCount = 0; const startTime = Date.now();
    
    try {
        for (let i = 0; i < totalItems; i++) {
            const item = pendingImportData[i];
            if (action === 'register') {
                await apiCall({ action: "registerStudent", studentData: item });
            } else {
                const studentRes = await apiCall({ action: "getStudent", studentNumber: item.studentNumber });
                let bd = { quizzes: 0, participation: 0, attendance: 0, exams: 0 };
                
                if (studentRes && studentRes.subjects && studentRes.subjects[subj]) {
                    const existing = studentRes.subjects[subj].breakdowns.find(b => b.quarter.toString().includes(qtr.replace(/\D/g, '')));
                    if (existing) bd = existing;
                }

                if (item.quizzes !== null) bd.quizzes = item.quizzes;
                if (item.participation !== null) bd.participation = item.participation;
                if (item.attendance !== null) bd.attendance = item.attendance;
                if (item.exams !== null) bd.exams = item.exams;

                await apiCall({ action: "saveBreakdown", pin: adminPin, studentNumber: item.studentNumber, subject: subj, quarter: qtr, breakdown: bd });
            }
            
            // Added 150ms delay to prevent Google Apps Script rate-limiting / concurrency errors
            await new Promise(resolve => setTimeout(resolve, 150));

            successCount++;
            
            const percent = Math.round((successCount / totalItems) * 100);
            const elapsedTime = (Date.now() - startTime) / 1000;
            const estimatedSecondsLeft = Math.round((elapsedTime / successCount) * (totalItems - successCount));
            
            document.getElementById('progress-bar-fill').style.width = `${percent}%`;
            document.getElementById('progress-percentage').innerText = `${percent}%`;
            document.getElementById('progress-count').innerText = `${successCount} of ${totalItems} processed`;
            document.getElementById('progress-eta').innerText = estimatedSecondsLeft > 60 ? `~${Math.floor(estimatedSecondsLeft/60)}m ${estimatedSecondsLeft%60}s remaining` : (estimatedSecondsLeft > 1 ? `~${estimatedSecondsLeft}s remaining` : "Almost done...");
        }

        status.innerText = `Success! Updated ${successCount} records.`;
        status.className = "bg-emerald-50 border border-emerald-200 text-emerald-700 mt-4 p-3 rounded-xl font-bold text-sm text-center";
        status.classList.remove('hidden'); cancelBtn.innerText = "Close"; cancelBtn.disabled = false;
        
        showToast(`Successfully processed ${successCount} entries!`);
        updateLastSavedTimestamp();
        await loadAdminDashboard(); 

    } catch (error) {
        showToast("Error during transfer", "error");
        btn.classList.remove('hidden'); cancelBtn.disabled = false;
    }
}

// ==========================================
// PUBLIC REGISTRATION
// ==========================================
function openRegisterModal() { 
    document.getElementById('reg-error').classList.add('hidden');
    document.getElementById('register-modal').classList.remove('hidden-screen'); 
}
function closeRegisterModal() { document.getElementById('register-modal').classList.add('hidden-screen'); }

async function submitRegistration() {
    const id = document.getElementById('reg-student-id').value.trim();
    const name = document.getElementById('reg-student-name').value.trim();
    const sec = document.getElementById('reg-student-section').value;
    const subjects = Array.from(document.querySelectorAll('#reg-subject-checkboxes input:checked')).map(cb => cb.value);
    
    const errorBox = document.getElementById('reg-error');
    errorBox.classList.add('hidden');
    errorBox.innerText = "";

    if (!id || !name || !sec || subjects.length === 0) {
        errorBox.innerText = "Please fill in all fields and select a section and at least one subject.";
        errorBox.classList.remove('hidden');
        return;
    }

    const btn = document.getElementById('submit-reg-btn');
    btn.innerText = "Checking ID...";
    btn.disabled = true;
    
    try {
        const res = await apiCall({ action: "registerStudent", studentData: { studentNumber: id, name: name, section: sec, enrolledSubjects: subjects } });
        
        if(res.success) { 
            closeRegisterModal(); 
            showToast("Registration successful! Logging you in...");
            document.getElementById('login-input').value = id; 
            document.getElementById('login-btn').click(); 
        } else {
            errorBox.innerText = res.message || "Student number already exists or registration failed.";
            errorBox.classList.remove('hidden');
            showToast(res.message || "Registration failed.", "error");
        }
    } catch (err) {
        errorBox.innerText = "Network error. Please try again.";
        errorBox.classList.add('hidden');
    }
    
    btn.innerText = "Register Profile";
    btn.disabled = false;
}

async function apiCall(payload) { return await (await fetch(WEB_APP_URL, { method: 'POST', body: JSON.stringify(payload) })).json(); }