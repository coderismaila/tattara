-- Custom migration: extensions the schema depends on.
-- PostGIS: geography(Point, 4326) columns and spatial checks for GPS flags (DATA_MODEL §1, SEED_DATA §3).
CREATE EXTENSION IF NOT EXISTS postgis;
