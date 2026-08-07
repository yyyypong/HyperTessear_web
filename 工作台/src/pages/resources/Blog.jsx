import { useI18n } from '../../i18n';
import PageHead from '../../components/PageHead';
import Reveal from '../../components/Reveal';

export default function Blog() {
  const { t } = useI18n();
  return (
    <>
      <PageHead
        eyebrow={t.resources.blogEyebrow}
        title={t.resources.blogTitle}
        lede={t.resources.blogLede}
      />
      <section className="band band--paper">
        <div className="wrap">
          <Reveal>
            <div className="resempty">
              <p className="resempty__eyebrow">{t.resources.comingSoon}</p>
              <h2 className="resempty__title">{t.resources.blogEmptyTitle}</h2>
              <p className="resempty__body">{t.resources.blogEmptyBody}</p>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
