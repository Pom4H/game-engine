#!/usr/bin/env python3
"""Research-only importer for numerical Story (2008), DOI 10.1121/1.2805683.
The paper is not bundled or used as a runtime dependency. Report parse failures
explicitly; do not confuse an anti-bot page or a partial table with observations.
"""
from html.parser import HTMLParser
from urllib.request import Request, urlopen
import json

class Tables(HTMLParser):
    def __init__(self):
        super().__init__(); self.tables=[]; self.table=None; self.row=None; self.cell=None
    def handle_starttag(self, tag, attrs):
        if tag=='table': self.table=[]
        elif tag=='tr' and self.table is not None: self.row=[]
        elif tag in ('td','th') and self.row is not None: self.cell=[]
    def handle_data(self, text):
        if self.cell is not None: self.cell.append(text)
    def handle_endtag(self, tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(''.join(self.cell).strip()); self.cell=None
        elif tag=='tr' and self.row is not None:
            self.table.append(self.row); self.row=None
        elif tag=='table' and self.table is not None:
            self.tables.append(self.table); self.table=None

urls=[
 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC2377017/fullTextXML',
 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/',
 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/table/T1/?report=objectonly',
]
errors=[]
for url in urls:
    try:
        raw=urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; numerical-research/1.0)'}),timeout=30).read()
        parser=Tables();parser.feed(raw.decode('utf-8'))
        print('REFERENCE_PARSE='+json.dumps({'url':url,'bytes':len(raw),'tables':[[len(t),t[:2],t[-2:]] for t in parser.tables]},ensure_ascii=False))
        candidates=[table for table in parser.tables if sum(len(row)==12 and row[0].isdigit() for row in table)==44]
        if not candidates:
            print('REFERENCE_PAGE_PREFIX='+raw[:600].decode('utf-8',errors='replace'))
            raise ValueError('No complete 44x11 numerical table')
        area=candidates[0];rows=[row for row in area if len(row)==12 and row[0].isdigit()]
        assert [int(row[0]) for row in rows]==list(range(1,45)), 'Section indices changed'
        values=[[float(cell) for cell in row[1:]] for row in rows]
        assert values[0]==[.51,.28,.29,.37,.31,.23,.56,.27,.38,.37,.54], 'Known first row does not identify Story 2008'
        assert all(0<x<20 for row in values for x in row), 'Area dimensions/range'
        print('STORY_2008_AREA_ROWS='+json.dumps(values))
        print('STORY_2008_TABLE_METADATA='+json.dumps([r for r in area if r not in rows],ensure_ascii=False))
        for table in parser.tables:
            if table!=area and any('295' in ' '.join(row) and '478' in ' '.join(row) for row in table):
                print('STORY_2008_FORMANTS='+json.dumps(table,ensure_ascii=False))
        break
    except Exception as error:
        errors.append(url+': '+type(error).__name__+': '+str(error))
else:
    raise SystemExit('\n'.join(errors))
