import { useEffect, useState } from 'react';
import { Copy, Plus, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../api';
import type { Audit, Member, Role, User } from '../types';
import { Avatar, ErrorNotice, Modal, Spinner } from './ui';
export function Team({
  workspaceId,
  owner,
  user,
}: {
  workspaceId: string;
  owner: boolean;
  user: User;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [error, setError] = useState(''),
    [invite, setInvite] = useState(false),
    [link, setLink] = useState('');
  const [email, setEmail] = useState(''),
    [role, setRole] = useState<'member' | 'viewer'>('member'),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setMembers(await api<Member[]>(`/workspaces/${workspaceId}/members`));
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  useEffect(() => {
    void load();
  }, [workspaceId]);
  async function change(member: Member, next: Role) {
    try {
      await api(`/workspaces/${workspaceId}/members/${member.id}`, 'PATCH', { role: next });
      void load();
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ token: string }>(`/workspaces/${workspaceId}/invites`, 'POST', {
        email,
        role,
      });
      setLink(`${window.location.origin}/?invite=${encodeURIComponent(result.token)}`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">People & permissions</span>
          <h1>Workspace team</h1>
          <p>Share rooms and model connections with the people you trust.</p>
        </div>
        {owner && (
          <button
            className="button primary"
            onClick={() => {
              setInvite(true);
              setLink('');
            }}
          >
            <Plus size={16} /> Invite someone
          </button>
        )}
      </header>
      <ErrorNotice>{error}</ErrorNotice>
      <div className="role-explainer">
        <div>
          <ShieldCheck size={17} />
          <b>Owner</b>
          <p>Manages providers, invitations, roles, and rooms.</p>
        </div>
        <div>
          <b>Member</b>
          <p>Creates rooms, configures agents, and starts discussions.</p>
        </div>
        <div>
          <b>Viewer</b>
          <p>Reads conversations and exports room history.</p>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="person-cell">
                    <Avatar name={member.name} size="small" />
                    <b>
                      {member.name}
                      {member.id === user.id && <small> (you)</small>}
                    </b>
                  </span>
                </td>
                <td>{member.email}</td>
                <td>
                  {owner ? (
                    <select
                      aria-label={`Role for ${member.name}`}
                      value={member.role}
                      onChange={(e) => change(member, e.target.value as Role)}
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="badge">{member.role}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invite && (
        <Modal
          title="Invite a teammate"
          subtitle="Invitations are email-bound and expire in three days."
          close={() => setInvite(false)}
        >
          <form onSubmit={createInvite}>
            <div className="modal-body">
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label>
                Role
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}
                >
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
              {link && (
                <div className="invite-link">
                  <label>
                    Share this invitation
                    <input readOnly value={link} />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(link)
                        .catch(() => setError('Copy the invitation URL manually'))
                    }
                  >
                    <Copy size={14} /> Copy link
                  </button>
                </div>
              )}
            </div>
            <footer className="modal-footer">
              <button type="button" className="button secondary" onClick={() => setInvite(false)}>
                Done
              </button>
              <button className="button primary" disabled={busy}>
                {busy ? <Spinner /> : <Plus size={15} />} Create invitation
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function Activity({ workspaceId }: { workspaceId: string }) {
  const [events, setEvents] = useState<Audit[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    api<Audit[]>(`/workspaces/${workspaceId}/audit`)
      .then(setEvents)
      .catch((e) => setError(errorMessage(e)));
  }, [workspaceId]);
  return (
    <section className="page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Accountability</span>
          <h1>Workspace activity</h1>
          <p>
            Recent administrative changes and discussion actions. Secrets and prompts are excluded.
          </p>
        </div>
      </header>
      <ErrorNotice>{error}</ErrorNotice>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Resource</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <b>{event.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</b>
                </td>
                <td className="mono">{event.resource_id.slice(0, 12)}</td>
                <td>{new Date(event.created_at * 1000).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length && <p className="table-empty">No activity yet</p>}
      </div>
    </section>
  );
}
