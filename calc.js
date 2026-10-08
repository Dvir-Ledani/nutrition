/* מנוע חישוב: פונקציות טהורות וניתנות לבדיקה. ללא תלות בדפדפן. */
(function (root) {
  'use strict';

  var TZ = 'Asia/Jerusalem';
  var dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false });

  function today() { return dateFmt.format(new Date()); }
  function nowHour() { return parseInt(hourFmt.format(new Date()), 10) % 24; }
  function addDays(s, n) {
    var p = s.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  var ACTIVITY = [
    { v: 1.2, t: 'ישיבה רוב היום', d: 'עבודה משרדית או ישיבה רוב היום, מעט הליכה, בלי אימונים קבועים' },
    { v: 1.375, t: 'פעילות קלה', d: 'הליכה יומיומית או אימונים קלים 1–3 פעמים בשבוע' },
    { v: 1.55, t: 'פעילות בינונית', d: 'עבודה בתנועה, או אימונים 3–5 פעמים בשבוע' },
    { v: 1.725, t: 'פעילות גבוהה', d: 'אימונים אינטנסיביים 6–7 פעמים בשבוע, או עבודה פיזית' },
    { v: 1.9, t: 'פעילות גבוהה מאוד', d: 'עבודה פיזית קשה יחד עם אימונים, או אימונים כפולים' }
  ];

  var FLOOR = { m: 1500, f: 1200 };
  var REF = { c: [45, 65], p: [10, 35], f: [20, 35] };
  var DEFAULT_PCT = { c: 45, p: 25, f: 30 };
  var KCAL_PER_G = { c: 4, p: 4, f: 9 };
  var KJ_PER_KCAL = 4.184;

  function bmr(sex, w, h, a) { return 10 * w + 6.25 * h - 5 * a + (sex === 'm' ? 5 : -161); }
  function bmi(w, h) { return w / Math.pow(h / 100, 2); }
  function kjToKcal(kj) { return kj / KJ_PER_KCAL; }

  /* הצעה בלבד לרמת פעילות: המשתמש הוא שבוחר. */
  function suggestActivity(daily, freq, dur, inten) {
    var base = daily === 'mov' ? 1 : 0;
    var mult = inten === 'high' ? 2 : inten === 'mid' ? 1.5 : 1;
    var score = (freq || 0) * (dur || 0) * mult;
    var add = score < 60 ? 0 : score < 180 ? 1 : score < 400 ? 2 : 3;
    return Math.min(4, base + add);
  }

  /* חסימות. נבדק על הערך המחושב לפני עיגול. */
  function floorCheck(sex, rawTarget) {
    var f = FLOOR[sex];
    return rawTarget < f ? { blocked: true, floor: f } : { blocked: false, floor: f };
  }

  function macroGrams(kcal, pct) {
    return {
      c: kcal * pct.c / 100 / KCAL_PER_G.c,
      p: kcal * pct.p / 100 / KCAL_PER_G.p,
      f: kcal * pct.f / 100 / KCAL_PER_G.f
    };
  }

  function pctCheck(pct) {
    var sum = pct.c + pct.p + pct.f;
    var out = { ok: Math.abs(sum - 100) < 1e-9, sum: sum, warnings: [] };
    var names = { c: 'פחמימות', p: 'חלבון', f: 'שומן' };
    ['c', 'p', 'f'].forEach(function (k) {
      if (pct[k] < REF[k][0] || pct[k] > REF[k][1]) {
        out.warnings.push(names[k] + ' ' + pct[k] + '% מחוץ לטווח הייחוס למבוגרים (' + REF[k][0] + '–' + REF[k][1] + '%)');
      }
    });
    return out;
  }

  /* p: {sex, age, height, weight, goal, target, factor} */
  function computeGoal(p) {
    var b = bmr(p.sex, p.weight, p.height, p.age);
    var maint = b * p.factor;
    var res = { bmr: b, maint: maint, status: 'ok' };
    if (p.goal === 'loss') {
      if (bmi(p.weight, p.height) < 18.5 || bmi(p.target, p.height) < 18.5) {
        res.status = 'blocked'; res.reason = 'underweight'; return res;
      }
      var raw = maint * 0.9;
      res.raw = raw;
      var fc = floorCheck(p.sex, raw);
      if (fc.blocked) { res.status = 'blocked'; res.reason = 'floor'; res.floor = fc.floor; return res; }
      res.target = raw;
    } else {
      res.target = maint;
    }
    return res;
  }

  /* ערכים תזונתיים לכמות שנאכלה.
     food: {base:'100g'|'100ml'|'serving', per:{kcal,p,c,f}, sw}
     unit: 'g' | 'ml' | 'serving'. שדה ריק נשאר null (לא אפס). */
  function nutrition(food, qty, unit) {
    if (!(qty > 0)) return { error: 'הכמות חייבת להיות גדולה מאפס' };
    var f;
    if (food.base === '100g') {
      if (unit === 'g') f = qty / 100;
      else if (unit === 'serving') { if (!(food.sw > 0)) return { error: 'משקל המנה אינו ידוע' }; f = qty * food.sw / 100; }
      else return { error: 'מוצר שבסיסו 100 גרם נרשם בגרמים או במנות' };
    } else if (food.base === '100ml') {
      if (unit === 'ml') f = qty / 100;
      else if (unit === 'serving') { if (!(food.sw > 0)) return { error: 'נפח המנה אינו ידוע' }; f = qty * food.sw / 100; }
      else return { error: 'מוצר שבסיסו 100 מ״ל נרשם במ״ל או במנות. אין המרה בין גרם למ״ל' };
    } else {
      if (unit === 'serving') f = qty;
      else if (unit === 'g' && food.sw > 0) f = qty / food.sw;
      else return { error: 'מוצר שבסיסו מנה נרשם במנות' };
    }
    var v = {};
    ['kcal', 'p', 'c', 'f'].forEach(function (k) {
      var x = food.per ? food.per[k] : null;
      v[k] = (x === null || x === undefined) ? null : x * f;
    });
    return { values: v };
  }

  function totals(list) {
    var t = { kcal: 0, p: 0, c: 0, f: 0, partial: { kcal: false, p: false, c: false, f: false } };
    list.forEach(function (v) {
      ['kcal', 'p', 'c', 'f'].forEach(function (k) {
        if (v[k] === null || v[k] === undefined) t.partial[k] = true; else t[k] += v[k];
      });
    });
    return t;
  }

  /* היעד שהיה בתוקף בתאריך נתון. לפני היעד הראשון: היעד הראשון. */
  function goalInEffect(goals, date) {
    if (!goals || !goals.length) return null;
    var s = goals.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    var g = s[0];
    for (var i = 0; i < s.length; i++) { if (s[i].from <= date) g = s[i]; }
    return g;
  }

  /* ממוצע נע של 7 ימים, רק כשיש לפחות 4 מדידות בחלון. */
  function movingAvg(weights, date) {
    var from = addDays(date, -6), n = 0, sum = 0;
    weights.forEach(function (w) { if (w.date >= from && w.date <= date) { n++; sum += w.kg; } });
    return n >= 4 ? sum / n : null;
  }

  /* ---------- בדיקות ---------- */
  function decimalsOf(x) { var s = String(x); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function near(got, exp) { return Math.abs(got - exp) <= Math.pow(10, -decimalsOf(exp)) + 1e-9; }

  function runTests() {
    var R = [];
    function num(name, got, exp) { R.push({ name: name, ok: got !== null && got !== undefined && near(got, exp), got: got === null ? 'null' : (typeof got === 'number' ? Math.round(got * 1e4) / 1e4 : got), exp: exp }); }
    function bool(name, got, exp) { R.push({ name: name, ok: got === exp, got: String(got), exp: String(exp) }); }
    function str(name, got, exp) { R.push({ name: name, ok: got === exp, got: String(got), exp: String(exp) }); }

    var m = { sex: 'm', age: 40, height: 175, weight: 85, factor: 1.375, goal: 'loss', target: 80 };
    var g = computeGoal(m), mg = macroGrams(g.target, DEFAULT_PCT);
    num('גבר 40/175/85: מנוחה', g.bmr, 1748.75);
    num('גבר 40/175/85: תחזוקה', g.maint, 2404.53);
    num('גבר 40/175/85: יעד ירידה', g.target, 2164.08);
    num('גבר 40/175/85: פחמימות', mg.c, 243.5);
    num('גבר 40/175/85: חלבון', mg.p, 135.3);
    num('גבר 40/175/85: שומן', mg.f, 72.1);
    var gm = computeGoal(Object.assign({}, m, { goal: 'maintain' }));
    num('אותם נתונים, שמירה: יעד', gm.target, 2404.53);

    var f = { sex: 'f', age: 30, height: 165, weight: 70, factor: 1.55, goal: 'loss', target: 65 };
    var gf = computeGoal(f), mf = macroGrams(gf.target, DEFAULT_PCT);
    num('אישה 30/165/70: מנוחה', gf.bmr, 1420.25);
    num('אישה 30/165/70: תחזוקה', gf.maint, 2201.39);
    num('אישה 30/165/70: יעד', gf.target, 1981.25);
    num('אישה 30/165/70: פחמימות', mf.c, 222.9);
    num('אישה 30/165/70: חלבון', mf.p, 123.8);
    num('אישה 30/165/70: שומן', mf.f, 66.0);

    var low = computeGoal({ sex: 'f', age: 60, height: 150, weight: 50, factor: 1.2, goal: 'loss', target: 48 });
    str('אישה 60/150/50: חסימה מתחת ל-1,200', low.status + ':' + low.reason, 'blocked:floor');
    num('אישה 60/150/50: ערך מחושב לפני עיגול', low.raw, 1054.62);

    var uw = computeGoal({ sex: 'm', age: 30, height: 180, weight: 62, factor: 1.55, goal: 'loss', target: 58 });
    str('גבר 30/180/62, יעד 58: אין הצעת ירידה (תת-משקל)', uw.status + ':' + uw.reason, 'blocked:underweight');

    bool('גבול 1,500 לגבר: 1,499.9 נחסם', floorCheck('m', 1499.9).blocked, true);
    bool('גבול 1,500 לגבר: 1,500 עובר', floorCheck('m', 1500).blocked, false);
    bool('גבול 1,200 לאישה: 1,199 נחסם', floorCheck('f', 1199).blocked, true);
    bool('גבול 1,200 לאישה: 1,200 עובר', floorCheck('f', 1200).blocked, false);

    bool('חלוקה 50/30/30 נדחית', pctCheck({ c: 50, p: 30, f: 30 }).ok, false);
    bool('חלוקה 45/25/30 תקינה', pctCheck(DEFAULT_PCT).ok, true);
    bool('חלוקה 70/10/20: אזהרת טווח לפחמימות', pctCheck({ c: 70, p: 10, f: 20 }).warnings.length === 1, true);

    var prod = { base: '100g', per: { kcal: 350, p: 10, c: 60, f: null }, sw: 0 };
    var n1 = nutrition(prod, 30, 'g');
    num('350 קק״ל ל-100 גרם, 30 גרם', n1.values.kcal, 105);
    bool('שדה שומן ריק נשאר null', n1.values.f === null, true);
    var tt = totals([n1.values]);
    bool('סיכום עם שומן חסר מסומן חלקי', tt.partial.f === true && tt.partial.kcal === false, true);
    num('1,464 קילו-ג׳אול לקק״ל', kjToKcal(1464), 349.9);

    var ml = { base: '100ml', per: { kcal: 40, p: 3, c: 5, f: 1 }, sw: 0 };
    num('מוצר 100 מ״ל: 200 מ״ל', nutrition(ml, 200, 'ml').values.kcal, 80);
    bool('מוצר 100 מ״ל: גרמים נדחים', !!nutrition(ml, 200, 'g').error, true);
    bool('מוצר 100 גרם: מנה בלי משקל מנה נדחית', !!nutrition(prod, 1, 'serving').error, true);
    var sv = { base: 'serving', per: { kcal: 120, p: 5, c: 15, f: 4 }, sw: 40 };
    num('בסיס מנה: 2 מנות', nutrition(sv, 2, 'serving').values.kcal, 240);
    num('בסיס מנה עם משקל 40 גרם: 20 גרם', nutrition(sv, 20, 'g').values.kcal, 60);

    str('מעבר חודש בתאריך: 2026-10-31 + יום', addDays('2026-10-31', 1), '2026-11-01');
    var goals = [{ from: '2026-10-01', kcal: 1900 }, { from: '2026-10-08', kcal: 1629 }];
    num('יום קודם מוצג מול היעד שהיה בתוקף', goalInEffect(goals, '2026-10-05').kcal, 1900);
    num('יום היעד החדש מוצג מול היעד החדש', goalInEffect(goals, '2026-10-08').kcal, 1629);

    var ws = [{ date: '2026-10-02', kg: 71 }, { date: '2026-10-04', kg: 70.8 }, { date: '2026-10-06', kg: 70.6 }];
    bool('ממוצע נע: 3 מדידות אינן מספיקות', movingAvg(ws, '2026-10-07') === null, true);
    ws.push({ date: '2026-10-07', kg: 70.4 });
    num('ממוצע נע: 4 מדידות', movingAvg(ws, '2026-10-07'), 70.7);

    str('הצעת פעילות: ישיבה בלי אימונים', String(ACTIVITY[suggestActivity('sed', 0, 0, 'low')].v), '1.2');
    return R;
  }

  var api = {
    TZ: TZ, ACTIVITY: ACTIVITY, FLOOR: FLOOR, REF: REF, DEFAULT_PCT: DEFAULT_PCT, KJ_PER_KCAL: KJ_PER_KCAL,
    today: today, nowHour: nowHour, addDays: addDays, daysBetween: daysBetween,
    bmr: bmr, bmi: bmi, kjToKcal: kjToKcal, suggestActivity: suggestActivity,
    floorCheck: floorCheck, macroGrams: macroGrams, pctCheck: pctCheck, computeGoal: computeGoal,
    nutrition: nutrition, totals: totals, goalInEffect: goalInEffect, movingAvg: movingAvg, runTests: runTests
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : this);
