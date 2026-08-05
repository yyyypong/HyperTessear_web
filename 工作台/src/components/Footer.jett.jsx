import { Link } from 'react-router-dom';
import { useI18n, Highlight } from '../i18n';
import { BrandMark } from './ui';
import { ROUTES } from '../config/routes';

/**
 * Resources: About, Dashboard, Development Docs, Blog.
 * Yield links retained under a Products column.
 */
export default function Footer() {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr__cols">
          <div className="ftr__brandcol">
            <div className="ftr__brand">
              <BrandMark size={30} />
              <span className="ftr__brand-name">{t.brand}</span>
            </div>
            <div className="ftr__entity">
              {t.footer.entity}
              <Highlight text={t.footer.address} as="div" />
            </div>
          </div>

          <div className="ftr__col">
            <div className="ftr__col-title">{t.footer.yield}</div>
            <Link to={ROUTES.products}>{t.footer.linkProducts}</Link>
            <Link to={ROUTES.productsTransparency}>{t.footer.linkTransparency}</Link>
            <Link to={ROUTES.productsLiquidity}>{t.footer.linkLiquidity}</Link>
          </div>

          <div className="ftr__col">
            <div className="ftr__col-title">{t.footer.resources}</div>
            <Link to={ROUTES.about}>{t.footer.linkAbout}</Link>
            <Link to={ROUTES.dashboard}>{t.footer.linkDashboard}</Link>
            <Link to={ROUTES.developmentDocs}>{t.footer.linkDocs}</Link>
            <Link to={ROUTES.blog}>{t.footer.linkBlog}</Link>
          </div>

          <div className="ftr__col">
            <div className="ftr__col-title">{t.footer.protocol}</div>
            <Link to={ROUTES.assetsIssue}>{t.footer.linkIssue}</Link>
            <Link to={ROUTES.assetsWrap}>{t.footer.linkWrap}</Link>
            <Link to={ROUTES.vaultsCreate}>{t.footer.linkCreateVault}</Link>
            <Link to={ROUTES.vaultsManage}>{t.footer.linkManageVault}</Link>
          </div>

          <div className="ftr__col">
            <div className="ftr__col-title">{t.footer.legal}</div>
            <span>{t.footer.linkTerms}</span>
            <span>{t.footer.linkPrivacy}</span>
            <span>{t.footer.linkImprint}</span>
          </div>
        </div>

        <div className="ftr__rule" />

        <div className="ftr__legal">
          <span>© {year} {t.brand}. {t.footer.rights}</span>
        </div>

        <div className="ftr__notes">
          <p><sup>1</sup>{t.footer.note1}</p>
          <p><sup>2</sup>{t.footer.note2}</p>
          <p><sup>3</sup>{t.footer.note3}</p>
          <p style={{ marginTop: 12 }}>{t.footer.restriction}</p>
        </div>
      </div>
    </footer>
  );
}
