-- =============================================================
-- HyperTessera — data-pages schema (phase: Charts & Stats +
-- Product Details), per HyperTessera_Data_Pages_Plan.md.
--
-- Additive only. Nothing here drops or rewrites the v0.2 tables;
-- the two page specs needed facts the original schema had no room
-- for (cycle settlement, adapter allocations, fee accounting, the
-- RWA registry, RevenuePool composition), so they get their own
-- tables and the originals keep working untouched.
--
-- Two deliberate reuses instead of new tables:
--   * Protocol-level scalars are new `metric_key` values in the
--     existing append-only metric_readings, so they inherit
--     v_metric_latest and real history for free.
--   * The Share Price / TVL / APY charts read product_nav_history,
--     which already carries a dense daily series.
--
-- Re-runnable: every statement is CREATE ... IF NOT EXISTS or a
-- declarative MODIFY.
-- =============================================================

-- -------------------------------------------------------------
-- product_vault — the Vault behind a product (plan §2.1, §2.2).
--
-- A separate 1:1 table rather than columns bolted onto `products`:
-- MySQL has no ADD COLUMN IF NOT EXISTS, and migrate.js is
-- documented as safe to re-run.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_vault (
  slug                   VARCHAR(64) PRIMARY KEY,
  vault_address          VARCHAR(64)  NULL,
  share_symbol           VARCHAR(32)  NULL,   -- Vault Share Symbol
  product_type           VARCHAR(48)  NULL,   -- Earn Vault | Liquidity Earn Vault
  issuer                 VARCHAR(128) NULL,
  risk_rating            VARCHAR(24)  NULL,
  total_supply           DECIMAL(30,6) NULL,  -- Vault totalSupply()
  share_price            DECIMAL(18,6) NULL,  -- convertToAssets(1e18), live indicative
  last_settlement_price  DECIMAL(18,6) NULL,  -- latest CycleSnapshot.settlementPrice
  current_cycle          INT          NULL,   -- StateManager
  cycle_state            VARCHAR(32)  NULL,
  product_state          VARCHAR(32)  NULL,
  performance_fee_bps    INT          NULL,
  protocol_fee_share_bps INT          NULL,   -- Governor-set protocol split
  maturity_date          DATE         NULL,   -- maturityTimestamp
  investors              INT          NULL,   -- current Vault Share holders
  redemption_timeline_zh VARCHAR(255) NULL,
  redemption_timeline_en VARCHAR(255) NULL,
  CONSTRAINT fk_pv_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_cycles — one row per settled cycle (plan §1.5, §2.5).
--
-- The contracts expose no standalone totalInterestGenerated, so
-- yield is derived cycle-to-cycle from Share Price movement:
--   cycle_yield = (settlement_price - previous) * share_supply
-- and the gross figure adds fee_assets back. Storing the inputs
-- alongside the result means the derivation stays auditable
-- rather than becoming a magic number.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_cycles (
  slug                VARCHAR(64) NOT NULL,
  cycle_no            INT         NOT NULL,
  settled_at          DATE        NOT NULL,
  settlement_price    DECIMAL(18,6)  NOT NULL,
  share_supply        DECIMAL(30,6)  NOT NULL,  -- interest-bearing supply
  total_assets        DECIMAL(20,4)  NOT NULL,
  cycle_yield         DECIMAL(20,4)  NOT NULL,  -- net of fees
  fee_assets          DECIMAL(20,4)  NOT NULL,
  fee_shares          DECIMAL(30,6)  NOT NULL,
  protocol_fee_shares DECIMAL(30,6)  NOT NULL,  -- minted to RevenuePool
  PRIMARY KEY (slug, cycle_no),
  INDEX idx_cycle_date (slug, settled_at),
  CONSTRAINT fk_pc_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_allocations — asset allocation and transparency (§2.4).
--
-- One table for every row that answers "where are this Vault's
-- assets": held directly, sitting in an Adapter, held as an RWA or
-- wrapped token, or in transit between them. `real_assets` is the
-- Adapter's realAssets() reading; the percentage of Product AUM is
-- derived at read time rather than stored, so it cannot drift.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_allocations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  slug            VARCHAR(64) NOT NULL,
  kind            ENUM('vault_direct','adapter','rwa_token','wrapped_token','in_transit')
                    NOT NULL DEFAULT 'adapter',
  name            VARCHAR(128) NOT NULL,
  contract_address VARCHAR(64) NULL,
  network         VARCHAR(32)  NULL,
  real_assets     DECIMAL(20,4) NOT NULL DEFAULT 0,
  description_zh  VARCHAR(500) NULL,
  description_en  VARCHAR(500) NULL,
  explorer_url    VARCHAR(500) NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  INDEX idx_alloc_slug (slug, sort_order),
  CONSTRAINT fk_pa_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- product_content — the off-chain CMS behind "More Info" (§2.6).
--
-- Locale-keyed long-form prose, one row per section, so editorial
-- copy never lands in JSX and `en` stays a data change.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_content (
  slug       VARCHAR(64) NOT NULL,
  locale     VARCHAR(8)  NOT NULL,
  section    ENUM('overview','strategy','risk','subscription','redemption',
                  'maturity','issuer','providers') NOT NULL,
  body       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, locale, section),
  CONSTRAINT fk_pcn_product FOREIGN KEY (slug) REFERENCES products(slug) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- §2.4 and §2.6 ask for proof-of-reserve, custody and legal
-- documents that the original four-value enum could not express.
ALTER TABLE product_documents
  MODIFY COLUMN kind ENUM('offering','audit','attestation','terms','por','custody','legal')
  NOT NULL DEFAULT 'offering';

-- -------------------------------------------------------------
-- rwa_assets — the AssetRegistry view behind Tokenized Assets (§1.3).
--
-- `nav` is nullable on purpose. The plan is explicit that an asset
-- with no available NAV must be excluded from the valuation rather
-- than counted as zero, and a NULL is the only representation that
-- cannot be silently summed.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rwa_assets (
  id            INT PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  asset_type    VARCHAR(64)  NOT NULL,
  network       VARCHAR(32)  NOT NULL,
  token_symbol  VARCHAR(32)  NULL,
  token_address VARCHAR(64)  NULL,   -- NULL => registered but no RWAToken deployed
  token_decimals TINYINT     NOT NULL DEFAULT 18,
  total_supply  DECIMAL(30,6) NULL,
  nav           DECIMAL(18,6) NULL,  -- NULL => excluded from valuation, not zero
  status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  sort_order    INT NOT NULL DEFAULT 0,
  INDEX idx_rwa_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- protocol_breakdowns — every "by network / by product / by type"
-- split the Charts & Stats page asks for (§1.2, §1.3, §1.4, §1.5,
-- §1.6), in one shape.
--
-- Five metrics x four dimensions would otherwise be twenty tables
-- that differ only in their label column. `slug` is set when a row
-- corresponds to a product, which is what lets the composition
-- chart link through to that product's page (§1.2).
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protocol_breakdowns (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  metric_key  VARCHAR(48) NOT NULL,  -- protocolAum | tokenizedAssets | totalInvestors | ...
  dimension   VARCHAR(24) NOT NULL,  -- network | product_type | product | asset_type | token | vault
  label       VARCHAR(96) NOT NULL,
  slug        VARCHAR(64) NULL,      -- set => row links to a product page
  value_num   DECIMAL(20,4) NULL,
  value_int   INT NULL,              -- for count metrics such as investors
  captured_at DATE NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  INDEX idx_breakdown (metric_key, dimension, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- revenue_pool_holdings — what RevenuePool actually holds (§1.6).
--
-- `priced` exists because the plan requires assets without
-- reliable pricing to be shown separately rather than force-
-- converted into USD. An unpriced row carries value_usd = NULL and
-- is reported as a holding, never folded into a total.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_pool_holdings (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  asset_label VARCHAR(96) NOT NULL,
  asset_kind  ENUM('vault_share','stablecoin','other') NOT NULL DEFAULT 'other',
  network     VARCHAR(32) NULL,
  amount      DECIMAL(30,6) NOT NULL,
  value_usd   DECIMAL(20,4) NULL,   -- NULL when `priced` = 0
  priced      BOOLEAN NOT NULL DEFAULT 1,
  captured_at DATE NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -------------------------------------------------------------
-- revenue_flows — income into and withdrawals out of RevenuePool
-- beyond performance fees (§1.6, §3 "Revenue Indexing").
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_flows (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  direction   ENUM('in','out') NOT NULL,
  source_zh   VARCHAR(128) NOT NULL,
  source_en   VARCHAR(128) NOT NULL,
  amount      DECIMAL(20,4) NOT NULL,
  occurred_at DATE NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  INDEX idx_flow_dir (direction, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
