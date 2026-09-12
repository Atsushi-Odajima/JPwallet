/*!
 * payCcount pay.js（デモ）— 「payCcountで支払う」ボタンを描画する軽量スクリプト
 *
 *   <script src="https://{{app_domain}}/sdk/pay.js" data-session="cs_..."></script>
 *
 * 属性:
 *   data-session  Checkout Session の ID（必須）。加盟店サーバーが POST /v1/checkout/sessions で作成したもの
 *   data-app-url  ウォレットアプリの URL（省略時はこのスクリプトの配信元）
 *   data-label    ボタンの文言（省略時: 日本語なら「payCcountで支払う」、それ以外は "Pay with payCcount"）
 *   data-lang     ja | en。Checkout ページの言語（省略時はページの lang / ブラウザ言語）
 *   data-class    独自の class 名（指定するとデフォルトスタイルを付けない）
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var session = script.getAttribute('data-session');
  if (!session) {
    console.warn('[payCcount] data-session がありません');
    return;
  }
  var appUrl = script.getAttribute('data-app-url');
  if (!appUrl) {
    try {
      appUrl = new URL(script.src).origin;
    } catch (e) {
      appUrl = window.location.origin;
    }
  }
  var lang = script.getAttribute('data-lang');
  var pageLang = (lang || document.documentElement.lang || navigator.language || 'ja').toLowerCase();
  var isJa = pageLang.indexOf('ja') === 0;
  var url = /^https?:\/\//.test(session) ? session : appUrl.replace(/\/$/, '') + '/checkout/' + encodeURIComponent(session);
  if (lang === 'ja' || lang === 'en') url += (url.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + lang;

  var btn = document.createElement('button');
  btn.type = 'button';
  var custom = script.getAttribute('data-class');
  if (custom) {
    btn.className = custom;
  } else {
    btn.className = 'payccount-pay-button';
    btn.style.cssText =
      'display:inline-flex;align-items:center;gap:8px;background:#1e3a8a;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.15)';
    btn.onmouseenter = function () {
      btn.style.background = '#312e81';
    };
    btn.onmouseleave = function () {
      btn.style.background = '#1e3a8a';
    };
  }
  var icon = document.createElement('span');
  icon.textContent = 'P';
  icon.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#fff;color:#1e3a8a;font-weight:800;font-size:14px';
  btn.appendChild(icon);
  btn.appendChild(document.createTextNode(script.getAttribute('data-label') || (isJa ? 'payCcountで支払う' : 'Pay with payCcount')));
  btn.setAttribute('data-payccount-session', session);
  btn.addEventListener('click', function () {
    window.location.assign(url);
  });
  script.parentNode.insertBefore(btn, script);
})();
