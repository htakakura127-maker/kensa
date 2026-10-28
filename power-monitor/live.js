// 電流ライブモニター（ブックマークレット）
// Informetis のサイト（installer.egvw.informetis.com）を開いた状態で実行すると、
// 画面を電流モニターに切り替え、グラフページを1秒ごとに直接取得して CH1 / CH2 の最新値を表示する
(function () {
  var HOST = 'installer.egvw.informetis.com';
  var MAC = '707414FFFE783CDC';
  var USERNAME = 'informetis';
  var PASSWORD = 'informetis1228';
  var VOLTAGE = 100;
  var POLL_MS = 1000;       // 取得を始める間隔
  var TIMEOUT_MS = 8000;    // これ以上かかった取得は捨てる
  var MAX_INFLIGHT = 3;     // 同時に走らせる取得の数（遅い取得に引きずられないように）
  var HISTORY_SEC = 180;    // グラフに残す秒数

  if (location.hostname !== HOST) {
    location.href = 'https://' + HOST + '/pro/' + MAC + '/';
    return;
  }

  var DATA_URL = 'https://' + HOST + '/pro/' + MAC + '/';
  var LOGIN_URL = 'https://' + HOST + '/accounts/login/';

  // ---- 元の画面の自動更新を止める ----
  var maxId = setTimeout(function () {}, 0);
  for (var i = 0; i <= maxId + 1000; i++) { clearTimeout(i); clearInterval(i); }
  try { window.stop(); } catch (e) {}

  // ---- 画面を作る ----
  document.open();
  document.write('<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>電流ライブ</title><style>' +
    ':root{--bg:#0e1116;--card:#181d25;--fg:#f2f5f8;--sub:#8d99a8;--line:#28303b;--c1:#4aa8ff;--c2:#ffb547;--warn:#6b4a00;--alarm:#7a1515;--ok:#3ecf7a;--ng:#ff5a5a}' +
    '*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg)}' +
    'body{font:15px/1.4 -apple-system,"Hiragino Sans",sans-serif;padding:calc(env(safe-area-inset-top) + 12px) max(14px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 16px) max(14px,env(safe-area-inset-left));-webkit-text-size-adjust:100%}' +
    '.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:var(--sub);font-size:13px}' +
    '.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--sub);margin-right:6px;vertical-align:1px}' +
    '.dot.ok{background:var(--ok)}.dot.ng{background:var(--ng)}' +
    '.card{background:var(--card);border-radius:18px;padding:16px;margin-bottom:12px;text-align:center}' +
    '.main{transition:background .3s}.main.warn{background:var(--warn)}.main.alarm{background:var(--alarm)}' +
    '.lbl{font-size:15px;color:var(--sub)}.main .lbl{color:#d6dde5}' +
    '.big{font-size:68px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;letter-spacing:-1px}' +
    '.mid{font-size:44px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}' +
    '.u{font-size:.45em;font-weight:600;margin-left:4px}' +
    '.w{color:var(--sub);font-size:16px;font-variant-numeric:tabular-nums}' +
    '.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row .card{margin:0 0 12px}' +
    '.c1 .lbl{color:var(--c1)}.c2 .lbl{color:var(--c2)}' +
    'canvas{width:100%;height:150px;display:block}' +
    '.leg{display:flex;gap:14px;justify-content:center;font-size:12px;color:var(--sub);margin-top:6px}' +
    '.leg i{display:inline-block;width:12px;height:3px;vertical-align:3px;margin-right:4px}' +
    '.info{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px;color:var(--sub);text-align:left;font-variant-numeric:tabular-nums}' +
    '.info b{color:var(--fg);font-weight:600}.stale{color:var(--ng)!important}' +
    '.flash{animation:f .5s}@keyframes f{from{opacity:.55}to{opacity:1}}' +
    'button{font:inherit;color:var(--fg);background:var(--line);border:0;border-radius:10px;padding:8px 12px}' +
    '</style></head><body>' +
    '<div class="top"><span><span id="dot" class="dot"></span><span id="st">接続中…</span></span><button id="back" type="button">元の画面</button></div>' +
    '<div id="main" class="card main"><div class="lbl">主幹電流（CH1/CH2の大きい方）</div><div class="big"><span id="m">--.--</span><span class="u">A</span></div><div class="w" id="mw">&nbsp;</div></div>' +
    '<div class="row"><div class="card c1"><div class="lbl">CH1</div><div class="mid"><span id="a1">--.--</span><span class="u">A</span></div><div class="w" id="w1">-- W</div></div>' +
    '<div class="card c2"><div class="lbl">CH2</div><div class="mid"><span id="a2">--.--</span><span class="u">A</span></div><div class="w" id="w2">-- W</div></div></div>' +
    '<div class="card"><canvas id="cv"></canvas><div class="leg"><span><i style="background:var(--c1)"></i>CH1</span><span><i style="background:var(--c2)"></i>CH2</span><span>直近3分・A</span></div></div>' +
    '<div class="card"><div class="info">' +
    '<span>データ時刻</span><b id="ts">--</b>' +
    '<span>データの遅れ</span><b id="lag">--</b>' +
    '<span>値の更新</span><b id="q">--</b>' +
    '<span>取得時間</span><b id="rt">--</b>' +
    '</div></div></body></html>');
  document.close();

  var $ = function (id) { return document.getElementById(id); };
  $('back').onclick = function () { location.href = DATA_URL; };

  // 画面を消灯させない（対応している iOS のみ）
  var lock = null;
  function keepAwake() {
    try { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }, function () {}); } catch (e) {}
  }
  keepAwake();

  // ---- データ時刻の読み取り（「10/28 18:37:28」は日本時間の今年） ----
  function toMs(xs) {
    if (xs === null || xs === undefined || xs === '') return null;
    if (typeof xs === 'number' || /^\d+(\.\d+)?$/.test(String(xs))) { var n = Number(xs); return n < 1e12 ? n * 1000 : n; }
    var s = String(xs).trim(), q = function (v) { return ('0' + v).slice(-2); };
    var md = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (md) {
      var y = new Date().getFullYear();
      var mk = function (yy) { return Date.parse(yy + '-' + q(md[1]) + '-' + q(md[2]) + 'T' + q(md[3]) + ':' + md[4] + ':' + (md[5] || '00') + '+09:00'); };
      var t = mk(y);
      if (t > Date.now() + 864e5) t = mk(y - 1);
      return isNaN(t) ? null : t;
    }
    var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) s = m[1] + '-' + q(m[2]) + '-' + q(m[3]) + 'T' + q(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00';
    var ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
  }

  function isLogin(html) { return html.indexOf('name="password"') !== -1 && html.indexOf('name="username"') !== -1; }

  // HTMLの graphs_data から CH1/CH2 の最新点を取り出す
  function parse(html) {
    var m = html.match(/(?:var\s+)?graphs_data\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return null;
    var g;
    try { g = new Function('return (' + m[1] + ');')(); } catch (e) { return null; }
    var c1 = g && g.ch_data && g.ch_data.ch1_data, c2 = g && g.ch_data && g.ch_data.ch2_data;
    if (!c1 || !c1.length || !c2 || !c2.length) return null;
    var l1 = c1[c1.length - 1], l2 = c2[c2.length - 1];
    var p1 = Number(l1.ys), p2 = Number(l2.ys);
    if (isNaN(p1) || isNaN(p2)) return null;
    return { xs: l1.xs, ms: toMs(l1.xs), p1: p1, p2: p2 };
  }

  // ---- ログイン（セッションが切れていたときだけ） ----
  var loggingIn = null;
  function login() {
    if (loggingIn) return loggingIn;
    setStatus('ログイン中…', '');
    loggingIn = fetch(LOGIN_URL, { credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var t = html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i) ||
                html.match(/value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i);
        if (!t) throw new Error('ログイン画面を読めませんでした');
        var body = 'csrfmiddlewaretoken=' + encodeURIComponent(t[1]) + '&username=' + encodeURIComponent(USERNAME) +
                   '&password=' + encodeURIComponent(PASSWORD) + '&next=' + encodeURIComponent('/pro/' + MAC + '/');
        return fetch(LOGIN_URL, { method: 'POST', credentials: 'include', cache: 'no-store',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body });
      })
      .then(function (r) { return r.text(); })
      .then(function (html) { if (isLogin(html) && !parse(html)) throw new Error('ログインに失敗しました'); })
      .then(function () { loggingIn = null; }, function (e) { loggingIn = null; throw e; });
    return loggingIn;
  }

  // ---- 表示 ----
  var latest = null, gotAt = 0, changedAt = 0, hist = [], lastRt = null, errCount = 0;

  function setStatus(text, cls) { $('st').textContent = text; $('dot').className = 'dot ' + (cls || ''); }

  function show(d) {
    var a1 = d.p1 / VOLTAGE, a2 = d.p2 / VOLTAGE, m = Math.max(a1, a2);
    $('a1').textContent = a1.toFixed(2); $('w1').textContent = d.p1.toFixed(0) + ' W';
    $('a2').textContent = a2.toFixed(2); $('w2').textContent = d.p2.toFixed(0) + ' W';
    $('m').textContent = m.toFixed(2);
    $('mw').textContent = (a1 >= a2 ? 'CH1' : 'CH2') + 'の値（20A超で橙・25A超で赤）';
    $('main').className = 'card main' + (m > 25 ? ' alarm' : m > 20 ? ' warn' : '');
    ['m', 'a1', 'a2'].forEach(function (id) { var e = $(id); e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash'); });
    $('ts').textContent = String(d.xs);
    if (d.ms !== null) {
      hist.push({ t: d.ms, a1: a1, a2: a2 });
      while (hist.length && hist[0].t < d.ms - HISTORY_SEC * 1000) hist.shift();
    }
    draw();
  }

  function fmtLag(ms) {
    if (ms < 0) ms = 0;
    var m = Math.floor(ms / 60000);
    return (m ? m + '分' : '') + ((ms % 60000) / 1000).toFixed(m ? 0 : 1) + '秒';
  }

  function tick() {
    if (!latest) return;
    var quiet = Date.now() - changedAt;
    $('q').textContent = Math.floor(quiet / 1000) + '秒前';
    $('q').className = quiet > 10000 ? 'stale' : '';
    $('lag').textContent = latest.ms === null ? '--' : fmtLag(Date.now() - latest.ms);
    if (lastRt !== null) $('rt').textContent = lastRt + 'ms';
  }

  function draw() {
    var cv = $('cv'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    var t1 = hist[hist.length - 1].t, t0 = t1 - HISTORY_SEC * 1000;
    var mx = 0;
    hist.forEach(function (p) { mx = Math.max(mx, p.a1, p.a2); });
    mx = Math.max(5, Math.ceil(mx / 5) * 5);
    var L = 30, B = 16, pw = w - L - 4, ph = h - B - 6;
    var X = function (t) { return L + (t - t0) / (t1 - t0) * pw; }, Y = function (v) { return 6 + ph - v / mx * ph; };
    c.font = '11px -apple-system,sans-serif'; c.fillStyle = '#8d99a8'; c.strokeStyle = '#28303b'; c.lineWidth = 1;
    for (var k = 0; k <= 2; k++) {
      var v = mx * k / 2, y = Math.round(Y(v)) + .5;
      c.beginPath(); c.moveTo(L, y); c.lineTo(w - 4, y); c.stroke();
      c.textAlign = 'right'; c.fillText(String(v), L - 5, y + 4);
    }
    c.textAlign = 'left'; c.fillText('3分前', L, h - 2); c.textAlign = 'right'; c.fillText('最新', w - 4, h - 2);
    [['a1', '#4aa8ff'], ['a2', '#ffb547']].forEach(function (s) {
      c.beginPath(); c.strokeStyle = s[1]; c.lineWidth = 2;
      hist.forEach(function (p, i) { var x = X(p.t), y = Y(p[s[0]]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
      var e = hist[hist.length - 1];
      c.beginPath(); c.fillStyle = s[1]; c.arc(X(e.t), Y(e[s[0]]), 3, 0, 7); c.fill();
    });
  }

  // ---- 取得：1秒ごとに新しい取得を始める（前の取得の完了は待たない） ----
  var inflight = 0, seq = 0, shownSeq = 0;

  function fetchOnce(retried) {
    var my = ++seq, st = Date.now();
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    inflight++;
    return fetch(DATA_URL, { credentials: 'include', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var d = parse(html);
        if (!d) {
          if (isLogin(html) && !retried) return login().then(function () { return fetchOnce(true); });
          throw new Error('データを読めませんでした');
        }
        lastRt = Date.now() - st;
        errCount = 0;
        setStatus('ライブ', 'ok');
        // 後から始めた取得が先に返っていたら、古い結果は使わない
        if (my < shownSeq) return;
        shownSeq = my;
        gotAt = Date.now();
        if (!latest || d.xs !== latest.xs) { changedAt = gotAt; latest = d; show(d); }
      })
      .catch(function (e) {
        if (++errCount >= 3) setStatus('取得できません: ' + (e && e.message || e), 'ng');
      })
      .then(function () { clearTimeout(to); if (inflight > 0) inflight--; });
  }

  var loop = null;
  function start() {
    if (loop) return;
    keepAwake();
    fetchOnce();
    loop = setInterval(function () { if (inflight < MAX_INFLIGHT) fetchOnce(); }, POLL_MS);
  }
  function stop() { clearInterval(loop); loop = null; setStatus('一時停止中', ''); }

  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  setInterval(tick, 200);
  window.addEventListener('resize', draw);
  start();
})();
