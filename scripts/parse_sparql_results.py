#!/usr/bin/env python3
"""Parse a bounded SPARQL XML result document. No third-party dependencies."""
import json
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2005/sparql-results#}'
XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang'
MAX_BYTES = 2 * 1024 * 1024


def parse_results(text):
    if len(text.encode('utf-8')) > MAX_BYTES:
        raise ValueError('Getty returned an oversized response')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('DTD and entity declarations are not allowed')
    root = ET.fromstring(text)
    if root.tag != NS + 'sparql':
        raise ValueError('Not a SPARQL XML result document')
    boolean = root.find(NS + 'boolean')
    if boolean is not None:
        return {'head': {}, 'boolean': (boolean.text or '').strip().lower() == 'true'}
    results = root.find(NS + 'results')
    if results is None:
        raise ValueError('No SPARQL result set')
    rows = []
    for result in results.findall(NS + 'result'):
        row = {}
        for binding in result.findall(NS + 'binding'):
            children = list(binding)
            if len(children) != 1 or not binding.get('name'):
                raise ValueError('Malformed SPARQL binding')
            value = children[0]
            kind = value.tag.removeprefix(NS)
            if kind not in ('uri', 'literal', 'bnode'):
                raise ValueError('Unexpected SPARQL value type')
            cell = {'type': kind, 'value': ''.join(value.itertext())}
            if value.get(XML_LANG):
                cell['xml:lang'] = value.get(XML_LANG)
            if value.get('datatype'):
                cell['datatype'] = value.get('datatype')
            row[binding.get('name')] = cell
        rows.append(row)
    return {'head': {}, 'results': {'bindings': rows}}


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('Oversized SPARQL document')
        print(json.dumps(parse_results(raw.decode('utf-8-sig')), ensure_ascii=False))
    except (ValueError, ET.ParseError, UnicodeDecodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
