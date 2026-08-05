import ObjectSelector from '../components/ObjectSelector';

export default function WorkspaceIndexPage() {
  return (
    <section className="ws-page ws-index">
      <p className="ws-eyebrow">HyperTessera</p>
      <h1>Workspaces</h1>
      <p>Select the onchain object and administrative role you need to inspect. This navigation does not request a signature or submit a transaction.</p>
      <ObjectSelector />
    </section>
  );
}
