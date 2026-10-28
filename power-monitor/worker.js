// 電流ライブ（Cloudflare Workers 用）
// このURLを iPhone のホーム画面に追加すると、ワンタップで CH1 / CH2 の電流をライブ表示できる
//   /       … モニター画面
//   /data   … 最新値のJSON（画面が1秒ごとに呼ぶ）
// Worker がログインと取得を代わりに行う。ログイン状態は使い回し、切れたら自動でログインし直す

const BASE = 'https://installer.egvw.informetis.com';
const MAC = '707414FFFE783CDC';
const USERNAME = 'informetis';
const PASSWORD = 'informetis1228';
const VOLTAGE = 100;

const LOGIN_PATH = '/accounts/login/';
const DATA_PATH = '/pro/' + MAC + '/';

// ログイン後のCookie（同じWorkerが動いている間は使い回す）
let cookies = '';
let loggingIn = null;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/data') return data();
    if (url.pathname === '/manifest.json') return manifest();
    if (url.pathname === '/icon.png') return icon();
    if (url.pathname === '/') {
      return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return new Response('not found', { status: 404 });
  },
};


// ==============================
// 最新値のJSON
// ==============================
async function data() {
  const started = Date.now();
  try {
    if (!cookies) await login();
    let html = await fetchPage();
    if (isLogin(html)) {
      await login();
      html = await fetchPage();
      if (isLogin(html)) throw new Error('Informetisへのログインに失敗しました');
    }
    const d = parse(html);
    if (!d) throw new Error('graphs_data を読めませんでした');
    d.ok = true;
    d.took_ms = Date.now() - started;
    return json(d);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) });
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

async function fetchPage() {
  const res = await fetch(BASE + DATA_PATH, { headers: { cookie: cookies }, redirect: 'follow' });
  return res.text();
}

function isLogin(html) {
  return html.indexOf('name="password"') !== -1 && html.indexOf('name="username"') !== -1;
}


// ==============================
// ログイン
// ==============================
function login() {
  if (!loggingIn) {
    loggingIn = doLogin().finally(() => { loggingIn = null; });
  }
  return loggingIn;
}

async function doLogin() {
  const page = await fetch(BASE + LOGIN_PATH, { redirect: 'manual' });
  const html = await page.text();
  const t = html.match(/name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i) ||
            html.match(/value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i);
  if (!t) throw new Error('CSRFトークンを取得できません');

  let jar = mergeCookies('', setCookies(page.headers));

  const body = new URLSearchParams({ csrfmiddlewaretoken: t[1], username: USERNAME, password: PASSWORD, next: DATA_PATH });
  const res = await fetch(BASE + LOGIN_PATH, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: jar,
      referer: BASE + LOGIN_PATH,
      origin: BASE,
    },
    body: body.toString(),
  });
  await res.text();
  cookies = mergeCookies(jar, setCookies(res.headers));
}

function setCookies(headers) {
  const list = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  return list.map(c => c.split(';')[0]).join('; ');
}

function mergeCookies(a, b) {
  const map = {};
  [a, b].forEach(str => (str || '').split(';').forEach(part => {
    const p = part.trim();
    const i = p.indexOf('=');
    if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
  }));
  return Object.keys(map).map(k => k + '=' + map[k]).join('; ');
}


// ==============================
// HTMLの graphs_data から CH1 / CH2 の最新点を取り出す
// （Workers では new Function が使えないので文字列のまま読む）
// ==============================
function parse(html) {
  const g = html.search(/graphs_data\s*=/);
  if (g === -1) return null;
  const p1 = lastPoint(html, g, 'ch1_data');
  const p2 = lastPoint(html, g, 'ch2_data');
  if (!p1 || !p2) return null;
  return { xs: p1.xs, ms: toMs(p1.xs), p1: p1.ys, p2: p2.ys, server_ms: Date.now() };
}

// key: [ {...}, {...} ] の最後の {...} から xs と ys を読む
function lastPoint(html, from, key) {
  const k = html.indexOf(key, from);
  if (k === -1) return null;
  const open = html.indexOf('[', k);
  if (open === -1) return null;
  let depth = 0, close = -1, quote = '';
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { close = i; break; } }
  }
  if (close === -1) return null;
  const end = html.lastIndexOf('}', close);
  const start = html.lastIndexOf('{', end);
  if (start <= open) return null;
  const obj = html.slice(start, end + 1);
  const xs = obj.match(/["']?xs["']?\s*:\s*(?:["']([^"']*)["']|(-?[\d.]+))/);
  const ys = obj.match(/["']?ys["']?\s*:\s*["']?(-?[\d.]+(?:[eE][-+]?\d+)?)/);
  if (!xs || !ys) return null;
  const v = Number(ys[1]);
  if (isNaN(v)) return null;
  return { xs: xs[1] !== undefined ? xs[1] : Number(xs[2]), ys: v };
}

// 「10/28 18:37:28」（年なし）は日本時間の今年として読む
function toMs(xs) {
  if (xs === null || xs === undefined || xs === '') return null;
  if (typeof xs === 'number') return xs < 1e12 ? xs * 1000 : xs;
  const q = v => ('0' + v).slice(-2);
  const s = String(xs).trim();
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (md) {
    const now = Date.now();
    const y = new Date(now + 9 * 3600e3).getUTCFullYear();
    const mk = yy => Date.parse(yy + '-' + q(md[1]) + '-' + q(md[2]) + 'T' + q(md[3]) + ':' + md[4] + ':' + (md[5] || '00') + '+09:00');
    let t = mk(y);
    if (t > now + 864e5) t = mk(y - 1);
    return isNaN(t) ? null : t;
  }
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const ms = Date.parse(m ? m[1] + '-' + q(m[2]) + '-' + q(m[3]) + 'T' + q(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00' : s);
  return isNaN(ms) ? null : ms;
}


// ==============================
// ホーム画面用
// ==============================
function manifest() {
  return json({
    name: '電流ライブ', short_name: '電流', start_url: '/', display: 'standalone',
    background_color: '#0e1116', theme_color: '#0e1116',
    icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }],
  });
}

const ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAIAAACyr5FlAAACnElEQVR42u3dwU3DUBAE0NjK2cgX90E/KY9+qIUOaIADCHl3/+6bMxfM08xGEcl2nNdD5KfsHoHAIXAIHAKHwCFwCBwCh8AhcIjAIXDI//P0CH6fr4/3P/382+tTc5BhVmRSbcChNuAgAw6bAofagIMMOGwKHGoDDjLgkPabAofagIMMOGwKHGoDjtVkNKsNOAQOgwJHoox+mwKHwGFQ4MiS0XJT4BA4DAocKTK6bopZETgMChzxMhpvilkROAwKHMEyem+KWRE4DAockTLab4pZkfE4DAoccTImbIpZkcE4DAocoTKGbIpZkZE4DAoc0ZmzKW1xqA04omWMqg2zIpNwGBQ4EmRM2xSzIjNwGBQ4cmQM3BSzIt1xGBQ40mTM3BSzIn1xGBQ4MmWM3ZSHb6SuXE7pLnd/s5qp0Fg7GeLVitoYgMOgwEEGHOLmUBvL1cZKOMiAw8sTONSGm4OMdWvDrJCxMo7etVH8Ld+dDDEraqMRDoMCh0GBQ1arjaI4DAocZMAhbg610aw2auEgAw4vT+BQG24OMrrWhlkhozYOg1I223FeA39t/6FvVgwKHPVqo8enemgOgcOgwEEGHEUPjmYfIKY5BA6DAgcZcJABx1LXKBwypTbgIAMOgUNtwFHiGp3wbQqagww4BA61AUfawTHqi5s0BxlwCBxqAw4y4Ch2jcIhagMOMuAgAw6BI/AaHV4bmoMMOMiAQ+C49+BQG5qDDDjIgEPgUBtwhF+jZGgOgcOgwEEGHGTAkXeNiuZQG3CQAQcZcDg44FAbcJABh8ChNuDocY2SAYfOgEPgUBtwkAFH+DVKBhwCh0GBgww4bjw4yIBD4DAoedmO8/IUxKwIHAKHwCFwCBwCh8AhcAgcInAIHAKH3JVvEbjzqV8BXiIAAAAASUVORK5CYII=';

function icon() {
  const bin = Uint8Array.from(atob(ICON_B64), c => c.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
}


// ==============================
// モニター画面
// ==============================
const PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="電流">
<meta name="theme-color" content="#0e1116">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="manifest" href="/manifest.json">
<title>電流ライブ</title>
<style>
:root{--bg:#0e1116;--card:#181d25;--fg:#f2f5f8;--sub:#8d99a8;--line:#28303b;--c1:#4aa8ff;--c2:#ffb547;--warn:#6b4a00;--alarm:#7a1515;--ok:#3ecf7a;--ng:#ff5a5a;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg)}
body{font:15px/1.4 -apple-system,"Hiragino Sans",sans-serif;padding:calc(env(safe-area-inset-top) + 12px) max(14px,env(safe-area-inset-right)) calc(env(safe-area-inset-bottom) + 16px) max(14px,env(safe-area-inset-left));-webkit-text-size-adjust:100%}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;color:var(--sub);font-size:13px;min-height:22px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--sub);margin-right:6px;vertical-align:1px}
.dot.ok{background:var(--ok)}.dot.ng{background:var(--ng)}
.card{background:var(--card);border-radius:18px;padding:16px;margin-bottom:12px;text-align:center}
.main{transition:background .3s}.main.warn{background:var(--warn)}.main.alarm{background:var(--alarm)}
.lbl{font-size:15px;color:var(--sub)}.main .lbl{color:#d6dde5}
.big{font-size:68px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1;letter-spacing:-1px}
.mid{font-size:44px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.1}
.u{font-size:.45em;font-weight:600;margin-left:4px}
.w{color:var(--sub);font-size:16px;font-variant-numeric:tabular-nums}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.row .card{margin:0 0 12px}
.c1 .lbl{color:var(--c1)}.c2 .lbl{color:var(--c2)}
canvas{width:100%;height:150px;display:block}
.leg{display:flex;gap:14px;justify-content:center;font-size:12px;color:var(--sub);margin-top:6px}
.leg i{display:inline-block;width:12px;height:3px;vertical-align:3px;margin-right:4px}
.info{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px;color:var(--sub);text-align:left;font-variant-numeric:tabular-nums}
.info b{color:var(--fg);font-weight:600}.stale{color:var(--ng)!important}
.flash{animation:f .5s}@keyframes f{from{opacity:.55}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.flash{animation:none}}
</style></head><body>
<div class="top"><span><span id="dot" class="dot"></span><span id="st">接続中…</span></span></div>
<div id="main" class="card main"><div class="lbl">主幹電流（CH1/CH2の大きい方）</div><div class="big"><span id="m">--.--</span><span class="u">A</span></div><div class="w" id="mw">&nbsp;</div></div>
<div class="row"><div class="card c1"><div class="lbl">CH1</div><div class="mid"><span id="a1">--.--</span><span class="u">A</span></div><div class="w" id="w1">-- W</div></div>
<div class="card c2"><div class="lbl">CH2</div><div class="mid"><span id="a2">--.--</span><span class="u">A</span></div><div class="w" id="w2">-- W</div></div></div>
<div class="card"><canvas id="cv"></canvas><div class="leg"><span><i style="background:var(--c1)"></i>CH1</span><span><i style="background:var(--c2)"></i>CH2</span><span>直近3分・A</span></div></div>
<div class="card"><div class="info">
<span>データ時刻</span><b id="ts">--</b>
<span>データの遅れ</span><b id="lag">--</b>
<span>値の更新</span><b id="q">--</b>
<span>取得時間</span><b id="rt">--</b>
</div></div>
<script>
(function () {
  var VOLTAGE = ${VOLTAGE};
  var POLL_MS = 1000, TIMEOUT_MS = 8000, MAX_INFLIGHT = 3, HISTORY_SEC = 180;
  var $ = function (id) { return document.getElementById(id); };

  var lock = null;
  function keepAwake() {
    try { if (navigator.wakeLock && !lock) navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }, function () {}); } catch (e) {}
  }

  var latest = null, changedAt = 0, hist = [], lastRt = null, errCount = 0;

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
    var t1 = hist[hist.length - 1].t, t0 = t1 - HISTORY_SEC * 1000, mx = 0;
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

  // 1秒ごとに新しい取得を始める（前の取得の完了は待たない）
  var inflight = 0, seq = 0, shownSeq = 0;

  function fetchOnce() {
    var my = ++seq, st = Date.now();
    var ctl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    inflight++;
    fetch('/data?t=' + st, { cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error);
        lastRt = Date.now() - st;
        errCount = 0;
        setStatus('ライブ', 'ok');
        if (my < shownSeq) return;
        shownSeq = my;
        if (!latest || d.xs !== latest.xs) { changedAt = Date.now(); latest = d; show(d); }
      })
      .catch(function (e) {
        if (++errCount >= 3) setStatus('取得できません: ' + (e && e.message || e), 'ng');
      })
      .then(function () { clearTimeout(to); inflight--; });
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
</script>
</body></html>`;
