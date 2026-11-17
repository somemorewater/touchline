export interface LiveSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface Connection {
  socket: LiveSocket;
  sessionId: string;
  userId: string;
  matchId: string;
}

const connections = new Set<Connection>();

export function registerConnection(connection: Connection): () => void {
  connections.add(connection);
  return () => {
    connections.delete(connection);
  };
}

function closeAll(predicate: (connection: Connection) => boolean, code: number, reason: string): void {
  for (const connection of [...connections]) {
    if (!predicate(connection)) continue;
    connections.delete(connection);
    try {
      connection.socket.close(code, reason);
    } catch {
      // The socket may already be closing; revocation still stands.
    }
  }
}

/** Close every live connection bound to a revoked session. */
export function closeSession(sessionId: string, code = 4401, reason = 'session_revoked'): void {
  closeAll((connection) => connection.sessionId === sessionId, code, reason);
}

/** Close every live connection for a user (logout-all or deactivation). */
export function closeUser(userId: string, code = 4401, reason = 'session_revoked'): void {
  closeAll((connection) => connection.userId === userId, code, reason);
}

export function connectionCount(): number {
  return connections.size;
}

/**
 * Process-local fan-out. Only connections that already passed match
 * authorization are registered, so a match-scoped frame cannot reach an
 * unauthorized subscriber. Multi-instance delivery is not provided.
 */
export function broadcastToMatch(matchId: string, payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const connection of [...connections]) {
    if (connection.matchId !== matchId) continue;
    try {
      connection.socket.send(text);
    } catch {
      // A failed send must never roll back committed database state.
    }
  }
}
