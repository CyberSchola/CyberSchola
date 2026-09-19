// CyberSchola landing page and sign-in.
//
// Plain JavaScript with no dependencies, like the rest of the demo. The look
// follows shadcn/ui and the motion follows Magic UI and Aceternity patterns,
// rebuilt in CSS (landing.css) so nothing new has to be installed.

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PATHS = {
  spark: '<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M17 11a4 4 0 0 0 0-8M22 21a7 7 0 0 0-4-6.3"/>',
  teacher: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h5z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
};
const svg = (name, size = 18, width = 1.9) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Content, all from the product requirements and what the demo actually does.

const MARQUEE = [
  ['clipboard', 'Attendance for pupils, teachers and staff'], ['chart', 'Results with CA1, CA2 and exams'], ['book', 'Lesson plans in minutes'],
  ['target', 'Personal study plans'], ['calendar', 'Timetables without clashes'], ['message', 'Parent updates'],
  ['globe', 'WAEC, JAMB and NECO practice'], ['shield', 'Each school kept separate'], ['video', 'Live after-school classes'], ['users', 'One person, more than one role'],
];

const COPILOTS = [
  {
    key: 'admin', label: 'Administrator', icon: 'chart', status: 'live',
    title: 'Ask how a class is doing. Get an answer you can act on.',
    text: 'The Admin Copilot reads the class results and registers, then tells you which subjects are weakest, which pupils need attention and what to do next. Every number it quotes is calculated from your own records.',
    ticks: ['Subject averages and every pupil below 50, by name', 'Attendance and results side by side, without guessing at causes', 'Missing results flagged as a data gap, not ignored'],
    shot: 'assets/admin-copilot.webp', alt: 'The Admin Copilot analysing SS2 A results',
  },
  {
    key: 'teacher', label: 'Teacher', icon: 'teacher', status: 'live',
    title: 'A full lesson plan before your tea gets cold.',
    text: 'Give it the topic, the class and the length of the lesson. It drafts the objectives, timed stages, materials, homework and ways to support different learners, aligned with the Nigerian curriculum. You review it and make it yours.',
    ticks: ['Stages that add up exactly to the lesson length', 'Local, low-cost examples pupils recognise', 'Only for classes you actually teach'],
    shot: 'assets/teacher-copilot.webp', alt: 'A Physics lesson plan from the Teacher Copilot',
  },
  {
    key: 'student', label: 'Pupil', icon: 'target', status: 'live',
    title: 'Help that starts where each pupil is losing marks.',
    text: 'Pupils pick a subject and a topic. The Copilot explains it step by step, sets practice questions with hints and answers to check themselves, and plans their revision around their own scores. It never sees anyone else\'s.',
    ticks: ['Starts with their weakest subject', 'Practice questions from easy to exam standard', 'A day-by-day revision plan'],
    shot: 'assets/student-copilot.webp', alt: 'The Student Copilot explaining quadratic equations',
  },
  {
    key: 'parent', label: 'Parent', icon: 'home', status: 'next',
    title: 'Know how your child is doing without a trip to school.',
    text: 'Parents will see results, attendance and school notices for each of their children, switch between children in one tap, and ask plain questions about progress. They only ever see their own children.',
    ticks: ['Results and attendance for each child', 'School notices and messages in one place', 'Questions answered from the school\'s records'],
  },
];

const BENTO = [
  { icon: 'clipboard', title: 'Attendance', tag: 'Live', wide: true, text: 'Registers for pupils, teachers and staff, with daily, weekly and termly reports. Corrections keep a record of who changed what and why.', bars: [['Favour J.', 97], ['Daniel O.', 95], ['Joseph M.', 79], ['Emmanuel C.', 68]] },
  { icon: 'chart', title: 'Results and score entry', tag: 'Live', wide: true, text: 'Subject teachers enter CA1, CA2 and exam scores for their own classes. Totals are worked out when read, so a corrected score never leaves a stale total behind.', sheet: [['Daniel Okafor', 13, 14, 36, 63], ['Ada Nwosu', 16, 17, 49, 82], ['Michael Obi', 6, 8, 25, 39]] },
  { icon: 'calendar', title: 'Timetables', tag: 'Coming next', text: 'A teacher can never be booked into two classes at once: the database itself refuses the clash. The rules are built; the screen is next.' },
  { icon: 'users', title: 'People and roles', tag: 'Live', text: 'Students, teachers, parents and staff, where one person can be a teacher and a parent at the same time.' },
  { icon: 'globe', title: 'Exam tutor', tag: 'Coming next', text: 'WAEC, JAMB and NECO practice that explains in English, French or Nigerian Pidgin.', langs: ['English', 'Français', 'Pidgin'] },
  { icon: 'video', title: 'Live classes', tag: 'Coming next', wide: true, text: 'Paid weekend and after-school lessons, so schools and teachers can earn a little more from the teaching they already do.' },
  { icon: 'wifi', title: 'Built for real connections', tag: 'Planned', wide: true, text: 'Designed to keep working when the internet is slow or drops out, which is everyday life for many schools.' },
];

const SECURITY = [
  ['database', 'Separated in the database itself', 'Every table is locked to its school with row-level security, so one school\'s records cannot be read from another, even by a coding mistake.'],
  ['eye', 'Each person sees their own part', 'A teacher sees the pupils they teach, a parent their own children, a pupil only themselves.'],
  ['spark', 'Copilots follow the same rules', 'A Copilot reads through the same checks as the person using it. It never gets more than they could see.'],
  ['shield', 'People stay in charge', 'Lesson plans, marks and messages are drafts until a person approves them. Results are never published by AI on its own.'],
];

const PLANS = [
  ['Free', 'The essentials for schools trying CyberSchola for the first time.'],
  ['Pro', 'Fuller school management, plus Copilots for staff.', true],
  ['Premium', 'More AI help across the school, and more day-to-day tools.'],
  ['Enterprise', 'For groups of schools, with larger scale, support and custom setup.'],
];

const FAQ = [
  ['Is the demo using real data?', 'Yes. It runs on a real server with a demo school, CyberSchola Demo College: twelve SS2 pupils, five teachers and a full term of results and attendance. Every screen is a real request to the platform, and every Copilot answer is generated from that data.'],
  ['Can a teacher see another teacher\'s class?', 'No. A teacher reaches only the pupils they supervise or teach, and a subject teacher can only enter scores for their own subject. The platform checks this on every request, not just in the menus.'],
  ['Will the AI publish results or send messages by itself?', 'No. The Copilots draft and suggest. Anything that matters, such as marks, lesson plans or messages to parents, waits for a person to approve it.'],
  ['What happens when the internet is poor?', 'Working well on slow or unreliable connections is part of the plan from the start, because that is the reality for many schools. Offline support is on the roadmap after the pilot.'],
  ['Which exams will the tutor cover?', 'WAEC, JAMB (UTME) and NECO, with explanations in English, French and Nigerian Pidgin. Students outside a CyberSchola school will be able to subscribe on their own.'],
];

// ------------------------------------------------------------------ landing

export function renderLanding(root, { onSignIn }) {
  const heading = ['Less', 'time', 'on', 'paperwork.', '<br>', 'More', 'time', 'with', 'students.'];
  let delay = 0.15;
  const h1 = heading.map((word) => {
    if (word === '<br>') return '<br>';
    delay += 0.08;
    const gradient = ['More', 'time', 'with', 'students.'].includes(word) && delay > 0.5;
    return `<span class="word${gradient ? ' lp-gradient-text' : ''}" style="animation-delay:${delay.toFixed(2)}s">${word}</span>`;
  }).join(' ');

  root.innerHTML = `
  <div class="lp">
    <header class="lp-nav" id="lp-nav">
      <div class="lp-wrap">
        <a class="lp-logo" href="#/" aria-label="CyberSchola home"><span class="lp-logo-mark">${svg('spark', 18, 2)}</span>CyberSchola</a>
        <nav class="lp-links" aria-label="Sections">
          <a href="#copilots" data-scroll>Copilots</a><a href="#how" data-scroll>How it works</a><a href="#features" data-scroll>Features</a><a href="#security" data-scroll>Security</a><a href="#plans" data-scroll>Plans</a>
        </nav>
        <div class="lp-nav-cta">
          <button class="lp-btn ghost" data-signin>Sign in</button>
          <button class="lp-btn primary shimmer" data-signin>Try the live demo ${svg('arrow', 16)}</button>
        </div>
      </div>
    </header>

    <section class="lp-hero">
      <div class="lp-aurora" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="lp-grid" aria-hidden="true"></div>
      <div class="lp-wrap">
        <div class="lp-hero-copy">
          <span class="lp-pill lp-fade-up"><b>Live demo</b><span class="lp-live-dot"></span> Built for secondary schools in Nigeria, starting in Lagos</span>
          <h1>${h1}</h1>
          <p class="lp-hero-sub lp-fade-up" style="animation-delay:.95s">CyberSchola puts attendance, results, timetables and parent updates in one place, and gives every administrator, teacher, pupil and parent a Copilot that works from the school's own records.</p>
          <div class="lp-hero-cta lp-fade-up" style="animation-delay:1.1s">
            <button class="lp-btn primary lg shimmer" data-signin>Try the live demo ${svg('arrow', 17)}</button>
            <a class="lp-btn ghost lg" href="#copilots" data-scroll>Meet the Copilots</a>
          </div>
          <p class="lp-hero-note lp-fade-up" style="animation-delay:1.25s">No sign-up needed. Pick a demo account and see exactly what that person sees.</p>
        </div>

        <div class="lp-stage lp-fade-up" style="animation-delay:1.2s">
          <div class="lp-frame beam" id="lp-frame">
            <div class="lp-frame-inner">
              <div class="lp-frame-bar"><i></i><i></i><i></i><span class="lp-frame-url">${svg('lock', 12)} app-cyberschola.ibraheembello.com</span></div>
              <img src="assets/admin-dashboard.webp" alt="The CyberSchola administrator dashboard for CyberSchola Demo College" width="1600" height="1000" fetchpriority="high">
            </div>
            <div class="lp-float a"><span class="ico" style="background:#f1ebfe;color:#6d28d9">${svg('book')}</span><div><b>Lesson plan ready</b><small>Newton's Laws of Motion, 40 minutes</small></div></div>
            <div class="lp-float b"><span class="ico" style="background:#fff1e6;color:#c2410c">${svg('alert')}</span><div><b>Mathematics needs attention</b><small>4 pupils below 50 this term</small></div></div>
            <div class="lp-float c"><span class="ico" style="background:#e7f8ef;color:#047857">${svg('target')}</span><div><b>Daniel's study plan</b><small>Starts with Mathematics, 63/100</small></div></div>
          </div>
        </div>
      </div>
    </section>

    <div class="lp-marquee" aria-label="What CyberSchola covers">
      <div class="lp-marquee-track">${[...MARQUEE, ...MARQUEE].map(([i, t], n) => `<span class="lp-chip"${n >= MARQUEE.length ? ' aria-hidden="true"' : ''}>${svg(i, 16)} ${esc(t)}</span>`).join('')}</div>
    </div>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-head reveal">
          <span class="lp-eyebrow">The problem</span>
          <h2>Schools run on people who are stretched thin</h2>
          <p>Most of a school's week still goes into paper, spreadsheets and repeated work that someone has to do by hand.</p>
        </div>
        <div class="lp-problems">
          ${[
            ['teacher', '#f1ebfe', '#6d28d9', 'Teachers', 'Marking scripts, writing lesson notes, taking registers and adding up results. In busy schools, pupils from other classes sometimes help with the marking.'],
            ['clipboard', '#fff1e6', '#c2410c', 'Administrators', 'Reviewing lesson notes, building timetables, scheduling exams, tracking fees and keeping records, mostly on paper or in scattered files.'],
            ['target', '#e7f8ef', '#047857', 'Pupils', 'Some are afraid to ask questions in class, some cannot afford extra lessons, and many revise without knowing where they are weak.'],
          ].map(([i, bg, fg, t, p], n) => `<div class="lp-card lp-problem reveal" style="--d:${n * 0.1}s"><div class="ico" style="background:${bg};color:${fg}">${svg(i, 22)}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
        </div>
        <p class="lp-quote reveal">The people responsible for students end up with <span>the least time for them.</span> CyberSchola is built to give that time back.</p>
      </div>
    </section>

    <section class="lp-section soft" id="copilots">
      <div class="lp-wrap">
        <div class="lp-head reveal">
          <span class="lp-eyebrow">${svg('spark', 14)} Copilots</span>
          <h2>A Copilot for everyone in the school</h2>
          <p>Each one works from the school's real records and sees only what its user is allowed to see. Three of them are working in the demo today.</p>
        </div>
        <div class="lp-tabs-wrap reveal">
          <div class="lp-tabs" role="tablist" aria-label="Copilots">
            <span class="lp-tab-ind" aria-hidden="true"></span>
            ${COPILOTS.map((c, i) => `<button class="lp-tab${i === 0 ? ' on' : ''}" role="tab" id="tab-${c.key}" aria-controls="panel-${c.key}" aria-selected="${i === 0}" data-tab="${c.key}">${svg(c.icon, 16)} ${c.label}</button>`).join('')}
          </div>
        </div>
        ${COPILOTS.map((c, i) => `
          <div class="lp-panel" role="tabpanel" id="panel-${c.key}" aria-labelledby="tab-${c.key}"${i === 0 ? '' : ' hidden'}>
            <div class="lp-panel-copy">
              <span class="lp-status ${c.status}">${c.status === 'live' ? '<span class="lp-live-dot"></span> Working in the demo' : svg('clock', 13) + ' Coming next'}</span>
              <h3>${esc(c.title)}</h3>
              <p>${esc(c.text)}</p>
              <ul class="lp-ticks">${c.ticks.map((t) => `<li>${svg('check', 18, 2.4)} ${esc(t)}</li>`).join('')}</ul>
              ${c.status === 'live' ? `<button class="lp-btn primary" data-signin>Try the ${c.label.toLowerCase()} Copilot ${svg('arrow', 16)}</button>` : ''}
            </div>
            <div class="lp-shot">${c.shot ? `<img src="${c.shot}" alt="${esc(c.alt)}" loading="lazy" width="1600" height="1000">` : parentChat()}</div>
          </div>`).join('')}
      </div>
    </section>

    <section class="lp-section" id="how">
      <div class="lp-wrap">
        <div class="lp-head reveal">
          <span class="lp-eyebrow">How it works</span>
          <h2>Accurate answers, and people stay in charge</h2>
          <p>The Copilots never guess at your school. They work from its records, within each person's permissions, and hand the final say to a human.</p>
        </div>
        <div class="lp-steps" id="lp-steps">
          ${[
            ['Your school\'s records', 'Registers, results and timetables your staff already keep, in one secure place.'],
            ['Only what you may see', 'The platform checks your role first. A teacher gets their classes, a parent their children.'],
            ['The Copilot drafts', 'It works only from that data. Counts and averages are calculated, never estimated.'],
            ['You decide', 'Lesson plans, marks and messages stay drafts until a person approves them.'],
          ].map(([t, p], n) => `<div class="lp-step reveal" style="--d:${n * 0.12}s"><div class="lp-step-num">${n + 1}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}
        </div>
      </div>
    </section>

    <section class="lp-section soft" id="features">
      <div class="lp-wrap">
        <div class="lp-head reveal">
          <span class="lp-eyebrow">The platform</span>
          <h2>Everything a school runs on, in one place</h2>
          <p>The Copilots sit on top of a complete school system, so the help they give is only as good as the records underneath, and those records are kept properly.</p>
        </div>
        <div class="lp-bento">
          ${BENTO.map((b, n) => `
            <div class="lp-card spot reveal${b.wide ? ' wide' : ''}" style="--d:${(n % 3) * 0.08}s">
              <div class="ico">${svg(b.icon, 20)}</div>
              <h3>${esc(b.title)} <span class="lp-tag${b.tag === 'Live' ? ' live' : ''}">${esc(b.tag)}</span></h3>
              <p>${esc(b.text)}</p>
              ${b.bars ? `<div class="lp-mini-bars">${b.bars.map(([name, v]) => `<div>${esc(name)}<span><em style="--w:${v}%"></em></span><b>${v}%</b></div>`).join('')}</div>` : ''}
              ${b.sheet ? `<div class="lp-sheet"><div class="h"><span>Mathematics</span><span>CA1</span><span>CA2</span><span>Exam</span><span>Total</span></div>${b.sheet.map(([n, a, c, e, t]) => `<div><span>${esc(n)}</span><span>${a}</span><span>${c}</span><span>${e}</span><b class="${t < 50 ? 'bad' : t < 60 ? 'warn' : ''}">${t}</b></div>`).join('')}</div>` : ''}
              ${b.langs ? `<div class="lp-langs">${b.langs.map((l) => `<span>${esc(l)}</span>`).join('')}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>
    </section>

    <section class="lp-section lp-dark" id="security">
      <div class="lp-wrap lp-secure">
        <div>
          <div class="lp-head reveal" style="text-align:left;margin:0 0 30px">
            <span class="lp-eyebrow">${svg('shield', 14)} Security</span>
            <h2>Each school's data stays with that school</h2>
            <p>Protection is built into the database, not only the screens. It holds for every person and every Copilot, on every request.</p>
          </div>
          <div class="lp-secure-list">
            ${SECURITY.map(([i, t, p], n) => `<div class="lp-secure-item reveal" style="--d:${n * 0.08}s"><span class="ico">${svg(i, 20)}</span><div><b>${esc(t)}</b><span>${esc(p)}</span></div></div>`).join('')}
          </div>
        </div>
        <div class="lp-vault reveal" aria-hidden="true">
          <div class="lp-ring"><em></em></div><div class="lp-ring"><em style="background:#f0abfc;box-shadow:0 0 20px #f0abfc"></em></div><div class="lp-ring"><em></em></div>
          <div class="lp-core">${svg('lock', 46, 1.6)}</div>
          <span class="lp-school s1">School A</span><span class="lp-school s2">School B</span><span class="lp-school s3">School C</span>
        </div>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-stats">
          ${[
            [5, '', 'roles, each with its own dashboard'],
            [4, '', 'pilot schools planned in Lagos'],
            [3, '', 'languages for the exam tutor'],
            [38, '', 'years of past exam questions planned'],
          ].map(([n, suffix, label], i) => `<div class="lp-card lp-stat reveal" style="--d:${i * 0.08}s"><strong data-count="${n}" data-suffix="${suffix}">0${suffix}</strong><span>${label}</span></div>`).join('')}
        </div>
      </div>
    </section>

    <section class="lp-section soft" id="plans">
      <div class="lp-wrap">
        <div class="lp-head reveal">
          <span class="lp-eyebrow">Plans</span>
          <h2>A plan for every size of school</h2>
          <p>Start free and grow into more help as the school is ready. Students preparing for exams on their own will have a monthly tutor plan.</p>
        </div>
        <div class="lp-plans">
          ${PLANS.map(([name, text, featured], n) => `<div class="lp-card lp-plan reveal${featured ? ' featured' : ''}" style="--d:${n * 0.08}s"><h3>${name}</h3><p>${text}</p><span class="price">Pricing after the pilot</span></div>`).join('')}
        </div>
        <p class="lp-plans-note reveal">Prices will be set with our pilot schools, based on what actually saves them time.</p>
      </div>
    </section>

    <section class="lp-section">
      <div class="lp-wrap">
        <div class="lp-head reveal"><span class="lp-eyebrow">Questions</span><h2>Things people usually ask</h2></div>
        <div class="lp-faq reveal">
          ${FAQ.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)} ${svg('chevron', 20)}</summary><div class="ans"><div><p>${esc(a)}</p></div></div></details>`).join('')}
        </div>
      </div>
    </section>

    <section class="lp-section" style="padding-top:0">
      <div class="lp-wrap">
        <div class="lp-final reveal">
          <div class="lp-grid" aria-hidden="true"></div>
          <h2>See it working with a real school's data</h2>
          <p>Sign in as the administrator, a teacher or a pupil. Each account shows exactly what that person would see on their first day.</p>
          <div class="lp-hero-cta" style="margin-top:0">
            <button class="lp-btn white lg" data-signin>Try the live demo ${svg('arrow', 17)}</button>
          </div>
        </div>
      </div>
    </section>

    <footer class="lp-footer">
      <div class="lp-wrap">
        <a class="lp-logo" href="#/"><span class="lp-logo-mark" style="color:#fff">${svg('spark', 16, 2)}</span>CyberSchola</a>
        <span>AI-powered school management and personalised learning, for secondary schools in Nigeria.</span>
        <span>© 2026 CyberSchola</span>
      </div>
    </footer>
  </div>`;

  wireLanding(root, onSignIn);
}

function parentChat() {
  return `
    <div class="lp-chat" aria-label="An example conversation with the Parent Copilot">
      <div class="lp-msg me">How did Daniel do in Mathematics this term?</div>
      <div class="lp-msg ai">Daniel scored <b>63 out of 100</b> in Mathematics this term: 13 and 14 in his two tests, and 36 out of 60 in the exam. The exam is where he lost most marks. His attendance is strong at 95%.</div>
      <div class="lp-msg me">What can I do to help him at home?</div>
      <div class="lp-msg ai" id="lp-typing"><span class="lp-typing"><i></i><i></i><i></i></span></div>
    </div>`;
}

function wireLanding(root, onSignIn) {
  const cleanups = [];
  root.querySelectorAll('[data-signin]').forEach((b) => (b.onclick = onSignIn));

  // Smooth scroll within the page without touching the router's hash.
  root.querySelectorAll('[data-scroll]').forEach((a) => {
    a.onclick = (event) => {
      event.preventDefault();
      document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    };
  });

  // Nav turns solid once the page moves; the product frame tilts flat as it rises.
  const nav = root.querySelector('#lp-nav');
  const frame = root.querySelector('#lp-frame');
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 24);
    if (frame && !reduced()) {
      const progress = Math.min(1, Math.max(0, window.scrollY / 520));
      frame.style.setProperty('--tilt', `${(22 * (1 - progress)).toFixed(2)}deg`);
      frame.style.setProperty('--zoom', (0.94 + 0.06 * progress).toFixed(3));
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => window.removeEventListener('scroll', onScroll));
  onScroll();

  // Reveal on scroll, number tickers, and the how-it-works line.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      entry.target.querySelectorAll?.('[data-count]').forEach(countUp);
      if (entry.target.matches('[data-count]')) countUp(entry.target);
      if (entry.target.id === 'lp-steps') entry.target.style.setProperty('--line', 1);
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
  root.querySelectorAll('.reveal, #lp-steps').forEach((el) => observer.observe(el));
  cleanups.push(() => observer.disconnect());

  // Spotlight follows the pointer across feature cards.
  root.querySelectorAll('.spot').forEach((card) => {
    card.onpointermove = (event) => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    };
  });

  // shadcn-style tabs with a sliding indicator.
  const tabs = [...root.querySelectorAll('[data-tab]')];
  const indicator = root.querySelector('.lp-tab-ind');
  const place = (tab) => { indicator.style.left = `${tab.offsetLeft}px`; indicator.style.width = `${tab.offsetWidth}px`; };
  const select = (tab) => {
    tabs.forEach((t) => { t.classList.toggle('on', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    root.querySelectorAll('.lp-panel').forEach((panel) => {
      const show = panel.id === `panel-${tab.dataset.tab}`;
      panel.hidden = !show;
      if (show) { panel.classList.remove('enter'); void panel.offsetWidth; panel.classList.add('enter'); }
    });
    place(tab);
    if (tab.dataset.tab === 'parent') typeParentAnswer(root);
  };
  tabs.forEach((tab, i) => {
    tab.onclick = () => select(tab);
    tab.onkeydown = (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step) { const next = tabs[(i + step + tabs.length) % tabs.length]; next.focus(); select(next); }
    };
  });
  requestAnimationFrame(() => place(tabs[0]));
  const onResize = () => place(tabs.find((t) => t.classList.contains('on')) ?? tabs[0]);
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));

  // The router calls this when the page is left.
  root.__cleanup = () => cleanups.forEach((fn) => fn());
}

function countUp(el) {
  if (el.dataset.done) return;
  el.dataset.done = '1';
  const target = Number(el.dataset.count);
  const suffix = el.dataset.suffix ?? '';
  if (reduced()) { el.textContent = `${target}${suffix}`; return; }
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / 1400);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(target * eased)}${suffix}`;
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function typeParentAnswer(root) {
  const bubble = root.querySelector('#lp-typing');
  if (!bubble || bubble.dataset.done) return;
  bubble.dataset.done = '1';
  const text = 'Short, regular practice helps most. Twenty minutes of exam-style questions three evenings a week, starting with quadratic equations, would go straight at the marks he is losing. His Student Copilot can build that plan with him.';
  setTimeout(() => {
    if (reduced()) { bubble.textContent = text; return; }
    bubble.textContent = '';
    let i = 0;
    const tick = () => { bubble.textContent = text.slice(0, i += 2); if (i < text.length) setTimeout(tick, 16); };
    tick();
  }, 900);
}

// ------------------------------------------------------------------ sign in

const TOUR = [
  ['Administrator', 'Open the dashboard, add a student, then ask the Admin Copilot about SS2 A.'],
  ['Chinedu Eze, Physics', 'Generate a 40-minute lesson on Newton\'s Laws of Motion.'],
  ['Adewale Ibrahim, Mathematics', 'Enter or correct CA and exam scores for SS2 A.'],
  ['Daniel Okafor, pupil', 'See his results and ask the Student Copilot for help.'],
];

const GROUPS = [
  { label: 'School leadership', keys: ['admin'] },
  { label: 'Teachers', keys: ['physicsTeacher', 'mathsTeacher'] },
  { label: 'Pupils', keys: ['student'] },
];

const TRY = {
  admin: 'Try: dashboard, students, teachers and the Admin Copilot',
  physicsTeacher: 'Try: the Teacher Copilot lesson plan',
  mathsTeacher: 'Try: Enter Scores for Mathematics',
  student: 'Try: My Results and the Student Copilot',
};

const AVATAR = {
  admin: 'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  physicsTeacher: 'linear-gradient(135deg,#f59e0b,#ea580c)',
  mathsTeacher: 'linear-gradient(135deg,#06b6d4,#2563eb)',
  student: 'linear-gradient(135deg,#34d399,#059669)',
};

export function renderSignIn(root, { accounts, onPick, onHome }) {
  const initials = (name) => name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  root.innerHTML = `
  <div class="signin">
    <aside class="signin-side">
      <div class="lp-aurora" aria-hidden="true"><span></span><span></span><span></span></div>
      <button class="signin-back" data-home>${svg('back', 16)} Back to the home page</button>
      <div>
        <h1>Welcome to CyberSchola Demo College</h1>
        <p>A demo school on a real server: twelve SS2 pupils, five teachers and a full term of results and attendance.</p>
      </div>
      <div>
        <p style="color:rgba(255,255,255,.6);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 12px">A good order for the tour</p>
        <ol class="tour">${TOUR.map(([t, s]) => `<li><div><b>${esc(t)}</b><span>${esc(s)}</span></div></li>`).join('')}</ol>
      </div>
      <p class="signin-foot">2025/2026 session · Second Term</p>
    </aside>
    <main class="signin-main">
      <div class="signin-card">
        <h2>Sign in</h2>
        <p>Choose who you want to be. Each account signs in with a real, time-limited token.</p>
        ${GROUPS.map((g) => `
          <div class="group-label">${g.label}</div>
          ${g.keys.map((key) => {
            const index = accounts.findIndex((a) => a.key === key);
            const a = accounts[index];
            return `<button class="acct" data-account="${index}">
              <span class="av" style="background:${AVATAR[key]}">${esc(initials(a.name))}</span>
              <span><strong>${esc(a.name)}</strong><span class="t">${esc(a.title)}</span><span class="try">${esc(TRY[key])}</span></span>
              <span class="go">${svg('arrow', 18)}</span>
            </button>`;
          }).join('')}`).join('')}
        <div class="signin-note">${svg('shield', 18)}<span>What you see is exactly what the platform allows for that person. A teacher sees only their classes, and a pupil sees only themselves.</span></div>
      </div>
    </main>
  </div>`;

  root.querySelector('[data-home]').onclick = onHome;
  root.querySelectorAll('[data-account]').forEach((button) => {
    button.onclick = async () => {
      root.querySelectorAll('[data-account]').forEach((b) => (b.disabled = true));
      button.querySelector('.try').textContent = 'Signing you in…';
      try {
        await onPick(accounts[Number(button.dataset.account)]);
      } catch (error) {
        root.querySelectorAll('[data-account]').forEach((b) => (b.disabled = false));
        button.querySelector('.try').textContent = error.message;
      }
    };
  });
}
