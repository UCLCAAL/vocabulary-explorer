#!/usr/bin/env python3
"""Refresh configured generic vocabularies from DB without discarding published content.

Run with the workbench environment; see START_HERE.txt. No PostgreSQL writes.
"""
import argparse
import csv
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

from rdflib import Graph, Literal, Namespace, RDF, URIRef
from rdflib.compare import isomorphic
from rdflib.namespace import SKOS

CAAL=Namespace('https://vocab.uclcaal.org/ns/')
ROOT='https://vocab.uclcaal.org/'
EXPECTED_VOCABULARIES=38
SKOSMOS=Namespace('http://purl.org/net/skosmos#')
APPROVED_LABEL_REPLACEMENTS={
    (ROOT+'concept/certainty/3','en'):('Mid','Medium'),
    (ROOT+'scheme/administrative-types','en'):('Administrative Types','Administrative Subdivision Types'),
}

def validate_lookup_fixes():
    import psycopg
    dsn=os.getenv('CAAL_DATABASE_URL') or os.getenv('DATABASE_URL') or ''
    with psycopg.connect(dsn) as connection:
        connection.execute('SET TRANSACTION READ ONLY')
        missing=connection.execute('''SELECT count(*) FROM public."ThsDesignationType" t
            LEFT JOIN ui.v_lkp_designation_type v USING (id)
            WHERE COALESCE(NULLIF(btrim(t."Hierarchy 1"::text),''),NULLIF(btrim(t."Russian_1"::text),''),
                NULLIF(btrim(t."Chinese_1"::text),'')) IS NOT NULL AND v.id IS NULL''').fetchone()[0]
        if missing:raise RuntimeError('Designation lookup still excludes stored terms. Apply 01_fix_lookup_views.sql first.')
        for lang,col in [('kk','Kazakh_1'),('ky','Kyrgyz_1'),('tg','Tajik_1'),('tk','Turkmen_1'),('uz','Uzbek_1')]:
            hidden=connection.execute(f'''SELECT count(*) FROM public."ThsSubjects" t
                LEFT JOIN ui.v_lkp_subjects v USING (id)
                WHERE NULLIF(btrim(t."{col}"::text),'') IS NOT NULL
                AND t."{col}"::text IS DISTINCT FROM v.display_{lang}''').fetchone()[0]
            if hidden:raise RuntimeError('Subjects lookup still hides stored translations. Apply 01_fix_lookup_views.sql first.')

def get_graph(endpoint, graph_uri):
    url=graph_url(endpoint,graph_uri)
    request=urllib.request.Request(url,headers={'Accept':'application/rdf+xml'})
    try:
        with urllib.request.urlopen(request,timeout=60) as response:
            data=response.read()
        graph=Graph().parse(data=data,format='xml')
        return graph, data, True
    except urllib.error.HTTPError as error:
        if error.code==404:return Graph(),b'',False
        raise RuntimeError(f'Graph backup failed: HTTP {error.code}') from None

def graph_url(endpoint,graph_uri):
    parts=urllib.parse.urlsplit(endpoint)
    query=[(k,v) for k,v in urllib.parse.parse_qsl(parts.query) if k!='graph']
    query.append(('graph',graph_uri))
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))

def put_graph(endpoint,graph_uri,data):
    request=urllib.request.Request(graph_url(endpoint,graph_uri),data=data,method='PUT',headers={'Content-Type':'application/rdf+xml'})
    with urllib.request.urlopen(request,timeout=60) as response:
        if response.status not in (200,201,204):raise RuntimeError('Unexpected publication response')

def restore_graph(endpoint,item):
    if item['existed']:
        put_graph(endpoint,item['graph_uri'],item['original'])
    else:
        request=urllib.request.Request(graph_url(endpoint,item['graph_uri']),method='DELETE')
        try:
            with urllib.request.urlopen(request,timeout=60):pass
        except urllib.error.HTTPError as error:
            if error.code!=404:raise

def merge_preserving_existing(old,new,slug):
    """Only additive publication. Conflicting single-valued text blocks the batch."""
    conflicts=[]
    approved=[]
    skip_scheme_labels=set()
    single_properties=[SKOS.prefLabel,CAAL.canonicalValue,CAAL.sortOrder]
    for predicate in single_properties:
        for subject in set(new.subjects(predicate,None)):
            old_values=list(old.objects(subject,predicate))
            new_values=list(new.objects(subject,predicate))
            if predicate==SKOS.prefLabel:
                groups={v.language for v in new_values if isinstance(v,Literal)}
                for lang in groups:
                    before={v for v in old_values if isinstance(v,Literal) and v.language==lang}
                    after={v for v in new_values if isinstance(v,Literal) and v.language==lang}
                    if slug=='cultural-periods' and subject==URIRef(ROOT+'scheme/cultural-periods') and before:
                        skip_scheme_labels.update((subject,predicate,v) for v in after if v not in before)
                        continue
                    replacement=APPROVED_LABEL_REPLACEMENTS.get((str(subject),lang))
                    if replacement and before=={Literal(replacement[0],lang=lang)} and after=={Literal(replacement[1],lang=lang)}:
                        approved.append((subject,lang,*replacement))
                    elif len(after)>1 or (before and before!=after):
                        conflicts.append({'vocabulary':slug,'subject':str(subject),'property':str(predicate),'language':lang,
                            'published_values':sorted(map(str,before)),'database_values':sorted(map(str,after))})
            elif old_values and set(old_values)!=set(new_values):
                conflicts.append({'vocabulary':slug,'subject':str(subject),'property':str(predicate),'language':'',
                    'published_values':sorted(map(str,old_values)),'database_values':sorted(map(str,new_values))})
    merged=Graph()
    for graph in (old,new):
        for prefix,namespace in graph.namespaces():merged.bind(prefix,namespace)
        for triple in graph:
            if triple not in skip_scheme_labels:merged.add(triple)
    for subject,lang,old_label,new_label in approved:
        merged.remove((subject,SKOS.prefLabel,Literal(old_label,lang=lang)))
        merged.add((subject,SKOS.altLabel,Literal(old_label,lang=lang)))
    return merged,conflicts

def checked_manifest(path,config):
    items=json.loads(path.read_text())
    if len(items)!=EXPECTED_VOCABULARIES:
        raise RuntimeError(f'Expected {EXPECTED_VOCABULARIES} exporter entries; got {len(items)}. No publication performed.')
    configured={str(v) for v in config.objects(None,SKOSMOS.sparqlGraph)}
    uris=[r['graph_uri'] for r in items]
    if len(uris)!=len(set(uris)):raise RuntimeError('Duplicate graph in export manifest')
    for item in items:
        uri=item['graph_uri']
        if uri not in configured:raise RuntimeError(f'{item["slug"]}: graph is not in current Skosmos configuration')
        if uri in [ROOT+'graph/monument-types',ROOT+'graph/aat-reference']:
            raise RuntimeError('Specialist graph unexpectedly included')
        if item['concept_count']<1:raise RuntimeError(f'{item["slug"]}: empty export')
    return items

def run(repo,apply,only=None):
    exporter=repo/'scripts/export_postgres_lookups_to_skos.py'
    config_path=repo/'dockerfiles/config/config-docker-compose.ttl'
    if not exporter.is_file() or not config_path.is_file():raise RuntimeError('Repository files not found')
    config=Graph().parse(config_path,format='turtle')
    validate_lookup_fixes()
    endpoint=os.getenv('FUSEKI_DATA_URL','http://localhost:9030/skosmos/data')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    folder=repo/'data/generated'/('lookup-refresh-'+stamp)
    folder.mkdir(parents=True)
    rdf_dir=folder/'rdf';backups=folder/'backups';ready=folder/'ready'
    backups.mkdir();ready.mkdir()
    # Exporter's generated loader/config fragment stays in this isolated run directory.
    subprocess.run([sys.executable,str(exporter),'--out-dir',str(rdf_dir),'--strict'],cwd=folder,check=True)
    manifest=checked_manifest(rdf_dir/'manifest.json',config)
    if only:
        manifest=[item for item in manifest if item['slug']==only]
        if not manifest:raise RuntimeError('Unknown publication vocabulary')
    items=[];report=[];conflicts=[]
    for entry in manifest:
        slug=entry['slug'];uri=entry['graph_uri']
        new=Graph().parse(entry['rdf_file'],format='xml')
        old,original,existed=get_graph(endpoint,uri)
        (backups/(slug+'.rdf')).write_bytes(original)
        from workbench_texts import prepare_managed_merge
        prepared,managed_conflicts=prepare_managed_merge(old,new,slug,entry.get("managed_fields",[]))
        merged,found=merge_preserving_existing(prepared,new,slug)
        found.extend(managed_conflicts)
        conflicts.extend(found)
        data=merged.serialize(format='xml',encoding='utf-8')
        (ready/(slug+'.rdf')).write_bytes(data)
        changed=not isomorphic(old,merged)
        label_added=len(set(merged.triples((None,SKOS.prefLabel,None)))-set(old.triples((None,SKOS.prefLabel,None))))
        concept_added=len(set(merged.subjects(RDF.type,SKOS.Concept))-set(old.subjects(RDF.type,SKOS.Concept)))
        report.append({'vocabulary':slug,'exported_concepts':entry['concept_count'],'new_concepts':concept_added,
            'new_labels':label_added,'retained_published_triples':len(set(old)&set(merged)),'changed':changed,'conflicts':len(found),'graph_uri':uri,'graph_existed':existed})
        items.append({'slug':slug,'graph_uri':uri,'old':old,'original':original,'existed':existed,'data':data,'changed':changed})
    (folder/'conflicts.json').write_text(json.dumps(conflicts,ensure_ascii=False,indent=2))
    with (folder/'summary.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(report[0]));writer.writeheader();writer.writerows(report)
    print(f'\nReport and backups: {folder}',flush=True)
    print(f'Checked {len(items)} vocabularies; {sum(i["changed"] for i in items)} would change; {len(conflicts)} text/value conflicts.',flush=True)
    if conflicts:raise RuntimeError('Stopped before publication. Share conflicts.json for review; existing published values have not been overwritten.')
    if not apply:
        print('Check complete. No published graphs changed. Re-run with --apply to refresh after the lookup SQL has been applied.')
        return
    # Detect edits made after backup, before touching any graph.
    for item in items:
        current,_,exists=get_graph(endpoint,item['graph_uri'])
        if exists!=item['existed'] or not isomorphic(current,item['old']):
            raise RuntimeError('Published graph changed during preparation. No publication performed; re-run.')
    attempted=[]
    try:
        for item in items:
            if not item['changed']:continue
            attempted.append(item)  # Include uncertain/failed writes in rollback.
            put_graph(endpoint,item['graph_uri'],item['data'])
            actual,_,_=get_graph(endpoint,item['graph_uri'])
            expected=Graph().parse(data=item['data'],format='xml')
            if not isomorphic(actual,expected):raise RuntimeError('Published graph verification failed')
            print('Updated '+item['slug'],flush=True)
    except Exception:
        failed=[]
        for item in reversed(attempted):
            try:restore_graph(endpoint,item)
            except Exception:failed.append(item['slug'])
        if failed:print('ROLLBACK NEEDS ATTENTION: '+', '.join(failed)+'. Backups are in '+str(backups),file=sys.stderr)
        else:print('Publication failed; attempted graphs restored from backup.',file=sys.stderr)
        raise
    # Restart display services even when the graphs are unchanged, to clear cached results.
    subprocess.run([os.getenv('DOCKER_BIN','docker'),'compose','restart','fuseki-cache','skosmos'],cwd=repo,check=True)
    print('\nComplete. Current lookup vocabularies refreshed, including Cultural Periods with existing CP URIs. Existing published-only content retained; audited Workbench text changes are applied. Site Types and AAT were not changed.',flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--repo',type=Path,default=Path('/opt/vocabulary-explorer'))
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--only')
    args=parser.parse_args()
    try:
        import psycopg
        with psycopg.connect(os.getenv("CAAL_DATABASE_URL") or os.getenv("DATABASE_URL"),autocommit=True) as lock:
            if not lock.execute("SELECT pg_try_advisory_lock(hashtext('caal-generic-vocabulary-edit'))").fetchone()[0]:
                raise RuntimeError("Another vocabulary edit or publication is in progress. Try again.")
            run(args.repo.resolve(),args.apply,args.only)
    except Exception as error:
        # Avoid dumping connection strings or environment variables in exception output.
        if isinstance(error,RuntimeError):print(str(error),file=sys.stderr)
        else:print('Refresh stopped ('+type(error).__name__+'). Check the last successful stage and saved report. Credentials are not printed.',file=sys.stderr)
        return 1
    return 0

if __name__=='__main__':sys.exit(main())
