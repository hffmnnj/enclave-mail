-- Enclave Mail — PostgreSQL initialization
-- This script runs when the container first starts (empty data directory only).
-- The enclave database is already created by POSTGRES_DB env var.
-- This script adds any needed extensions or initial config.

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for any future cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set timezone
SET timezone = 'UTC';
