import { Link } from 'react-router-dom';

export default function WorkspaceNotFoundPage() {
  return (
    <section className="ws-page ws-not-found">
      <p className="ws-eyebrow">Workspaces</p>
      <h1>Workspace not found</h1>
      <p>The role or object route is incomplete or does not exist.</p>
      <Link className="ws-link-button" to="/workspaces">Choose a workspace</Link>
    </section>
  );
}
