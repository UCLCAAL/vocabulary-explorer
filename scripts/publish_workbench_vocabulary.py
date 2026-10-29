#!/usr/bin/env python3
"""Detached Workbench publication worker; status persists across Node restarts."""
import argparse,os,sys,traceback
from pathlib import Path
import psycopg
from refresh_lookup_vocabularies import run
p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--slug',required=True);p.add_argument('--run-id',type=int,required=True)
a=p.parse_args();dsn=os.getenv('CAAL_DATABASE_URL') or os.getenv('DATABASE_URL')
try:
    with psycopg.connect(dsn,autocommit=True) as lock:
        if not lock.execute("SELECT pg_try_advisory_lock(hashtext('caal-generic-vocabulary-edit'))").fetchone()[0]:raise RuntimeError('Another vocabulary edit or publication is in progress. Try again.')
        run(a.repo.resolve(),True,a.slug)
    with psycopg.connect(dsn) as db:
        db.execute("UPDATE vocab_workbench.editor_publications SET status='success',finished_at=now() WHERE publication_id=%s AND vocabulary_code=%s",(a.run_id,a.slug))
except BaseException as e:
    # No DSNs or arbitrary exception bodies in user-facing status.
    message=str(e) if isinstance(e,RuntimeError) else 'Publication stopped ('+type(e).__name__+'). Check the saved server report.'
    print(message,file=sys.stderr,flush=True)
    with psycopg.connect(dsn) as db:
        db.execute("UPDATE vocab_workbench.editor_publications SET status='failed',finished_at=now(),error=%s WHERE publication_id=%s AND vocabulary_code=%s",(message,a.run_id,a.slug))
    sys.exit(1)
