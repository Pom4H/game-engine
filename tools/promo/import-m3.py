"""Reference-only inspector/converter for the user supplied BMW M3 FBX 7400.
Production geometry is generated from src/vehicles/m3.ts; this tool must not
create or update a runtime mesh asset.
Adapted from the local TheGame inspection reader; requires numpy.
Restricted to this asset format, XYZ transforms and indexed polygon normals.
Keeps authored split normals and material assignments; removes front-wheel steering.
"""
import argparse,struct,zlib,hashlib
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('fbx',type=Path)
parser.add_argument('--output',type=Path,default=Path('artifacts/m3-reference-import'))
args=parser.parse_args();output=args.output;output.mkdir(parents=True,exist_ok=True)
b=args.fbx.read_bytes()
if len(b)>32*1024*1024 or b[:23]!=b'Kaydara FBX Binary  \x00\x1a\x00' or struct.unpack_from('<I',b,23)[0]!=7400:raise ValueError('Expected a binary FBX 7400 smaller than 32 MB')
def node(pos,depth=0):
 if depth>64:raise ValueError('Excessive nesting')
 end,n,plen=struct.unpack_from('<III',b,pos);ln=b[pos+12];pos+=13
 if not end:return None,pos
 if end>len(b) or n>100000:raise ValueError('Invalid FBX node')
 name=b[pos:pos+ln].decode();pos+=ln;props=[]
 for _ in range(n):
  t=chr(b[pos]);pos+=1
  if t in 'YCLIFD':
   fmt={'Y':'h','C':'?','L':'q','I':'i','F':'f','D':'d'}[t];v=struct.unpack_from('<'+fmt,b,pos)[0];pos+=struct.calcsize(fmt)
  elif t in 'fdlibc':
   count,enc,size=struct.unpack_from('<III',b,pos);pos+=12
   if count>4000000 or enc not in [0,1]:raise ValueError('Unsupported array')
   raw=b[pos:pos+size];pos+=size;fmt={'f':'f','d':'d','l':'q','i':'i','b':'?','c':'b'}[t]
   if enc:raw=zlib.decompressobj().decompress(raw,count*struct.calcsize(fmt)+1)
   v=list(struct.unpack('<'+str(count)+fmt,raw))
  elif t in 'SR':
   size=struct.unpack_from('<I',b,pos)[0];pos+=4;raw=b[pos:pos+size];pos+=size;v=raw.decode(errors='replace') if t=='S' else raw.hex()
  else:raise ValueError('Unsupported property '+t)
  props.append(v)
 children=[]
 while pos<end:
  child,pos=node(pos,depth+1)
  if child is None:break
  children.append(child)
 return {'name':name,'p':props,'c':children},end
roots=[];pos=27
while True:
 n,pos=node(pos)
 if not n:break
 roots.append(n)
import json,math,numpy as np
from pathlib import Path

def child(n,k):return next(x for x in n['c'] if x['name']==k)
def props(n):return {x['p'][0]:x['p'][4:] for x in child(n,'Properties70')['c']}
settings=props(child({'c':roots},'GlobalSettings'))
if [settings[k][0] for k in ['UpAxis','UpAxisSign','FrontAxis','FrontAxisSign','CoordAxis','CoordAxisSign']]!=[1,1,2,1,0,1]:raise ValueError('Expected +Y up, +Z front, +X coordinate axis')
unit=settings['UnitScaleFactor'][0]/100
objects=child({'c':roots},'Objects')['c'];byid={o['p'][0]:o for o in objects}
connections=[x['p'][1:] for x in child({'c':roots},'Connections')['c']]
def matrix(id):
 n=byid[id];p=props(n)
 for key in ['PreRotation','PostRotation','RotationPivot','ScalingPivot','GeometricTranslation','GeometricRotation']:
  if any(p.get(key,[0,0,0])):raise ValueError('Unsupported FBX transform '+key)
 if p.get('RotationOrder',[0])!=[0]:raise ValueError('Only XYZ Euler rotations are supported')
 a,b,c=np.radians([0,0,0] if n['p'][1].startswith('Wheel_') else p.get('Lcl Rotation',[0,0,0]));S=np.diag([*p.get('Lcl Scaling',[1,1,1]),1]);T=np.eye(4);T[:3,3]=p.get('Lcl Translation',[0,0,0]);R=np.eye(4)
 Rx=np.array([[1,0,0],[0,np.cos(a),-np.sin(a)],[0,np.sin(a),np.cos(a)]]);Ry=np.array([[np.cos(b),0,np.sin(b)],[0,1,0],[-np.sin(b),0,np.cos(b)]]);Rz=np.array([[np.cos(c),-np.sin(c),0],[np.sin(c),np.cos(c),0],[0,0,1]])
 R[:3,:3]=Rz@Ry@Rx;M=T@R@S;parent=next((b for a,b in connections if a==id and b in byid and byid[b]['name']=='Model'),None)
 return matrix(parent)@M if parent else M
# Engine car faces +X. Proper rotation: +Z -> +X, +X -> -Z.
Q=np.array([[0,0,1],[0,1,0],[-1,0,0]])
parts=[]
for o in objects:
 if o['name']!='Geometry':continue
 gid=o['p'][0];mid=next(b for a,b in connections if a==gid);M=matrix(mid);name=byid[mid]['p'][1].split('\x00')[0]
 v=np.array(child(o,'Vertices')['p'][0]).reshape(-1,3);v=((np.c_[v,np.ones(len(v))]@M.T)[:,:3]*unit)@Q.T
 layer=child(o,'LayerElementNormal')
 if child(layer,'MappingInformationType')['p']!=['ByPolygonVertex'] or child(layer,'ReferenceInformationType')['p']!=['IndexToDirect']:raise ValueError('Unsupported normals')
 normals=np.array(child(layer,'Normals')['p'][0]).reshape(-1,3)@np.linalg.inv(M[:3,:3])@Q.T
 normals/=np.linalg.norm(normals,axis=1)[:,None];ni=child(layer,'NormalsIndex')['p'][0]
 mids=[a for a,b in connections if b==mid and byid[a]['name']=='Material'];names=[byid[i]['p'][1].split('\x00')[0] for i in mids]
 mi=child(child(o,'LayerElementMaterial'),'Materials')['p'][0];polys=child(o,'PolygonVertexIndex')['p'][0]
 wheel=name.startswith('Wheel_');center=(v.min(0)+v.max(0))/2 if wheel else np.zeros(3)
 group={};face=[];fi=0
 for corner,idx in enumerate(polys):
  face.append((idx if idx>=0 else -idx-1,ni[corner]))
  if idx>=0:continue
  material=names[mi[fi if len(mi)>1 else 0]];g=group.setdefault(material,{'positions':[],'normals':[],'indices':[]});start=len(g['positions'])//3
  for vi,n in face:g['positions'].extend(np.round(v[vi]-center,6).tolist());g['normals'].extend(np.round(normals[n],6).tolist())
  for j in range(1,len(face)-1):g['indices'].extend([start,start+j,start+j+1])
  face=[];fi+=1
 for material,g in group.items():
  # Re-author smooth corner normals on paint and tyres. Preserve true creases
  # (more than 48 degrees) and never blend across a material boundary.
  if material in ['CarPaint','Tires','Rims']:
   pv=np.array(g['positions']).reshape(-1,3);pn=np.array(g['normals']).reshape(-1,3);groups={}
   for j,p in enumerate(pv):groups.setdefault(tuple(np.round(p,5)),[]).append(j)
   result=pn.copy()
   for same in groups.values():
    ns=pn[same]
    for j in same:
     close=ns[(ns@pn[j])>np.cos(np.radians(48))];avg=close.sum(0);length=np.linalg.norm(avg)
     if length>1e-9:result[j]=avg/length
   g['normals']=np.round(result,6).flatten().tolist()
  parts.append({'name':name+'-'+material,'material':material,'wheel':wheel,'center':np.round(center,6).tolist(),'mesh':{'kind':'triangle-mesh',**g}})
report={'source':args.fbx.name,'sha256':hashlib.sha256(b).hexdigest(),'sourceKind':'User supplied local asset, previously referenced by TheGame','conversion':'metres; +Y up; +X forward; straight front wheels; crease-aware smooth paint/tyre normals','parts':len(parts),'triangles':sum(len(p['mesh']['indices'])//3 for p in parts)}
(output/'m3.json').write_text(json.dumps({'provenance':report,'parts':parts},separators=(',',':')))
(output/'m3-provenance.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
