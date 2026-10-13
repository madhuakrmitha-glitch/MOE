export type Role = 'owner' | 'member' | 'viewer';
export interface User {
  id: string;
  email: string;
  name: string;
}
export interface Workspace {
  id: string;
  name: string;
  role: Role;
}
export type ProviderKind = 'openai' | 'ollama' | 'huggingface';
export interface Connection {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  has_key: boolean;
  token_parameter: 'max_tokens' | 'max_completion_tokens';
  supports_temperature: boolean;
  stream_enabled: boolean;
  include_usage: boolean;
}
export interface Agent {
  id: string;
  name: string;
  connection_id: string;
  model: string;
  system_prompt: string;
  enabled: boolean;
  temperature: number;
  max_tokens: number;
  color: string;
}
export type Mode = 'broadcast' | 'round_robin' | 'moderated';
export interface RoomSummary {
  id: string;
  workspace_id: string;
  title: string;
  mode: Mode;
  updated_at: number;
}
export interface Message {
  id: string;
  run_id: string | null;
  sequence: number;
  role: 'user' | 'agent' | 'error' | 'partial';
  name: string;
  agent_id: string | null;
  content: string;
  model: string | null;
  created_at: number;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
}
export interface Run {
  id: string;
  status: string;
  input_text: string;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}
export interface RoomConfig {
  title: string;
  revision: number;
  shared_prompt: string;
  mode: Mode;
  rounds: number;
  max_turns: number;
  context_messages: number;
  failure_policy: 'continue' | 'stop';
  moderator_id: string | null;
  agents: Agent[];
}
export interface Room extends RoomSummary, RoomConfig {
  messages: Message[];
  runs: Run[];
}
export interface Member extends User {
  role: Role;
}
export interface Audit {
  id: string;
  actor_id: string;
  action: string;
  resource_id: string;
  created_at: number;
}
export interface PartialReply {
  turn_id: string;
  agent_id: string;
  name: string;
  text: string;
  turn: number;
}
export const ACTIVE_STATUSES = ['queued', 'running', 'cancel_requested'];
export const modeLabel: Record<Mode, string> = {
  broadcast: 'Independent replies',
  round_robin: 'Round-robin discussion',
  moderated: 'Moderator-led discussion',
};
export const providerLabel: Record<ProviderKind, string> = {
  openai: 'OpenAI compatible',
  ollama: 'Ollama',
  huggingface: 'Hugging Face',
};
