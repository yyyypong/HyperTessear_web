import { useI18n } from '../../i18n';

export default function DevelopmentDocs() {
  const { t } = useI18n();
  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.resources.docsEyebrow}</div>
        <h1 className="phead__title">{t.resources.docsTitle}</h1>
        <p className="section__lede">{t.resources.docsLede}</p>
      </div>
      <div className="shellcard">
        <p className="shellcard__note">{t.workspace.phaseNote}</p>
      </div>
    </div>
  );
}
