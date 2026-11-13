import type { ProtocolErrorCode, RoomErrorPayload } from '../../../src/shared/protocol.ts';

export const ERROR_MESSAGES_AR: Record<ProtocolErrorCode, string> = {
  UNSUPPORTED_PROTOCOL_VERSION: 'إصدار البروتوكول غير مدعوم.',
  INVALID_MESSAGE: 'صيغة الرسالة أو البيانات غير صالحة.',
  PAYLOAD_TOO_LARGE: 'حجم الرسالة يتجاوز الحد المسموح.',
  UNKNOWN_MESSAGE_TYPE: 'نوع الرسالة غير معروف.',
  RATE_LIMITED: 'تم تجاوز حد إرسال الطلبات، يرجى التمهل.',
  UNAUTHORIZED: 'يجب مصادقة الجلسة أولاً.',
  SESSION_EXPIRED: 'انتهت صلاحية الجلسة أو تم إبطالها.',
  SESSION_REPLACED: 'تم استبدال الجلسة باتصال جديد.',
  FORBIDDEN_HOST_ONLY: 'هذا الإجراء مسموح للمضيف فقط.',
  ROOM_NOT_FOUND: 'الغرفة غير موجودة أو انتهت صلاحيتها.',
  ROOM_CLOSED: 'الغرفة مغلقة ولا يمكن الانضمام إليها.',
  ROOM_FULL: 'الغرفة ممتلئة (4/4 لاعبين).',
  ROOM_ALREADY_EXISTS: 'رمز الغرفة مستخدم بالفعل.',
  INVALID_LIFECYCLE_STATE: 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية للغرفة.',
  PLAYERS_NOT_READY: 'لا يمكن بدء الجولة قبل أن يصبح جميع اللاعبين جاهزين.',
  STALE_INPUT_SEQ: 'رقم تسلسل الإدخال قديم.',
  INVALID_ROOM_CODE: 'رمز الغرفة غير صالح.',
  FORBIDDEN_ORIGIN: 'المصدر غير مصرح به للاتصال بالخادم.',
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
