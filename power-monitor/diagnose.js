// Informetis のグラフ画面（/pro/MACアドレス/）を開いた状態で実行する診断スクリプト
// 60秒間、画面が裏でどこからデータを取っているか・データ自体がどれだけ遅れているかを記録して、結果を表示する
(function () {
  var WATCH_SEC = 60;
  var t0 = Date.now();
  var log = [];        // 通信の記録
  var changes = [];    // graphs_data の最新点が変わった記録
  var lines = [];

  function sec(ms) { return (ms / 1000).toFixed(1) + '秒'; }
  function at() { return '+' + sec(Date.now() - t0); }
  function cut(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…(' + s.length + '文字)' : s; }

  function toMs(xs) {
    if (xs === null || xs === undefined || xs === '') return null;
    if (typeof xs === 'number' || /^\d+(\.\d+)?$/.test(String(xs))) { var n = Number(xs); return n < 1e12 ? n * 1000 : n; }
    var s = String(xs).trim();
    var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      var p = function (v) { return ('0' + v).slice(-2); };
      s = m[1] + '-' + p(m[2]) + '-' + p(m[3]) + 'T' + p(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00';
    }
    var ms = Date.parse(s);
    return isNaN(ms) ? null : ms;
  }

  function lastPoint() {
    try {
      var d = window.graphs_data && graphs_data.ch_data;
      if (!d) return null;
      var c1 = d.ch1_data || [], c2 = d.ch2_data || [];
      if (!c1.length) return null;
      return { xs: c1[c1.length - 1].xs, ys1: c1[c1.length - 1].ys, ys2: c2.length ? c2[c2.length - 1].ys : null, n: c1.length, prev: c1.length > 1 ? c1[c1.length - 2].xs : null };
    } catch (e) { return null; }
  }

  // ---- 1. 今の graphs_data の状態 ----
  lines.push('■ 診断 ' + new Date().toString());
  lines.push('URL: ' + location.href);
  var lp = lastPoint();
  if (!lp) {
    lines.push('graphs_data.ch_data が見つかりません（グラフ画面で実行してください）');
  } else {
    var ms = toMs(lp.xs), pms = toMs(lp.prev);
    lines.push('点の数: ' + lp.n);
    lines.push('最新点 xs の生の値: ' + JSON.stringify(lp.xs) + ' / CH1=' + lp.ys1 + 'W CH2=' + lp.ys2 + 'W');
    lines.push('1つ前の点 xs: ' + JSON.stringify(lp.prev));
    if (ms !== null) lines.push('最新点の遅れ（今 − 最新点の時刻）: ' + sec(Date.now() - ms));
    if (ms !== null && pms !== null) lines.push('点と点の間隔: ' + sec(ms - pms));
    try {
      var keys = Object.keys(graphs_data);
      lines.push('graphs_data のキー: ' + keys.join(', '));
      lines.push('ch_data のキー: ' + Object.keys(graphs_data.ch_data).join(', '));
      lines.push('ch1_data[最後] の中身: ' + cut(JSON.stringify(graphs_data.ch_data.ch1_data[graphs_data.ch_data.ch1_data.length - 1]), 300));
    } catch (e) {}
  }

  // ---- 2. ページ読み込みから今までの通信（ブラウザの記録） ----
  lines.push('');
  lines.push('■ これまでの通信（画像・CSS・フォントは除く）');
  try {
    performance.getEntriesByType('resource').forEach(function (r) {
      if (/\.(png|jpe?g|gif|svg|ico|css|woff2?|ttf)(\?|$)/i.test(r.name)) return;
      lines.push('[' + r.initiatorType + '] ' + r.name + '  ' + Math.round(r.duration) + 'ms');
    });
  } catch (e) { lines.push('取得不可: ' + e); }

  // ---- 3. ページ内スクリプトから更新処理らしき箇所を抜き出す ----
  lines.push('');
  lines.push('■ ページ内スクリプトの手がかり');
  var pat = /(setInterval|setTimeout|location\.reload|WebSocket|EventSource|socket\.io|\$\.ajax|\$\.get|\$\.post|\$\.getJSON|fetch\(|XMLHttpRequest|\/api\/|graphs_data\s*=|\.json)/g;
  var found = 0;
  [].forEach.call(document.scripts, function (s, i) {
    if (s.src) { lines.push('外部スクリプト: ' + s.src); return; }
    var t = s.textContent, m;
    pat.lastIndex = 0;
    while ((m = pat.exec(t)) && found < 40) {
      found++;
      var a = Math.max(0, m.index - 120), b = Math.min(t.length, m.index + 200);
      lines.push('--- script#' + i + ' 「' + m[1] + '」付近:');
      lines.push(t.slice(a, b).replace(/\s+/g, ' '));
    }
  });
  var meta = document.querySelector('meta[http-equiv="refresh" i]');
  if (meta) lines.push('meta refresh: ' + meta.content);

  // ---- 4. これから60秒間の通信を横取りして記録 ----
  var of = window.fetch;
  if (of) window.fetch = function (u, o) {
    var url = typeof u === 'string' ? u : (u && u.url), st = Date.now();
    return of.apply(this, arguments).then(function (res) {
      res.clone().text().then(function (b) { log.push(at() + ' fetch ' + ((o && o.method) || 'GET') + ' ' + url + ' → ' + res.status + ' ' + (Date.now() - st) + 'ms 内容: ' + cut(b, 400)); });
      return res;
    });
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__d = { m: m, u: u }; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var x = this, st = Date.now();
    x.addEventListener('loadend', function () {
      var b = ''; try { b = x.responseText; } catch (e) { b = '(' + x.responseType + ')'; }
      log.push(at() + ' XHR ' + (x.__d && x.__d.m) + ' ' + (x.__d && x.__d.u) + ' → ' + x.status + ' ' + (Date.now() - st) + 'ms 内容: ' + cut(b, 400));
    });
    return os.apply(this, arguments);
  };
  var OW = window.WebSocket;
  if (OW) window.WebSocket = function (u, p) {
    var ws = p ? new OW(u, p) : new OW(u);
    log.push(at() + ' WebSocket 接続: ' + u);
    ws.addEventListener('message', function (e) { log.push(at() + ' WebSocket 受信: ' + cut(e.data, 400)); });
    return ws;
  };

  // graphs_data の最新点が変わったタイミングを1秒ごとに確認
  var lastXs = lp ? lp.xs : null;
  var iv = setInterval(function () {
    var p = lastPoint();
    if (p && p.xs !== lastXs) {
      var ms = toMs(p.xs);
      changes.push(at() + ' 最新点が更新 xs=' + JSON.stringify(p.xs) + ' CH1=' + p.ys1 + 'W CH2=' + p.ys2 + 'W' + (ms !== null ? ' 遅れ=' + sec(Date.now() - ms) : ''));
      lastXs = p.xs;
    }
  }, 1000);

  // 進み具合の表示
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;background:#111;color:#fff;padding:12px;border-radius:10px;font:14px/1.5 sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.5)';
  document.body.appendChild(box);
  var cd = setInterval(function () {
    var left = WATCH_SEC - Math.floor((Date.now() - t0) / 1000);
    box.textContent = '診断中… 残り' + left + '秒（このまま画面を開いておいてください）  通信' + log.length + '件 / 更新' + changes.length + '回';
  }, 500);

  setTimeout(function () {
    clearInterval(iv); clearInterval(cd);
    lines.push('');
    lines.push('■ ' + WATCH_SEC + '秒間の通信');
    lines.push(log.length ? log.join('\n') : '（なし）');
    lines.push('');
    lines.push('■ ' + WATCH_SEC + '秒間の graphs_data の更新');
    lines.push(changes.length ? changes.join('\n') : '（変化なし）');

    var text = lines.join('\n');
    box.innerHTML = '';
    box.style.top = '8px';
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'width:100%;height:calc(100% - 50px);font:12px monospace;color:#000;background:#fff';
    var btn = document.createElement('button');
    btn.textContent = '結果をコピー';
    btn.style.cssText = 'margin-top:8px;padding:10px 16px;font-size:16px';
    btn.onclick = function () {
      ta.select();
      try { navigator.clipboard.writeText(text).then(function () { btn.textContent = 'コピーしました'; }, function () { document.execCommand('copy'); btn.textContent = 'コピーしました'; }); }
      catch (e) { document.execCommand('copy'); btn.textContent = 'コピーしました'; }
    };
    var close = document.createElement('button');
    close.textContent = '閉じる';
    close.style.cssText = 'margin:8px 0 0 8px;padding:10px 16px;font-size:16px';
    close.onclick = function () { box.remove(); };
    box.appendChild(ta); box.appendChild(btn); box.appendChild(close);
  }, WATCH_SEC * 1000);
})();
