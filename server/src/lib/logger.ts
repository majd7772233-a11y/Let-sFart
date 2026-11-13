export type ServerLogEventName =
  | 'room_created'
  | 'player_joined'
  | 'round_started'
  | 'round_finished'
  | 'room_restarted'
  | 'host_migrated'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'player_expired'
  | 'room_closed'
  | 'security_rejected';

const REDACTED_KEYS = new Set([
  'resumeToken',
  'resume_token',
  'resumeTokenHash',
  'resume_token_hash',
  'sessionId',
  'session_id',
  'token',
  'secret',
  'password',
]);

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (REDACTED_KEYS.has(k)) continue;
    clean[k] = v;
  }
  return clean;
}

export function logServerEvent(
  event: ServerLogEventName,
  details: Record<string, unknown> = {},
): void {
  const entry = {
    level: event === 'security_rejected' ? 'warn' : 'info',
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeLogData(details),
  };
  if (entry.level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.info(JSON.stringify(entry));
  }
}
