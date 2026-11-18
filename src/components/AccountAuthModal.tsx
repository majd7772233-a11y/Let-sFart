import React, { useState } from 'react';

export type AccountAuthMode = 'login' | 'register' | 'link';

interface AccountAuthModalProps {
  mode: AccountAuthMode;
  currentDisplayName: string;
  isBusy: boolean;
  errorMsg: string | null;
  onChangeMode: (mode: AccountAuthMode) => void;
  onSubmitLogin: (username: string, password: string) => void;
  onSubmitRegister: (username: string, password: string, displayName: string) => void;
  onSubmitLink: (username: string, password: string, displayName: string) => void;
  onClose: () => void;
}

export const AccountAuthModal: React.FC<AccountAuthModalProps> = ({
  mode,
  currentDisplayName,
  isBusy,
  errorMsg,
  onChangeMode,
  onSubmitLogin,
  onSubmitRegister,
  onSubmitLink,
  onClose,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    if (mode === 'login') {
      onSubmitLogin(username, password);
    } else if (mode === 'register') {
      onSubmitRegister(username, password, displayName);
    } else {
      onSubmitLink(username, password, displayName);
    }
  };

  const title =
    mode === 'link'
      ? 'ربط حساب الضيف بحساب دائم'
      : mode === 'register'
        ? 'إنشاء حساب لاعب دائم'
        : 'تسجيل الدخول للحساب';

  const subtitle =
    mode === 'link'
      ? 'احتفظ بجميع نقاط الخبرة والمستوى والإنجازات وأفضل الأوقات في حساب دائم.'
      : mode === 'register'
        ? 'اختر اسم مستخدم وكلمة مرور لحفظ تقدمك عبر الأجهزة.'
        : 'أدخل اسم المستخدم وكلمة المرور لاسترجاع ملفك الشخصي وإحصائياتك.';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4 bg-[#071928]/75">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="account-auth-modal"
        className="wood-panel w-full max-w-md rounded-3xl p-5 sm:p-6 text-[#fff8e7] max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 border-b-2 border-[#f7d060]/30 pb-3 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-[#ffd13b] cartoon-outline-sm">
              {title}
            </h2>
            <p className="text-xs font-bold text-[#b8d8f8] mt-1">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="auth-close-btn"
            className="px-3 py-1.5 rounded-xl bg-[#102438] hover:bg-[#19334d] border border-[#2a4c6e] text-xs font-black text-[#cbd5e1] cursor-pointer whitespace-nowrap shrink-0"
          >
            إغلاق
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-[#0c1d2e] p-1.5 rounded-2xl border border-[#2a4c6e] mb-4">
          <button
            type="button"
            data-testid="auth-tab-login"
            onClick={() => onChangeMode('login')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap ${
              mode === 'login' ? 'bg-[#ffd13b] text-[#14222f]' : 'text-[#cbd5e1] hover:text-white'
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            data-testid="auth-tab-register"
            onClick={() => onChangeMode('register')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap ${
              mode === 'register' ? 'bg-[#ffd13b] text-[#14222f]' : 'text-[#cbd5e1] hover:text-white'
            }`}
          >
            حساب جديد
          </button>
          <button
            type="button"
            data-testid="auth-tab-link"
            onClick={() => onChangeMode('link')}
            className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-black cursor-pointer whitespace-nowrap ${
              mode === 'link' ? 'bg-[#06d6a0] text-[#082f49]' : 'text-[#cbd5e1] hover:text-white'
            }`}
          >
            ربط الضيف
          </button>
        </div>

        {errorMsg && (
          <div
            data-testid="auth-error-msg"
            className="mb-3 rounded-xl bg-[#ff595e]/20 border border-[#ff595e] px-3 py-2 text-xs font-bold text-[#ffb4b6]"
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-black text-[#93c5fd] mb-1">
              اسم المستخدم (إنجليزي وأرقام بدون مسافات)
            </label>
            <input
              type="text"
              dir="ltr"
              required
              minLength={3}
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="captain_hero"
              data-testid="auth-username-input"
              className="w-full rounded-xl bg-[#0c1d2e] border-2 border-[#2b4d6e] focus:border-[#ffd13b] outline-none px-3 py-2 text-sm font-bold text-white"
            />
          </div>

          {mode !== 'login' && (
            <div>
              <label className="block text-xs font-black text-[#93c5fd] mb-1">
                الاسم الظاهر داخل اللعبة
              </label>
              <input
                type="text"
                maxLength={18}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="قبطان فرفوش"
                data-testid="auth-displayname-input"
                className="w-full rounded-xl bg-[#0c1d2e] border-2 border-[#2b4d6e] focus:border-[#ffd13b] outline-none px-3 py-2 text-sm font-bold text-white"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-black text-[#93c5fd]">كلمة المرور (6 أحرف فأكثر)</label>
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-[11px] font-bold text-[#ffd13b] hover:underline cursor-pointer"
              >
                {showPassword ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              dir="ltr"
              required
              minLength={6}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              data-testid="auth-password-input"
              className="w-full rounded-xl bg-[#0c1d2e] border-2 border-[#2b4d6e] focus:border-[#ffd13b] outline-none px-3 py-2 text-sm font-bold text-white"
            />
          </div>

          <button
            type="submit"
            disabled={isBusy}
            data-testid="auth-submit-btn"
            className="wood-btn-primary w-full py-2.5 rounded-2xl text-sm sm:text-base font-black cursor-pointer disabled:opacity-60"
          >
            {isBusy
              ? 'جارٍ التنفيذ...'
              : mode === 'link'
                ? 'حفظ وربط الحساب الدائم'
                : mode === 'register'
                  ? 'إنشاء الحساب والبدء'
                  : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  );
};
