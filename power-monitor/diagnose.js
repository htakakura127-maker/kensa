// Informetis のグラフ画面（/pro/MACアドレス/）を開いた状態で実行する診断スクリプト
// 画面の自動更新を止め、同じページを1秒ごとに裏で取り直して、
// データの最新点がいつ変わるか・データ自体がどれだけ遅れているか・1回の取得に何秒かかるかを60秒間記録する
(function () {
  var WATCH_SEC = 60;
  var POLL_MS = 1000;
  var t0 = Date.now();
  var lines = [];
  var url = location.href;

  // ---- 自動更新を止める（setTimeout / setInterval を全部解除）----
  var maxId = setTimeout(function () {}, 0);
  for (var i = 0; i <= maxId + 1000; i++) { clearTimeout(i); clearInterval(i); }
  try { window.stop(); } catch (e) {}

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

  function lastPoint(g) {
    try {
      var d = g && g.ch_data;
      if (!d) return null;
      var c1 = d.ch1_data || [], c2 = d.ch2_data || [];
      if (!c1.length) return null;
      return { xs: c1[c1.length - 1].xs, ys1: c1[c1.length - 1].ys, ys2: c2.length ? c2[c2.length - 1].ys : null, n: c1.length, prev: c1.length > 1 ? c1[c1.length - 2].xs : null };
    } catch (e) { return null; }
  }

  function parseGraphs(html) {
    var m = html.match(/(?:var\s+)?graphs_data\s*=\s*(\{[\s\S]*?\});/);
    if (!m) return null;
    try { return new Function('return (' + m[1] + ');')(); } catch (e) { return null; }
  }

  // ---- 1. 今の graphs_data の状態 ----
  lines.push('■ 診断 ' + new Date().toString());
  lines.push('URL: ' + url);
  var lp = lastPoint(window.graphs_data);
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
      lines.push('graphs_data のキー: ' + Object.keys(graphs_data).join(', '));
      lines.push('ch_data のキー: ' + Object.keys(graphs_data.ch_data).join(', '));
      lines.push('ch1_data[最後] の中身: ' + cut(JSON.stringify(graphs_data.ch_data.ch1_data[graphs_data.ch_data.ch1_data.length - 1]), 300));
    } catch (e) {}
  }

  // ---- 2. ページ読み込みから今までの通信 ----
  lines.push('');
  lines.push('■ これまでの通信（画像・CSS・フォントは除く）');
  try {
    performance.getEntriesByType('resource').forEach(function (r) {
      if (/\.(png|jpe?g|gif|svg|ico|css|woff2?|ttf)(\?|$)/i.test(r.name)) return;
      lines.push('[' + r.initiatorType + '] ' + r.name + '  ' + Math.round(r.duration) + 'ms');
    });
    var nav = performance.getEntriesByType('navigation')[0];
    if (nav) lines.push('このページ自体の読み込み: ' + Math.round(nav.responseEnd - nav.requestStart) + 'ms（' + nav.type + '）');
  } catch (e) { lines.push('取得不可: ' + e); }

  // ---- 3. 自動更新とデータ取得の手がかり ----
  lines.push('');
  lines.push('■ 自動更新・データ取得の手がかり');
  var meta = document.querySelector('meta[http-equiv="refresh" i]');
  lines.push('meta refresh: ' + (meta ? meta.content : 'なし'));
  var pat = /(setInterval|setTimeout|location\.reload|location\.href\s*=|WebSocket|EventSource|socket\.io|\$\.ajax|\$\.get|\$\.post|\$\.getJSON|fetch\(|XMLHttpRequest|\/api\/|\.json)/g;
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

  // ---- 画面を診断画面に置き換える（meta refresh もこれで止まる）----
  document.open();
  document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>診断中</title>' +
    '<body style="margin:0;padding:16px;background:#111;color:#fff;font:15px/1.5 -apple-system,sans-serif">' +
    '<div id="st">診断中…</div><div id="ls" style="margin-top:8px;font:12px/1.5 monospace;color:#aaa;white-space:pre-wrap"></div>' +
    '<textarea id="ta" style="display:none;width:100%;height:60vh;font:12px monospace;color:#000;background:#fff"></textarea>' +
    '<button id="cp" style="display:none;margin-top:8px;padding:12px 18px;font-size:17px">結果をコピー</button>' +
    '<button id="bk" style="display:none;margin:8px 0 0 8px;padding:12px 18px;font-size:17px">グラフ画面に戻る</button></body>');
  document.close();

  // ---- 4. 同じページを1秒ごとに取り直して、最新点が変わるタイミングを測る ----
  var polls = [], changes = [];
  var lastXs = lp ? lp.xs : null;
  var busy = false;

  function poll() {
    if (busy) return;
    busy = true;
    var st = Date.now();
    fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      return res.text().then(function (html) {
        var took = Date.now() - st;
        var p = lastPoint(parseGraphs(html));
        var login = html.indexOf('name="password"') !== -1;
        polls.push(took);
        if (login) {
          changes.push(at() + ' ログイン画面が返ってきました（ログインが切れています）');
        } else if (!p) {
          changes.push(at() + ' graphs_data を読めませんでした（' + res.status + ', ' + html.length + '文字）');
        } else if (p.xs !== lastXs) {
          var ms = toMs(p.xs);
          changes.push(at() + ' 最新点が更新 xs=' + JSON.stringify(p.xs) + ' CH1=' + p.ys1 + 'W CH2=' + p.ys2 + 'W' +
            (ms !== null ? ' 遅れ=' + sec(Date.now() - ms) : '') + ' 取得' + took + 'ms');
          lastXs = p.xs;
        }
        document.getElementById('ls').textContent = changes.slice(-12).join('\n');
      });
    }).catch(function (e) {
      changes.push(at() + ' 取得失敗: ' + e);
    }).then(function () { busy = false; });
  }

  poll();
  var iv = setInterval(poll, POLL_MS);
  var cd = setInterval(function () {
    var left = WATCH_SEC - Math.floor((Date.now() - t0) / 1000);
    document.getElementById('st').textContent = '診断中… 残り' + left + '秒（このまま画面を開いておいてください）  取得' + polls.length + '回 / 更新' + changes.length + '回';
  }, 500);

  setTimeout(function () {
    clearInterval(iv); clearInterval(cd);
    lines.push('');
    lines.push('■ ' + WATCH_SEC + '秒間、' + (POLL_MS / 1000) + '秒ごとにページを取り直した結果');
    if (polls.length) {
      var sorted = polls.slice().sort(function (a, b) { return a - b; });
      lines.push('取得回数: ' + polls.length + ' / 1回の取得時間 最短' + sorted[0] + 'ms 中央' + sorted[Math.floor(sorted.length / 2)] + 'ms 最長' + sorted[sorted.length - 1] + 'ms');
    }
    lines.push(changes.length ? changes.join('\n') : '（最新点の変化なし）');

    var text = lines.join('\n');
    document.getElementById('st').textContent = '診断が終わりました。「結果をコピー」を押して貼り付けてください。';
    document.getElementById('ls').style.display = 'none';
    var ta = document.getElementById('ta'), cp = document.getElementById('cp'), bk = document.getElementById('bk');
    ta.value = text;
    ta.style.display = cp.style.display = bk.style.display = 'block';
    bk.style.display = 'inline-block'; cp.style.display = 'inline-block';
    cp.onclick = function () {
      ta.focus(); ta.select();
      try { navigator.clipboard.writeText(text).then(function () { cp.textContent = 'コピーしました'; }, function () { document.execCommand('copy'); cp.textContent = 'コピーしました'; }); }
      catch (e) { document.execCommand('copy'); cp.textContent = 'コピーしました'; }
    };
    bk.onclick = function () { location.href = url; };
  }, WATCH_SEC * 1000);
})();
