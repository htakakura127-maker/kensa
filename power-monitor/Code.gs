const LOGIN_URL = 'https://installer-ep.egvw.informetis.com/accounts/login/';
const DATA_URL  = 'https://installer.egvw.informetis.com/pro/707414FFFE783CDC/';

const USERNAME = 'informetis';
const PASSWORD = 'informetis1228';

const VOLTAGE = 100;

// ログイン後のCookieを使い回す時間（秒）。CacheServiceの上限は6時間
const COOKIE_CACHE_KEY = 'informetis_cookies';
const COOKIE_CACHE_SEC = 6 * 60 * 60;

// 複数の画面で同時に開いたとき、この時間内なら取得結果を共有する（ミリ秒）
const RESULT_CACHE_KEY = 'informetis_latest';
const RESULT_SHARE_MS  = 900;


// ==============================
// iPhoneから呼ばれるAPI
// ==============================
function doGet(e) {

  // ?view=monitor の場合はモニター画面を表示
  if (e && e.parameter && e.parameter.view === 'monitor') {
    return HtmlService
      .createHtmlOutputFromFile('Monitor')
      .setTitle('電流モニター')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 通常はJSON API
  let data;
  try {
    data = getInformetisData();
  } catch (err) {
    data = { ok: false, error: String(err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ==============================
// Informetisからデータ取得
// ==============================
function getInformetisData() {

  const cache = CacheService.getScriptCache();

  // 直前に他の画面が取得した結果があればそれを返す（通信しない）
  const shared = cache.get(RESULT_CACHE_KEY);
  if (shared) {
    const s = JSON.parse(shared);
    if (Date.now() - s.server_ms < RESULT_SHARE_MS) {
      return withAge(s);
    }
  }

  // ----------------------------
  // 1. 保存済みCookieでデータページを取得（通常はこの1回の通信だけ）
  // ----------------------------
  let cookies = cache.get(COOKIE_CACHE_KEY);
  let html = cookies ? fetchDataPage(cookies) : null;

  // ----------------------------
  // 2. Cookieが無い・期限切れのときだけログインし直す
  // ----------------------------
  if (!html || isLoginPage(html)) {
    cookies = login();
    cache.put(COOKIE_CACHE_KEY, cookies, COOKIE_CACHE_SEC);
    html = fetchDataPage(cookies);

    if (isLoginPage(html)) {
      cache.remove(COOKIE_CACHE_KEY);
      throw new Error('Informetisへのログインに失敗しました');
    }
  }

  // ----------------------------
  // 3. graphs_dataを取得
  // ----------------------------
  const graphsData = extractGraphsData(html);

  if (!graphsData || !graphsData.ch_data) {
    throw new Error('graphs_data.ch_dataが見つかりません');
  }

  const ch1 = graphsData.ch_data.ch1_data || [];
  const ch2 = graphsData.ch_data.ch2_data || [];

  if (ch1.length === 0) {
    throw new Error('CH1データがありません');
  }

  if (ch2.length === 0) {
    throw new Error('CH2データがありません');
  }


  // ----------------------------
  // 最新データ
  // ----------------------------
  const latest1 = ch1[ch1.length - 1];
  const latest2 = ch2[ch2.length - 1];

  const power1 = Number(latest1.ys);
  const power2 = Number(latest2.ys);

  if (isNaN(power1) || isNaN(power2)) {
    throw new Error('CH1/CH2の電力値が数値ではありません');
  }


  // ----------------------------
  // 電流値
  // ----------------------------
  const current1 = power1 / VOLTAGE;
  const current2 = power2 / VOLTAGE;

  // ★ 主幹電流（CH1とCH2の大きい方）
  const mainCurrent = Math.max(current1, current2);


  const sourceMs = toMs(latest1.xs);


  // ----------------------------
  // 4. JSONを作成
  // ----------------------------
  const result = {

    ok: true,

    // GASで取得した時刻
    fetched_at:
      Utilities.formatDate(
        new Date(),
        'Asia/Tokyo',
        'yyyy-MM-dd HH:mm:ss'
      ),
    server_ms: Date.now(),

    // Informetis側のデータ時刻
    source_time_ch1: latest1.xs,
    source_time_ch2: latest2.xs,
    source_ms: sourceMs,

    ch1: {
      power: power1,
      current: current1
    },

    ch2: {
      power: power2,
      current: current2
    },

    main_current: mainCurrent,

    // ★ 20A超過 / 25A超過
    alarm_20a: mainCurrent > 20,
    alarm_25a: mainCurrent > 25,

    voltage: VOLTAGE

  };

  cache.put(RESULT_CACHE_KEY, JSON.stringify(result), 10);

  return withAge(result);
}


// ==============================
// データの遅れ（今 − データ時刻）を付ける
// ==============================
function withAge(result) {
  result.age_ms = result.source_ms === null ? null : Date.now() - result.source_ms;
  return result;
}


// ==============================
// データページ取得
// ==============================
function fetchDataPage(cookies) {

  const res = UrlFetchApp.fetch(DATA_URL, {
    method: 'get',
    followRedirects: true,
    muteHttpExceptions: true,
    headers: {
      'Cookie': cookies
    }
  });

  return res.getContentText();
}


// ==============================
// ログインページに戻されたか
// ==============================
function isLoginPage(html) {
  return (
    html.indexOf('name="username"') !== -1 &&
    html.indexOf('name="password"') !== -1
  );
}


// ==============================
// ログインしてCookieを返す
// ==============================
function login() {

  // ログインページGET
  const loginPage = UrlFetchApp.fetch(LOGIN_URL, {
    method: 'get',
    followRedirects: false,
    muteHttpExceptions: true
  });

  const loginHtml = loginPage.getContentText();

  // CSRFトークン取得
  const csrfMatch =
    loginHtml.match(
      /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i
    );

  if (!csrfMatch) {
    throw new Error('CSRFトークンを取得できません');
  }

  const csrfToken = csrfMatch[1];

  let cookies = getCookies(loginPage.getAllHeaders());

  // ログインPOST
  const loginResponse = UrlFetchApp.fetch(LOGIN_URL, {
    method: 'post',
    followRedirects: false,
    muteHttpExceptions: true,
    headers: {
      'Cookie': cookies
    },
    payload: {
      csrfmiddlewaretoken: csrfToken,
      username: USERNAME,
      password: PASSWORD,
      next: ''
    }
  });

  // ログインPOST後のCookieを追加
  return mergeCookies(cookies, getCookies(loginResponse.getAllHeaders()));
}


// ==============================
// xs（データ時刻）をミリ秒に変換
// ==============================
function toMs(xs) {

  if (xs === null || xs === undefined || xs === '') return null;

  // 数値：10桁なら秒、13桁ならミリ秒
  if (typeof xs === 'number' || /^\d+(\.\d+)?$/.test(String(xs))) {
    const n = Number(xs);
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }

  let s = String(xs).trim();

  // 年の無い「MM/dd HH:mm(:ss)」は今年の日本時間として扱う（年をまたいだ直後は去年）
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (md) {
    const p2 = n => ('0' + n).slice(-2);
    const year = Number(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy'));
    const build = y => Date.parse(y + '-' + p2(md[1]) + '-' + p2(md[2]) + 'T' + p2(md[3]) + ':' + md[4] + ':' + (md[5] || '00') + '+09:00');
    let ms = build(year);
    if (ms > Date.now() + 24 * 60 * 60 * 1000) ms = build(year - 1);
    return isNaN(ms) ? null : ms;
  }

  // タイムゾーン無しの「yyyy-MM-dd HH:mm(:ss)」は日本時間として扱う
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    const p = n => ('0' + n).slice(-2);
    s = m[1] + '-' + p(m[2]) + '-' + p(m[3]) + 'T' + p(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+09:00';
  }

  const ms = Date.parse(s);
  return isNaN(ms) ? null : ms;
}


// ==============================
// HTMLからgraphs_dataを抽出
// ==============================
function extractGraphsData(html) {

  // graphs_data = {...}; を探す
  const match = html.match(
    /(?:var\s+)?graphs_data\s*=\s*(\{[\s\S]*?\});/
  );

  if (!match) {
    throw new Error('graphs_dataがHTML内に見つかりません');
  }

  const jsObject = match[1];

  try {

    // JavaScriptとしてオブジェクトを評価する
    const fn = new Function(
      'return (' + jsObject + ');'
    );

    return fn();

  } catch (e) {

    throw new Error(
      'graphs_dataのJavaScript解析に失敗しました: ' + e
    );
  }
}


// ==============================
// Set-Cookie取得
// ==============================
function getCookies(headers) {

  const setCookie = headers['Set-Cookie'];

  if (!setCookie) {
    return '';
  }

  const arr = Array.isArray(setCookie)
    ? setCookie
    : [setCookie];

  return arr
    .map(function(cookie) {
      return cookie.split(';')[0];
    })
    .join('; ');
}


// ==============================
// Cookieを統合
// ==============================
function mergeCookies(oldCookies, newCookies) {

  const map = {};

  function addCookies(str) {

    if (!str) return;

    str.split(';').forEach(function(part) {

      const p = part.trim();

      if (!p) return;

      const index = p.indexOf('=');

      if (index === -1) return;

      map[p.substring(0, index)] = p.substring(index + 1);
    });
  }

  addCookies(oldCookies);
  addCookies(newCookies);

  return Object.keys(map)
    .map(function(name) {
      return name + '=' + map[name];
    })
    .join('; ');
}
