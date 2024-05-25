/**
 * Status codes for closing websocket connections
 *
 * We may specify status codes in the range of 3000-3999.
 * Ref: https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4
 */

export const statusNormal = 1000
export const statusUnauthenticated = 3000
export const statusParseError = 3100
export const statusConsistencyError = 3200
