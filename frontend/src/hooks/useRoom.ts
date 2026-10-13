import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api';
import { ACTIVE_STATUSES, type Message, type PartialReply, type Room } from '../types';

export function useRoom(id: string | null) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [partials, setPartials] = useState<Record<string, PartialReply>>({});
  const [reconnecting, setReconnecting] = useState(false);
  const selected = useRef(id);
  selected.current = id;
  const reload = useCallback(async () => {
    if (!id) {
      setRoom(null);
      return;
    }
    try {
      const result = await api<Room>(`/rooms/${id}`);
      if (selected.current === id) {
        setRoom(result);
        setError('');
      }
    } catch (error) {
      if (selected.current === id) setError(errorMessage(error));
    }
  }, [id]);
  useEffect(() => {
    setRoom(null);
    setPartials({});
    setError('');
    void reload();
  }, [reload]);
  const active = room?.runs.find((run) => ACTIVE_STATUSES.includes(run.status));
  const runId = active?.id;
  useEffect(() => {
    if (!runId) {
      setReconnecting(false);
      return;
    }
    let cursor = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onopen = () => setReconnecting(false);
    source.onerror = () => {
      setReconnecting(true);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void reload(), 2000);
    };
    source.addEventListener('update', (event: MessageEvent) => {
      const eventId = Number(event.lastEventId);
      if (eventId && eventId <= cursor) return;
      if (eventId) cursor = eventId;
      const { type, data } = JSON.parse(event.data);
      if (type === 'turn_started')
        setPartials((previous) => ({ ...previous, [data.turn_id]: { ...data, text: '' } }));
      if (type === 'delta')
        setPartials((previous) => ({
          ...previous,
          [data.turn_id]: {
            ...(previous[data.turn_id] || { name: 'Agent', turn: 0 }),
            ...data,
            text: (previous[data.turn_id]?.text || '') + data.text,
          },
        }));
      if (type === 'message')
        setRoom((previous) =>
          previous
            ? {
                ...previous,
                messages: previous.messages.some((m) => m.id === data.id)
                  ? previous.messages
                  : [...previous.messages, data as Message],
              }
            : previous,
        );
      if (type === 'turn_finished')
        setPartials((previous) => {
          const copy = { ...previous };
          delete copy[data.turn_id];
          return copy;
        });
      if (type === 'status')
        setRoom((previous) =>
          previous
            ? {
                ...previous,
                runs: previous.runs.map((run) =>
                  run.id === runId ? { ...run, status: data.status } : run,
                ),
              }
            : previous,
        );
      if (type === 'terminal') {
        source.close();
        setPartials({});
        setReconnecting(false);
        void reload();
      }
    });
    return () => {
      source.close();
      clearTimeout(retryTimer);
    };
  }, [runId, reload]);
  async function loadEarlier() {
    if (!room || !room.messages.length) return;
    const items = await api<Message[]>(
      `/rooms/${room.id}/messages?before=${room.messages[0].sequence}`,
    );
    setRoom((previous) =>
      previous
        ? {
            ...previous,
            messages: [
              ...items.filter((item) => !previous.messages.some((m) => m.id === item.id)),
              ...previous.messages,
            ],
          }
        : previous,
    );
  }
  return {
    room,
    error,
    active,
    partials: Object.values(partials),
    reconnecting,
    reload,
    loadEarlier,
  };
}
