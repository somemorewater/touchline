import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParamsSchema } from '../../shared/validation.js';
import { registerConnection } from '../../security/connections.js';
import { requireAuth } from '../../security/plugin.js';
import { isSessionActive } from '../../security/service.js';
import { canReadMatch, loadMatchScope } from '../../security/access.js';

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strict(),
  z.object({ type: z.literal('subscribe'), matchId: z.uuid() }).strict(),
  z.object({ type: z.literal('unsubscribe'), matchId: z.uuid() }).strict(),
]);

type ClientMessage = z.infer<typeof clientMessageSchema>;

interface ServerError {
  type: 'error';
  code: string;
  message: string;
}

const WS_OPEN = 1;
const MAX_MESSAGE_BYTES = 4_096;

/**
 * Authenticated, match-scoped realtime channel.
 *
 * Authentication happens in `preValidation`, before the protocol upgrade, so
 * anonymous or revoked sessions never receive a `connection.ready` frame.
 * Every subscribe request is re-authorized against the database.
 */
export async function matchWebSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/ws/matches/:id',
    {
      websocket: true,
      schema: {
        tags: ['Matches'],
        summary: 'Authenticated match-scoped WebSocket channel',
        ...idParamsSchema,
      },
      preValidation: app.authenticateWebSocket,
    },
    (socket, request) => {
      const auth = requireAuth(request);
      const matchId = (request.params as { id: string }).id;
      let unregister: (() => void) | null = null;

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        unregister?.();
        unregister = null;
      };

      const send = (payload: unknown) => {
        if (socket.readyState === WS_OPEN) socket.send(JSON.stringify(payload));
      };
      const reject = (code: string, message: string, closeCode: number, reason: string) => {
        send({ type: 'error', code, message } satisfies ServerError);
        socket.close(closeCode, reason);
        release();
      };

      socket.on('close', release);
      socket.on('error', release);

      void (async () => {
        try {
          const scope = await loadMatchScope(matchId);
          if (!scope || !(await canReadMatch(auth, scope))) {
            reject('RESOURCE_NOT_FOUND', 'Match not found.', 4404, 'match_not_found');
            return;
          }
          unregister = registerConnection({
            socket,
            sessionId: auth.sessionId,
            userId: auth.userId,
            matchId,
          });
          send({
            type: 'connection.ready',
            matchId,
            at: new Date().toISOString(),
          });
        } catch {
          reject('INTERNAL_ERROR', 'Unable to open the match channel.', 1011, 'internal_error');
        }
      })();

      const handleMessage = async (raw: unknown) => {
        try {
          if (released) return;
          if (!(await isSessionActive(auth.userId, auth.sessionId))) {
            reject('SESSION_REVOKED', 'Session has been revoked.', 4401, 'session_revoked');
            return;
          }

          const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : '';
          if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
            reject('MESSAGE_TOO_LARGE', 'Message is too large.', 1009, 'message_too_large');
            return;
          }

          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            send({ type: 'error', code: 'INVALID_MESSAGE', message: 'Message must be valid JSON.' });
            return;
          }

          const parsed = clientMessageSchema.safeParse(json);
          if (!parsed.success) {
            send({ type: 'error', code: 'INVALID_MESSAGE', message: 'Unsupported message.' });
            return;
          }

          const message: ClientMessage = parsed.data;
          if (message.type === 'ping') {
            send({ type: 'pong', at: new Date().toISOString() });
            return;
          }

          // This channel is bound to the match in the URL. A client may not
          // pivot it to arbitrary private matches.
          if (message.matchId !== matchId) {
            send({
              type: 'error',
              code: 'SUBSCRIPTION_FORBIDDEN',
              message: 'This channel is bound to a different match.',
            });
            return;
          }

          const scope = await loadMatchScope(matchId);
          if (!scope || !(await canReadMatch(auth, scope))) {
            send({
              type: 'error',
              code: 'FORBIDDEN',
              message: 'You are not authorized to subscribe to this match.',
            });
            return;
          }

          send({
            type: message.type === 'subscribe' ? 'subscribed' : 'unsubscribed',
            matchId,
          });
        } catch {
          send({ type: 'error', code: 'INVALID_MESSAGE', message: 'Unable to process the message.' });
        }
      };

      socket.on('message', (raw: unknown) => {
        void handleMessage(raw);
      });
    },
  );
}
