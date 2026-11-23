// 通知のベル（F41）：ブラウザの通知を、オン・オフする。既定はオフ。オンにする押下で、許可を求める（`Notification.requestPermission()`）。
// 使えない（API がない）・ブロックされている（denied）ときは、押せない（理由は、title・aria-label）。許可が granted でなければ、保存がオンでも、オフとして扱う。
import { Bell, BellOff, BellRing } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Permission, permissionNow, requestPermission } from '../lib/notify';
import { useUi } from '../store/ui';

const UNSUPPORTED = 'このブラウザでは通知が使えません';
const BLOCKED = '通知がブロックされています。ブラウザの設定で許可してください';

export function NotifyBell() {
  const saved = useUi((s) => s.ui.notify);
  const [permission, setPermission] = useState<Permission>(permissionNow);

  // 許可は、ブラウザの設定で変わる：画面に戻ったとき・許可の変更の通知で、読み直す
  useEffect(() => {
    const refresh = (): void => setPermission(permissionNow());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    let status: PermissionStatus | null = null;
    let live = true;
    navigator.permissions
      ?.query({ name: 'notifications' })
      .then((s) => {
        if (!live) return;
        status = s;
        s.onchange = refresh;
      })
      .catch(() => {});
    return () => {
      live = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      if (status) status.onchange = null;
    };
  }, []);

  const on = saved && permission === 'granted';
  const disabled = permission === 'unsupported' || permission === 'denied';
  const label = disabled
    ? permission === 'unsupported'
      ? UNSUPPORTED
      : BLOCKED
    : on
      ? '通知：オン。押すと、オフにします（画面が前面にないとき、AI の返信などを、通知します）'
      : '通知：オフ。押すと、オンにします（画面が前面にないとき、AI の返信などを、通知します）';
  const Icon = disabled ? BellOff : on ? BellRing : Bell;

  const toggle = async (): Promise<void> => {
    if (on) return useUi.getState().setNotify(false);
    let p = permissionNow();
    if (p === 'default') {
      p = await requestPermission(); // 新しい形（Promise）・古い形（コールバック）の両方
      setPermission(permissionNow() === 'unsupported' ? p : permissionNow());
    }
    if (p === 'granted') useUi.getState().setNotify(true); // 拒否されたら、オフのまま
  };

  return (
    <button
      id="btn-notify"
      type="button"
      className="iconbtn"
      title={label}
      aria-label={label}
      aria-pressed={disabled ? undefined : on}
      data-notify={disabled ? 'disabled' : on ? 'on' : 'off'}
      disabled={disabled}
      onClick={() => void toggle()}
    >
      <Icon aria-hidden="true" focusable="false" />
    </button>
  );
}
