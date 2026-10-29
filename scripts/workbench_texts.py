"""Read audited Workbench text and mapping edits for RDF export and safe publication."""
from collections import defaultdict
from rdflib import Literal,URIRef
from rdflib.namespace import SKOS,RDF
from psycopg.rows import dict_row
ROOT='https://vocab.uclcaal.org/'
FIELDS={'preferred':SKOS.prefLabel,'alternative':SKOS.altLabel,'definition':SKOS.definition,'scopeNote':SKOS.scopeNote,'description':SKOS.scopeNote}

def read_rows(conn,query,params=()):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query,params)
        return cur.fetchall()

def export_workbench(conn,g,slug,concept_uri):
    if not read_rows(conn,"SELECT to_regclass('vocab_workbench.editor_texts') AS t")[0]['t']:
        return []
    texts=read_rows(conn,'SELECT * FROM vocab_workbench.editor_texts WHERE vocabulary_code=%s',(slug,))
    revisions=read_rows(conn,'SELECT * FROM vocab_workbench.editor_revisions WHERE vocabulary_code=%s ORDER BY revision_id',(slug,))
    managed={}
    for r in revisions:
        if r['field'] not in FIELDS:continue
        key=(r['concept_id'],r['field'],r['lang'])
        item=managed.setdefault(key,{'allowed':set(),'values':[]})
        item['allowed'].update(r['old_values']);item['allowed'].update(r['new_values']);item['values']=r['new_values']
    for r in texts:
        if r['field'] not in FIELDS:continue
        subject=URIRef(ROOT+'scheme/'+slug) if not r['concept_id'] else concept_uri(r['concept_id'])
        if r['concept_id'] and (subject,RDF.type,SKOS.Concept) not in g:
            raise RuntimeError('Workbench text refers to a concept outside this export')
        predicate=FIELDS[r['field']]
        for value in list(g.objects(subject,predicate)):
            if isinstance(value,Literal) and value.language==r['lang']:g.remove((subject,predicate,value))
        for value in r['texts']:g.add((subject,predicate,Literal(value,lang=r['lang'])))
    result=[]
    for (cid,field,lang),item in managed.items():
        subject=URIRef(ROOT+'scheme/'+slug) if not cid else concept_uri(cid)
        actual=sorted(str(v) for v in g.objects(subject,FIELDS[field]) if isinstance(v,Literal) and v.language==lang)
        if set(actual)!=set(item['values']):raise RuntimeError('Audited text and current source differ. Refresh the workbench before publishing.')
        result.append({'subject':str(subject),'property':str(FIELDS[field]),'language':lang,'allowed':sorted(item['allowed']),'values':actual,'kind':'text'})
    if slug=='site-types':return result
    mappings=read_rows(conn,'SELECT * FROM vocab_workbench.editor_alignments WHERE vocabulary_code=%s',(slug,))
    groups=defaultdict(lambda:{'allowed':set(),'values':set()})
    for r in mappings:
        import re
        if r['relation'] not in ['exactMatch','closeMatch','broadMatch','narrowMatch','relatedMatch'] or not re.fullmatch(r'http://vocab[.]getty[.]edu/aat/[0-9]{9}',r['target_uri']):raise RuntimeError('Invalid saved mapping')
        subject=concept_uri(r['source_concept_id']);predicate=SKOS[r['relation']]
        item=groups[(subject,predicate)];item['allowed'].add(r['target_uri'])
        if r['status']=='accepted':
            if (subject,RDF.type,SKOS.Concept) not in g:raise RuntimeError('Accepted alignment source is missing')
            g.add((subject,predicate,URIRef(r['target_uri'])));item['values'].add(r['target_uri'])
    for (s,p),item in groups.items():result.append({'subject':str(s),'property':str(p),'language':'','allowed':sorted(item['allowed']),'values':sorted(item['values']),'kind':'uri'})
    return result

def prepare_managed_merge(old,new,slug,managed):
    """Replace only audited fields. A published value absent from the audit stops publication."""
    from rdflib import Graph
    result=Graph()
    for t in old:result.add(t)
    conflicts=[]
    for item in managed:
        s,p=URIRef(item['subject']),URIRef(item['property']);lang=item['language'];allowed=set(item['allowed'])
        before=([v for v in result.objects(s,p) if isinstance(v,URIRef) and str(v) in allowed] if item['kind']=='uri' else [v for v in result.objects(s,p) if isinstance(v,Literal) and v.language==lang])
        if item['kind']=='text' and any(str(v) not in allowed for v in before):
            conflicts.append({'vocabulary':slug,'subject':str(s),'property':str(p),'language':lang,'published_values':sorted(map(str,before)),'database_values':item['values']});continue
        actual=sorted(str(v) for v in new.objects(s,p) if isinstance(v,Literal) and v.language==lang) if item['kind']=='text' else sorted(str(v) for v in new.objects(s,p) if isinstance(v,URIRef) and str(v) in allowed)
        if actual!=sorted(item['values']):raise RuntimeError('Invalid managed-text export manifest')
        for v in before:result.remove((s,p,v))
    return result,conflicts
