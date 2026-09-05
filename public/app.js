const app = document.getElementById("app");
const state = { token: localStorage.getItem("fmc_token"), user: null, issues: [], staff: [], analytics: null };

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const api = async (url, opts={}) => {
  opts.headers = opts.headers || {};
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  const r = await fetch(url, opts);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.message || "Request failed");
  return data;
};
const notify = msg => alert(msg);
const statusClass = s => s.replace(/\s/g,"");

async function boot(){
  if(!state.token) return renderAuth();
  try { state.user = (await api("/api/auth/me")).user; renderShell(); await refresh(); }
  catch { logout(); }
}
function renderAuth(){
  app.innerHTML = `<div class="login"><div class="loginbox">
    <div class="brand">Fix My <span>Campus</span></div>
    <p class="muted">Report. Track. Resolve campus problems.</p>
    <div class="tabs"><button id="loginTab" class="active" type="button">Login</button><button id="registerTab" type="button">Register</button></div>
    <div id="authForm"></div>
  </div></div>`;

  const authForm = document.getElementById("authForm");
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");

  function renderLoginForm(){
    loginTab.classList.add("active");
    registerTab.classList.remove("active");
    authForm.innerHTML = `
      <form id="loginForm">
        <div class="field"><label for="loginEmail">Email</label><input id="loginEmail" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="loginPassword">Password</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" style="width:100%" type="submit">Login</button>
        <p class="muted" style="font-size:13px;margin-top:15px">Admin demo: admin@campus.local / Admin@123</p>
      </form>`;
    document.getElementById("loginForm").addEventListener("submit", authSubmit);
  }

  function renderRegisterForm(){
    registerTab.classList.add("active");
    loginTab.classList.remove("active");
    authForm.innerHTML = `
      <form id="registerForm">
        <div class="field"><label for="registerName">Full name</label><input id="registerName" name="name" autocomplete="name" required></div>
        <div class="field"><label for="registerEmail">Email</label><input id="registerEmail" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="registerDepartment">Department</label><input id="registerDepartment" name="department" placeholder="CSE"></div>
        <div class="field"><label for="registerPassword">Password</label><input id="registerPassword" name="password" type="password" autocomplete="new-password" minlength="6" required></div>
        <button class="btn primary" style="width:100%" type="submit">Create student account</button>
      </form>`;
    document.getElementById("registerForm").addEventListener("submit", authSubmit);
  }

  loginTab.addEventListener("click", renderLoginForm);
  registerTab.addEventListener("click", renderRegisterForm);
  renderLoginForm();
}

async function authSubmit(e){
  e.preventDefault();
  const form = e.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  try{
    const endpoint = form.id === "loginForm" ? "/api/auth/login" : "/api/auth/register";
    const data = await api(endpoint, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body)
    });
    state.token=data.token;
    state.user=data.user;
    localStorage.setItem("fmc_token",data.token);
    renderShell();
    await refresh();
  }catch(err){
    notify(err.message);
  }
}
function renderShell(){
  const isStudent=state.user.role==="student";
  app.innerHTML=`<header class="topbar"><div class="brand">Fix My <span>Campus</span></div>
    <div class="nav"><span class="user-email">${esc(state.user.name)} · ${state.user.role}</span><button class="btn ghost" onclick="logout()">Logout</button></div></header>
    <main class="page">
      <section class="hero"><h1>${isStudent?"Campus Issue Portal":"Admin Control Center"}</h1><p>${isStudent?"Report a problem and follow its progress from submission to resolution.":"Review, assign, prioritize and resolve campus issues."}</p></section>
      <div id="content"></div>
    </main><div class="footer">Fix My Campus · Full-stack issue management system</div>
    <div id="modal" class="modal"></div>`;
}
async function refresh(){
  const dash=await api("/api/dashboard");
  state.issues=await api("/api/issues");
  state.analytics=await api("/api/analytics");
  if(state.user.role==="admin") state.staff=await api("/api/users/staff");
  renderDashboard(dash);
}
function renderDashboard(d){
  const cards=[
    ["Total Issues",d.total,"📋"],
    ["Pending",d.pending,"⏳"],
    ["In Progress",d.progress,"🔧"],
    ["Resolved",d.resolved,"✅"]
  ];
  const a=state.analytics || {totals:{}};
  document.getElementById("content").innerHTML=`
  <div class="grid">${cards.map(x=>`<div class="card metric"><div class="metric-icon">${x[2]}</div><div class="muted">${x[0]}</div><div class="stat">${x[1]}</div></div>`).join("")}</div>
  <div class="toolbar">
    ${state.user.role==="student"?`<button class="btn primary" onclick="openReport()">+ Report Issue</button>`:""}
    <button class="btn secondary" onclick="downloadReport()">⬇ Export CSV</button>
    <input id="search" placeholder="Search issues..." oninput="filterIssues()">
    <select id="statusFilter" onchange="filterIssues()"><option value="">All status</option><option>Pending</option><option>Assigned</option><option>In Progress</option><option>Resolved</option><option>Rejected</option></select>
    <select id="priorityFilter" onchange="filterIssues()"><option value="">All priority</option><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option></select>
    <select id="categoryFilter" onchange="filterIssues()"><option value="">All categories</option><option>Electrical</option><option>Plumbing</option><option>Cleanliness</option><option>Infrastructure</option><option>Internet</option><option>Safety</option><option>Other</option></select>
  </div>
  <section class="analytics-head"><div><h2>Campus Analytics</h2><p class="muted">Live insights from reported issues and resolution activity.</p></div></section>
  <div class="grid analytics-summary">
    <div class="card"><div class="muted">Resolution Rate</div><div class="stat">${a.totals.resolutionRate||0}%</div><div class="progress"><span style="width:${Math.min(100,a.totals.resolutionRate||0)}%"></span></div></div>
    <div class="card"><div class="muted">Urgent Issues</div><div class="stat">${a.totals.urgent||0}</div><p class="muted small">High-priority attention required</p></div>
    <div class="card"><div class="muted">Overdue &gt; 3 days</div><div class="stat">${a.totals.overdue||0}</div><p class="muted small">Pending, assigned or in progress</p></div>
    <div class="card"><div class="muted">Avg. Resolution</div><div class="stat">${a.totals.avgResolutionHours||0}h</div><p class="muted small">Average time for resolved issues</p></div>
  </div>
  <div class="analytics-grid">
    <div class="card chart-card"><h3>Status Breakdown</h3><div id="statusChart">${barChart(a.status||[])}</div></div>
    <div class="card chart-card"><h3>Issues by Category</h3><div id="categoryChart">${barChart(a.category||[])}</div></div>
    <div class="card chart-card"><h3>Priority Breakdown</h3><div id="priorityChart">${barChart(a.priority||[])}</div></div>
    <div class="card chart-card"><h3>Top Locations</h3><div id="locationChart">${barChart(a.location||[])}</div></div>
    <div class="card chart-card wide"><h3>Monthly Reports</h3><div id="monthlyChart">${barChart(a.monthly||[])}</div></div>
    ${state.user.role!=="student"?`<div class="card chart-card"><h3>Top Reporters</h3><div>${barChart(a.topReporter||[])}</div></div>`:""}
  </div>

  <section class="ai-section">
    <div class="ai-title">
      <div>
        <h2>🤖 AI Campus Assistant</h2>
        <p class="muted">Analyze complaints, suggest priority/category, and ask questions about your campus issues.</p>
      </div>
      <span class="ai-pill">AI ENABLED</span>
    </div>
    <div class="ai-grid">
      <div class="card">
        <h3>AI Issue Analyzer</h3>
        <p class="muted small">Enter a complaint to get a suggested category, priority, summary, and action.</p>
        <div class="field"><label>Issue title</label><input id="aiTitle" placeholder="e.g. Fan not working in Room 204"></div>
        <div class="field"><label>Description</label><textarea id="aiDescription" placeholder="Describe the problem..."></textarea></div>
        <div class="field"><label>Location</label><input id="aiLocation" placeholder="Block A - Room 204"></div>
        <button class="btn primary" onclick="analyzeWithAI()">✨ Analyze with AI</button>
        <div id="aiResult" class="ai-result"></div>
      </div>
      <div class="card">
        <h3>Ask AI</h3>
        <p class="muted small">Ask questions about reporting issues or the current dashboard.</p>
        <div id="aiChat" class="ai-chat"><div class="ai-message">Hi! I'm the Fix My Campus Assistant. How can I help?</div></div>
        <div class="ai-chat-row">
          <input id="aiQuestion" placeholder="Ask: How many urgent issues are there?">
          <button class="btn secondary" onclick="askAI()">Ask</button>
        </div>
      </div>
    </div>
  </section>

  <div id="issueList"></div>`;
  filterIssues();
}
function barChart(items){
  if(!items.length) return `<div class="empty-chart">No data available yet.</div>`;
  const max=Math.max(...items.map(x=>Number(x.value)||0),1);
  return items.map(x=>`<div class="bar-row"><div class="bar-label"><span>${esc(x.label)}</span><b>${x.value}</b></div><div class="bar-track"><span style="width:${Math.max(4,Math.round((x.value/max)*100))}%"></span></div></div>`).join("");
}
function downloadReport(){
  fetch("/api/reports/issues.csv",{headers:{Authorization:`Bearer ${state.token}`}})
    .then(async r=>{if(!r.ok) throw new Error((await r.json().catch(()=>({}))).message||"Export failed"); return r.blob();})
    .then(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="fix-my-campus-issues.csv";a.click();URL.revokeObjectURL(url);notify("CSV report downloaded");})
    .catch(err=>notify(err.message));
}
function filterIssues(){
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  const s=document.getElementById("statusFilter")?.value||"";
  const p=document.getElementById("priorityFilter")?.value||"";
  const c=document.getElementById("categoryFilter")?.value||"";
  const list=state.issues.filter(i=>(!s||i.status===s)&&(!p||i.priority===p)&&(!c||i.category===c)&&(!q||`${i.title} ${i.description} ${i.location}`.toLowerCase().includes(q)));
  document.getElementById("issueList").innerHTML=list.length?`<div class="tablewrap"><table class="table"><thead><tr>
    <th>ID</th><th>Issue</th><th>Category</th><th>Location</th><th>Priority</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${list.map(i=>`<tr><td>#${i.id}</td><td><b>${esc(i.title)}</b><br><small class="muted">${esc(i.student_name)}</small></td><td>${esc(i.category)}</td><td>${esc(i.location)}</td><td>${esc(i.priority)}</td><td><span class="badge ${statusClass(i.status)}">${esc(i.status)}</span></td><td><button class="btn secondary" onclick="viewIssue(${i.id})">View</button></td></tr>`).join("")}
  </tbody></table></div>`:`<div class="card empty"><h3>No issues found</h3><p class="muted">Try another filter or report a new issue.</p></div>`;
}
function openReport(){
  const modal=document.getElementById("modal");
  modal.className="modal show";
  modal.innerHTML=`<div class="modalbox"><div class="issue"><h2>Report a Campus Issue</h2><button class="btn ghost" onclick="closeModal()">✕</button></div>
  <form id="reportForm">
    <div class="field"><label>Title</label><input name="title" placeholder="Broken classroom fan" required></div>
    <div class="field"><label>Description</label><textarea name="description" placeholder="Describe the problem clearly..." required></textarea></div>
    <div class="layout"><div class="field"><label>Category</label><select name="category" required><option>Electrical</option><option>Plumbing</option><option>Cleanliness</option><option>Infrastructure</option><option>Internet</option><option>Safety</option><option>Other</option></select></div>
    <div class="field"><label>Priority</label><select name="priority"><option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option></select></div></div>
    <div class="field"><label>Location</label><input name="location" placeholder="Block A, Room 204" required></div>
    <div class="field"><label>Photo (optional, max 5MB)</label><input name="image" type="file" accept="image/png,image/jpeg,image/webp"></div>
    <button class="btn primary">Submit Issue</button></form></div>`;
  reportForm.onsubmit=async e=>{e.preventDefault();try{await api("/api/issues",{method:"POST",body:new FormData(reportForm)});closeModal();await refresh();notify("Issue reported successfully");}catch(err){notify(err.message)}};
}
async function viewIssue(id){
  try{
    const data=await api(`/api/issues/${id}`), i=data.issue;
    const modal=document.getElementById("modal"); modal.className="modal show";
    modal.innerHTML=`<div class="modalbox"><div class="issue"><div><h2>#${i.id} ${esc(i.title)}</h2><span class="badge ${statusClass(i.status)}">${esc(i.status)}</span></div><button class="btn ghost" onclick="closeModal()">✕</button></div>
    <p>${esc(i.description)}</p><p><b>Category:</b> ${esc(i.category)} &nbsp; <b>Location:</b> ${esc(i.location)} &nbsp; <b>Priority:</b> ${esc(i.priority)}</p>
    ${i.image?`<img src="${esc(i.image)}" style="max-width:100%;max-height:280px;border-radius:12px">`:""}
    ${state.user.role!=="student"?`<div class="layout" style="margin-top:15px"><div class="field"><label>Status</label><select id="editStatus">${["Pending","Assigned","In Progress","Resolved","Rejected"].map(s=>`<option ${s===i.status?"selected":""}>${s}</option>`).join("")}</select></div>
    <div class="field"><label>Assign staff</label><select id="editStaff"><option value="">Unassigned</option>${state.staff.map(u=>`<option value="${u.id}" ${u.id===i.assigned_to?"selected":""}>${esc(u.name)} (${esc(u.department)})</option>`).join("")}</select></div></div>
    <button class="btn primary" onclick="updateIssue(${i.id})">Save Changes</button>`:""}
    <hr><h3>Comments</h3><div>${data.comments.map(c=>`<div class="comment"><b>${esc(c.user_name)}</b> <small class="muted">· ${esc(c.user_role)}</small><div>${esc(c.message)}</div></div>`).join("")||`<p class="muted">No comments yet.</p>`}</div>
    <form id="commentForm" style="margin-top:12px"><div class="field"><textarea name="message" placeholder="Add an update or comment..." required></textarea></div><button class="btn secondary">Add Comment</button></form>
    </div>`;
    commentForm.onsubmit=async e=>{e.preventDefault();try{await api(`/api/issues/${id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:new FormData(commentForm).get("message")})});viewIssue(id)}catch(err){notify(err.message)}};
  }catch(err){notify(err.message)}
}
async function updateIssue(id){
  try{await api(`/api/issues/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:editStatus.value,assigned_to:editStaff.value||null})});await refresh();viewIssue(id);notify("Issue updated");}
  catch(err){notify(err.message)}
}
function closeModal(){document.getElementById("modal").className="modal"}
function logout(){localStorage.removeItem("fmc_token");state.token=null;state.user=null;renderAuth()}
boot();

async function analyzeWithAI(){
  const title = document.getElementById("aiTitle")?.value || "";
  const description = document.getElementById("aiDescription")?.value || "";
  const location = document.getElementById("aiLocation")?.value || "";
  const box = document.getElementById("aiResult");
  if(!title && !description){ notify("Enter an issue title or description"); return; }
  box.innerHTML = '<div class="ai-loading">Analyzing...</div>';
  try{
    const data = await api("/api/ai/analyze", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title,description,location})
    });
    box.innerHTML = `
      <div class="ai-result-head">AI suggestion <span class="ai-source">${data.source==="openai"?"OpenAI":"Local fallback"}</span></div>
      <div class="ai-tags"><span>Category: <b>${esc(data.category)}</b></span><span>Priority: <b>${esc(data.priority)}</b></span></div>
      <p><b>Summary:</b> ${esc(data.summary)}</p>
      <p><b>Recommendation:</b> ${esc(data.recommendation)}</p>`;
  }catch(e){ box.innerHTML = `<div class="ai-error">${esc(e.message)}</div>`; }
}

async function askAI(){
  const input = document.getElementById("aiQuestion");
  const chat = document.getElementById("aiChat");
  const message = input?.value.trim();
  if(!message) return;
  chat.innerHTML += `<div class="user-message">${esc(message)}</div>`;
  input.value = "";
  chat.innerHTML += `<div class="ai-message" id="aiTyping">Thinking...</div>`;
  chat.scrollTop = chat.scrollHeight;
  try{
    const data = await api("/api/ai/chat", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message})
    });
    document.getElementById("aiTyping")?.remove();
    chat.innerHTML += `<div class="ai-message">${esc(data.answer)}<div class="ai-source">${data.source==="openai"?"AI":"Local assistant"}</div></div>`;
  }catch(e){
    document.getElementById("aiTyping")?.remove();
    chat.innerHTML += `<div class="ai-error">${esc(e.message)}</div>`;
  }
  chat.scrollTop = chat.scrollHeight;
}

window.addEventListener("keydown", e => { if(e.key==="Enter" && document.activeElement?.id==="aiQuestion"){ e.preventDefault(); askAI(); } });

// Keep the session in sync across browser tabs/windows on the same origin.
// localStorage changes fire a "storage" event in every *other* tab, so when a
// user logs in (or out) in one tab, the others update instead of getting stuck
// on a stale login/dashboard screen.
window.addEventListener("storage", e => {
  if (e.key !== "fmc_token") return;
  const newToken = e.newValue;
  if (newToken === state.token) return;
  state.token = newToken;
  if (!newToken) {
    state.user = null;
    renderAuth();
  } else {
    boot();
  }
});
