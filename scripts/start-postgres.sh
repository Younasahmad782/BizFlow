#!/bin/bash
# Starts the local PostgreSQL used for BIZFLOW development.
# (Installed via pip pgserver because apt was unreachable; data lives in /tmp/pgdata-bizflow.)
set -e
PGROOT=/usr/local/lib/python3.12/dist-packages/pgserver/pginstall
export LD_LIBRARY_PATH=$PGROOT/lib:$LD_LIBRARY_PATH
export PATH=$PGROOT/bin:$PATH
id postgres >/dev/null 2>&1 || useradd -m -s /bin/bash postgres
chown -R postgres:postgres /tmp/pgdata-bizflow
su postgres -c "$PGROOT/bin/pg_ctl -D /tmp/pgdata-bizflow -l /tmp/pg.log start"
echo "PostgreSQL running on 127.0.0.1:5432 (databases: bizflow, bizflow_test)"
