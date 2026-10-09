/* אפליקציית תזונה אישית. כל הנתונים נשמרים בטלפון בלבד (localStorage). */
(function () {
  'use strict';
  var C = window.Calc;
  var KEY = 'nutrition.v1';
  var MEALS = [['breakfast', 'בוקר'], ['lunch', 'צהריים'], ['dinner', 'ערב'], ['snack', 'נשנושים']];
  var UNIT = { g: 'גרם', ml: 'מ״ל', serving: 'מנות' };
  var DISCLAIMER = 'היעדים והערכות המזון הם אומדנים לצורכי מעקב ואינם תחליף לייעוץ תזונתי אישי.';

  /* ---------- נתונים ---------- */
  function blank() { return { v: 1, profile: null, goals: [], foods: [], meals: [], diary: [], weights: [], settings: { usdaKey: '', geminiKey: '', geminiConsent: false, geminiModel: '' } }; }
  function load() {
    try {
      var r = localStorage.getItem(KEY);
      if (r) { var o = JSON.parse(r); return Object.assign(blank(), o); }
    } catch (e) { /* ריק */ }
    return blank();
  }
  var S = load();
  if (!S.settings) S.settings = {};
  ['usdaKey', 'geminiKey', 'geminiModel'].forEach(function (k) { if (S.settings[k] === undefined) S.settings[k] = ''; });
  if (S.settings.geminiConsent === undefined) S.settings.geminiConsent = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); return true; }
    catch (e) { toast('השמירה נכשלה. ייתכן שהאחסון בטלפון מלא או חסום'); return false; }
  }
  var uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  /* ---------- עזרים ---------- */
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(',', '.');
    if (s === '') return null;
    var x = Number(s); return isNaN(x) ? NaN : x;
  }
  function r0(x) { return Math.round(x); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function kc(v) { return v === null || v === undefined ? 'לא ידוע' : r0(v) + ' קק״ל'; }
  function gm(v) { return v === null || v === undefined ? 'לא ידוע' : r1(v) + ' ג׳'; }
  function mealName(k) { var m = MEALS.filter(function (x) { return x[0] === k; })[0]; return m ? m[1] : k; }
  function dateLabel(s) {
    return new Date(s + 'T12:00:00Z').toLocaleDateString('he-IL', { timeZone: C.TZ, weekday: 'long', day: 'numeric', month: 'long' });
  }
  function guessMeal() { var h = C.nowHour(); return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; }
  var toastT;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function setPath(o, path, v) { var p = path.split('.'); for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; }

  var ui = { screen: S.profile ? 'main' : 'wizard', tab: 'today', date: C.today(), add: { meal: guessMeal(), tab: 'foods', q: '', pick: null, editFood: null, prefill: null, search: { q: '', results: null, loading: false, err: null } }, set: null, wiz: null, res: null };
  if (ui.screen === 'wizard') ui.wiz = newWiz('new');

  /* ---------- שאלון ---------- */
  function newWiz(mode) {
    var p = S.profile || {};
    return {
      mode: mode, step: 0, conf: {}, msgs: null,
      d: {
        age: p.age != null ? String(p.age) : '', height: p.height != null ? String(p.height) : '', weight: p.weight != null ? String(p.weight) : '',
        sex: p.sex || '', goal: p.goal || '', target: p.target != null ? String(p.target) : '',
        daily: p.daily || '', tfreq: p.tfreq != null ? String(p.tfreq) : '', tdur: p.tdur != null ? String(p.tdur) : '', tint: p.tint || '',
        factor: null,
        prefs: Object.assign({ veg: false, vegan: false, kosher: false, allergies: '', dislikes: '' }, p.prefs || {}),
        screen: { preg: false, ed: false, med: false }
      }
    };
  }
  var STEPS = 7;

  function rangeCheck(label, unit, val, ok, warns, field, w) {
    if (val === null || isNaN(val)) return { err: 'יש להזין ' + label };
    if (val >= ok[0] && val <= ok[1]) return {};
    for (var i = 0; i < warns.length; i++) {
      if (val >= warns[i][0] && val <= warns[i][1]) {
        return { conf: { field: field, val: String(val), msg: label + ' ' + val + ' ' + unit + ' נראה חריג. אשר שהערך נכון' } };
      }
    }
    return { err: label + ' ' + val + ' ' + unit + ' מחוץ לטווח שהאפליקציה תומכת בו' };
  }

  function validateStep(w) {
    var d = w.d, errs = [], confs = [];
    function take(r) { if (r.err) errs.push(r.err); if (r.conf) { if (w.conf[r.conf.field] !== r.conf.val) confs.push(r.conf); } }
    if (w.step === 0) {
      var age = num(d.age);
      if (age === null || isNaN(age) || age < 10 || age > 110 || Math.floor(age) !== age) errs.push('יש להזין גיל במספר שלם (10 עד 110)');
      else if (age > 90) take({ conf: { field: 'age', val: String(age), msg: 'גיל ' + age + ' נראה חריג. אשר שהערך נכון' } });
      take(rangeCheck('גובה', 'ס״מ', num(d.height), [140, 210], [[100, 139], [211, 250]], 'height'));
      take(rangeCheck('משקל', 'ק״ג', num(d.weight), [40, 200], [[25, 39], [201, 350]], 'weight'));
    } else if (w.step === 1) {
      if (!d.sex) errs.push('יש לבחור מקדם');
    } else if (w.step === 2) {
      if (!d.goal) errs.push('יש לבחור מטרה');
      if (d.goal === 'loss') {
        var t = num(d.target), cur = num(d.weight);
        if (t === null || isNaN(t)) errs.push('יש להזין משקל יעד');
        else if (t < 25 || t > 350) errs.push('משקל היעד מחוץ לטווח');
        else if (t >= cur) errs.push('משקל היעד חייב להיות נמוך מהמשקל הנוכחי (' + cur + ' ק״ג). אם אינך רוצה לרדת, בחר “שמירה על המשקל”');
      }
    } else if (w.step === 3) {
      if (!d.daily) errs.push('יש לבחור את אופי הפעילות היומיומית');
      var fr = num(d.tfreq), du = num(d.tdur);
      if (fr === null || isNaN(fr) || fr < 0 || fr > 14) errs.push('יש להזין כמה פעמים בשבוע אתה מתאמן (0 אם אינך מתאמן)');
      if (fr > 0) {
        if (du === null || isNaN(du) || du < 5 || du > 300) errs.push('יש להזין משך אימון בדקות (5 עד 300)');
        if (!d.tint) errs.push('יש לבחור עצימות אימון');
      }
    } else if (w.step === 4) {
      if (!d.factor) errs.push('יש לבחור רמת פעילות');
    }
    return { errs: errs, confs: confs };
  }

  function profileFromDraft(d, needsPro) {
    return {
      age: num(d.age), height: num(d.height), weight: num(d.weight), sex: d.sex, goal: d.goal,
      target: d.goal === 'loss' ? num(d.target) : null,
      daily: d.daily, tfreq: num(d.tfreq), tdur: num(d.tdur), tint: d.tint, factor: d.factor,
      prefs: d.prefs, needsPro: !!needsPro
    };
  }
  function needsProOf(d) { return num(d.age) < 18 || d.screen.preg || d.screen.ed || d.screen.med; }

  function viewWizard() {
    var w = ui.wiz, d = w.d, h = '';
    var dots = ''; for (var i = 0; i < STEPS; i++) dots += '<i class="' + (i <= w.step ? 'on' : '') + '"></i>';
    h += '<h1>' + (w.mode === 'update' ? 'עדכון פרופיל' : 'בוא נכיר') + '</h1><div class="stepper">' + dots + '</div>';
    if (w.step === 0) {
      h += '<p class="mute">שלושה נתונים בסיסיים לחישוב. אפשר לחזור ולערוך בכל שלב.</p>' +
        '<label>גיל (שנים)</label><input data-w="age" inputmode="numeric" value="' + esc(d.age) + '">' +
        '<label>גובה (ס״מ)</label><input data-w="height" inputmode="decimal" value="' + esc(d.height) + '">' +
        '<label>משקל נוכחי (ק״ג)</label><input data-w="weight" inputmode="decimal" value="' + esc(d.weight) + '">';
    } else if (w.step === 1) {
      h += '<p>נוסחת החישוב משתמשת במקדם שונה לגברים ולנשים. בחר את המקדם שמתאים לך לצורך החישוב.</p>' +
        optCard('sex', 'm', 'מקדם גבר', '', d.sex === 'm') + optCard('sex', 'f', 'מקדם אישה', '', d.sex === 'f');
    } else if (w.step === 2) {
      h += '<p>מה המטרה?</p>' + optCard('goal', 'loss', 'ירידה במשקל', 'גרעון מתון מצריכת התחזוקה', d.goal === 'loss') +
        optCard('goal', 'maintain', 'שמירה על המשקל', 'יעד שווה לצריכת התחזוקה המשוערת', d.goal === 'maintain');
      if (d.goal === 'loss') h += '<label>משקל יעד (ק״ג)</label><input data-w="target" inputmode="decimal" value="' + esc(d.target) + '">';
    } else if (w.step === 3) {
      h += '<p>הפעילות היומיומית שלך</p>' + optCard('daily', 'sed', 'עבודה בישיבה', '', d.daily === 'sed') + optCard('daily', 'mov', 'עבודה בתנועה', 'הליכה, עמידה או מאמץ פיזי במהלך היום', d.daily === 'mov') +
        '<h2>אימונים</h2><label>כמה פעמים בשבוע?</label><input data-w="tfreq" inputmode="numeric" value="' + esc(d.tfreq) + '">' +
        '<label>משך אימון ממוצע (דקות)</label><input data-w="tdur" inputmode="numeric" value="' + esc(d.tdur) + '">' +
        '<label>עצימות</label><select data-w="tint"><option value="">בחר</option>' +
        [['low', 'קלה: אפשר לשוחח בקלות'], ['mid', 'בינונית: נושמים חזק, עדיין אפשר לדבר'], ['high', 'גבוהה: קשה לדבר']].map(function (o) { return '<option value="' + o[0] + '"' + (d.tint === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    } else if (w.step === 4) {
      var sug = C.suggestActivity(d.daily, num(d.tfreq), num(d.tdur), d.tint);
      h += '<p>בחר את הרמה שמתארת אותך הכי טוב. המקדמים הם אומדנים בלבד, והצריכה המחושבת תהיה אומדן.</p>';
      C.ACTIVITY.forEach(function (a, i) {
        h += '<div class="opt' + (d.factor === a.v ? ' sel' : '') + '" data-a="wfactor" data-v="' + a.v + '"><b>' + a.t + ' (' + a.v + ')' + (i === sug ? '<span class="tag">מוצע לפי התשובות</span>' : '') + '</b><small>' + a.d + '</small></div>';
      });
      h += '<p class="mute">ההצעה מבוססת על הפעילות היומיומית והאימונים יחד. הבחירה שלך.</p>';
    } else if (w.step === 5) {
      h += '<p>העדפות תזונה (לא חובה)</p>' +
        chk('prefs.veg', 'צמחונות', d.prefs.veg) + chk('prefs.vegan', 'טבעונות', d.prefs.vegan) + chk('prefs.kosher', 'כשרות', d.prefs.kosher) +
        '<label>אלרגיות</label><input data-w="prefs.allergies" value="' + esc(d.prefs.allergies) + '">' +
        '<label>מזונות שאיני אוהב</label><input data-w="prefs.dislikes" value="' + esc(d.prefs.dislikes) + '">';
    } else if (w.step === 6) {
      h += '<p>בדיקת התאמה קצרה. אם אחד מהמצבים הבאים נכון, יעד לירידה במשקל צריך להיקבע עם איש מקצוע. האפליקציה תשמש אותך ליומן ולמעקב. אין צורך לפרט.</p>' +
        chk('screen.preg', 'היריון או הנקה', d.screen.preg) + chk('screen.ed', 'הפרעת אכילה כעת או בעבר', d.screen.ed) +
        chk('screen.med', 'מצב רפואי או תרופות שמחייבים התאמת תזונה', d.screen.med);
      if (num(d.age) < 18) h += '<div class="note">בגיל מתחת ל-18 אין חישוב יעד אוטומטי.</div>';
    }
    if (w.msgs) {
      w.msgs.errs.forEach(function (e) { h += '<div class="err">' + esc(e) + '</div>'; });
      w.msgs.confs.forEach(function (c) { h += '<label class="check"><input type="checkbox" data-conf="' + c.field + '" data-val="' + esc(c.val) + '"><span>' + esc(c.msg) + '</span></label>'; });
    }
    h += '<div class="row" style="margin-top:14px"><button data-a="wback" style="flex:1">' + (w.step === 0 && w.mode === 'new' ? ' ' : 'חזרה') + '</button>' +
      '<button class="primary" data-a="wnext" style="flex:2">' + (w.step === STEPS - 1 ? 'חשב יעד' : 'המשך') + '</button></div>';
    return h;
  }
  function optCard(k, v, t, sub, sel) {
    return '<div class="opt' + (sel ? ' sel' : '') + '" data-a="wset" data-k="' + k + '" data-v="' + v + '"><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  }
  function chk(path, label, on) { return '<label class="check"><input type="checkbox" data-w="' + path + '"' + (on ? ' checked' : '') + '><span>' + label + '</span></label>'; }

  /* ---------- מסך תוצאת יעד ---------- */
  function startResult() {
    var d = ui.wiz.d, pro = needsProOf(d);
    var p = { sex: d.sex, age: num(d.age), height: num(d.height), weight: num(d.weight), goal: d.goal, target: num(d.target), factor: d.factor };
    var res = pro ? { status: 'blocked', reason: 'pro' } : C.computeGoal(p);
    ui.res = { calc: res, p: p, pro: pro, pct: Object.assign({}, C.DEFAULT_PCT), manual: '' };
    ui.screen = 'result';
  }
  function macroOut(kcal, pct) {
    var chk2 = C.pctCheck(pct), g = C.macroGrams(kcal, pct), h = '';
    h += '<div class="kpi"><div><span class="mute">פחמימות</span><b>' + r0(g.c) + ' ג׳</b></div><div><span class="mute">חלבון</span><b>' + r0(g.p) + ' ג׳</b></div><div><span class="mute">שומן</span><b>' + r0(g.f) + ' ג׳</b></div></div>';
    if (!chk2.ok) h += '<div class="err">סכום האחוזים הוא ' + chk2.sum + '%. יש להגיע ל-100%</div>';
    else h += '<div class="okbox">סכום האחוזים תקין: 100%</div>';
    chk2.warnings.forEach(function (w) { h += '<div class="note">' + esc(w) + '</div>'; });
    return h;
  }
  function viewResult() {
    var R = ui.res, c = R.calc, d = ui.wiz.d, h = '<h1>היעד שלך</h1>';
    if (c.status === 'ok') {
      var cur = C.goalInEffect(S.goals, C.today());
      h += '<div class="card"><div class="kpi"><div><span class="mute">מנוחה (אומדן)</span><b>' + r0(c.bmr) + '</b>קק״ל</div><div><span class="mute">תחזוקה (אומדן)</span><b>' + r0(c.maint) + '</b>קק״ל</div></div>' +
        '<p style="margin-top:12px">יעד יומי מוצע</p><div class="big">' + r0(c.target) + ' <span class="mute" style="font-size:18px">קק״ל</span></div>' +
        (R.p.goal === 'loss' ? '<p class="mute">היעד מבוסס על גרעון מתון של 10% מצריכת התחזוקה. זו הצעת פתיחה כללית ולא המלצה רפואית אישית. לא מובטח תאריך הגעה למשקל היעד.</p>' : '<p class="mute">היעד לשמירה על המשקל הוא אומדן צריכת התחזוקה.</p>') +
        (cur && ui.wiz.mode === 'update' ? '<div class="note">היעד הנוכחי: ' + r0(cur.kcal) + ' קק״ל. החלפה תחול מהיום. הימים הקודמים יוצגו מול היעד שהיה בתוקף בהם.</div>' : '') + '</div>';
      h += '<div class="card"><h3>חלוקה לפחמימות, חלבון ושומן</h3><div class="grid3">' +
        ['c', 'p', 'f'].map(function (k) { return '<div><label style="margin-top:0">' + { c: 'פחמימות', p: 'חלבון', f: 'שומן' }[k] + ' %</label><input data-in="pct" data-k="' + k + '" inputmode="decimal" value="' + R.pct[k] + '"></div>'; }).join('') +
        '</div><div id="macroOut">' + macroOut(c.target, R.pct) + '</div>' +
        '<p class="mute">ברירת המחדל (45% פחמימות, 25% חלבון, 30% שומן) היא חלוקה כללית ואינה חלוקה אופטימלית אישית. גרם חלבון אינו גרם של מזון המכיל חלבון.</p></div>';
      h += '<div class="card"><h3>נתוני החישוב</h3><table>' +
        row('גיל', R.p.age + ' שנים') + row('גובה', R.p.height + ' ס״מ') + row('משקל נוכחי', R.p.weight + ' ק״ג') +
        (R.p.goal === 'loss' ? row('משקל יעד', R.p.target + ' ק״ג') : '') + row('מקדם החישוב', R.p.sex === 'm' ? 'גבר' : 'אישה') +
        row('מטרה', R.p.goal === 'loss' ? 'ירידה במשקל' : 'שמירה על המשקל') + row('מקדם פעילות', C.ACTIVITY.filter(function (a) { return a.v === R.p.factor; })[0].t + ' (' + R.p.factor + ')') + '</table></div>';
      h += '<button class="primary block" data-a="rsave">' + (ui.wiz.mode === 'update' ? 'אשר והחלף יעד' : 'שמור והתחל') + '</button>';
    } else {
      var why = c.reason === 'pro' ? 'לפי התשובות שלך, יעד לירידה במשקל צריך להיקבע עם איש מקצוע. האפליקציה לא תפיק יעד אוטומטי.' :
        c.reason === 'underweight' ? 'המשקל הנוכחי או משקל היעד נמצאים בטווח שבו האפליקציה אינה מציעה ירידה במשקל. מומלץ להיוועץ באיש מקצוע.' :
          'הערך המחושב (' + r0(c.raw) + ' קק״ל ליום) נמוך מהגבול השמרני של האפליקציה (' + c.floor + ' קק״ל). נדרשת התאמה מקצועית, ולכן לא יוצע יעד אוטומטי.';
      h += '<div class="note">' + why + '</div><p>אפשר להשתמש ביומן ובמעקב המשקל, ולהזין יעד שנקבע עם איש מקצוע.</p>' +
        '<label>יעד יומי שנקבע עם איש מקצוע (קק״ל)</label><input id="manualKcal" inputmode="numeric" value="' + esc(R.manual) + '">' +
        '<button class="primary block" data-a="rmanual">שמור יעד</button><button class="block" data-a="rskip">המשך בלי יעד</button>';
    }
    h += '<button class="link block" data-a="rback">חזרה לשאלון</button><p class="mute">' + DISCLAIMER + '</p>';
    return h;
  }
  function row(a, b) { return '<tr><td class="mute">' + a + '</td><td><b>' + b + '</b></td></tr>'; }

  function commitProfileAndGoal(kcal, pct, src) {
    var d = ui.wiz.d, mode = ui.wiz.mode;
    S.profile = profileFromDraft(d, ui.res.pro);
    if (kcal) {
      var today = C.today();
      S.goals = S.goals.filter(function (g) { return g.from !== today; });
      S.goals.push({ from: today, kcal: kcal, pct: pct, src: src, basis: { age: S.profile.age, height: S.profile.height, weight: S.profile.weight, sex: S.profile.sex, goal: S.profile.goal, target: S.profile.target, factor: S.profile.factor } });
    }
    if (mode === 'new' && !S.weights.some(function (w) { return w.date === C.today(); })) {
      S.weights.push({ id: uid(), date: C.today(), kg: S.profile.weight });
      toast('המשקל הנוכחי נרשם גם במעקב המשקל');
    }
    save();
    ui.screen = 'main'; ui.tab = 'today'; ui.date = C.today(); ui.wiz = null; ui.res = null;
  }

  /* ---------- מסך היום ---------- */
  function viewToday() {
    var d = ui.date, g = C.goalInEffect(S.goals, d);
    var es = S.diary.filter(function (e) { return e.date === d; });
    var t = C.totals(es.map(function (e) { return e.snap; }));
    var h = '<div class="datebar"><button data-a="dprev" aria-label="יום קודם">›</button><div class="d">' + dateLabel(d) + (d === C.today() ? ' (היום)' : '') + '</div><button data-a="dnext" aria-label="יום הבא">‹</button></div>';
    if (d !== C.today()) h += '<div class="row" style="justify-content:center"><button class="link" data-a="dtoday">חזרה להיום</button></div>';
    if (g) {
      var gg = C.macroGrams(g.kcal, g.pct), left = g.kcal - t.kcal;
      h += '<div class="card"><div class="row between"><div><div class="mute">נרשם</div><div class="big">' + r0(t.kcal) + '</div></div><div style="text-align:end"><div class="mute">' + (left >= 0 ? 'נותרו' : 'מעל היעד ב') + '</div><div class="big">' + r0(Math.abs(left)) + '</div></div></div>' +
        '<div class="bar"><i style="width:' + Math.min(100, t.kcal / g.kcal * 100) + '%;background:var(--brand)"></i></div>' +
        '<p class="mute">יעד יומי: ' + r0(g.kcal) + ' קק״ל' + (t.partial.kcal ? ' · הסיכום חלקי: יש פריטים ללא קלוריות' : '') + '</p>' +
        macroBar('פחמימות', t.c, gg.c, 'var(--c)', t.partial.c) + macroBar('חלבון', t.p, gg.p, 'var(--p)', t.partial.p) + macroBar('שומן', t.f, gg.f, 'var(--f)', t.partial.f);
      if (d < S.goals.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; })[0].from) h += '<p class="mute">היום הזה קודם ליעד הראשון, ולכן הוא מוצג מול היעד הראשון.</p>';
      h += '</div>';
    } else {
      h += '<div class="note">עדיין אין יעד יומי. אפשר לתעד אוכל, ולחשב יעד דרך “הגדרות” ← “עדכון פרופיל”.</div>' +
        '<div class="card"><div class="mute">נרשם</div><div class="big">' + r0(t.kcal) + ' קק״ל</div>' + (t.partial.kcal ? '<p class="mute">הסיכום חלקי: יש פריטים ללא קלוריות</p>' : '') + '</div>';
    }
    MEALS.forEach(function (m) {
      var list = es.filter(function (e) { return e.meal === m[0]; });
      var mt = C.totals(list.map(function (e) { return e.snap; }));
      h += '<div class="card"><div class="row between"><h3>' + m[1] + '</h3><span class="mute">' + (list.length ? r0(mt.kcal) + ' קק״ל' + (mt.partial.kcal ? ' (חלקי)' : '') : '') + '</span></div>';
      list.forEach(function (e) {
        h += '<div class="entry" data-a="eedit" data-id="' + e.id + '"><div><div>' + esc(e.name) + (e.brand ? ' <span class="mute">· ' + esc(e.brand) + '</span>' : '') + '</div><div class="mute">' + r1(e.qty) + ' ' + UNIT[e.unit] + (e.snap.p === null || e.snap.c === null || e.snap.f === null ? ' · ערכים חסרים' : '') + '</div></div><div class="kc">' + kc(e.snap.kcal) + '</div></div>';
      });
      if (!list.length) h += '<p class="mute">עדיין לא נרשם דבר.</p>';
      h += '<div class="row"><button class="primary grow" data-a="addto" data-m="' + m[0] + '">+ הוסף</button>' + (list.length ? '<button data-a="savemeal" data-m="' + m[0] + '">שמור כארוחה</button>' : '') + '</div></div>';
    });
    return h + '<p class="mute">' + DISCLAIMER + '</p>';
  }
  function macroBar(name, val, goal, color, partial) {
    return '<div class="macro"><div class="row between"><span>' + name + '</span><span>' + r0(val) + ' / ' + r0(goal) + ' ג׳' + (partial ? ' (חלקי)' : '') + '</span></div><div class="bar"><i style="width:' + Math.min(100, goal ? val / goal * 100 : 0) + '%;background:' + color + '"></i></div></div>';
  }

  /* ---------- הוספת אוכל ---------- */
  function unitsFor(f) {
    if (f.base === '100g') return f.sw > 0 ? ['g', 'serving'] : ['g'];
    if (f.base === '100ml') return f.sw > 0 ? ['ml', 'serving'] : ['ml'];
    return f.sw > 0 ? ['serving', 'g'] : ['serving'];
  }
  function defQty(f) { return f.base === 'serving' ? 1 : 100; }
  function baseLabel(b) { return b === '100g' ? 'ל-100 גרם' : b === '100ml' ? 'ל-100 מ״ל' : 'למנה'; }
  function foodLine(f) {
    return baseLabel(f.base) + ': ' + kc(f.per.kcal) + ' · ח ' + (f.per.p === null ? '?' : r1(f.per.p)) + ' · פ ' + (f.per.c === null ? '?' : r1(f.per.c)) + ' · ש ' + (f.per.f === null ? '?' : r1(f.per.f));
  }
  function mealSelect(sel) { return '<select name="meal">' + MEALS.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === sel ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>'; }

  function viewAdd() {
    var A = ui.add, h = '<h1>הוספת אוכל</h1><p class="mute">מוסיף ל: ' + dateLabel(ui.date) + '</p>';
    if (A.pick) {
      var f = S.foods.filter(function (x) { return x.id === A.pick; })[0];
      if (!f) { A.pick = null; return viewAdd(); }
      h += '<div class="card"><h3>' + esc(f.name) + (f.brand ? ' <span class="mute">· ' + esc(f.brand) + '</span>' : '') + '</h3><p class="mute">' + foodLine(f) + '</p>' + (f.energyNote ? '<p class="mute">האנרגיה הומרה מקילו-ג׳אול לקק״ל.</p>' : '') +
        '<form data-f="pick"><label>כמות</label><div class="row"><input name="qty" data-in="prev" inputmode="decimal" value="' + defQty(f) + '"><select name="unit" data-in="prev" style="max-width:130px">' +
        unitsFor(f).map(function (u) { return '<option value="' + u + '">' + UNIT[u] + '</option>'; }).join('') + '</select></div>' +
        '<label>ארוחה</label>' + mealSelect(A.meal) + '<div id="prev" class="okbox"></div><button class="primary block" type="submit">הוסף ליומן</button></form>' +
        '<div class="row"><button class="link" data-a="unpick">חזרה לרשימה</button><button class="link" data-a="efood" data-id="' + f.id + '">עריכת מוצר</button><button class="link" data-a="dfood" data-id="' + f.id + '" style="color:var(--bad)">מחיקת מוצר</button></div></div>';
      return h;
    }
    h += '<div class="row"><button class="primary grow" data-a="scan">📷 סריקת ברקוד</button><button class="grow" data-a="aiopen">✨ הערכת AI</button></div>';
    h += '<div class="tabs">' + [['foods', 'המוצרים שלי'], ['search', 'חיפוש במאגר'], ['fav', 'מועדפים'], ['meals', 'ארוחות שמורות'], ['manual', 'הזנה ידנית']].map(function (t) { return '<button class="' + (A.tab === t[0] ? 'on' : '') + '" data-a="atab" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (A.tab === 'foods' || A.tab === 'fav') {
      h += '<input data-in="q" placeholder="חיפוש לפי שם או מותג" value="' + esc(A.q) + '"><div id="flist">' + foodList() + '</div>';
      h += '<button class="block" data-a="copyday">העתקה מיום קודם</button>';
    } else if (A.tab === 'search') {
      h += searchTab();
    } else if (A.tab === 'meals') {
      if (!S.meals.length) h += '<p class="mute">עוד אין ארוחות שמורות. במסך “היום” אפשר לשמור ארוחה קיימת.</p>';
      S.meals.forEach(function (m) {
        var tot = C.totals(m.items.map(function (it) { return C.nutrition(it, it.qty, it.unit).values; }));
        h += '<div class="card"><div class="row between"><h3>' + esc(m.name) + '</h3><span class="mute">' + r0(tot.kcal) + ' קק״ל' + (tot.partial.kcal ? ' (חלקי)' : '') + '</span></div><p class="mute">' + m.items.map(function (it) { return esc(it.name); }).join(', ') + '</p>' +
          '<form data-f="addmeal" data-id="' + m.id + '"><div class="grid2"><div><label>כמות (פי)</label><input name="mult" inputmode="decimal" value="1"></div><div><label>ארוחה</label>' + mealSelect(A.meal) + '</div></div>' +
          '<div class="row"><button class="primary grow" type="submit">הוסף ליומן</button><button type="button" class="danger" data-a="dmeal" data-id="' + m.id + '">מחק</button></div></form></div>';
      });
    } else {
      h += manualForm(A.editFood ? S.foods.filter(function (x) { return x.id === A.editFood; })[0] : null, A.prefill);
    }
    return h;
  }
  function searchTab() {
    var s = ui.add.search;
    var h = '<form data-f="search"><div class="row"><input name="q" placeholder="חיפוש מזון באנגלית (למשל banana, white rice)" value="' + esc(s.q) + '"><button class="primary" type="submit">חפש</button></div></form>' +
      '<p class="mute">החיפוש פונה למאגר USDA (באנגלית, מאכלים כלליים ומותגים אמריקאים). למוצרים ארוזים מקומיים עדיף לסרוק ברקוד. הערכים הם ל-100 גרם.</p>';
    if (s.loading) h += '<div class="okbox">מחפש…</div>';
    else if (s.err) h += '<div class="err">' + esc(s.err) + '</div>';
    else if (s.results) h += s.results.length ? s.results.map(searchResultCard).join('') : '<p class="mute">לא נמצאו תוצאות. נסה מילים אחרות באנגלית.</p>';
    return h;
  }
  function foodList() {
    var A = ui.add, q = A.q.trim().toLowerCase();
    var list = S.foods.filter(function (f) {
      if (A.tab === 'fav' && !f.fav) return false;
      return !q || (f.name + ' ' + (f.brand || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || b.updated - a.updated; });
    if (!list.length) return '<p class="mute">' + (S.foods.length ? 'לא נמצאו תוצאות.' : 'עוד אין מוצרים אישיים. הוסף דרך “הזנה ידנית”.') + '</p>';
    return list.map(function (f) {
      return '<div class="card"><div class="row between"><div class="grow" data-a="pickfood" data-id="' + f.id + '" style="cursor:pointer"><b>' + esc(f.name) + '</b>' + (f.brand ? ' <span class="mute">· ' + esc(f.brand) + '</span>' : '') + '<div class="mute">' + foodLine(f) + '</div></div>' +
        '<button class="link" data-a="fav" data-id="' + f.id + '" aria-label="מועדף" style="font-size:24px">' + (f.fav ? '★' : '☆') + '</button></div></div>';
    }).join('');
  }
  function manualForm(f, prefill) {
    var src = f || (prefill && prefill.food) || null;
    var per = src ? src.per : { kcal: null, p: null, c: null, f: null };
    function v(x) { return x === null || x === undefined ? '' : r1(x); }
    return (prefill && !f ? '<div class="okbox">' + esc(prefill.msg) + '</div>' : '') +
      '<form data-f="manual"' + (f ? ' data-id="' + f.id + '"' : '') + (!f && src && src.source ? ' data-src="' + esc(src.source) + '"' : '') + '>' +
      '<label>שם המזון</label><input name="name" value="' + esc(src ? src.name : '') + '">' +
      '<label>מותג (לא חובה)</label><input name="brand" value="' + esc(src ? src.brand : '') + '">' +
      '<label>הערכים התזונתיים נמסרו</label><select name="base">' + [['100g', 'ל-100 גרם'], ['100ml', 'ל-100 מ״ל'], ['serving', 'למנה']].map(function (o) { return '<option value="' + o[0] + '"' + (src && src.base === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
      '<div class="grid2"><div><label>קלוריות (קק״ל)</label><input name="kcal" inputmode="decimal" value="' + v(per.kcal) + '"></div><div><label>או אנרגיה (קילו-ג׳אול)</label><input name="kj" inputmode="decimal"></div>' +
      '<div><label>חלבון (ג׳)</label><input name="p" inputmode="decimal" value="' + v(per.p) + '"></div><div><label>פחמימות (ג׳)</label><input name="c" inputmode="decimal" value="' + v(per.c) + '"></div>' +
      '<div><label>שומן (ג׳)</label><input name="f" inputmode="decimal" value="' + v(per.f) + '"></div><div><label>משקל או נפח מנה (אם ידוע)</label><input name="sw" inputmode="decimal" value="' + (src && src.sw ? src.sw : '') + '"></div></div>' +
      '<p class="mute">שדה שנשאר ריק נשמר כ“לא ידוע” ולא כאפס. משקל מנה בגרמים למוצר ל-100 גרם, ובמ״ל למוצר ל-100 מ״ל.</p>' +
      (f ? '' : (function () {
        var dBase = src ? src.base : '100g';
        var dUnit = dBase === 'serving' ? 'serving' : dBase === '100ml' ? 'ml' : 'g';
        var dQty = (src && dBase === 'serving') ? '1' : '';
        return '<hr><label>כמות שנאכלה</label><div class="grid2"><input name="qty" inputmode="decimal" placeholder="לא חובה" value="' + dQty + '"><select name="unit">' +
          [['g', 'גרם'], ['ml', 'מ״ל'], ['serving', 'מנות']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === dUnit ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div><label>ארוחה</label>' + mealSelect(ui.add.meal); })() +
        '<label class="check"><input type="checkbox" name="keep" checked><span>שמור גם כמוצר אישי</span></label>') +
      '<button class="primary block" type="submit">' + (f ? 'שמור שינויים' : 'הוסף') + '</button>' + (f ? '<button type="button" class="block" data-a="unedit">ביטול</button>' : '') + '</form>';
  }
  function updatePreview() {
    var el = $('#prev'); if (!el) return;
    var f = S.foods.filter(function (x) { return x.id === ui.add.pick; })[0], q = $('[name=qty]'), u = $('[name=unit]');
    if (!f || !q) return;
    var n = C.nutrition(f, num(q.value), u.value);
    el.innerHTML = n.error ? esc(n.error) : kc(n.values.kcal) + ' · חלבון ' + gm(n.values.p) + ' · פחמימות ' + gm(n.values.c) + ' · שומן ' + gm(n.values.f);
  }

  function makeEntry(item, qty, unit, meal, date) {
    var n = C.nutrition(item, qty, unit);
    if (n.error) { toast(n.error); return null; }
    return { id: uid(), date: date, meal: meal, name: item.name, brand: item.brand || '', source: item.source || 'manual', qty: qty, unit: unit, base: item.base, per: item.per, sw: item.sw || 0, snap: n.values };
  }

  /* ---------- מאגרי מזון חיצוניים (חיפוש וברקוד) ---------- */
  var USER_AGENT = 'NutritionPWA/1.0 (github.com/Dvir-Ledani/nutrition)';
  function numOrNull(x) { return (x === null || x === undefined || x === '' || isNaN(Number(x))) ? null : Number(x); }

  function mapUsda(food) {
    var byId = {};
    (food.foodNutrients || []).forEach(function (n) { if (n.nutrientId != null) byId[n.nutrientId] = n.value; });
    var p = numOrNull(byId[1003]), c = numOrNull(byId[1005]), f = numOrNull(byId[1004]);
    var kcal = numOrNull(byId[1008]);
    if (kcal === null) kcal = numOrNull(byId[2047]);
    if (kcal === null) kcal = numOrNull(byId[2048]);
    if (kcal === null && (p !== null || c !== null || f !== null)) kcal = 4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0);
    var brand = food.brandName || food.brandOwner || '';
    return { name: food.description || 'מזון', brand: brand, base: '100g', per: { kcal: kcal, p: p, c: c, f: f }, sw: 0, source: 'usda', _type: food.dataType || '' };
  }

  async function usdaSearch(query) {
    var key = (S.settings.usdaKey || '').trim() || 'DEMO_KEY';
    var url = 'https://api.nal.usda.gov/fdc/v1/foods/search?api_key=' + encodeURIComponent(key) +
      '&query=' + encodeURIComponent(query) + '&pageSize=20&dataType=' + encodeURIComponent('Foundation,SR Legacy,Branded');
    var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.status === 429) throw new Error('יותר מדי בקשות למאגר כרגע. נסה שוב בעוד דקה, או הזן מפתח USDA אישי בהגדרות');
    if (r.status === 403) throw new Error('המפתח ל-USDA אינו תקף. בדוק אותו בהגדרות');
    if (!r.ok) throw new Error('שגיאת רשת מול USDA (' + r.status + ')');
    var j = await r.json();
    return (j.foods || []).map(mapUsda).filter(function (x) { return x.per.kcal !== null || x.per.p !== null || x.per.c !== null || x.per.f !== null; });
  }

  function mapOff(prod, code) {
    var n = prod.nutriments || {};
    var per = prod.nutrition_data_per || '100g';
    var base = per === '100ml' ? '100ml' : per === 'serving' ? 'serving' : '100g';
    var suf = base === 'serving' ? '_serving' : '_100g';
    function pick(stem) { var v = n[stem + suf]; if (v === undefined) v = n[stem]; return numOrNull(v); }
    var kcal = pick('energy-kcal');
    if (kcal === null) { var kj = n['energy-kj' + suf]; if (kj === undefined) kj = n['energy' + suf]; if (kj === undefined) kj = n['energy']; if (numOrNull(kj) !== null) kcal = C.kjToKcal(Number(kj)); }
    var sw = 0;
    if (base !== 'serving' && prod.serving_size) { var m = String(prod.serving_size).match(/[\d.]+/); if (m) sw = Number(m[0]) || 0; }
    var name = (prod.product_name_he && prod.product_name_he.trim()) || (prod.product_name && prod.product_name.trim()) || ('מוצר ' + code);
    var brand = (prod.brands || '').split(',')[0].trim();
    return { name: name, brand: brand, base: base, per: { kcal: kcal, p: pick('proteins'), c: pick('carbohydrates'), f: pick('fat') }, sw: sw, source: 'off' };
  }

  async function offLookup(code) {
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) +
      '.json?fields=product_name,product_name_he,brands,nutriments,nutrition_data_per,serving_size';
    var r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('שגיאת רשת מול Open Food Facts (' + r.status + ')');
    var j = await r.json();
    if (j.status !== 1 || !j.product) return null;
    return mapOff(j.product, code);
  }

  /* טעינה עצלה של ספריית הברקוד (נשמרת במטמון ועובדת גם בלי רשת לאחר התקנה) */
  var zxingP = null;
  function ensureZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (zxingP) return zxingP;
    zxingP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/zxing.js';
      s.onload = function () { window.ZXing ? res(window.ZXing) : rej(new Error('no ZXing')); };
      s.onerror = function () { zxingP = null; rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return zxingP;
  }

  var scanReader = null;
  function stopScan() { if (scanReader) { try { scanReader.reset(); } catch (e) { } scanReader = null; } }

  function openScan() {
    openModal('<h2>סריקת ברקוד</h2><div id="scanbox"><p class="mute" id="scanmsg">מפעיל מצלמה…</p><video id="scanvid" playsinline muted></video></div>' +
      '<p class="mute">כוון את המצלמה לברקוד של המוצר. הסריקה מתבצעת במכשיר; רק מספר הברקוד נשלח ל-Open Food Facts.</p>' +
      '<form data-f="barcode"><label>או הזנת מספר ברקוד ידנית</label><div class="row"><input name="code" inputmode="numeric" placeholder="לדוגמה 7290000000008"><button class="primary" type="submit">חפש</button></div></form>' +
      '<button class="block" data-a="closescan">סגירה</button>');
    ensureZXing().then(function (ZX) {
      var hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128]);
      scanReader = new ZX.BrowserMultiFormatReader(hints, 400);
      var vid = $('#scanvid'); if (!vid) return;
      scanReader.decodeFromConstraints({ video: { facingMode: 'environment' } }, vid, function (result, err) {
        if (result) { var code = result.getText(); stopScan(); onBarcode(code); }
      }).catch(function () {
        var m = $('#scanmsg'); if (m) m.innerHTML = 'לא הצלחתי לפתוח את המצלמה. ייתכן שצריך לאשר הרשאת מצלמה, או שהמכשיר דורש iOS 16.4 ומעלה לשימוש במצלמה באפליקציה מותקנת. אפשר להזין מספר ברקוד ידנית למטה.';
        var v = $('#scanvid'); if (v) v.style.display = 'none';
      });
    }).catch(function () {
      var m = $('#scanmsg'); if (m) m.textContent = 'טעינת רכיב הסריקה נכשלה. נסה שוב כשיש חיבור לרשת, או הזן מספר ברקוד ידנית.';
    });
  }

  async function onBarcode(code) {
    var msg = $('#scanmsg'); if (msg) { msg.textContent = 'מחפש מוצר (' + code + ')…'; }
    var v = $('#scanvid'); if (v) v.style.display = 'none';
    try {
      var food = await offLookup(code);
      if (!food) { if (msg) msg.innerHTML = 'הברקוד ' + esc(code) + ' לא נמצא במאגר. אפשר להזין את המוצר ידנית.'; return; }
      closeModal(); prefillManual(food, 'הפרטים מולאו מברקוד (Open Food Facts). בדוק, תקן אם צריך, ושמור.');
    } catch (e) { if (msg) msg.textContent = (e && e.message) || 'שגיאה בחיפוש המוצר'; }
  }

  function prefillManual(food, bannerMsg) {
    ui.add.prefill = { food: food, msg: bannerMsg };
    ui.add.editFood = null; ui.add.pick = null; ui.add.tab = 'manual'; ui.tab = 'add';
    render(); window.scrollTo(0, 0);
  }

  function searchResultCard(x, i) {
    var macro = foodLine({ base: x.base, per: x.per });
    var tag = x.source === 'usda' ? '<span class="tag">USDA' + (x._type === 'Branded' ? ' · מותג' : '') + '</span>' : '';
    return '<div class="card"><div class="grow" data-a="pickresult" data-i="' + i + '" style="cursor:pointer"><b>' + esc(x.name) + '</b>' + tag + (x.brand ? ' <span class="mute">· ' + esc(x.brand) + '</span>' : '') +
      '<div class="mute">' + macro + '</div></div></div>';
  }

  /* ---------- הערכת AI (Gemini) ---------- */
  var AI_RESULTS = null;
  var GEM_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
  var GEM_SCHEMA = {
    type: 'object', properties: {
      items: {
        type: 'array', items: {
          type: 'object', properties: {
            name: { type: 'string' }, grams: { type: 'number' }, kcal: { type: 'number' },
            protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' }
          }, required: ['name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g']
        }
      }
    }, required: ['items']
  };
  var GEM_PROMPT = 'אתה מעריך תזונה. בהינתן תיאור ארוחה ו/או תמונה, החזר הערכה של כל פריט מזון בנפרד: name = שם קצר בעברית, grams = כמות משוערת בגרמים, ו-kcal/protein_g/carbs_g/fat_g = הערכים עבור אותה כמות משוערת (לא ל-100 גרם). היה מציאותי ושמרני. אם אי אפשר להעריך, החזר items ריק. החזר JSON בלבד לפי הסכמה.';

  function geminiModel() { return (S.settings.geminiModel || '').trim() || 'gemini-flash-latest'; }

  function fileToJpegBase64(file, maxDim, quality) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height, scale = Math.min(1, maxDim / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        try { res(c.toDataURL('image/jpeg', quality).split(',')[1]); } catch (e) { rej(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('לא הצלחתי לקרוא את התמונה')); };
      img.src = url;
    });
  }

  async function geminiCall(model, parts) {
    var key = (S.settings.geminiKey || '').trim();
    var body = { contents: [{ parts: parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: GEM_SCHEMA, temperature: 0.4 } };
    var r = await fetch(GEM_BASE + 'models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r;
  }

  async function geminiDiscoverModel() {
    var key = (S.settings.geminiKey || '').trim();
    var r = await fetch(GEM_BASE + 'models?key=' + encodeURIComponent(key) + '&pageSize=100');
    if (!r.ok) return null;
    var j = await r.json();
    var models = (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0; });
    var flash = models.filter(function (m) { return /flash/i.test(m.name) && !/lite|thinking|image|tts|live/i.test(m.name); });
    var pick = (flash[0] || models[0]);
    if (!pick) return null;
    var name = pick.name.replace(/^models\//, '');
    S.settings.geminiModel = name; save();
    return name;
  }

  async function geminiEstimate(desc, imgBase64) {
    var parts = [{ text: GEM_PROMPT + (desc ? '\nתיאור הארוחה: ' + desc : '') }];
    if (imgBase64) parts.push({ inlineData: { mimeType: 'image/jpeg', data: imgBase64 } });
    var r = await geminiCall(geminiModel(), parts);
    if (r.status === 404) { var nm = await geminiDiscoverModel(); if (nm) r = await geminiCall(nm, parts); }
    if (r.status === 400) throw new Error('המפתח של Gemini אינו תקף. בדוק אותו בהגדרות');
    if (r.status === 429) throw new Error('חרגת ממגבלת השימוש של Gemini. נסה שוב מאוחר יותר');
    if (!r.ok) throw new Error('שגיאה מול Gemini (' + r.status + ')');
    var j = await r.json();
    if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error('הבקשה נחסמה על ידי Gemini. נסה תיאור או תמונה אחרים');
    var cand = j.candidates && j.candidates[0];
    var text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
    if (!text) throw new Error('לא התקבלה תשובה מ-Gemini');
    var parsed; try { parsed = JSON.parse(text); } catch (e) { throw new Error('התשובה מ-Gemini לא הייתה בפורמט צפוי'); }
    var items = (parsed.items || []).map(function (it) {
      return { name: String(it.name || 'פריט'), brand: '', base: 'serving', per: { kcal: numOrNull(it.kcal), p: numOrNull(it.protein_g), c: numOrNull(it.carbs_g), f: numOrNull(it.fat_g) }, sw: numOrNull(it.grams) || 0, source: 'ai' };
    });
    return items;
  }

  function aiResultsHtml() {
    if (!AI_RESULTS) return '';
    if (!AI_RESULTS.length) return '<p class="mute">לא זוהו פריטים. נסה תיאור מפורט יותר או תמונה ברורה יותר.</p>';
    return '<h3>הערכה (אפשר לערוך אחרי הבחירה)</h3>' + AI_RESULTS.map(function (x, i) {
      var g = x.sw ? ' · ~' + r0(x.sw) + ' ג׳' : '';
      return '<div class="card"><div class="row between"><div class="grow"><b>' + esc(x.name) + '</b>' + g + '<div class="mute">' + kc(x.per.kcal) + ' · חלבון ' + gm(x.per.p) + ' · פחמימות ' + gm(x.per.c) + ' · שומן ' + gm(x.per.f) + '</div></div>' +
        '<button class="primary" data-a="aipick" data-i="' + i + '">הוסף</button></div></div>';
    }).join('') + '<p class="mute">הערכות AI הן קירוב בלבד ואינן מדידה מדויקת. מומלץ לבדוק ולתקן.</p>';
  }

  function openAi() {
    if (!(S.settings.geminiKey || '').trim()) { toast('כדי להשתמש בהערכת AI יש להזין מפתח Gemini בהגדרות'); ui.tab = 'settings'; ui.set = null; render(); window.scrollTo(0, 0); return; }
    AI_RESULTS = null;
    var consent = S.settings.geminiConsent;
    var consentHtml = consent ? '' :
      '<div class="note">בשימוש בתכונה זו, הטקסט ו/או התמונה שתשלח נשלחים ל-Google (Gemini) לצורך ההערכה. בשכבה החינמית Google עשויה להשתמש בתוכן לשיפור מוצריה. אל תשלח מידע רגיש. אין לשלוח תמונות של אנשים.</div>' +
      '<label class="check"><input type="checkbox" id="aiConsent"><span>הבנתי ואני מאשר לשלוח את התיאור/התמונה ל-Google</span></label>';
    openModal('<h2>הערכת AI</h2>' + consentHtml +
      '<form data-f="ai"><label>תיאור הארוחה (עברית)</label><textarea name="desc" rows="3" placeholder="לדוגמה: 2 ביצים קשות, פרוסת לחם מלא וכף טחינה"></textarea>' +
      '<label>או תמונה של הצלחת (לא חובה)</label><input type="file" name="photo" accept="image/*" capture="environment">' +
      '<button class="primary block" type="submit">הערך</button></form>' +
      '<div id="aibox"></div><button class="block" data-a="closemodal">סגירה</button>');
  }

  async function runAi(form) {
    var box = $('#aibox'); if (box) box.innerHTML = '<div class="okbox">שולח ל-Gemini ומעריך…</div>';
    try {
      var fd = new FormData(form);
      var desc = String(fd.get('desc') || '').trim();
      var file = fd.get('photo'), img = null;
      if (file && file.size) img = await fileToJpegBase64(file, 1024, 0.7);
      if (!desc && !img) { if (box) box.innerHTML = '<div class="err">יש להזין תיאור או לבחור תמונה</div>'; return; }
      AI_RESULTS = await geminiEstimate(desc, img);
      if (box) box.innerHTML = aiResultsHtml();
    } catch (e) {
      if (box) box.innerHTML = '<div class="err">' + esc((e && e.message) || 'ההערכה נכשלה') + '</div>';
    }
  }

  /* ---------- מעקב משקל ---------- */
  function viewWeight() {
    var ws = S.weights.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var h = '<h1>מעקב משקל</h1><form data-f="weight" class="card"><div class="grid2"><div><label style="margin-top:0">תאריך</label><input type="date" name="date" value="' + C.today() + '" max="' + C.today() + '"></div><div><label style="margin-top:0">משקל (ק״ג)</label><input name="kg" inputmode="decimal"></div></div><button class="primary block" type="submit">שמור</button></form>';
    if (ws.length) {
      var last = ws[ws.length - 1], avg = C.movingAvg(ws, last.date), prev = C.movingAvg(ws, C.addDays(last.date, -7));
      h += '<div class="card"><div class="kpi"><div><span class="mute">מדידה אחרונה</span><b>' + r1(last.kg) + '</b>ק״ג</div><div><span class="mute">ממוצע נע 7 ימים</span><b>' + (avg === null ? '—' : r1(avg)) + '</b>' + (avg === null ? 'נדרשות 4 מדידות בשבוע' : 'ק״ג') + '</div></div>';
      if (avg !== null && prev !== null) { var df = r1(avg - prev); h += '<p class="mute">לעומת הממוצע של לפני שבוע: ' + (df === 0 ? 'ללא שינוי' : (df < 0 ? 'ירידה של ' : 'עלייה של ') + Math.abs(df) + ' ק״ג') + '. מגמה נקבעת לפי ממוצעים ולא לפי שקילה בודדת.</p>'; }
      else h += '<p class="mute">מגמה נקבעת לפי ממוצעים ולא לפי שקילה בודדת. נדרשות מדידות בשני שבועות רצופים כדי להשוות.</p>';
      h += '</div>';
      if (ws.length >= 2) h += '<div class="card">' + weightChart(ws) + '</div>';
      h += '<div class="card"><h3>המדידות</h3>' + ws.slice().reverse().map(function (w) {
        return '<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)"><span>' + dateLabel(w.date) + '</span><span><b>' + r1(w.kg) + ' ק״ג</b> <button class="link" data-a="wdel" data-id="' + w.id + '" style="color:var(--bad)">מחק</button></span></div>';
      }).join('') + '</div>';
    } else h += '<p class="mute">עוד אין מדידות.</p>';
    return h;
  }
  function weightChart(ws) {
    var W = 320, H = 170, pad = 28, n = ws.length;
    var min = Math.min.apply(null, ws.map(function (w) { return w.kg; })) - 0.5, max = Math.max.apply(null, ws.map(function (w) { return w.kg; })) + 0.5;
    var d0 = ws[0].date, span = Math.max(1, C.daysBetween(d0, ws[n - 1].date));
    function X(date) { return W - pad - (C.daysBetween(d0, date) / span) * (W - 2 * pad); }  /* ימין לשמאל: הישן מימין */
    function Y(kg) { return H - pad - (kg - min) / (max - min) * (H - 2 * pad); }
    var pts = ws.map(function (w) { return X(w.date) + ',' + Y(w.kg); }).join(' ');
    var avgPts = ws.map(function (w) { var a = C.movingAvg(S.weights, w.date); return a === null ? null : X(w.date) + ',' + Y(a); }).filter(Boolean).join(' ');
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="גרף משקל" direction="ltr" style="direction:ltr">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="var(--line)"/>' +
      '<text x="' + (W - 4) + '" y="' + (Y(max) + 4) + '" font-size="11" fill="var(--mute)" text-anchor="end">' + r1(max) + '</text><text x="' + (W - 4) + '" y="' + (Y(min) + 4) + '" font-size="11" fill="var(--mute)" text-anchor="end">' + r1(min) + '</text>' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="3 3"/>' +
      (avgPts.indexOf(' ') > 0 ? '<polyline points="' + avgPts + '" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linejoin="round"/>' : '') +
      ws.map(function (w) { return '<circle cx="' + X(w.date) + '" cy="' + Y(w.kg) + '" r="3.5" fill="var(--brand)"/>'; }).join('') +
      '<text x="' + (W - pad) + '" y="' + (H - 8) + '" font-size="11" fill="var(--mute)" text-anchor="end">' + d0.slice(5).split('-').reverse().join('/') + '</text>' +
      '<text x="' + pad + '" y="' + (H - 8) + '" font-size="11" fill="var(--mute)" text-anchor="start">' + ws[n - 1].date.slice(5).split('-').reverse().join('/') + '</text></svg>' +
      '<p class="mute">הקו הירוק: ממוצע נע של 7 ימים (מוצג כשיש 4 מדידות לפחות בחלון). הנקודות: מדידות בודדות.</p>';
    return s;
  }

  /* ---------- הגדרות ---------- */
  function viewSettings() {
    if (ui.set === 'tests') return viewTests();
    var p = S.profile, g = C.goalInEffect(S.goals, C.today()), h = '<h1>הגדרות</h1>';
    h += '<div class="card"><h3>פרופיל ויעד</h3>' + (p ? '<p class="mute">' + p.age + ' שנים · ' + p.height + ' ס״מ · ' + r1(p.weight) + ' ק״ג · ' + (p.goal === 'loss' ? 'ירידה במשקל' : 'שמירה על המשקל') + '</p>' : '') +
      (g ? '<p>יעד נוכחי: <b>' + r0(g.kcal) + ' קק״ל</b> ' + (g.src === 'manual' ? '<span class="tag">נקבע עם איש מקצוע</span>' : '') + '</p>' : '<p class="mute">אין יעד.</p>') +
      '<button class="block primary" data-a="wupdate">עדכון פרופיל וחישוב יעד חדש</button><button class="block" data-a="mgoal">הזנת יעד שנקבע עם איש מקצוע</button></div>';
    if (S.goals.length) {
      h += '<div class="card"><h3>היסטוריית יעדים</h3>' + S.goals.slice().sort(function (a, b) { return a.from < b.from ? 1 : -1; }).map(function (x) {
        return '<div class="row between" style="padding:4px 0"><span>מ-' + x.from.split('-').reverse().join('/') + '</span><b>' + r0(x.kcal) + ' קק״ל</b></div>';
      }).join('') + '</div>';
    }
    h += '<div class="card"><h3>גיבוי ונתונים</h3><p class="mute">הנתונים נשמרים בטלפון הזה בלבד. מומלץ לייצא גיבוי מדי פעם, כי מחיקת נתוני האתר בדפדפן תמחק אותם.</p>' +
      '<button class="block" data-a="expjson">ייצוא גיבוי מלא (JSON)</button><button class="block" data-a="expcsv">ייצוא יומן ומשקל (CSV)</button><button class="block" data-a="imp">שחזור מגיבוי</button>' +
      '<input type="file" id="impfile" accept=".json,application/json" class="hide"><button class="block danger" data-a="delall">מחיקת כל הנתונים</button></div>';
    h += '<div class="card"><h3>חיפוש מזון ומאגרים</h3>' +
      '<p class="mute">סריקת ברקוד מחפשת במאגר Open Food Facts (בלי מפתח). חיפוש טקסט פונה למאגר USDA. אפשר להזין מפתח USDA אישי וחינמי כדי להימנע ממגבלות השימוש המשותף.</p>' +
      '<label>מפתח USDA (לא חובה)</label><input id="usdakey" placeholder="ברירת מחדל: מפתח הדגמה משותף" value="' + esc(S.settings.usdaKey || '') + '">' +
      '<button class="block" data-a="savekey">שמירת מפתח</button>' +
      '<p class="mute">מפתח חינמי מתקבל מיידית בכתובת fdc.nal.usda.gov/api-key-signup.html ונשמר בטלפון הזה בלבד.</p>' +
      '<p class="mute">פרטיות: בחיפוש נשלח טקסט החיפוש ל-USDA, ובסריקה נשלח מספר הברקוד ל-Open Food Facts. לא נשלחים נתונים אישיים, היומן או המשקל. נתוני Open Food Facts מסופקים ברישיון ODbL; נתוני USDA FoodData Central הם נחלת הכלל.</p></div>';
    h += '<div class="card"><h3>הערכת AI (Gemini)</h3>' +
      '<p class="mute">מאפשר לתאר ארוחה או לצלם צלחת ולקבל הערכת ערכים תזונתיים. אופציונלי, ודורש מפתח Gemini אישי וחינמי.</p>' +
      '<label>מפתח Gemini (לא חובה)</label><input id="gemkey" placeholder="מפתח מ-Google AI Studio" value="' + esc(S.settings.geminiKey || '') + '">' +
      '<button class="block" data-a="savegem">שמירת מפתח</button>' +
      '<p class="mute">מפתח חינמי מתקבל בכתובת aistudio.google.com/apikey ונשמר בטלפון הזה בלבד.</p>' +
      '<p class="mute">פרטיות: התיאור או התמונה שתשלח נשלחים ל-Google. בשכבה החינמית Google עשויה להשתמש בתוכן לשיפור מוצריה; אל תשלח מידע רגיש או תמונות של אנשים. ההערכות הן קירוב בלבד ואינן ייעוץ תזונתי.</p></div>';
    h += '<div class="card"><h3>בדיקות חישוב</h3><p class="mute">מריץ את פונקציות החישוב מול מקרים עם תוצאה ידועה.</p><button class="block" data-a="tests">הרצת בדיקות</button></div>';
    var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!standalone) {
      var ua = navigator.userAgent || '', ins;
      if (/android/i.test(ua)) ins = { t: 'התקנה באנדרואיד', p: 'ב-Chrome: אם מופיע באנר “התקנת אפליקציה” אשר אותו. אחרת פתח את תפריט שלוש הנקודות (⋮) ובחר “התקנת אפליקציה” או “הוספה למסך הבית”. האפליקציה תיפתח כמו אפליקציה רגילה.' };
      else if (/iphone|ipad|ipod/i.test(ua)) ins = { t: 'התקנה באייפון', p: 'ב-Safari: לחץ על כפתור השיתוף (ריבוע עם חץ), בחר “הוסף למסך הבית”. האפליקציה תיפתח כמו אפליקציה רגילה.' };
      else ins = { t: 'התקנה בטלפון', p: 'פתח את הכתובת בדפדפן של הטלפון — באייפון ב-Safari (שיתוף ← “הוסף למסך הבית”), באנדרואיד ב-Chrome (תפריט ⋮ ← “התקנת אפליקציה”).' };
      h += '<div class="card"><h3>' + ins.t + '</h3><p>' + ins.p + '</p></div>';
    }
    return h + '<p class="mute">' + DISCLAIMER + '</p>';
  }
  function viewTests() {
    var R = C.runTests(), bad = R.filter(function (x) { return !x.ok; }).length;
    return '<h1>בדיקות חישוב</h1><div class="' + (bad ? 'err' : 'okbox') + '">' + (R.length - bad) + ' מתוך ' + R.length + ' עברו</div><p class="mute">בדיקה עוברת כשההפרש מהערך הצפוי אינו עולה על יחידה אחת בספרה האחרונה של הערך הצפוי.</p><div class="card"><table>' +
      R.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.got) + '</td><td class="' + (x.ok ? 'pass' : 'fail') + '">' + (x.ok ? 'עבר' : 'נכשל (צפוי ' + esc(x.exp) + ')') + '</td></tr>'; }).join('') + '</table></div><button class="block" data-a="back">חזרה</button>';
  }

  /* ---------- מודלים ---------- */
  function openModal(html) { var m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.classList.add('open'); }
  function closeModal() { stopScan(); var m = $('#modal'); m.classList.remove('open'); m.innerHTML = ''; }
  function entryModal(e) {
    var f = { base: e.base, per: e.per, sw: e.sw };
    openModal('<h2>' + esc(e.name) + '</h2><form data-f="entry" data-id="' + e.id + '"><label>כמות</label><div class="row"><input name="qty" inputmode="decimal" value="' + e.qty + '"><select name="unit" style="max-width:130px">' +
      unitsFor(f).map(function (u) { return '<option value="' + u + '"' + (u === e.unit ? ' selected' : '') + '>' + UNIT[u] + '</option>'; }).join('') + '</select></div><label>ארוחה</label>' + mealSelect(e.meal) +
      '<button class="primary block" type="submit">שמור</button></form><button class="danger block" data-a="edel" data-id="' + e.id + '">מחק מהיומן</button><button class="block" data-a="closemodal">ביטול</button>');
  }

  /* ---------- ייצוא וייבוא ---------- */
  async function shareOrDownload(name, mime, text) {
    var file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function csvCell(x) { x = x === null || x === undefined ? '' : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }
  function exportCsv() {
    var rows = [['סוג', 'תאריך', 'ארוחה', 'שם', 'מותג', 'כמות', 'יחידה', 'קלוריות', 'חלבון', 'פחמימות', 'שומן', 'משקל ק״ג']];
    S.diary.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
      rows.push(['יומן', e.date, mealName(e.meal), e.name, e.brand, e.qty, UNIT[e.unit], e.snap.kcal === null ? '' : r1(e.snap.kcal), e.snap.p === null ? '' : r1(e.snap.p), e.snap.c === null ? '' : r1(e.snap.c), e.snap.f === null ? '' : r1(e.snap.f), '']);
    });
    S.weights.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (w) { rows.push(['משקל', w.date, '', '', '', '', '', '', '', '', '', w.kg]); });
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /* ---------- רינדור ---------- */
  function navHtml() {
    return [['today', '🍽️', 'היום'], ['add', '＋', 'הוספת אוכל'], ['weight', '⚖️', 'מעקב משקל'], ['settings', '⚙️', 'הגדרות']].map(function (t) {
      return '<button class="' + (ui.tab === t[0] ? 'on' : '') + '" data-a="nav" data-t="' + t[0] + '"><span>' + t[1] + '</span>' + t[2] + '</button>';
    }).join('');
  }
  function render() {
    var app = $('#app'), nav = $('#nav');
    if (ui.screen === 'wizard') { app.innerHTML = viewWizard(); nav.style.display = 'none'; }
    else if (ui.screen === 'result') { app.innerHTML = viewResult(); nav.style.display = 'none'; }
    else {
      app.innerHTML = { today: viewToday, add: viewAdd, weight: viewWeight, settings: viewSettings }[ui.tab]();
      nav.style.display = 'flex'; nav.innerHTML = navHtml();
      if (ui.tab === 'add') updatePreview();
    }
  }
  function go(fn) { fn(); render(); }

  /* ---------- אירועים ---------- */
  var actions = {
    nav: function (d) { ui.tab = d.t; ui.set = null; ui.add.pick = null; ui.add.editFood = null; ui.add.prefill = null; if (d.t === 'add') ui.add.meal = ui.add.meal || guessMeal(); window.scrollTo(0, 0); },
    dprev: function () { ui.date = C.addDays(ui.date, -1); },
    dnext: function () { if (ui.date < C.today()) ui.date = C.addDays(ui.date, 1); else toast('אי אפשר לתעד ימים עתידיים'); },
    dtoday: function () { ui.date = C.today(); },
    addto: function (d) { ui.add.meal = d.m; ui.add.tab = 'foods'; ui.add.pick = null; ui.tab = 'add'; window.scrollTo(0, 0); },
    eedit: function (d) { var e = S.diary.filter(function (x) { return x.id === d.id; })[0]; if (e) entryModal(e); },
    edel: function (d) { S.diary = S.diary.filter(function (x) { return x.id !== d.id; }); save(); closeModal(); },
    closemodal: function () { closeModal(); },
    savemeal: function (d) {
      var items = S.diary.filter(function (e) { return e.date === ui.date && e.meal === d.m; });
      var name = window.prompt('שם הארוחה השמורה', mealName(d.m)); if (!name || !name.trim()) return;
      S.meals.push({ id: uid(), name: name.trim(), items: items.map(function (e) { return { name: e.name, brand: e.brand, source: e.source, qty: e.qty, unit: e.unit, base: e.base, per: e.per, sw: e.sw }; }) });
      save(); toast('הארוחה נשמרה');
    },
    atab: function (d) { ui.add.tab = d.t; ui.add.pick = null; ui.add.editFood = null; ui.add.prefill = null; },
    scan: function () { openScan(); },
    closescan: function () { stopScan(); closeModal(); },
    aiopen: function () { openAi(); },
    aipick: function (d) {
      var x = AI_RESULTS && AI_RESULTS[Number(d.i)];
      if (x) { closeModal(); prefillManual(x, 'הפרטים מולאו מהערכת AI (קירוב). בדוק, תקן, ושמור. היחידה היא “מנה” בכמות המשוערת.'); }
    },
    pickresult: function (d) {
      var x = ui.add.search.results && ui.add.search.results[Number(d.i)];
      if (x) prefillManual(x, 'הפרטים מולאו מתוצאת החיפוש (USDA, ל-100 גרם). אפשר לשנות את השם לעברית ולשמור.');
    },
    savekey: function () {
      var el = $('#usdakey'); if (!el) return;
      S.settings.usdaKey = el.value.trim(); save(); toast('המפתח נשמר');
    },
    savegem: function () {
      var el = $('#gemkey'); if (!el) return;
      S.settings.geminiKey = el.value.trim(); S.settings.geminiModel = ''; save(); toast('המפתח נשמר');
    },
    pickfood: function (d) { ui.add.pick = d.id; },
    unpick: function () { ui.add.pick = null; },
    fav: function (d) { var f = S.foods.filter(function (x) { return x.id === d.id; })[0]; if (f) { f.fav = !f.fav; save(); } },
    efood: function (d) { ui.add.editFood = d.id; ui.add.pick = null; ui.add.tab = 'manual'; },
    unedit: function () { ui.add.editFood = null; ui.add.tab = 'foods'; },
    dfood: function (d) { if (window.confirm('למחוק את המוצר מהרשימה? רשומות היומן הקיימות לא ישתנו.')) { S.foods = S.foods.filter(function (x) { return x.id !== d.id; }); ui.add.pick = null; save(); } },
    dmeal: function (d) { if (window.confirm('למחוק את הארוחה השמורה?')) { S.meals = S.meals.filter(function (x) { return x.id !== d.id; }); save(); } },
    copyday: function () {
      openModal('<h2>העתקה מיום קודם</h2><form data-f="copy"><label>מתאריך</label><input type="date" name="from" value="' + C.addDays(ui.date, -1) + '" max="' + C.today() + '"><label>מה להעתיק</label><select name="which"><option value="all">כל הארוחות</option>' +
        MEALS.map(function (m) { return '<option value="' + m[0] + '">' + m[1] + '</option>'; }).join('') + '</select><p class="mute">הפריטים יתווספו ל-' + dateLabel(ui.date) + ', באותה ארוחה. הערכים נשמרים כפי שנרשמו אז.</p><button class="primary block" type="submit">העתק</button></form><button class="block" data-a="closemodal">ביטול</button>');
    },
    wdel: function (d) { if (window.confirm('למחוק את המדידה?')) { S.weights = S.weights.filter(function (x) { return x.id !== d.id; }); save(); } },
    /* שאלון */
    wset: function (d) { ui.wiz.d[d.k] = d.v; ui.wiz.msgs = null; },
    wfactor: function (d) { ui.wiz.d.factor = Number(d.v); ui.wiz.msgs = null; },
    wback: function () {
      var w = ui.wiz;
      if (w.step === 0) { if (w.mode === 'update') { ui.screen = 'main'; ui.wiz = null; } return; }
      w.step--; w.msgs = null;
    },
    wnext: function () {
      var w = ui.wiz, v = validateStep(w);
      if (v.errs.length || v.confs.length) { w.msgs = v; return; }
      w.msgs = null;
      if (w.step === 3 && !w.d.factor) { /* ללא בחירה מראש */ }
      if (w.step < STEPS - 1) w.step++; else startResult();
    },
    rback: function () { ui.screen = 'wizard'; ui.wiz.step = STEPS - 1; },
    rsave: function () {
      var R = ui.res, chk2 = C.pctCheck(R.pct);
      if (!chk2.ok) { toast('סכום האחוזים חייב להיות 100%'); return; }
      commitProfileAndGoal(R.calc.target, { c: R.pct.c, p: R.pct.p, f: R.pct.f }, 'app');
    },
    rmanual: function () {
      var k = num($('#manualKcal').value);
      if (k === null || isNaN(k) || k < 800 || k > 6000) { toast('יש להזין יעד בין 800 ל-6,000 קק״ל'); return; }
      commitProfileAndGoal(k, Object.assign({}, C.DEFAULT_PCT), 'manual');
    },
    rskip: function () { commitProfileAndGoal(null, null, null); },
    wupdate: function () { ui.wiz = newWiz('update'); ui.screen = 'wizard'; },
    mgoal: function () {
      openModal('<h2>יעד שנקבע עם איש מקצוע</h2><form data-f="mgoal"><label>יעד יומי (קק״ל)</label><input name="kcal" inputmode="numeric"><p class="mute">היעד יחול מהיום. הימים הקודמים יוצגו מול היעד שהיה בתוקף בהם. חלוקת הרכיבים: ברירת המחדל הכללית.</p><button class="primary block" type="submit">שמור</button></form><button class="block" data-a="closemodal">ביטול</button>');
    },
    expjson: function () { shareOrDownload('nutrition-backup-' + C.today() + '.json', 'application/json', JSON.stringify(S, null, 1)); },
    expcsv: function () { shareOrDownload('nutrition-' + C.today() + '.csv', 'text/csv', exportCsv()); },
    imp: function () { $('#impfile').click(); },
    delall: function () {
      var a = window.prompt('פעולה זו מוחקת את כל הנתונים בטלפון ואי אפשר לבטל אותה. כדי לאשר, הקלד: מחק');
      if (a && a.trim() === 'מחק') { localStorage.removeItem(KEY); S = blank(); ui.screen = 'wizard'; ui.wiz = newWiz('new'); toast('כל הנתונים נמחקו'); }
    },
    tests: function () { ui.set = 'tests'; window.scrollTo(0, 0); },
    back: function () { ui.set = null; }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a]'); if (!t) return;
    var fn = actions[t.dataset.a]; if (!fn) return;
    fn(t.dataset, t);
    if (t.dataset.a !== 'closemodal' && t.dataset.a !== 'edel' && t.dataset.a !== 'copyday' && t.dataset.a !== 'eedit' && t.dataset.a !== 'mgoal' && t.dataset.a !== 'imp' && t.dataset.a !== 'expjson' && t.dataset.a !== 'expcsv') { if (['wnext', 'wback', 'rback', 'wupdate', 'rsave', 'rmanual', 'rskip'].indexOf(t.dataset.a) >= 0) window.scrollTo(0, 0); render(); }
    else if (t.dataset.a === 'edel') render();
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.w) { setPath(ui.wiz.d, t.dataset.w, t.type === 'checkbox' ? t.checked : t.value); }
    else if (t.dataset.conf) { ui.wiz.conf[t.dataset.conf] = t.checked ? t.dataset.val : ''; }
    else if (t.dataset.in === 'q') { ui.add.q = t.value; var fl = $('#flist'); if (fl) fl.innerHTML = foodList(); }
    else if (t.dataset.in === 'prev') updatePreview();
    else if (t.dataset.in === 'pct') {
      ui.res.pct[t.dataset.k] = num(t.value) || 0;
      $('#macroOut').innerHTML = macroOut(ui.res.calc.target, ui.res.pct);
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.name === 'base' && e.target.form && e.target.form.dataset.f === 'manual') {
      var us = e.target.form.querySelector('select[name=unit]');
      if (us) us.value = e.target.value === 'serving' ? 'serving' : e.target.value === '100ml' ? 'ml' : 'g';
    }
    if (e.target.id === 'impfile') {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var o = JSON.parse(rd.result);
          if (!o || o.v !== 1 || !Array.isArray(o.diary) || !Array.isArray(o.goals)) throw new Error('bad');
          if (!window.confirm('השחזור יחליף את כל הנתונים הנוכחיים בטלפון. להמשיך?')) return;
          S = Object.assign(blank(), o); save(); ui.screen = S.profile ? 'main' : 'wizard'; if (ui.screen === 'wizard') ui.wiz = newWiz('new'); render(); toast('הנתונים שוחזרו');
        } catch (err) { toast('הקובץ אינו גיבוי תקין של האפליקציה'); }
      };
      rd.readAsText(f);
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f.dataset.f) return;
    e.preventDefault();
    var fd = new FormData(f), T = f.dataset.f;
    if (T === 'search') {
      var q = String(fd.get('q') || '').trim();
      ui.add.search.q = q;
      if (!q) { ui.add.search.results = null; ui.add.search.err = null; render(); return; }
      ui.add.search.loading = true; ui.add.search.err = null; ui.add.search.results = null; render();
      usdaSearch(q).then(function (list) {
        ui.add.search.loading = false; ui.add.search.results = list; if (ui.tab === 'add' && ui.add.tab === 'search') render();
      }).catch(function (err) {
        ui.add.search.loading = false; ui.add.search.err = (err && err.message) || 'החיפוש נכשל. בדוק את החיבור לרשת'; if (ui.tab === 'add' && ui.add.tab === 'search') render();
      });
      return;
    } else if (T === 'barcode') {
      var code = String(fd.get('code') || '').replace(/\D/g, '');
      if (code.length < 6) { toast('יש להזין מספר ברקוד תקין'); return; }
      stopScan(); onBarcode(code); return;
    } else if (T === 'ai') {
      if (!S.settings.geminiConsent) {
        var cb = $('#aiConsent');
        if (!cb || !cb.checked) { toast('יש לאשר את שליחת התיאור/התמונה ל-Google'); return; }
        S.settings.geminiConsent = true; save();
      }
      runAi(f); return;
    } else if (T === 'weight') {
      var kg = num(fd.get('kg')), date = fd.get('date');
      if (kg === null || isNaN(kg) || kg < 25 || kg > 350) { toast('יש להזין משקל תקין'); return; }
      if (!date || date > C.today()) { toast('יש לבחור תאריך שאינו עתידי'); return; }
      var ex = S.weights.filter(function (w) { return w.date === date; })[0];
      if (ex) ex.kg = kg; else S.weights.push({ id: uid(), date: date, kg: kg });
      save(); toast('נשמר'); render();
    } else if (T === 'entry') {
      var en = S.diary.filter(function (x) { return x.id === f.dataset.id; })[0]; if (!en) return;
      var q = num(fd.get('qty')), u = fd.get('unit'), n = C.nutrition({ base: en.base, per: en.per, sw: en.sw }, q, u);
      if (n.error) { toast(n.error); return; }
      en.qty = q; en.unit = u; en.meal = fd.get('meal'); en.snap = n.values; save(); closeModal(); render();
    } else if (T === 'pick') {
      var fo = S.foods.filter(function (x) { return x.id === ui.add.pick; })[0], qq = num(fd.get('qty'));
      var ent = makeEntry(fo, qq, fd.get('unit'), fd.get('meal'), ui.date); if (!ent) return;
      S.diary.push(ent); ui.add.meal = fd.get('meal'); save(); ui.add.pick = null; ui.tab = 'today'; toast('נוסף ליומן'); render(); window.scrollTo(0, 0);
    } else if (T === 'addmeal') {
      var m = S.meals.filter(function (x) { return x.id === f.dataset.id; })[0], mult = num(fd.get('mult'));
      if (!m || mult === null || isNaN(mult) || mult <= 0) { toast('יש להזין כמות תקינה'); return; }
      var made = [], bad = false;
      m.items.forEach(function (it) { var en2 = makeEntry(it, it.qty * mult, it.unit, fd.get('meal'), ui.date); if (en2) made.push(en2); else bad = true; });
      if (bad) return;
      made.forEach(function (x) { S.diary.push(x); }); save(); ui.tab = 'today'; toast('הארוחה נוספה'); render(); window.scrollTo(0, 0);
    } else if (T === 'manual') {
      var name = String(fd.get('name') || '').trim();
      if (!name) { toast('יש להזין שם'); return; }
      var vals = {}, badv = false;
      ['kcal', 'kj', 'p', 'c', 'f', 'sw'].forEach(function (k) { var x = num(fd.get(k)); if (x !== null && (isNaN(x) || x < 0)) badv = true; vals[k] = x; });
      if (badv) { toast('הערכים חייבים להיות מספרים אי-שליליים'); return; }
      var kcal = vals.kcal, note = false;
      if (kcal === null && vals.kj !== null) { kcal = C.kjToKcal(vals.kj); note = true; }
      if (kcal === null && vals.p === null && vals.c === null && vals.f === null) { toast('יש להזין לפחות ערך תזונתי אחד'); return; }
      var food = { name: name, brand: String(fd.get('brand') || '').trim(), base: fd.get('base'), per: { kcal: kcal, p: vals.p, c: vals.c, f: vals.f }, sw: vals.sw || 0, energyNote: note, source: f.dataset.src || 'manual' };
      ui.add.prefill = null;
      if (f.dataset.id) {
        var old = S.foods.filter(function (x) { return x.id === f.dataset.id; })[0];
        Object.assign(old, food, { updated: Date.now() }); save(); ui.add.editFood = null; ui.add.tab = 'foods'; toast('נשמר'); render(); return;
      }
      var qty = num(fd.get('qty'));
      if (qty !== null && (isNaN(qty) || qty <= 0)) { toast('הכמות חייבת להיות גדולה מאפס'); return; }
      var meal = fd.get('meal'), unit = fd.get('unit');
      if (qty !== null) {
        var chk3 = C.nutrition(food, qty, unit); if (chk3.error) { toast(chk3.error); return; }
      }
      if (fd.get('keep') || qty === null) { food.id = uid(); food.fav = false; food.updated = Date.now(); S.foods.push(food); }
      if (qty !== null) { var ent2 = makeEntry(food, qty, unit, meal, ui.date); S.diary.push(ent2); ui.add.meal = meal; save(); ui.tab = 'today'; toast(note ? 'נוסף. האנרגיה הומרה מקילו-ג׳אול לקק״ל' : 'נוסף ליומן'); render(); window.scrollTo(0, 0); }
      else { save(); ui.add.tab = 'foods'; toast('המוצר נשמר'); render(); }
    } else if (T === 'copy') {
      var from = fd.get('from'), which = fd.get('which');
      if (!from || from >= ui.date) { toast('יש לבחור תאריך מוקדם מהיום המוצג'); return; }
      var src = S.diary.filter(function (x) { return x.date === from && (which === 'all' || x.meal === which); });
      if (!src.length) { toast('לא נמצאו רשומות להעתקה בתאריך הזה'); return; }
      src.forEach(function (x) { var c2 = JSON.parse(JSON.stringify(x)); c2.id = uid(); c2.date = ui.date; S.diary.push(c2); });
      save(); closeModal(); ui.tab = 'today'; toast('הועתקו ' + src.length + ' פריטים'); render();
    } else if (T === 'mgoal') {
      var k = num(fd.get('kcal'));
      if (k === null || isNaN(k) || k < 800 || k > 6000) { toast('יש להזין יעד בין 800 ל-6,000 קק״ל'); return; }
      var today = C.today(); S.goals = S.goals.filter(function (g) { return g.from !== today; });
      S.goals.push({ from: today, kcal: k, pct: Object.assign({}, C.DEFAULT_PCT), src: 'manual', basis: null });
      save(); closeModal(); toast('היעד נשמר'); render();
    }
  });

  /* ---------- הפעלה ---------- */
  render();
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () { }); }
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) { navigator.serviceWorker.register('sw.js').catch(function () { }); }
  window.__app = { get S() { return S; }, ui: ui };
})();
