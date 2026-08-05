import { useI18n } from '../../i18n';

export default function Blog() {
  const { t } = useI18n();
  return (
    <div className="wrap accesspage">
      <div className="phead">
        <div className="section__eyebrow">{t.resources.blogEyebrow}</div>
        <h1 className="phead__title">{t.resources.blogTitle}</h1>
        <p className="section__lede">{t.resources.blogLede}</p>
      </div>
      <div className="shellcard">
        <p className="shellcard__note">{t.workspace.phaseNote}</p>
      </div>
    </div>
  );
}
