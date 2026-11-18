import type { ProtocolErrorCode, RoomErrorPayload } from '../../../src/shared/protocol.ts';

export const ERROR_MESSAGES_AR: Record<ProtocolErrorCode, string> = {
  UNSUPPORTED_PROTOCOL_VERSION: 'إصدار البروتوكول غير مدعوم.',
  PROTOCOL_MISMATCH: 'إصدار اللعبة أو البروتوكول غير متوافق مع الخادم؛ يرجى تحديث الصفحة.',
  RESULT_VERIFICATION_FAILED: 'تعذر التحقق من صحة نتائج الجولة المرسلة.',
  INVALID_MESSAGE: 'صيغة الرسالة أو البيانات غير صالحة.',
  PAYLOAD_TOO_LARGE: 'حجم الرسالة يتجاوز الحد المسموح.',
  UNKNOWN_MESSAGE_TYPE: 'نوع الرسالة غير معروف.',
  RATE_LIMITED: 'تم تجاوز حد إرسال الطلبات، يرجى التمهل.',
  UNAUTHORIZED: 'يجب مصادقة الجلسة أولاً.',
  SESSION_EXPIRED: 'انتهت صلاحية الجلسة أو تم إبطالها.',
  SESSION_REPLACED: 'تم استبدال الجلسة باتصال جديد.',
  SESSION_ALREADY_ACTIVE: 'تم تفعيل هذه الجلسة بالفعل ولا يمكن إعادة إصدار رمزها عبر هذا الطلب.',
  FORBIDDEN_HOST_ONLY: 'هذا الإجراء مسموح للمضيف فقط.',
  SPECTATOR_FORBIDDEN: 'أنت في وضع المشاهد ولا يمكنك التحكم بالطوف في هذه الجولة.',
  ROOM_NOT_FOUND: 'الغرفة غير موجودة أو انتهت صلاحيتها.',
  ROOM_CLOSED: 'الغرفة مغلقة ولا يمكن الانضمام إليها.',
  ROOM_FULL: 'الغرفة ممتلئة (4/4 لاعبين).',
  ROOM_ALREADY_EXISTS: 'رمز الغرفة مستخدم بالفعل.',
  PARTY_NOT_FOUND: 'المجموعة غير موجودة أو انتهت صلاحيتها.',
  PARTY_FULL: 'المجموعة ممتلئة بالحد الأقصى (4 أعضاء).',
  INVALID_LIFECYCLE_STATE: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية للغرفة.',
  PLAYERS_NOT_READY: 'لا يمكن بدء الجولة قبل أن يصبح جميع اللاعبين جاهزين.',
  STALE_INPUT_SEQ: 'رقم تسلسل الإدخال قديم.',
  INVALID_ROOM_CODE: 'رمز الغرفة غير صالح.',
  INVALID_PASSWORD: 'كلمة مرور الغرفة غير صحيحة.',
  NO_PUBLIC_ROOMS_AVAILABLE: 'لا توجد غرف عامة متاحة حاليًا، يمكنك إنشاء غرفة جديدة!',
  USERNAME_TAKEN: 'اسم المستخدم مستخدم بالفعل، يرجى اختيار اسم آخر.',
  INVALID_CREDENTIALS: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  ACCOUNT_NOT_FOUND: 'لم يتم العثور على الحساب المطلوب.',
  ALREADY_LINKED: 'هذا الحساب مرتبط بالفعل باسم مستخدم دائم.',
  FORBIDDEN_ORIGIN: 'المصدر غير مصرح به للاتصال بالخادم.',
  INSUFFICIENT_COINS: 'رصيد العملات الذهبية لا يكفي لفتح هذا العنصر.',
  ITEM_NOT_FOUND: 'العنصر التجميلي المطلوب غير موجود.',
  ITEM_ALREADY_OWNED: 'تم فتح هذا العنصر التجميلي مسبقًا.',
  ITEM_NOT_OWNED: 'يجب فتح هذا العنصر التجميلي قبل تجهيزه.',
  QUEST_NOT_READY: 'لم تكتمل شروط استلام هذه المكافأة بعد.',
  ALREADY_CLAIMED: 'تم استلام هذه المكافأة مسبقًا.',
  INTERNAL_ERROR: 'حدث خطأ داخلي في الخادم.',
};

export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;
  public readonly httpStatus: number;
  public readonly command?: string;

  constructor(code: ProtocolErrorCode, message?: string, httpStatus = 400, command?: string) {
    super(message ?? ERROR_MESSAGES_AR[code]);
    this.code = code;
    this.httpStatus = httpStatus;
    this.command = command;
  }

  public toPayload(): RoomErrorPayload {
    return this.command
      ? { code: this.code, message: this.message, command: this.command }
      : { code: this.code, message: this.message };
  }
}

export function makeErrorPayload(
  code: ProtocolErrorCode,
  message?: string,
  command?: string,
): RoomErrorPayload {
  return command
    ? { code, message: message ?? ERROR_MESSAGES_AR[code], command }
    : { code, message: message ?? ERROR_MESSAGES_AR[code] };
}
