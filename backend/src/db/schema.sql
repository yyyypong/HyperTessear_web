-- =============================================================
-- HyperTessera — schema v0.2
--
-- Supersedes the one-table-per-metric design in
-- "Data Table Homepage (5).pdf". That design stored a single row
-- per metric, so updating a value was an UPDATE that destroyed
-- history — which works against the stated goal of transparency
-- and "holistic record keeping".
--
-- Here, metric_readings is append-only: every observation is kept,
-- `lastUpdated` is derived rather than stored, and the /transparency
-- page gets a real time series for free.
-- =============================================================

-- -------------------------------------------------------------
-- metric_readings — every homepage KPI, one row per observation
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS metric_readings (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  metric_key   VARCHAR(64)   NOT NULL,   -- 'currentTVL', 'cumPayout', ...
  value_num    DECIMAL(20,4) NULL,       -- numeric metrics
  value_bool   BOOLEAN       NULL,       -- protocolLiveStatus
  data_source  VARCHAR(31)   NOT NULL,   -- 'Algorithm' | 'Human'   [INTERNAL]
  source_ref   VARCHAR(255)  NULL,       -- URL or person           [INTERNAL]
  attribution  VARCHAR(128)  NULL,       -- whose number this is, if not ours
  captured_at  DATE          NOT NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_metric_date (metric_key, captured_at),
  INDEX idx_latest (metric_key, captured_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Latest reading per metric. One query instead of seven.
CREATE OR REPLACE VIEW v_metric_latest AS
SELECT m.*
FROM metric_readings m
JOIN (
  SELECT metric_key, MAX(captured_at) AS d
  FROM metric_readings
  GROUP BY metric_key
) t ON m.metric_key = t.metric_key AND m.captured_at = t.d;

-- -------------------------------------------------------------
-- partners — split by category so the homepage can show
-- "Integrations" and "Security & Audits" as separate, honest
-- sections instead of one undifferentiated logo marquee.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partners (
  id         INT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  logo_url   VARCHAR(500) NULL,   -- NULL => frontend renders a monogram (no hotlinking)
  link_url   VARCHAR(500) NULL,
  category   ENUM('integration','auditor','custodian','manager') NOT NULL DEFAULT 'integration',
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- security_audits — a logo without a linked report is decoration
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_audits (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  auditor      VARCHAR(128) NOT NULL,
  scope_zh     VARCHAR(255) NOT NULL,
  scope_en     VARCHAR(255) NOT NULL,
  report_url   VARCHAR(500) NULL,
  completed_at DATE NULL,
  sort_order   INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- products — locale-independent facts only.
-- target_apy_min/max covers all three wireframe cases:
--   8%          -> min 8.000,  max 8.000
--   14.5%+      -> min 14.500, max NULL, apy_open_ended = 1
--   8.5%-11.67% -> min 8.500,  max 11.670
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  slug             VARCHAR(64) PRIMARY KEY,
  sequence_no      TINYINT NOT NULL,
  role             ENUM('senior','junior','liquidity') NOT NULL,
  strategy_manager VARCHAR(128) NOT NULL,
  strategy_ref     VARCHAR(255) NULL,
  denomination     VARCHAR(16)  NOT NULL,
  term_days        INT NOT NULL,
  target_apy_min   DECIMAL(6,3) NULL,
  target_apy_max   DECIMAL(6,3) NULL,
  apy_open_ended   BOOLEAN NOT NULL DEFAULT 0,
  tvl              DECIMAL(20,4) NOT NULL DEFAULT 0,
  capacity         DECIMAL(20,4) NULL,
  status           ENUM('live','coming_soon','retired') NOT NULL DEFAULT 'live',
  network          VARCHAR(32) NOT NULL DEFAULT 'Ethereum',
  token_standard   VARCHAR(32) NULL,
  contract_address VARCHAR(64) NULL,
  inception_date   DATE NULL,
  sort_order       INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_translations — all prose, keyed by locale.
-- Keeps Chinese out of the JSX and makes `en` a data change,
-- not a rewrite.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_translations (
  slug            VARCHAR(64) NOT NULL,
  locale          VARCHAR(8)  NOT NULL,
  name            VARCHAR(128) NOT NULL,
  tagline         VARCHAR(255) NOT NULL,
  role_label      VARCHAR(64)  NOT NULL,
  underlying      VARCHAR(128) NOT NULL,
  term_label      VARCHAR(64)  NOT NULL,
  summary         TEXT NOT NULL,
  strategy_note   TEXT NULL,
  redemption_note TEXT NULL,
  risk_note       TEXT NULL,
  PRIMARY KEY (slug, locale),
  CONSTRAINT fk_pt_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_nav_history — powers the NAV chart on the detail page
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_nav_history (
  slug        VARCHAR(64) NOT NULL,
  captured_at DATE NOT NULL,
  nav         DECIMAL(18,6) NOT NULL,
  apy_7d      DECIMAL(6,3) NULL,
  apy_30d     DECIMAL(6,3) NULL,
  PRIMARY KEY (slug, captured_at),
  CONSTRAINT fk_nav_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_documents
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_documents (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(64) NOT NULL,
  title_zh   VARCHAR(255) NOT NULL,
  title_en   VARCHAR(255) NOT NULL,
  kind       ENUM('offering','audit','attestation','terms') NOT NULL DEFAULT 'offering',
  url        VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_doc_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- reserve_attestations — proof of reserves.
--
-- Each row is one independently attested asset balance backing a
-- product. Powers the /transparency page: the claim "reserves exist"
-- is worth nothing without an attestor, a date and a report link.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reserve_attestations (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  slug         VARCHAR(64) NULL,          -- NULL = protocol-level, not product-specific
  asset_class  VARCHAR(64) NOT NULL,
  amount       DECIMAL(20,4) NOT NULL,
  attestor     VARCHAR(128) NOT NULL,
  report_url   VARCHAR(500) NULL,
  attested_at  DATE NOT NULL,
  sort_order   INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_activity — recent onchain activity feed
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_activity (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  slug        VARCHAR(64) NOT NULL,
  kind        ENUM('deposit','redeem','yield') NOT NULL,
  amount      DECIMAL(20,4) NOT NULL,
  occurred_at DATETIME NOT NULL,
  CONSTRAINT fk_act_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
