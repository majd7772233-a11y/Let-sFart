export function generatePlayerId(): string {
  return crypto.randomUUID();
}

export function generateSessionId(): string {
  return crypto.randomUUID();
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}
