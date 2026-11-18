import React, { useEffect } from 'react';

interface MoreMenuModalProps {
  isGuest: boolean;
  onOpenProfile: () => void;
  onOpenReplays?: () => void;
  onOpenOps?: () => void;
  onOpenSettings: () => void;
  onOpenAuth: () => void;
  onStartTutorial?: () => void;
  onStartPractice?: () => void;
  onClose: () => void;
}

export const MoreMenuModal: React.FC<MoreMenuModalProps> = ({
  isGuest,
  onOpenProfile,
  onOpenReplays,
  onOpenOps,
  onOpenSettings,
  onOpenAuth,
  onStartTutorial,
  onStartPractice,
  onClose,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items: {
    id: string;
    testId: string;
    icon: string;
    title: string;
    subtitle: string;
    onClick: () => void;
  }[] = [
    {
      id: 'profile',
      testId: 'open-profile-btn',
      icon: '👤',
      title: 'الملف الشخصي والإنجازات',
      subtitle: 'الإحصائيات التفصيلية، الأصدقاء، والأوسمة',
      onClick: () => {
        onClose();
        onOpenProfile();
      },
    },
    ...(onOpenReplays
      ? [
          {
            id: 'replays',
            testId: 'open-replays-btn',
            icon: '🎬',
            title: 'إعادة الجولات',
            subtitle: 'استعرض مسار الجولات السابقة والأحداث',
            onClick: () => {
              onClose();
              onOpenReplays();
            },
          },
        ]
      : []),
    ...(onStartTutorial
      ? [
          {
            id: 'tutorial',
            testId: 'start-tutorial-btn',
            icon: '🎓',
            title: 'تدريب تفاعلي للمبتدئين',
            subtitle: 'تعلم التوجيه والدفع والتوازن خطوة بخطوة',
            onClick: () => {
              onClose();
              onStartTutorial();
            },
          },
        ]
      : []),
    ...(onStartPractice
      ? [
          {
            id: 'practice',
            testId: 'start-practice-btn',
            icon: '🧪',
            title: 'ساحة التدريب الحرة',
            subtitle: 'جرّب الفيزياء والأدوات بدون وقت أو خسارة',
            onClick: () => {
              onClose();
              onStartPractice();
            },
          },
        ]
      : []),
    {
      id: 'settings',
      testId: 'more-open-settings-btn',
      icon: '⚙️',
      title: 'المظهر والإعدادات',
      subtitle: 'الصوت، الكاميرا، تخصيص أزرار اللمس، والمظهر',
      onClick: () => {
        onClose();
        onOpenSettings();
      },
    },
    {
      id: 'auth',
      testId: 'more-open-auth-btn',
      icon: '🔐',
      title: isGuest ? 'ربط / تسجيل الدخول' : 'إدارة الحساب الدائم',
      subtitle: 'احفظ تقدمك ومشترياتك عبر الأجهزة',
      onClick: () => {
        onClose();
        onOpenAuth();
      },
    },
    ...(onOpenOps
      ? [
          {
            id: 'ops',
            testId: 'open-ops-btn',
            icon: '📊',
            title: 'مراقبة السيرفر والتوازن',
            subtitle: 'صحة الخادم، البروتوكول، وتحليلات المسارات',
            onClick: () => {
              onClose();
              onOpenOps();
            },
          },
        ]
      : []),
  ];

  return (
    <div
      data-testid="more-menu-modal"
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-5 bg-[#071928]/82 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#0b1929] border-2 border-[#2a4c6e] w-full max-w-xl rounded-3xl text-[#fff8e7] max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#1d3955]">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-[#ffd13b]">المزيد والأدوات</h2>
            <p className="text-xs text-[#9cc6ee] mt-0.5">التدريب، الإعادات، الملف الشخصي، ومراقبة السيرفر</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#132940] hover:bg-[#1c3b5c] border border-[#2f567d] text-xs font-bold text-[#dbeafe] cursor-pointer"
          >
            إغلاق
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              onClick={item.onClick}
              className="text-right min-h-[68px] p-3.5 rounded-2xl bg-[#0f2236] hover:bg-[#15314d] border border-[#234363] hover:border-[#4b7eb0] transition-colors cursor-pointer flex items-start gap-3"
            >
              <span className="text-2xl leading-none mt-0.5 shrink-0" aria-hidden="true">
                {item.icon}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-black text-[#fff8e7] leading-snug">{item.title}</div>
                <div className="text-xs text-[#9cc6ee] leading-snug mt-0.5">{item.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
