#!/usr/bin/env python3
"""Read only the numerical area/formant tables of Story (2008).

Research-only importer; never used by the browser, synth or normal CI. The
article is not redistributed. All downloaded bytes remain in memory. Fixed
known cells and row/column counts guard against a different article or a
silently broken parse. DOI: 10.1121/1.2805683, Tables I and II.
"""
from html.parser import HTMLParser
from urllib.request import Request, urlopen
import json
import xml.etree.ElementTree as ET

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
]
errors=[]
for url in urls:
    try:
        raw=urlopen(Request(url,headers={'User-Agent':'game-engine speech research (numerical tables only)'}),timeout=30).read()
        parser=Tables();parser.feed(raw.decode('utf-8'))
        area=next(table for table in parser.tables if sum(len(row)==12 and row[0].isdigit() for row in table)==44)
        rows=[row for row in area if len(row)==12 and row[0].isdigit()]
        assert [int(row[0]) for row in rows]==list(range(1,45))
        values=[[float(cell) for cell in row[1:]] for row in rows]
        assert values[0]==[.51,.28,.29,.37,.31,.23,.56,.27,.38,.37,.54]
        assert values[-1]==[.91,.82,.95,.78,4.17,.99,4.72,.90,.47,.59,.16]
        assert all(0<x<20 for row in values for x in row)
        print('STORY_2008_AREA_ROWS='+json.dumps(values))
        print('STORY_2008_TABLE_METADATA='+json.dumps([r for r in area if r not in rows],ensure_ascii=False))
        for table in parser.tables:
            if table!=area and any('295' in ' '.join(row) and '478' in ' '.join(row) for row in table):
                print('STORY_2008_FORMANTS='+json.dumps(table,ensure_ascii=False))
        break
    except Exception as error:
        errors.append(url+': '+str(error))
else:
    raise SystemExit('\n'.join(errors))
