#!/usr/bin/env python3
"""Bring already-published, explicitly typed SKOS notes/alternatives into the editor.
Never infer definitions from raw spreadsheet notes; never replace an existing editor value.
"""
import argparse,json,os
from pathlib import Path
from collections import defaultdict
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from rdflib import Literal,URIRef
from rdflib.namespace import SKOS
from refresh_lookup_vocabularies import get_graph
from export_postgres_lookups_to_skos import concept_uri,scheme_uri
LANGS={'en','ru','zh','kk','ky','tg','tk','uz'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--apply',action='store_true');a=p.parse_args()
 registry=json.loads((a.repo/'workbench/services/vocabularyRegistry.json').read_text())
 endpoint=os.getenv('FUSEKI_DATA_URL','http://localhost:9030/skosmos/data');staged=[];report=[]
 with psycopg.connect(os.getenv('CAAL_DATABASE_URL')or os.getenv('DATABASE_URL'),row_factory=dict_row)as db:
  if not db.execute("SELECT pg_try_advisory_xact_lock(hashtext('caal-generic-vocabulary-edit')) AS locked").fetchone()['locked']:raise RuntimeError('A vocabulary edit or publication is in progress. Try again.')
  for v in registry:
   slug=v['slug'];graph,_,exists=get_graph(endpoint,'https://vocab.uclcaal.org/graph/'+slug)
   rows=db.execute(sql.SQL('SELECT to_jsonb(v) AS data FROM ui.{} v').format(sql.Identifier(v['view']))).fetchall()
   subjects={concept_uri(slug,str(r['data']['id'])):r['data'] for r in rows};pending=defaultdict(set)
   for subject,row in subjects.items():
    for predicate,field in [(SKOS.altLabel,'alternative'),(SKOS.definition,'definition'),(SKOS.scopeNote,'scopeNote')]:
     for value in graph.objects(subject,predicate):
      if isinstance(value,Literal)and value.language in LANGS and str(value).strip():pending[(str(row['id']),field,value.language)].add(str(value).strip())
    for lang in LANGS:
     for value in row.get('alt_labels_'+lang)or []:
      if value.strip():pending[(str(row['id']),'alternative',lang)].add(value.strip())
    if str(row.get('description')or '').strip():pending[(str(row['id']),'scopeNote','en')].add(str(row['description']).strip())
   for value in graph.objects(scheme_uri(slug),SKOS.scopeNote):
    if isinstance(value,Literal)and value.language in LANGS and str(value).strip():pending[('','description',value.language)].add(str(value).strip())
   n=0
   for(cid,field,lang),vals in pending.items():
    if db.execute('SELECT 1 FROM vocab_workbench.editor_texts WHERE vocabulary_code=%s AND concept_id=%s AND field=%s AND lang=%s',(slug,cid,field,lang)).fetchone():continue
    staged.append((slug,cid,field,lang,json.dumps(sorted(vals),ensure_ascii=False)));n+=1
   report.append({'vocabulary':slug,'graph_exists':exists,'fields_to_import':n})
  if a.apply:
   for row in staged:db.execute('INSERT INTO vocab_workbench.editor_texts(vocabulary_code,concept_id,field,lang,texts) VALUES(%s,%s,%s,%s,%s::jsonb) ON CONFLICT DO NOTHING',row)
  else:db.rollback()
 print(json.dumps(report,ensure_ascii=False,indent=2))
 print(('Imported 'if a.apply else 'Would import ')+str(len(staged))+' published/source note and alternative fields. Existing editor values and preferred labels unchanged.')
if __name__=='__main__':
 try:main()
 except Exception as e:
  print(str(e)if isinstance(e,RuntimeError)else 'Published text import stopped ('+type(e).__name__+'). No partial import was committed.');raise SystemExit(1)
