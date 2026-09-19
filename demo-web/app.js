// CyberSchola hackathon demo frontend.
//
// Plain JavaScript, no build step and no dependencies. It talks only to the
// CyberSchola API on the same origin (Nginx proxies /api and /demo-auth), with a
// real signed token, so every screen shows exactly what the backend authorizes
// for the signed-in person. Hiding a menu item here is presentation only: the
// API enforces every permission and scope regardless.

import { renderLanding, renderSignIn } from './landing.js';

const API = '/api/v1';
const app = document.getElementById('app');

/**
 * An element of the current page, or a detached one when it has gone. Pages
 * load their data after rendering, and a person may move on before it arrives;
 * the late write then lands nowhere instead of throwing.
 */
const byId = (id) => document.getElementById(id) ?? document.createElement('div');

/** Enables a Copilot's button once its list holds a real choice, so an early click cannot send a placeholder. */
function readyWhenChosen(select) {
  const button = select.closest('form')?.querySelector('[type=submit]');
  if (button) button.disabled = !select.value;
}

// ---------------------------------------------------------------- utilities

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const initials = (name) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toast(message, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 11a4 4 0 0 0 0-8M22 21a7 7 0 0 0-4-6.3"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  spark: '<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/>',
  lesson: '<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  class: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
};
const icon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

// ---------------------------------------------------------------- session

const session = {
  get token() { return sessionStorage.getItem('cs.token'); },
  set token(value) { value ? sessionStorage.setItem('cs.token', value) : sessionStorage.removeItem('cs.token'); },
  get person() { try { return JSON.parse(sessionStorage.getItem('cs.person') || 'null'); } catch { return null; } },
  set person(value) { value ? sessionStorage.setItem('cs.person', JSON.stringify(value)) : sessionStorage.removeItem('cs.person'); },
  school: null,
  roles: [],
  term: null,
};

class ApiError extends Error {
  constructor(status, body) {
    super(body?.details?.[0] ?? body?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.code;
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${session.token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));

  if (response.status === 401) {
    signOut();
    throw new ApiError(401, json);
  }
  if (!response.ok) throw new ApiError(response.status, json);

  return json.data;
}

const isAdmin = () => session.roles.includes('SCHOOL_ADMIN');
const isTeacher = () => session.roles.includes('TEACHER');
const isStudent = () => session.roles.includes('STUDENT');

// The demo accounts, each signed in with a real token from the staging sign-in.
const ACCOUNTS = [
  { key: 'admin', name: 'School Administrator', title: 'CyberSchola Demo College', role: 'Admin' },
  { key: 'mathsTeacher', name: 'Adewale Ibrahim', title: 'Mathematics teacher, SS2 A', role: 'Teacher' },
  { key: 'physicsTeacher', name: 'Chinedu Eze', title: 'Physics teacher, SS2 A', role: 'Teacher' },
  { key: 'student', name: 'Daniel Okafor', title: 'Pupil, SS2 A', role: 'Student' },
];

async function signIn(account) {
  const response = await fetch('/demo-auth/tokens.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Sign-in is unavailable. Please try again.');
  const tokens = await response.json();

  session.token = tokens[account.key].token;
  session.person = account;
  await loadContext();
  location.hash = '#/dashboard';
}

function signOut() {
  session.token = null;
  session.person = null;
  session.school = null;
  session.roles = [];
  location.hash = '#/login';
}

async function loadContext() {
  const schools = await api('/me/schools');
  session.school = schools[0] ?? null;
  session.roles = session.school?.roles ?? [];
}

// ---------------------------------------------------------------- navigation

const COMING_SOON = {
  timetable: { label: 'Timetable', icon: 'calendar', text: 'Class and teacher timetables, with clash detection built in.' },
  payments: { label: 'Payments', icon: 'money', text: 'School fees, receipts and outstanding balances, reconciled automatically.' },
  pta: { label: 'PTA', icon: 'users', text: 'Parent–teacher association meetings, levies and communication.' },
  'live-classes': { label: 'Live Classes', icon: 'video', text: 'Live lessons for teachers and pupils, with attendance and recordings.' },
  'waec-jamb': { label: 'WAEC/JAMB Tutor', icon: 'target', text: 'Exam preparation with past questions, mock tests and an AI tutor.' },
};

function navItems() {
  const groups = [];
  const lockedGroup = { title: 'Coming soon', items: Object.entries(COMING_SOON).map(([key, item]) => ({ href: `#/soon/${key}`, label: item.label, icon: item.icon, locked: true })) };

  if (isAdmin()) {
    groups.push({ title: 'Overview', items: [{ href: '#/dashboard', label: 'Dashboard', icon: 'home' }] });
    groups.push({ title: 'People', items: [
      { href: '#/students', label: 'Students', icon: 'cap' },
      { href: '#/teachers', label: 'Teachers', icon: 'users' },
    ] });
    groups.push({ title: 'Academics', items: [
      { href: '#/results', label: 'Results', icon: 'chart' },
      { href: '#/scores', label: 'Enter Scores', icon: 'book' },
      { href: '#/attendance', label: 'Attendance', icon: 'check' },
    ] });
    groups.push({ title: 'Intelligence', items: [{ href: '#/copilot/admin', label: 'AI Admin Copilot', icon: 'spark' }] });
  } else if (isTeacher()) {
    groups.push({ title: 'Overview', items: [{ href: '#/dashboard', label: 'Dashboard', icon: 'home' }] });
    groups.push({ title: 'Teaching', items: [
      { href: '#/students', label: 'My Students', icon: 'cap' },
      { href: '#/results', label: 'Results', icon: 'chart' },
      { href: '#/scores', label: 'Enter Scores', icon: 'book' },
    ] });
    groups.push({ title: 'Intelligence', items: [{ href: '#/copilot/teacher', label: 'Teacher Copilot', icon: 'spark' }] });
  } else {
    groups.push({ title: 'Overview', items: [{ href: '#/dashboard', label: 'Dashboard', icon: 'home' }] });
    groups.push({ title: 'Learning', items: [{ href: '#/results', label: 'My Results', icon: 'chart' }] });
    groups.push({ title: 'Intelligence', items: [{ href: '#/copilot/student', label: 'Student Copilot', icon: 'spark' }] });
  }

  groups.push(lockedGroup);
  return groups;
}

function shell(title, body) {
  const person = session.person ?? {};
  const route = location.hash || '#/dashboard';
  const copilotHref = isAdmin() ? '#/copilot/admin' : isTeacher() ? '#/copilot/teacher' : '#/copilot/student';
  const roleLabel = isAdmin() ? 'Administrator' : isTeacher() ? 'Teacher' : isStudent() ? 'Student' : 'Member';

  app.innerHTML = `
  <div class="shell" id="shell">
    <aside class="sidebar" aria-label="Main navigation">
      <div class="brand">
        <div class="brand-mark">${icon('spark', 20)}</div>
        <div><div class="brand-name">CyberSchola</div><div class="brand-sub">SCHOOL INTELLIGENCE</div></div>
      </div>
      <div class="school-chip">
        <div class="avatar">${esc(initials(session.school?.name))}</div>
        <div><strong>${esc(session.school?.name ?? 'Your school')}</strong><span class="muted small">${esc(roleLabel)}</span></div>
      </div>
      <nav class="nav">
        ${navItems().map((group) => `
          <div class="nav-group">${esc(group.title.toUpperCase())}</div>
          ${group.items.map((item) => `
            <a href="${item.href}" class="${route.startsWith(item.href) ? 'active' : ''}${item.locked ? ' locked' : ''}">
              ${icon(item.icon)}<span>${esc(item.label)}</span>${item.locked ? '<span class="lock">SOON</span>' : ''}
            </a>`).join('')}`).join('')}
      </nav>
      <div class="sidebar-foot">
        <button class="btn-copilot" data-go="${copilotHref}">${icon('spark')} Ask Copilot</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn sm menu-btn" id="menu" aria-label="Open menu">${icon('menu')}</button>
        <div class="crumbs">${esc(session.school?.name ?? '')} / <b>${esc(title)}</b></div>
        <div class="spacer"></div>
        <span class="term-pill">2025/2026 · Second Term</span>
        <div class="user">
          <div class="avatar">${esc(initials(person.name))}</div>
          <div><strong>${esc(person.name ?? '')}</strong><span>${esc(roleLabel)}</span></div>
        </div>
        <button class="link-btn" id="signout">Sign out</button>
      </header>
      <main class="content" id="content">${body}</main>
    </div>
  </div>`;

  byId('signout').onclick = signOut;
  byId('menu').onclick = () => byId('shell').classList.toggle('nav-open');
  document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => (location.hash = el.dataset.go)));
}

const content = () => byId('content');

function errorBox(error, retry) {
  const message = error instanceof ApiError && error.status >= 500
    ? "We couldn't load this right now. Please try again."
    : error.message;
  return `<div class="error-box">${esc(message)}${retry ? '<div style="margin-top:12px"><button class="btn" data-retry>Retry</button></div>' : ''}</div>`;
}

// ---------------------------------------------------------------- charts

function bars(rows, { max = 100, suffix = '', danger = 50, warn = 60 } = {}) {
  return `<div class="bars">${rows.map((row) => {
    const pct = Math.max(0, Math.min(100, (row.value / max) * 100));
    const tone = row.value < danger ? 'bad' : row.value < warn ? 'warn' : 'good';
    return `<div class="bar-row"><span>${esc(row.label)}</span><div class="bar-track"><div class="bar-fill ${tone}" style="width:${pct}%"></div></div><b class="num">${esc(row.value)}${suffix}</b></div>`;
  }).join('')}</div>`;
}

const tone = (value, low = 50, mid = 60) => (value == null ? '' : value < low ? 'bad' : value < mid ? 'warn' : 'good');

// ---------------------------------------------------------------- screens

function renderLogin() {
  renderSignIn(app, {
    accounts: ACCOUNTS,
    onPick: signIn,
    onHome: () => (location.hash = '#/'),
  });
}

function renderHome() {
  renderLanding(app, { onSignIn: () => (location.hash = session.token ? '#/dashboard' : '#/login') });
}

async function renderDashboard() {
  if (isAdmin()) return renderAdminDashboard();
  if (isTeacher()) return renderTeacherDashboard();
  return renderStudentDashboard();
}

function statCard(label, value, foot, dot = '') {
  return `<div class="card card-pad stat"><div class="label">${esc(label)}<span class="dot ${dot}"></span></div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
}

function skeletonStats(n = 4) {
  return `<div class="grid cols-4">${Array.from({ length: n }, () => '<div class="card card-pad"><div class="skeleton" style="height:14px;width:40%"></div><div class="skeleton" style="height:34px;width:55%;margin:14px 0 8px"></div><div class="skeleton" style="height:12px;width:70%"></div></div>').join('')}</div>`;
}

async function renderAdminDashboard() {
  const name = (session.person?.name ?? '').split(' ').slice(-1)[0];
  shell('Dashboard', `
    <div class="page-head">
      <div><h1>Good morning, ${esc(session.person?.name?.split(' ').slice(0, 2).join(' ') ?? name)}</h1><p>Here's what's happening across ${esc(session.school?.name ?? 'your school')}.</p></div>
      <button class="btn primary" data-go="#/copilot/admin">${icon('spark')} Ask Admin Copilot</button>
    </div>
    <div id="stats">${skeletonStats()}</div>
    <div class="grid split" style="margin-top:18px" id="panels"></div>`);
  document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => (location.hash = el.dataset.go)));

  try {
    const [students, teachers, classes, performance] = await Promise.all([
      api('/students?limit=1'),
      api('/teachers?limit=1'),
      api('/classes?limit=1'),
      api('/results/performance'),
    ]);
    const rated = performance.students.filter((s) => s.attendanceRate != null);
    const attendance = rated.length ? (rated.reduce((sum, s) => sum + s.attendanceRate, 0) / rated.length).toFixed(1) : '–';
    const averages = performance.students.filter((s) => s.average != null);
    const overall = averages.length ? (averages.reduce((sum, s) => sum + s.average, 0) / averages.length).toFixed(1) : '–';
    const noResults = performance.students.filter((s) => s.average == null).length;

    byId('stats').innerHTML = `<div class="grid cols-4">
      ${statCard('Students', students.total, `Enrolled in ${esc(performance.session.name)}`, 'good')}
      ${statCard('Teachers', teachers.total, 'Across 5 subjects', 'good')}
      ${statCard('Classes', classes.total, 'SS2 A', '')}
      ${statCard('Attendance', `${attendance}%`, `${esc(performance.term.name)} average`, Number(attendance) >= 90 ? 'good' : 'warn')}
    </div>`;

    const subjectRows = performance.subjects.map((s) => ({ label: s.subject, value: s.average }));
    const attentionCount = averages.filter((s) => s.average < 60).length;
    byId('panels').innerHTML = `
      <div class="card">
        <div class="card-head"><div><h3>Academic performance by subject</h3><p>Average total out of 100 · ${esc(performance.term.name)}</p></div><span class="badge brand">Overall ${overall}</span></div>
        <div class="card-pad">${bars(subjectRows)}</div>
      </div>
      <div class="grid" style="gap:18px">
        <div class="card">
          <div class="card-head"><div><h3>Attendance by pupil</h3><p>${esc(performance.term.name)} · 100 school days</p></div></div>
          <div class="card-pad" style="max-height:268px;overflow:auto">${bars(rated.slice().sort((a, b) => a.attendanceRate - b.attendanceRate).map((s) => ({ label: s.name, value: s.attendanceRate })), { suffix: '%', danger: 75, warn: 85 })}</div>
        </div>
        <div class="insight">
          <div class="tag">${icon('spark', 16)} AI Insight</div>
          <p>${attentionCount} pupils average below 60 this term${noResults ? `, and ${noResults} has no results recorded` : ''}. Ask the Admin Copilot to find the patterns behind the numbers.</p>
          <button class="btn sm" data-go="#/copilot/admin">Analyse with Copilot</button>
        </div>
      </div>`;
    document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => (location.hash = el.dataset.go)));
  } catch (error) {
    byId('stats').innerHTML = errorBox(error, true);
    bindRetry(renderAdminDashboard);
  }
}

async function renderTeacherDashboard() {
  shell('Dashboard', `
    <div class="page-head">
      <div><h1>Welcome back, ${esc(session.person?.name ?? '')}</h1><p>Your classes, your pupils and what needs your attention.</p></div>
      <button class="btn primary" data-go="#/copilot/teacher">${icon('spark')} Plan a lesson with Copilot</button>
    </div>
    <div id="stats">${skeletonStats(3)}</div>
    <div class="grid cols-2" style="margin-top:18px" id="panels"></div>`);
  document.querySelectorAll('[data-go]').forEach((el) => (el.onclick = () => (location.hash = el.dataset.go)));

  try {
    const [assignments, students, performance] = await Promise.all([
      api('/ai/teacher/assignments'),
      api('/students?limit=1'),
      api('/results/performance'),
    ]);
    const mySubjects = new Set(assignments.map((a) => a.subject));
    const mine = performance.subjects.filter((s) => mySubjects.has(s.subject));
    const focus = mine[0];

    byId('stats').innerHTML = `<div class="grid cols-3">
      ${statCard('My classes', new Set(assignments.map((a) => a.class)).size, esc([...new Set(assignments.map((a) => a.class))].join(', ')), 'good')}
      ${statCard('My pupils', students.total, 'Pupils I teach this session', 'good')}
      ${statCard(`${esc(focus?.subject ?? 'Subject')} average`, focus ? focus.average : '–', focus ? `${focus.below50} pupils below 50` : 'No results yet', focus && focus.average < 60 ? 'warn' : 'good')}
    </div>`;

    const rows = focus
      ? performance.students
          .map((s) => ({ name: s.name, score: s.subjects.find((x) => x.subject === focus.subject) }))
          .filter((row) => row.score)
          .sort((a, b) => a.score.total - b.score.total)
      : [];

    byId('panels').innerHTML = `
      <div class="card">
        <div class="card-head"><div><h3>My classes and subjects</h3><p>From my teaching assignments</p></div></div>
        <div class="card-pad">${assignments.length ? assignments.map((a) => `<div class="attention"><div class="avatar">${icon('class', 16)}</div><div><strong>${esc(a.class)} · ${esc(a.subject)}</strong><div class="muted small">Taught by ${esc(a.teacher)}</div></div></div>`).join('') : '<div class="empty">No teaching assignments yet.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>${esc(focus?.subject ?? 'Subject')}: pupils by total</h3><p>Lowest first · out of 100</p></div></div>
        <div class="card-pad" style="max-height:340px;overflow:auto">${rows.length ? bars(rows.map((r) => ({ label: r.name, value: r.score.total }))) : '<div class="empty">No results recorded yet.</div>'}</div>
      </div>`;
  } catch (error) {
    byId('stats').innerHTML = errorBox(error, true);
    bindRetry(renderTeacherDashboard);
  }
}

async function renderStudentDashboard() {
  shell('Dashboard', `<div class="page-head"><div><h1>Hello, ${esc(session.person?.name?.split(' ')[0] ?? '')}</h1><p>Your results and attendance this term.</p></div></div><div id="panels">${skeletonStats(3)}</div>`);
  try {
    const performance = await api('/results/performance');
    const me = performance.students[0];
    byId('panels').innerHTML = me ? `
      <div class="grid cols-3">${statCard('Average', me.average ?? '–', `${esc(performance.term.name)}`, 'good')}${statCard('Subjects', me.subjects.length, 'Results recorded', '')}${statCard('Class', esc(me.class), esc(performance.session.name), '')}</div>
      <div class="card" style="margin-top:18px"><div class="card-head"><h3>My results</h3></div><div class="card-pad">${bars(me.subjects.map((s) => ({ label: s.subject, value: s.total })))}</div></div>` : '<div class="card empty">No results yet.</div>';
  } catch (error) {
    byId('panels').innerHTML = errorBox(error);
  }
}

function bindRetry(fn) {
  document.querySelectorAll('[data-retry]').forEach((el) => (el.onclick = fn));
}

// ---------------------------------------------------------------- students

async function renderStudents() {
  const admin = isAdmin();
  shell(admin ? 'Students' : 'My Students', `
    <div class="page-head">
      <div><h1>${admin ? 'Students' : 'My students'}</h1><p>${admin ? 'Every pupil in the school this session.' : 'Only the pupils you teach: the platform narrows this list for you.'}</p></div>
      ${admin ? `<button class="btn primary" id="add">${icon('plus')} Add student</button>` : ''}
    </div>
    <div class="card"><div class="table-wrap" id="table"><div class="card-pad"><div class="skeleton" style="height:220px"></div></div></div></div>`);

  if (admin) byId('add').onclick = () => studentModal();

  try {
    const [list, performance] = await Promise.all([api('/students?limit=100'), api('/results/performance').catch(() => null)]);
    const resultsById = new Map((performance?.students ?? []).map((s) => [s.studentId, s]));
    const rows = list.items;

    byId('table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>Student</th><th>Class</th><th class="num">Average</th>${admin ? '<th class="num">Attendance</th><th></th>' : ''}</tr></thead>
        <tbody>${rows.map((student) => {
          const perf = resultsById.get(student.id);
          const name = `${student.firstName} ${student.lastName}`;
          return `<tr>
            <td><div class="name-cell"><div class="avatar">${esc(initials(name))}</div><div><strong>${esc(name)}</strong>${student.admissionNumber ? `<div class="muted small">${esc(student.admissionNumber)}</div>` : ''}</div></div></td>
            <td>${esc(perf?.class ?? '–')}</td>
            <td class="num">${perf?.average != null ? `<span class="badge ${tone(perf.average, 50, 60)}">${perf.average}</span>` : '<span class="badge">No results</span>'}</td>
            ${admin ? `<td class="num">${perf?.attendanceRate != null ? `${perf.attendanceRate}%` : '–'}</td>
            <td class="num"><button class="btn sm" data-edit="${esc(student.id)}">Edit</button> <button class="btn sm danger" data-del="${esc(student.id)}">Delete</button></td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table>` : `<div class="empty"><strong>No students found</strong><p>There are no students in this school yet.</p></div>`;

    document.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => studentModal(rows.find((s) => s.id === el.dataset.edit))));
    document.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
      const student = rows.find((s) => s.id === el.dataset.del);
      if (!confirm(`Remove ${student.firstName} ${student.lastName}? Their history is kept.`)) return;
      try {
        await api(`/students/${student.id}`, { method: 'DELETE' });
        toast('Student removed.');
        renderStudents();
      } catch (error) {
        toast(error.message, true);
      }
    }));
  } catch (error) {
    byId('table').innerHTML = errorBox(error, true);
    bindRetry(renderStudents);
  }
}

async function studentModal(student) {
  const editing = Boolean(student);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <form class="modal" novalidate>
      <div class="card-head"><h3>${editing ? 'Edit student' : 'Add student'}</h3><button type="button" class="link-btn" data-close>Close</button></div>
      <div class="body">
        <div class="row">
          <div class="field"><label for="fn">First name</label><input id="fn" name="firstName" required maxlength="120" value="${esc(student?.firstName ?? '')}"></div>
          <div class="field"><label for="ln">Last name</label><input id="ln" name="lastName" required maxlength="120" value="${esc(student?.lastName ?? '')}"></div>
        </div>
        <div class="row">
          <div class="field"><label for="adm">Admission number</label><input id="adm" name="admissionNumber" maxlength="120" value="${esc(student?.admissionNumber ?? '')}" placeholder="Optional"></div>
          <div class="field"><label for="dob">Date of birth</label><input id="dob" name="dateOfBirth" type="date" value="${esc(student?.dateOfBirth ?? '')}"></div>
        </div>
        ${editing ? '' : '<p class="muted small" style="margin:0">The new student is enrolled in SS2 A for this session.</p>'}
        <p class="error-box small hidden" id="form-error" style="padding:8px 0 0;text-align:left"></p>
      </div>
      <div class="foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${editing ? 'Save changes' : 'Add student'}</button></div>
    </form>`;
  document.body.appendChild(back);
  back.querySelectorAll('[data-close]').forEach((el) => (el.onclick = () => back.remove()));
  back.querySelector('#fn').focus();

  back.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = {
      firstName: String(form.get('firstName')).trim(),
      lastName: String(form.get('lastName')).trim(),
      admissionNumber: String(form.get('admissionNumber')).trim() || null,
      dateOfBirth: String(form.get('dateOfBirth')) || null,
    };
    const errorEl = back.querySelector('#form-error');

    if (!body.firstName || !body.lastName) {
      errorEl.textContent = 'First and last name are required.';
      errorEl.classList.remove('hidden');
      return;
    }

    const submit = event.target.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      if (editing) {
        await api(`/students/${student.id}`, { method: 'PATCH', body });
        toast('Changes saved.');
      } else {
        const name = `${body.firstName} ${body.lastName}`;
        const outcome = await addAndEnrol(body);
        if (outcome.stranded) {
          // Created, not enrolled, and not removable: close the form so a retry
          // cannot create the same student twice, and show the list as it is.
          back.remove();
          renderStudents();
          toast(`${name} was added but could not be enrolled in ${DEMO_CLASS.label}. Enrol or remove them before trying again.`, true);
          return;
        }
        toast(`${name} added to ${DEMO_CLASS.label}.`);
      }
      back.remove();
      renderStudents();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      submit.disabled = false;
    }
  };
}

/** The class the demo enrols new students in, found by name in the current session. */
const DEMO_CLASS = { grade: 'SS2', arm: 'A', label: 'SS2 A' };

async function demoClassId() {
  const [sessions, classes, grades] = await Promise.all([
    api('/academic-sessions?limit=100'),
    api('/classes?limit=100'),
    api('/grade-levels?limit=100'),
  ]);
  const current = sessions.items.find((session) => session.isCurrent);
  const grade = grades.items.find((g) => g.name === DEMO_CLASS.grade);
  const match = classes.items.find((c) => c.sessionId === current?.id && c.gradeLevelId === grade?.id && c.arm === DEMO_CLASS.arm);
  if (!match) throw new Error(`${DEMO_CLASS.label} was not found in the current session, so no student was added.`);
  return match.id;
}

/**
 * Adds a student and enrols them in SS2 A, as one action from the user's side.
 *
 * The API exposes these as two requests, so this makes the pair all or nothing:
 * the class is resolved before anything is written, and if the enrolment fails
 * the new student is removed again, so a retry starts clean. Only if that
 * removal also fails is the student left behind, and the caller is told so.
 */
async function addAndEnrol(body) {
  const classId = await demoClassId();
  const created = await api('/students', { method: 'POST', body });
  try {
    await api('/class-enrolments', { method: 'POST', body: { classId, studentId: created.id } });
    return { stranded: false };
  } catch (error) {
    const removed = await api(`/students/${created.id}`, { method: 'DELETE' }).then(() => true, () => false);
    if (!removed) return { stranded: true };
    throw new Error(`Could not enrol in ${DEMO_CLASS.label}, so the student was not added. ${error.message}`);
  }
}

// ---------------------------------------------------------------- teachers

async function renderTeachers() {
  const admin = isAdmin();
  shell('Teachers', `
    <div class="page-head"><div><h1>Teachers</h1><p>Teaching staff and what they teach.</p></div>
      ${admin ? `<button class="btn primary" id="add">${icon('plus')} Add teacher</button>` : ''}</div>
    <div class="card"><div class="table-wrap" id="table"><div class="card-pad"><div class="skeleton" style="height:200px"></div></div></div></div>`);
  if (admin) byId('add').onclick = () => teacherModal();
  try {
    const [list, assignments] = await Promise.all([api('/teachers?limit=100'), api('/ai/teacher/assignments')]);
    const subjects = new Map();
    for (const a of assignments) subjects.set(a.teacher, [...(subjects.get(a.teacher) ?? []), `${a.subject} · ${a.class}`]);
    const rows = list.items;
    byId('table').innerHTML = rows.length ? `
      <table><thead><tr><th>Teacher</th><th>Teaches</th><th>Sign-in</th>${admin ? '<th></th>' : ''}</tr></thead>
      <tbody>${rows.map((t) => {
        const name = `${t.firstName} ${t.lastName}`;
        const teaches = subjects.get(name) ?? [];
        // A teacher who signs in or teaches a class is in use: removing them
        // would orphan their classes, so the demo only removes unused records.
        const inUse = Boolean(t.membershipId) || teaches.length > 0;
        return `<tr><td><div class="name-cell"><div class="avatar">${esc(initials(name))}</div><strong>${esc(name)}</strong></div></td>
          <td>${teaches.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ') || '<span class="muted">Not assigned yet</span>'}</td>
          <td>${t.membershipId ? '<span class="badge good">Has account</span>' : '<span class="badge">No account</span>'}</td>
          ${admin ? `<td class="num"><button class="btn sm" data-edit="${esc(t.id)}">Edit</button> <button class="btn sm danger" data-del="${esc(t.id)}"${inUse ? ' disabled title="Teaches a class or signs in, so it stays"' : ''}>Delete</button></td>` : ''}</tr>`;
      }).join('')}</tbody></table>` : '<div class="empty"><strong>No teachers yet</strong><p>Add the first teacher to get started.</p></div>';
    document.querySelectorAll('[data-edit]').forEach((el) => (el.onclick = () => teacherModal(rows.find((t) => t.id === el.dataset.edit))));
    document.querySelectorAll('[data-del]').forEach((el) => (el.onclick = async () => {
      const teacher = rows.find((t) => t.id === el.dataset.del);
      if (!confirm(`Remove ${teacher.firstName} ${teacher.lastName}? Their history is kept.`)) return;
      try {
        await api(`/teachers/${teacher.id}`, { method: 'DELETE' });
        toast('Teacher removed.');
        renderTeachers();
      } catch (error) {
        toast(error.message, true);
      }
    }));
  } catch (error) {
    byId('table').innerHTML = errorBox(error, true);
    bindRetry(renderTeachers);
  }
}

function teacherModal(teacher) {
  const editing = Boolean(teacher);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <form class="modal" novalidate>
      <div class="card-head"><h3>${editing ? 'Edit teacher' : 'Add teacher'}</h3><button type="button" class="link-btn" data-close>Close</button></div>
      <div class="body">
        <div class="row">
          <div class="field"><label for="tfn">First name</label><input id="tfn" name="firstName" required maxlength="120" value="${esc(teacher?.firstName ?? '')}"></div>
          <div class="field"><label for="tln">Last name</label><input id="tln" name="lastName" required maxlength="120" value="${esc(teacher?.lastName ?? '')}"></div>
        </div>
        ${editing ? '' : '<p class="muted small" style="margin:0">Classes and subjects are assigned to a teacher separately.</p>'}
        <p class="error-box small hidden" id="form-error" style="padding:8px 0 0;text-align:left"></p>
      </div>
      <div class="foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">${editing ? 'Save changes' : 'Add teacher'}</button></div>
    </form>`;
  document.body.appendChild(back);
  back.querySelectorAll('[data-close]').forEach((el) => (el.onclick = () => back.remove()));
  back.querySelector('#tfn').focus();

  back.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = { firstName: String(form.get('firstName')).trim(), lastName: String(form.get('lastName')).trim() };
    const errorEl = back.querySelector('#form-error');
    if (!body.firstName || !body.lastName) {
      errorEl.textContent = 'First and last name are required.';
      errorEl.classList.remove('hidden');
      return;
    }
    const submit = event.target.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      if (editing) {
        await api(`/teachers/${teacher.id}`, { method: 'PATCH', body });
        toast('Changes saved.');
      } else {
        await api('/teachers', { method: 'POST', body });
        toast(`${body.firstName} ${body.lastName} added.`);
      }
      back.remove();
      renderTeachers();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
      submit.disabled = false;
    }
  };
}

// ---------------------------------------------------------------- results + attendance

async function renderResults() {
  shell('Results', `
    <div class="page-head"><div><h1>${isStudent() ? 'My results' : 'Results'}</h1><p>CA1 /20 · CA2 /20 · Exam /60 · Total /100</p></div></div>
    <div class="card"><div class="table-wrap" id="table"><div class="card-pad"><div class="skeleton" style="height:260px"></div></div></div></div>`);
  try {
    const performance = await api('/results/performance');
    const subjects = performance.subjects.map((s) => s.subject);
    byId('table').innerHTML = `
      <table><thead><tr><th>Student</th>${subjects.map((s) => `<th class="num">${esc(s)}</th>`).join('')}<th class="num">Average</th></tr></thead>
      <tbody>${performance.students.map((student) => `<tr><td><strong>${esc(student.name)}</strong></td>
        ${subjects.map((name) => {
          const score = student.subjects.find((s) => s.subject === name);
          return `<td class="num">${score ? `<span class="badge ${tone(score.total)}" title="CA1 ${score.ca1} · CA2 ${score.ca2} · Exam ${score.exam}">${score.total}</span>` : '<span class="muted">–</span>'}</td>`;
        }).join('')}
        <td class="num"><b>${student.average ?? '–'}</b></td></tr>`).join('')}</tbody></table>
      <div class="meta-line">${esc(performance.session.name)} · ${esc(performance.term.name)} · Hover a score for its breakdown</div>`;
  } catch (error) {
    byId('table').innerHTML = errorBox(error, true);
    bindRetry(renderResults);
  }
}

// ---------------------------------------------------------------- score entry

const ASSESSMENTS = [
  { key: 'CA1', field: 'ca1', label: 'CA1', max: 20 },
  { key: 'CA2', field: 'ca2', label: 'CA2', max: 20 },
  { key: 'EXAM', field: 'exam', label: 'Exam', max: 60 },
];

const scoreState = { options: [], optionId: null, termId: null, assessment: 'CA1', sheet: null };

/**
 * A subject teacher's score sheet. One assessment column is editable at a time;
 * totals update as they type, and Save sends only the lines that changed. The
 * API decides who may open which sheet, so the picker lists GET /results/sheets.
 */
async function renderScores() {
  shell('Enter Scores', `
    <div class="page-head"><div><h1>Enter scores</h1><p>CA1 /20 · CA2 /20 · Exam /60. New scores are added; changed ones are corrected.</p></div></div>
    <div class="card"><div class="card-pad score-toolbar" id="picker"><div class="skeleton" style="height:44px"></div></div>
      <div class="table-wrap" id="sheet"></div></div>`);
  try {
    scoreState.options = await api('/results/sheets');
    if (!scoreState.options.length) {
      byId('picker').innerHTML = '<div class="empty">You have no class subjects to score this session.</div>';
      return;
    }
    const option = scoreState.options.find((o) => o.classSubjectId === scoreState.optionId) ?? scoreState.options[0];
    scoreState.optionId = option.classSubjectId;
    if (!option.terms.some((t) => t.id === scoreState.termId)) {
      scoreState.termId = (option.terms.find((t) => t.name === 'Second Term') ?? option.terms[option.terms.length - 1])?.id ?? null;
    }
    drawPicker(option);
    await loadSheet();
  } catch (error) {
    byId('picker').innerHTML = errorBox(error, true);
    bindRetry(renderScores);
  }
}

function drawPicker(option) {
  const picker = byId('picker');
  picker.innerHTML = `
    <div class="field"><label for="sc-sheet">Subject and class</label><select id="sc-sheet">${scoreState.options.map((o) =>
      `<option value="${esc(o.classSubjectId)}"${o.classSubjectId === scoreState.optionId ? ' selected' : ''}>${esc(o.subject)} · ${esc(o.class)}</option>`).join('')}</select></div>
    <div class="field"><label for="sc-term">Term</label><select id="sc-term">${option.terms.map((t) =>
      `<option value="${esc(t.id)}"${t.id === scoreState.termId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Assessment</label><div class="seg" role="tablist">${ASSESSMENTS.map((a) =>
      `<button type="button" role="tab" class="seg-btn${a.key === scoreState.assessment ? ' on' : ''}" data-assessment="${a.key}" aria-selected="${a.key === scoreState.assessment}">${a.label} <span>/${a.max}</span></button>`).join('')}</div></div>`;
  picker.querySelector('#sc-sheet').onchange = (event) => { scoreState.optionId = event.target.value; scoreState.termId = null; renderScores(); };
  picker.querySelector('#sc-term').onchange = (event) => { scoreState.termId = event.target.value; loadSheet(); };
  picker.querySelectorAll('[data-assessment]').forEach((button) => {
    button.onclick = () => { scoreState.assessment = button.dataset.assessment; drawPicker(option); drawSheet(); };
  });
}

async function loadSheet() {
  const target = byId('sheet');
  target.innerHTML = '<div class="card-pad"><div class="skeleton" style="height:260px"></div></div>';
  try {
    scoreState.sheet = await api(`/results/sheet?classSubjectId=${encodeURIComponent(scoreState.optionId)}&termId=${encodeURIComponent(scoreState.termId)}`);
    drawSheet();
  } catch (error) {
    target.innerHTML = errorBox(error, true);
    bindRetry(loadSheet);
  }
}

const round2 = (value) => Math.round(value * 100) / 100;

function drawSheet() {
  const sheet = scoreState.sheet;
  if (!sheet) return;
  const active = ASSESSMENTS.find((a) => a.key === scoreState.assessment);
  const target = byId('sheet');

  target.innerHTML = `
    <table class="score-table"><thead><tr><th>Student</th>${ASSESSMENTS.map((a) =>
      `<th class="num${a === active ? ' active-col' : ' other-col'}">${a.label} /${a.max}</th>`).join('')}<th class="num">Total /100</th></tr></thead>
    <tbody>${sheet.pupils.map((pupil) => `<tr data-student="${esc(pupil.studentId)}">
      <td><div class="name-cell"><div class="avatar">${esc(initials(pupil.name))}</div><strong>${esc(pupil.name)}</strong></div></td>
      ${ASSESSMENTS.map((a) => a === active
        ? `<td class="num active-col"><input class="score-input" type="number" inputmode="decimal" min="0" max="${a.max}" step="0.5" value="${pupil[a.field] ?? ''}" data-was="${pupil[a.field] ?? ''}" aria-label="${esc(pupil.name)} ${a.label}" placeholder="–"></td>`
        : `<td class="num other-col">${pupil[a.field] ?? '<span class="muted">–</span>'}</td>`).join('')}
      <td class="num"><span class="badge total">${pupil.total}</span></td></tr>`).join('')}</tbody></table>
    <div class="score-foot"><span class="muted small" id="sc-status"></span>
      <button class="btn primary" id="sc-save" disabled>${icon('check', 16)} Save ${active.label}</button></div>`;

  const inputs = [...target.querySelectorAll('.score-input')];
  const status = target.querySelector('#sc-status');
  const save = target.querySelector('#sc-save');

  const refresh = () => {
    let changed = 0;
    let invalid = 0;
    for (const input of inputs) {
      const row = input.closest('tr');
      const pupil = sheet.pupils.find((p) => p.studentId === row.dataset.student);
      const raw = input.value.trim();
      const value = raw === '' ? null : Number(raw);
      const bad = raw !== '' && (!Number.isFinite(value) || value < 0 || value > active.max || round2(value) !== value);
      const cleared = raw === '' && input.dataset.was !== '';
      input.classList.toggle('bad', bad || cleared);
      input.title = bad ? `Between 0 and ${active.max}, at most 2 decimals` : cleared ? 'A saved score cannot be cleared here' : '';
      if (bad || cleared) invalid += 1;
      else if (raw !== input.dataset.was) changed += 1;
      const others = ASSESSMENTS.filter((a) => a !== active).reduce((sum, a) => sum + (pupil[a.field] ?? 0), 0);
      const total = round2(others + (bad || value == null ? pupil[active.field] ?? 0 : value));
      const badge = row.querySelector('.total');
      badge.textContent = total;
      badge.className = `badge total ${tone(total)}`;
    }
    save.disabled = changed === 0 || invalid > 0;
    save.innerHTML = `${icon('check', 16)} Save ${active.label}${changed ? ` (${changed})` : ''}`;
    status.textContent = invalid
      ? `${invalid} score${invalid > 1 ? 's' : ''} to fix before saving`
      : changed ? `${changed} unsaved change${changed > 1 ? 's' : ''}` : `${sheet.subject} · ${sheet.class} · ${sheet.term.name}`;
    status.classList.toggle('warn-text', invalid > 0);
  };
  inputs.forEach((input) => { input.oninput = refresh; });
  refresh();

  save.onclick = async () => {
    const entries = inputs
      .filter((input) => input.value.trim() !== '' && input.value.trim() !== input.dataset.was)
      .map((input) => ({ studentId: input.closest('tr').dataset.student, score: Number(input.value) }));
    save.disabled = true;
    try {
      const saved = await api('/results/sheet', {
        method: 'PUT',
        body: { classSubjectId: sheet.classSubjectId, termId: sheet.term.id, assessmentType: active.key, entries },
      });
      scoreState.sheet = saved;
      drawSheet();
      const parts = [saved.inserted && `${saved.inserted} new`, saved.updated && `${saved.updated} corrected`].filter(Boolean);
      toast(`${active.label} saved: ${parts.join(', ')}.`);
    } catch (error) {
      toast(error.message, true);
      save.disabled = false;
    }
  };
}

async function renderAttendance() {
  shell('Attendance', `
    <div class="page-head"><div><h1>Attendance</h1><p>Second Term registers, 100 school days.</p></div></div>
    <div class="card"><div class="card-pad" id="table"><div class="skeleton" style="height:260px"></div></div></div>`);
  try {
    const performance = await api('/results/performance');
    const rated = performance.students.filter((s) => s.attendanceRate != null).sort((a, b) => a.attendanceRate - b.attendanceRate);
    const missing = performance.students.filter((s) => s.attendanceRate == null);
    byId('table').innerHTML = bars(rated.map((s) => ({ label: s.name, value: s.attendanceRate })), { suffix: '%', danger: 75, warn: 85 })
      + (missing.length ? `<p class="muted small" style="margin-top:14px">No register recorded for: ${missing.map((s) => esc(s.name)).join(', ')}.</p>` : '');
  } catch (error) {
    byId('table').innerHTML = errorBox(error, true);
    bindRetry(renderAttendance);
  }
}

// ---------------------------------------------------------------- copilots

function thinking(steps) {
  return `<div class="thinking" id="thinking">${steps.map((s, i) => `<div class="step" data-step="${i}"><span class="spinner hidden"></span><span class="tick">○</span> ${esc(s)}</div>`).join('')}</div>`;
}

async function runSteps(stepsDone) {
  const nodes = [...document.querySelectorAll('#thinking .step')];
  for (const [index, node] of nodes.entries()) {
    if (stepsDone.value) break;
    node.classList.add('now');
    node.querySelector('.spinner').classList.remove('hidden');
    node.querySelector('.tick').classList.add('hidden');
    await sleep(index === nodes.length - 1 ? 60_000 : 1400);
    if (index < nodes.length - 1) {
      node.classList.replace('now', 'done');
      node.querySelector('.spinner').classList.add('hidden');
      const tick = node.querySelector('.tick');
      tick.textContent = '✓';
      tick.classList.remove('hidden');
    }
  }
}

async function renderAdminCopilot() {
  shell('AI Admin Copilot', `
    <div class="page-head"><div class="copilot-hero"><div class="spark">${icon('spark', 22)}</div><div><h1>AI Admin Copilot</h1><p>Analyses your school's real results and attendance. It only sees what you are authorized to see.</p></div></div></div>
    <div class="grid split" style="align-items:start">
      <div class="card" id="output"><div class="empty">${icon('bulb', 28)}<p><strong>Ask a question about your school</strong></p><p>The Copilot reads this term's results and attendance and returns a summary, key findings, areas of concern and recommendations.</p></div></div>
      <form class="card card-pad" id="ask">
        <div class="field"><label for="class">Class</label><select id="class" required><option>Loading classes…</option></select></div>
        <div class="field"><label for="q">Your request</label><textarea id="q" rows="4">Analyze SS2 students' academic performance and identify areas requiring attention.</textarea></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center" disabled>${icon('spark')} Analyze</button>
        <p class="muted small" style="margin:12px 0 0">Uses 2025/2026 · Second Term results and registers.</p>
      </form>
    </div>`);

  const select = byId('class');
  try {
    const [classes, grades] = await Promise.all([api('/classes?limit=100'), api('/grade-levels?limit=100')]);
    const gradeName = new Map(grades.items.map((g) => [g.id, g.name]));
    select.innerHTML = classes.items.map((c) => `<option value="${esc(c.id)}">${esc(`${gradeName.get(c.gradeLevelId) ?? ''} ${c.arm}`.trim())}</option>`).join('');
    readyWhenChosen(select);
  } catch (error) {
    select.innerHTML = '<option>Could not load classes</option>';
  }

  byId('ask').onsubmit = async (event) => {
    event.preventDefault();
    const output = byId('output');
    const button = event.target.querySelector('[type=submit]');
    button.disabled = true;
    output.innerHTML = thinking(['Checking your permissions', 'Retrieving SS2 A results for Second Term', 'Retrieving attendance registers', 'Analysing with CyberSchola AI']);
    const done = { value: false };
    const steps = runSteps(done);

    try {
      const insight = await api('/ai/admin/performance', { method: 'POST', body: { classId: select.value, question: byId('q').value } });
      done.value = true;
      await Promise.race([steps, sleep(50)]);
      output.innerHTML = adminInsight(insight);
    } catch (error) {
      done.value = true;
      output.innerHTML = errorBox(error, true);
      bindRetry(() => event.target.requestSubmit());
    } finally {
      button.disabled = false;
    }
  };
}

function adminInsight(insight) {
  return `
    <div class="result-section"><h4>${icon('spark', 16)} Summary</h4><p style="margin:0">${esc(insight.summary)}</p></div>
    <div class="result-section"><h4>${icon('bulb', 16)} Key findings</h4><ul>${insight.keyFindings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>
    <div class="result-section"><h4>${icon('alert', 16)} Areas of concern</h4><div class="grid" style="gap:12px">${insight.areasOfConcern.map((c) => `
      <div class="concern"><div class="concern-head"><span>${esc(c.subject)}</span><span class="badge warn">${esc(c.studentsAffected)} pupils affected</span></div><div>${esc(c.description)}</div></div>`).join('') || '<p class="muted">None identified.</p>'}</div></div>
    ${insight.studentsNeedingAttention?.length ? `<div class="result-section"><h4>${icon('users', 16)} Students needing attention</h4>${insight.studentsNeedingAttention.map((s) => `
      <div class="attention"><div class="avatar">${esc(initials(s.name))}</div><div><strong>${esc(s.name)}</strong><div class="muted small">${esc(s.reason)}</div></div></div>`).join('')}</div>` : ''}
    <div class="result-section"><h4>${icon('check', 16)} Recommendations</h4><ul>${insight.recommendations.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
    <div class="meta-line"><span>${esc(insight.meta.class)} · ${esc(insight.meta.term)} ${esc(insight.meta.session)}</span><span>${esc(insight.meta.studentsAnalysed)} pupils analysed</span>${insight.meta.studentsWithoutResults.length ? `<span>No results: ${insight.meta.studentsWithoutResults.map(esc).join(', ')}</span>` : ''}<span>Model ${esc(insight.meta.model)}</span></div>`;
}

async function renderTeacherCopilot() {
  shell('Teacher Copilot', `
    <div class="page-head"><div class="copilot-hero"><div class="spark">${icon('spark', 22)}</div><div><h1>Teacher Copilot</h1><p>Generates a complete lesson plan for a class you teach.</p></div></div></div>
    <div class="grid split" style="align-items:start">
      <div class="card" id="output"><div class="empty">${icon('lesson', 28)}<p><strong>Plan your next lesson</strong></p><p>Choose the class and subject, give a topic, duration and objectives, and the Copilot drafts the full lesson.</p></div></div>
      <form class="card card-pad" id="ask">
        <div class="field"><label for="cs">Subject and class</label><select id="cs" required><option>Loading your classes…</option></select></div>
        <div class="field"><label for="topic">Topic</label><input id="topic" required value="Newton's Laws of Motion"></div>
        <div class="field"><label for="dur">Duration (minutes)</label><input id="dur" type="number" min="10" max="180" value="40"></div>
        <div class="field"><label for="obj">Learning objectives (one per line)</label><textarea id="obj" rows="4">Explain Newton's three laws.
Apply Newton's laws to simple real-world examples.</textarea></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center" disabled>${icon('spark')} Generate Lesson Plan</button>
      </form>
    </div>`);

  const select = byId('cs');
  try {
    const assignments = await api('/ai/teacher/assignments');
    select.innerHTML = assignments.length
      ? assignments.map((a) => `<option value="${esc(a.classSubjectId)}" ${a.subject === 'Physics' ? 'selected' : ''}>${esc(a.subject)} · ${esc(a.class)}</option>`).join('')
      : '<option value="">You have no teaching assignments</option>';
    readyWhenChosen(select);
  } catch {
    select.innerHTML = '<option value="">Could not load your classes</option>';
  }

  byId('ask').onsubmit = async (event) => {
    event.preventDefault();
    const output = byId('output');
    const button = event.target.querySelector('[type=submit]');
    const objectives = byId('obj').value.split('\n').map((line) => line.trim()).filter(Boolean);
    button.disabled = true;
    output.innerHTML = thinking(['Checking your teaching assignment', 'Aligning with the SS2 curriculum', 'Drafting the lesson stages']);
    const done = { value: false };
    const steps = runSteps(done);

    try {
      const plan = await api('/ai/teacher/lesson-plan', {
        method: 'POST',
        body: { classSubjectId: select.value, topic: byId('topic').value, durationMinutes: Number(byId('dur').value), objectives },
      });
      done.value = true;
      await Promise.race([steps, sleep(50)]);
      output.innerHTML = lessonPlan(plan);
    } catch (error) {
      done.value = true;
      output.innerHTML = errorBox(error, true);
      bindRetry(() => event.target.requestSubmit());
    } finally {
      button.disabled = false;
    }
  };
}

function lessonPlan(plan) {
  const total = plan.stages.reduce((sum, s) => sum + s.durationMinutes, 0);
  return `
    <div class="result-section"><h4>${icon('lesson', 16)} ${esc(plan.meta.subject)} · ${esc(plan.meta.class)}</h4><h2 style="font-size:22px;margin-bottom:8px">${esc(plan.title)}</h2><p style="margin:0">${esc(plan.overview)}</p></div>
    <div class="result-section"><h4>${icon('target', 16)} Objectives</h4><ul>${plan.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul></div>
    <div class="result-section"><h4>${icon('calendar', 16)} Lesson flow · ${total} minutes</h4>${plan.stages.map((s) => `
      <div class="stage"><div class="mins">${esc(s.durationMinutes)} min</div><div><h5>${esc(s.name)}</h5>
        <div class="small"><b>Teacher:</b> ${s.teacherActivities.map(esc).join(' ')}</div>
        <div class="small" style="margin-top:4px"><b>Pupils:</b> ${s.studentActivities.map(esc).join(' ')}</div></div></div>`).join('')}</div>
    <div class="result-section"><h4>${icon('book', 16)} Materials</h4><div class="chips">${plan.materials.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</div></div>
    <div class="result-section"><h4>${icon('check', 16)} Assessment</h4><ul>${plan.assessment.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
    <div class="result-section"><h4>${icon('home', 16)} Homework</h4><p style="margin:0">${esc(plan.homework)}</p></div>
    <div class="result-section"><h4>${icon('users', 16)} Differentiation</h4><ul>${plan.differentiation.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <div class="result-section"><h4>${icon('spark', 16)} Key vocabulary</h4><div class="chips">${plan.keyVocabulary.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div></div>
    <div class="meta-line"><span>Generated ${esc(new Date(plan.meta.generatedAt).toLocaleString())}</span><span>Model ${esc(plan.meta.model)}</span><button class="link-btn" onclick="window.print()">Print</button></div>`;
}

// ---------------------------------------------------------------- student copilot

const STUDY_GOALS = [
  { key: 'explain', label: 'Explain it' },
  { key: 'practice', label: 'Practice questions' },
  { key: 'plan', label: 'Revision plan' },
];

/**
 * The pupil's study partner. Subjects come from the pupil's own results, the
 * weakest first, so help starts where it is needed; the API personalises the
 * answer from the same scores and gives the model nothing about anyone else.
 */
async function renderStudentCopilot() {
  shell('Student Copilot', `
    <div class="page-head"><div class="copilot-hero"><div class="spark">${icon('spark', 22)}</div><div><h1>Student Copilot</h1><p>Your study partner. It knows your own scores, and only yours.</p></div></div></div>
    <div class="grid split" style="align-items:start">
      <div class="card" id="output"><div class="empty">${icon('book', 28)}<p><strong>What do you want to learn today?</strong></p><p>Pick a subject and a topic. The Copilot explains it, gives you questions to practise with answers to check, or plans your revision around where you lose marks.</p></div></div>
      <form class="card card-pad" id="ask">
        <div id="focus" class="focus-line muted small">Loading your subjects…</div>
        <div class="field"><label for="subj">Subject</label><select id="subj" required><option>Loading…</option></select></div>
        <div class="field"><label for="topic">Topic</label><input id="topic" required maxlength="200" value="Quadratic equations"></div>
        <div class="field"><label>I want</label><div class="seg" role="tablist">${STUDY_GOALS.map((g, i) =>
          `<button type="button" role="tab" class="seg-btn${i === 0 ? ' on' : ''}" data-goal="${g.key}" aria-selected="${i === 0}">${g.label}</button>`).join('')}</div></div>
        <div class="field"><label for="q">Anything specific? <span class="muted">(optional)</span></label><textarea id="q" rows="3" maxlength="500" placeholder="For example: I keep getting the sign wrong when I factorise."></textarea></div>
        <button class="btn primary" type="submit" style="width:100%;justify-content:center" disabled>${icon('spark')} Help me study</button>
      </form>
    </div>`);

  let goal = 'explain';
  document.querySelectorAll('[data-goal]').forEach((button) => {
    button.onclick = () => {
      goal = button.dataset.goal;
      document.querySelectorAll('[data-goal]').forEach((b) => { b.classList.toggle('on', b === button); b.setAttribute('aria-selected', String(b === button)); });
    };
  });

  const select = byId('subj');
  const focus = byId('focus');
  try {
    const performance = await api('/results/performance');
    const mine = [...(performance.students[0]?.subjects ?? [])].sort((a, b) => a.total - b.total);
    if (!mine.length) {
      select.innerHTML = '<option value="">No results yet</option>';
      focus.textContent = 'Your results are not recorded yet, so there is nothing to personalise.';
    } else {
      select.innerHTML = mine.map((s) => `<option value="${esc(s.subjectId)}">${esc(s.subject)} · ${esc(s.total)}/100</option>`).join('');
      readyWhenChosen(select);
      focus.innerHTML = `Focus first on <b>${esc(mine[0].subject)}</b>: your lowest total this term, ${esc(mine[0].total)}/100.`;
    }
  } catch (error) {
    select.innerHTML = '<option value="">Could not load your subjects</option>';
    focus.textContent = error.message;
  }

  byId('ask').onsubmit = async (event) => {
    event.preventDefault();
    const output = byId('output');
    const button = event.target.querySelector('[type=submit]');
    const subject = select.options[select.selectedIndex]?.text.split(' · ')[0] ?? 'your subject';
    button.disabled = true;
    output.innerHTML = thinking([`Reading your ${subject} scores`, 'Finding where you lose marks', 'Preparing your study help']);
    const done = { value: false };
    const steps = runSteps(done);
    try {
      const help = await api('/ai/student/study-help', {
        method: 'POST',
        body: { subjectId: select.value, topic: byId('topic').value.trim(), goal, question: byId('q').value.trim() || undefined },
      });
      done.value = true;
      await Promise.race([steps, sleep(50)]);
      output.innerHTML = studyHelp(help);
    } catch (error) {
      done.value = true;
      output.innerHTML = errorBox(error, true);
      bindRetry(() => event.target.requestSubmit());
    } finally {
      button.disabled = false;
    }
  };
}

function studyHelp(help) {
  return `
    <div class="result-section"><h4>${icon('book', 16)} ${esc(help.meta.subject)} · your total ${esc(help.meta.total ?? '–')}/100</h4><h2 style="font-size:22px;margin-bottom:8px">${esc(help.title)}</h2><p style="margin:0">${esc(help.summary)}</p></div>
    <div class="result-section"><h4>${icon('bulb', 16)} Explanation</h4>${help.explanation.map((s) => `<h5 class="study-h">${esc(s.heading)}</h5><p class="study-p">${esc(s.body)}</p>`).join('')}</div>
    <div class="result-section"><h4>${icon('lesson', 16)} Worked example</h4><p class="study-p"><b>${esc(help.workedExample.problem)}</b></p><ol class="study-steps">${help.workedExample.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol><p class="study-p"><b>Answer:</b> ${esc(help.workedExample.answer)}</p></div>
    <div class="result-section"><h4>${icon('target', 16)} Practise · ${help.practice.length} questions</h4>${help.practice.map((p, i) => `
      <div class="practice"><p class="study-p"><b>${i + 1}.</b> ${esc(p.question)}</p>
        <details><summary>Hint</summary><p class="study-p">${esc(p.hint)}</p></details>
        <details><summary>Answer</summary><p class="study-p">${esc(p.answer)}</p></details></div>`).join('')}</div>
    <div class="result-section"><h4>${icon('calendar', 16)} Your plan</h4>${help.studyPlan.map((d) => `<div class="stage"><div class="mins">${esc(d.day)}</div><div class="small">${esc(d.task)}</div></div>`).join('')}</div>
    <div class="result-section"><h4>${icon('check', 16)} Tips</h4><ul>${help.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="result-section"><div class="insight"><div class="tag">${icon('spark', 14)} Keep going</div><p style="margin-bottom:0">${esc(help.encouragement)}</p></div></div>
    <div class="meta-line"><span>${esc(help.meta.term)}</span><span>Generated ${esc(new Date(help.meta.generatedAt).toLocaleString())}</span><span>Model ${esc(help.meta.model)}</span></div>`;
}

// ---------------------------------------------------------------- coming soon

function renderSoon(key) {
  const feature = COMING_SOON[key] ?? { label: 'This feature', icon: 'lock', text: '' };
  shell(feature.label, `
    <div class="card soon">
      <div class="lock-ring">${icon(feature.icon, 30)}</div>
      <span class="badge brand" style="margin-bottom:12px">Coming soon</span>
      <h2>${esc(feature.label)}</h2>
      <p>${esc(feature.text)}</p>
      <p class="small">Part of the wider CyberSchola platform. Available in a future release.</p>
    </div>`);
}

// ---------------------------------------------------------------- router

/** Which kind of page is showing, so only moves between kinds animate. */
let lastKind = null;

/**
 * Cross-fades between the home page, sign-in and the app with the View
 * Transitions API where the browser has it. Moves within the app stay instant.
 */
function transition(kind, render) {
  const animate = lastKind !== null && lastKind !== kind && document.startViewTransition
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  lastKind = kind;
  if (!animate) return render();
  document.startViewTransition(() => { render(); });
}

async function route() {
  const hash = location.hash || '#/';
  app.__cleanup?.();
  app.__cleanup = null;

  if (hash === '#/' || hash === '#/home') {
    window.scrollTo(0, 0);
    return transition('home', renderHome);
  }

  if (!session.token) {
    if (hash !== '#/login') {
      location.hash = '#/login';
      return;
    }
    window.scrollTo(0, 0);
    return transition('signin', renderLogin);
  }

  if (!session.school) {
    try {
      await loadContext();
    } catch {
      return signOut();
    }
  }

  const [, page, sub] = hash.split('/');
  const pages = {
    login: () => (location.hash = '#/dashboard'),
    dashboard: renderDashboard,
    students: renderStudents,
    teachers: renderTeachers,
    results: renderResults,
    attendance: renderAttendance,
    scores: renderScores,
    copilot: () => (sub === 'teacher' ? renderTeacherCopilot() : sub === 'student' ? renderStudentCopilot() : renderAdminCopilot()),
    soon: () => renderSoon(sub),
  };

  window.scrollTo(0, 0);
  return transition('app', () => (pages[page] ?? renderDashboard)());
}

window.addEventListener('hashchange', route);
route();
