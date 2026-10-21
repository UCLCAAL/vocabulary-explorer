import importlib.util
import pathlib
import unittest
import json
import subprocess
from rdflib.plugins.sparql.parser import parseQuery
from rdflib import Graph, URIRef, Literal
from rdflib.namespace import SKOS, OWL

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('exporter', ROOT / 'scripts/export_site_types_from_db.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class Cursor:
    def __init__(self, alignments):
        self.alignments = alignments
        self.rows = []

    def execute(self, sql, params=None):
        if 'FROM public.vocabulary_schemes' in sql:
            self.rows = [('https://vocab.uclcaal.org/scheme/site-types', 'https://vocab.uclcaal.org/concept/')]
        elif 'FROM public.vocabulary_scheme_labels' in sql:
            self.rows = [('en', 'Site Types')]
        elif 'FROM public.vocabulary_scheme_notes' in sql:
            self.rows = []
        elif 'FROM public.concepts_curated' in sql:
            self.rows = [(cid, None, 'L2', cid, 'true', i, 'active', None) for i, cid in enumerate(['MT-2-0014', 'MT-2-0076', 'MT-3-0038', 'MT-2-0999'])]
            self.rows.append(('MT-2-0888', None, 'L2', 'Retired fixture', 'false', 100, 'retired', 'MT-2-0999'))
        elif 'FROM public.labels_curated' in sql:
            self.rows = [('MT-2-0888', 'en', 'Retired fixture', 'preferred', '1')]
        elif 'FROM public.concept_notes_curated' in sql or 'FROM public.concept_bibliographic_links' in sql:
            self.rows = []
        elif 'FROM vocab_workbench.concept_id_registry' in sql:
            self.rows = [('MT-2-0777', {'labels': [{'lang': 'en', 'label': 'Deleted fixture', 'status': 'preferred'}]})]
        elif 'FROM vocab_workbench.site_type_alignments' in sql:
            assert "status = 'accepted'" in sql
            self.rows = [row[:6] for row in self.alignments if row[6] == 'accepted']
        else:
            raise AssertionError(sql)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class AlignmentExportTests(unittest.TestCase):
    def test_generated_search_and_detail_queries_are_valid_sparql(self):
        queries = json.loads(subprocess.check_output([
            'node', '-e', 'const g=require("./workbench/services/getty");process.stdout.write(JSON.stringify([g.searchQuery("caravanserai"),g.detailQuery("300007148")]));'
        ], cwd=ROOT, text=True))
        for query in queries:
            parseQuery(query)
        # Evaluate the detail query against a real RDF graph with Getty's model.
        from rdflib import BNode, Namespace
        gvp = Namespace('http://vocab.getty.edu/ontology#')
        xl = Namespace('http://www.w3.org/2008/05/skos-xl#')
        target = URIRef('http://vocab.getty.edu/aat/300007148')
        label = BNode()
        graph = Graph()
        graph.add((target, SKOS.inScheme, URIRef('http://vocab.getty.edu/aat/')))
        graph.add((target, gvp.prefLabelGVP, label))
        graph.add((label, xl.literalForm, Literal('caravanserais', lang='en')))
        rows = list(graph.query(queries[1]))
        self.assertTrue(any(str(row.kind) == 'preferred' and str(row.value) == 'caravanserais' for row in rows))

    def test_legacy_mappings_and_rejected_or_withdrawn_decisions(self):
        original = Graph().parse(ROOT / 'data/alignments/caal-aat-site-types.ttl', format='turtle')
        rows = [(str(s).rsplit('/', 1)[1], str(o), str(p).rsplit('#', 1)[1], 'Fixture AAT label', 'en', {}, 'accepted') for s, p, o in original]
        rows += [('MT-2-0999', 'http://vocab.getty.edu/aat/300000001', 'exactMatch', 'pending', 'en', {}, 'proposed'),
                 ('MT-2-0999', 'http://vocab.getty.edu/aat/300000002', 'closeMatch', 'rejected', 'en', {}, 'rejected'),
                 ('MT-2-0999', 'http://vocab.getty.edu/aat/300000003', 'broadMatch', 'withdrawn', 'en', {}, 'deprecated')]
        graph = exporter.build_curated_graph(Cursor(rows))
        for triple in original:
            self.assertIn(triple, graph)
        source = URIRef('https://vocab.uclcaal.org/concept/MT-2-0999')
        for predicate in [SKOS.exactMatch, SKOS.closeMatch, SKOS.broadMatch]:
            self.assertEqual(list(graph.objects(source, predicate)), [])
        self.assertEqual(exporter.graph_summary(graph)['accepted_alignments'], 4)
        self.assertIn((URIRef('https://vocab.uclcaal.org/concept/MT-2-0888'), OWL.deprecated, Literal(True)), graph)
        self.assertIn((URIRef('https://vocab.uclcaal.org/concept/MT-2-0777'), OWL.deprecated, Literal(True)), graph)
        # Both RDF/XML outputs round-trip through the real RDF parser.
        self.assertEqual(len(Graph().parse(data=graph.serialize(format='xml'), format='xml')), len(graph))
        ref = graph._caal_aat_reference_graph
        self.assertIn((URIRef('http://vocab.getty.edu/aat/300007148'), SKOS.prefLabel, Literal('Fixture AAT label', lang='en')), ref)
        self.assertEqual(len(Graph().parse(data=ref.serialize(format='xml'), format='xml')), len(ref))

    def test_withdrawing_an_imported_mapping_removes_the_triple(self):
        graph = exporter.build_curated_graph(Cursor([('MT-2-0014', 'http://vocab.getty.edu/aat/300007148', 'exactMatch', 'caravanserais', 'en', {}, 'deprecated')]))
        self.assertEqual(list(graph.triples((None, SKOS.exactMatch, None))), [])
        self.assertEqual(exporter.graph_summary(graph)['accepted_alignments'], 0)


if __name__ == '__main__':
    unittest.main()
