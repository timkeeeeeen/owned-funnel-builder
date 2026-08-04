CREATE TABLE IF NOT EXISTS tracking_ingress_capabilities (
  capability_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  release_sha TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS tracking_delivery_budgets_insert_limit
BEFORE INSERT ON tracking_delivery_budgets
WHEN NEW.used < 1 OR NEW.budget_limit < 1 OR NEW.used > NEW.budget_limit
BEGIN
  SELECT RAISE(ABORT, 'tracking_budget_exhausted');
END;

CREATE TRIGGER IF NOT EXISTS tracking_delivery_budgets_update_limit
BEFORE UPDATE OF used, budget_limit ON tracking_delivery_budgets
WHEN NEW.used < 1 OR NEW.budget_limit < 1 OR NEW.used > NEW.budget_limit
BEGIN
  SELECT RAISE(ABORT, 'tracking_budget_exhausted');
END;
