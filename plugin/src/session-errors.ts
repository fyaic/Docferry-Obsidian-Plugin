const NON_TERMINAL_UNAUTHORIZED_CODES = new Set([
  "auth_code_consumed",
  "auth_code_expired",
  "invalid_auth_code",
  "invalid_auth_redirect",
  "invalid_auth_state",
  "password_required",
  "synapsehub_user_session_required"
]);

export function isInvalidProductSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = "status" in error ? error.status : undefined;
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return status === 401 && !NON_TERMINAL_UNAUTHORIZED_CODES.has(code ?? "");
}
