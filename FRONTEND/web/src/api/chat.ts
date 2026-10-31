/**
 * src/api/chat.ts  →  chat-service (:4005) via Gateway
 * Live messages come over the socket; this is only HISTORY (MongoDB).
 */
import { api } from '../lib/apiClient';
import type { ApiEnvelope, ChatMessage } from '../types/api';

// STEP 1 — fetch the latest messages
export async function getMessages(roomCode: string, limit = 50): Promise<ChatMessage[]> {
  const res = await api.get<ApiEnvelope<ChatMessage[] | { messages: ChatMessage[] }>>(
    `/v1/chat/${encodeURIComponent(roomCode)}/messages`,
    { params: { limit } },
  );
  const d = res.data.data;
  return Array.isArray(d) ? d : d.messages ?? [];
}
