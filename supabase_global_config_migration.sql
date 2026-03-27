-- Migration: Create global_config table for central settings
-- Created: 2026-03-27

CREATE TABLE IF NOT EXISTS global_config (
    id TEXT PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID
);

-- Initiale Feiertags-Konfiguration einfügen
INSERT INTO global_config (id, config) 
VALUES ('holiday_config', '{"neujahr": true, "h3k": true, "karfreitag": true, "ostermontag": true, "tag_der_arbeit": true, "christi_himmelfahrt": true, "pfingstmontag": true, "fronleichnam": true, "friedensfest": false, "mariae_himmelfahrt": true, "tag_der_deutschen_einheit": true, "allerheiligen": true, "weihnachten_1": true, "weihnachten_2": true}')
ON CONFLICT (id) DO NOTHING;
