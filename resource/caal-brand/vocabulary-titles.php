<?php
// Read only the vocabulary scheme labels from the public RDF graphs.
// The browser cannot supply a query or change the upstream address.
header('Content-Type: application/json; charset=utf-8');

$query = <<<'SPARQL'
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT DISTINCT ?scheme ?label WHERE {
  GRAPH ?graph {
    ?scheme a skos:ConceptScheme ; skos:prefLabel ?label .
  }
  FILTER (STRSTARTS(STR(?graph), "https://vocab.uclcaal.org/graph/"))
  FILTER (STRSTARTS(STR(?scheme), "https://vocab.uclcaal.org/scheme/"))
  FILTER (LCASE(LANG(?label)) IN ("en", "ru", "zh", "kk", "ky", "tg", "tk", "uz"))
}
LIMIT 1000
SPARQL;

$context = stream_context_create(['http' => [
    'timeout' => 3,
    'follow_location' => 0,
    'header' => "Accept: application/sparql-results+json\r\nConnection: close\r\n",
]]);
$url = 'http://fuseki:3030/skosmos/sparql?query=' . rawurlencode($query);
$result = @file_get_contents($url, false, $context, 0, 262145);
$data = $result !== false && strlen($result) <= 262144 ? json_decode($result, true) : null;
if (!is_array($data['results']['bindings'] ?? null)) {
    http_response_code(503);
    header('Cache-Control: no-store');
    echo '{"error":"Vocabulary names are temporarily unavailable."}';
    exit;
}

header('Cache-Control: public, max-age=300');
echo $result;
