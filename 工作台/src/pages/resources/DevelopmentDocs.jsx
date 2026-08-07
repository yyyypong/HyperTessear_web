import { useI18n } from '../../i18n';
import PageHead from '../../components/PageHead';
import Reveal from '../../components/Reveal';

export default function DevelopmentDocs() {
  const { t } = useI18n();
  return (
    <>
      <PageHead
        eyebrow={t.resources.docsEyebrow}
        title={t.resources.docsTitle}
        lede={t.resources.docsLede}
      />
      <section className="band band--paper">
        <div className="wrap">
          <Reveal>
            <div className="resempty">
              <p className="resempty__eyebrow">{t.resources.comingSoon}</p>
              <h2 className="resempty__title">{t.resources.docsEmptyTitle}</h2>
              <p className="resempty__body">{t.resources.docsEmptyBody}</p>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
