#!/usr/bin/env bash
# Cluster-level objects of a MediBooker PostgreSQL cluster (07 §2, 02 §9, ADR 0005 §4): the roles
# platform_owner, platform_app and medibooker_provisioner, and the platform database. No practice
# database and no group role: medibooker-db provision creates each practice's database and roles
# as the provisioner. The Testcontainers global setup prepares its cluster with this same file.
#
# The image's entrypoint runs it once, on an empty data directory: it sources the file when it is
# not executable (a git checkout) and runs it otherwise. The body runs in a subshell, so its shell
# options never reach the entrypoint, which is not written for nounset.
(
  set -euo pipefail

  : "${PLATFORM_OWNER_PASSWORD:?is required}"
  : "${PLATFORM_APP_PASSWORD:?is required}"
  : "${PROVISIONER_PASSWORD:?is required}"

  # psql reads the passwords from the environment (\getenv), not from its command line. This
  # session logs no statement, also when it fails, so no role password reaches a server log that
  # runs with log_statement=all (the Testcontainers cluster); terse errors keep the statement
  # text out of the container's output.
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --set=VERBOSITY=terse \
    --username "${POSTGRES_USER:-postgres}" --dbname postgres <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\getenv platform_owner_password PLATFORM_OWNER_PASSWORD
\getenv platform_app_password PLATFORM_APP_PASSWORD
\getenv provisioner_password PROVISIONER_PASSWORD

-- Each password reference stands on a line of its own: on one line with PASSWORD, the secret
-- scan's password rule would read the psql variable name as a literal password.
CREATE ROLE platform_owner LOGIN PASSWORD
  :'platform_owner_password';
CREATE ROLE platform_app LOGIN PASSWORD
  :'platform_app_password';
CREATE ROLE medibooker_provisioner LOGIN CREATEDB CREATEROLE PASSWORD
  :'provisioner_password';
-- PostgreSQL 16 and later give a CREATEROLE role the ADMIN option on the roles it creates but no
-- membership. With 'set' the provisioner may SET ROLE to a practice owner, as CREATE DATABASE
-- ... OWNER requires, without inheriting the owner's privileges (02 §6).
ALTER ROLE medibooker_provisioner SET createrole_self_grant = 'set';

-- The builtin locale provider keeps sorting independent of the operating system (ADR 0005 §5.3).
CREATE DATABASE medibooker_platform OWNER platform_owner TEMPLATE template0
  ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
-- PostgreSQL grants CONNECT to PUBLIC on every new database.
REVOKE ALL ON DATABASE medibooker_platform FROM PUBLIC;
GRANT CONNECT ON DATABASE medibooker_platform TO platform_app;
-- createPracticeDatabase stores medibooker.app_role on each practice database as that practice's
-- owner (ALTER DATABASE ... SET after SET ROLE). Since PostgreSQL 15 a non-superuser needs the SET
-- privilege on a custom parameter for that, and the practice owners share no group role, so PUBLIC
-- carries it. A role can only ALTER a database it owns; the value labels the database's app role.
GRANT SET ON PARAMETER medibooker.app_role TO PUBLIC;
SQL
)
