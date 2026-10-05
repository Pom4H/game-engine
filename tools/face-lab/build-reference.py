"""Extract only a CC0 head and bake a sparse, topology-aware skin binding.
No MakeHuman application code is used. Source OBJ's Git blob ID is pinned;
indices below are authored landmarks on that exact mesh, not runtime guesses.
Requires numpy/scipy only when regenerating the checked-in asset.
"""
import base64,collections,hashlib,json,sys
from pathlib import Path
import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import splu
SOURCE_BLOB='d26635e9326e3cca30778fd7b9c00062b03cce09'
raw=Path(sys.argv[1]).read_bytes()
if hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()!=SOURCE_BLOB:raise ValueError('Wrong anatomical source')
p=[];faces=[];group=''
for line in raw.decode().splitlines():
    if line.startswith('v '):p.append(list(map(float,line.split()[1:])))
    elif line.startswith('g '):group=line[2:]
    elif line.startswith('f ') and group=='body':faces.append([int(v.split('/')[0])-1 for v in line.split()[1:]])
p=np.array(p);faces=[f for f in faces if min(p[v,1] for v in f)>6.0]
vs=sorted(set(v for f in faces for v in f));remap={v:i for i,v in enumerate(vs)};p=p[vs];faces=[[remap[v] for v in f]for f in faces]
# MakeHuman Y-up, +Z face -> engine Y-up, +X face. Metres.
p=np.stack([.095*(p[:,2]-.46),(p[:,1]-7.28415)*.109+.029,p[:,0]*.11],axis=1)
# Continuous edge loops around the oral entrance and the two eyelids.
mouth=[474,473,472,471,470,1740,469,419,418,433,430,1357,428,429,1330,443,438,476,482,481,487,493,2635,2629,2630,2624,2591,2596,3419,2582,2581,3446,2583,2586,2571,2572,2618,3812,2619,2620,2621,2622]
eye=[3105,3122,3123,3124,3129,3125,3126,3127,3128,3121,3565,3120,3119,3118,3117,3116,3115,3114,3564,3113,3112,3111,3110,3109,3108,3107,3106,3104]
mirror=[]
for v in eye:
    q=p[v].copy();q[2]*=-1;d=np.linalg.norm(p-q,axis=1);i=int(d.argmin())
    if d[i]>1e-8:raise ValueError('Non-symmetric reference eye')
    mirror.append(i)
loops=[mouth,mirror,eye];barrier={tuple(sorted((l[i],l[(i+1)%len(l)]))) for l in loops for i in range(len(l))}
edge_faces=collections.defaultdict(list)
for i,f in enumerate(faces):
    for j in range(len(f)):edge_faces[tuple(sorted((f[j],f[(j+1)%len(f)])))].append(i)
if not barrier.issubset(edge_faces):raise ValueError('Landmark loop must follow real mesh edges')
neighbors=[[]for _ in faces]
for edge,fs in edge_faces.items():
    if len(fs)==2 and edge not in barrier:a,b=fs;neighbors[a].append(b);neighbors[b].append(a)
components=[];seen=set()
for start in range(len(faces)):
    if start in seen:continue
    todo=[start];part=[];seen.add(start)
    while todo:
        i=todo.pop();part.append(i)
        for j in neighbors[i]:
            if j not in seen:seen.add(j);todo.append(j)
    components.append(part)
if len(components)!=4:raise ValueError('Expected outer skin and three cavity interiors')
faces=[faces[i]for i in max(components,key=len)]
used=sorted(set(v for f in faces for v in f));remap={v:i for i,v in enumerate(used)};p=p[used];faces=[[remap[v]for v in f]for f in faces];loops=[[remap[v]for v in l]for l in loops]
# Match the two lip edges' horizontal sample positions. Then a curved,
# asymmetric smile is a true area-preserving shear even at a closed mouth.
mouth=loops[0];zs=sorted(set(round(float(p[v,2]),9) for v in mouth));splits={};new_loop=[]
for k,a in enumerate(mouth):
    b=mouth[(k+1)%len(mouth)];za,zb=p[a,2],p[b,2];new_loop.append(a)
    inside=[z for z in zs if min(za,zb)+1e-9<z<max(za,zb)-1e-9]
    if zb<za:inside.reverse()
    inserted=[]
    for z in inside:
        u=(z-za)/(zb-za);v=len(p);p=np.vstack([p,p[a]*(1-u)+p[b]*u]);p[v,2]=z;inserted.append(v);new_loop.append(v)
    if inserted:splits[(a,b)]=inserted;splits[(b,a)]=inserted[::-1]
new_faces=[]
for f in faces:
    g=[]
    for k,v in enumerate(f):g.append(v);g.extend(splits.get((v,f[(k+1)%len(f)]),[]))
    if len(g)>4:
        center=len(p);p=np.vstack([p,p[g].mean(0)])
        for k,v in enumerate(g):new_faces.append([center,v,g[(k+1)%len(g)]])
    else:new_faces.append(g)
faces=new_faces;loops[0]=new_loop
tri=[];adj=[set()for _ in p]
for f in faces:
    for j in range(len(f)):a,b=f[j],f[(j+1)%len(f)];adj[a].add(b);adj[b].add(a)
    for j in range(1,len(f)-1):tri.append([f[0],f[j+1],f[j]]) # handedness conversion
# Bind nearby vertices to boundary displacements; outside eight graph edges
# is an anchor. Geodesic adjacency avoids skin influence jumping across lips.
boundary=[v for l in loops for v in l];bi={v:i for i,v in enumerate(boundary)}
dist={v:0 for v in boundary};queue=collections.deque(boundary)
while queue:
    v=queue.popleft()
    if dist[v]>=8:continue
    for w in adj[v]:
        if w not in dist:dist[w]=dist[v]+1;queue.append(w)
active=sorted(v for v,d in dist.items()if d<8 and v not in bi);ai={v:i for i,v in enumerate(active)}
A=lil_matrix((len(active),len(active)));B=np.zeros((len(active),len(boundary)))
for v in active:
    i=ai[v];A[i,i]=len(adj[v])
    for w in adj[v]:
        if w in ai:A[i,ai[w]]=-1
        elif w in bi:B[i,bi[w]]=1
W=splu(A.tocsc()).solve(B);W=np.maximum(0,W)
# Eight largest influences preserve each row's attenuation. No pose data or
# recorded motion is stored, only a fixed geometric skin binding.
wi=np.argsort(-W,axis=1)[:,:8];ww=np.take_along_axis(W,wi,axis=1);ww*=W.sum(1,keepdims=True)/np.maximum(1e-15,ww.sum(1,keepdims=True))
mins=p.min(0);maxs=p.max(0);quant=np.round((p-mins)/(maxs-mins)*65535).astype('<u2')
b64=lambda a:base64.b64encode(np.asarray(a).tobytes()).decode()
data={'sourceGitBlob':SOURCE_BLOB,'sourceSha256':hashlib.sha256(raw).hexdigest(),'license':'CC0-1.0','vertices':len(p),'triangles':len(tri),'min':mins.tolist(),'max':maxs.tolist(),'positionsU16Base64':b64(quant),'indicesU16Base64':b64(np.array(tri,dtype='<u2')),'mouth':loops[0],'mouthU':[round(float(p[v,2]/max(abs(p[k,2])for k in loops[0])),8)for v in loops[0]],'eyes':loops[1:],'binding':{'verticesU16':b64(np.array(active,dtype='<u2')),'controlsU16':b64(wi.astype('<u2')),'weightsF32':b64(ww.astype('<f4')),'influences':8}}
path=Path(sys.argv[2]);path.parent.mkdir(parents=True,exist_ok=True)
path.write_text('/** Generated from MakeHuman CC0 hm08, only head skin. See tools/face-lab/build-reference.py and licenses/face-reference.md. */\nexport const FACE_REFERENCE='+json.dumps(data,separators=(',',':'))+' as const;\n')
print(json.dumps({'vertices':len(p),'triangles':len(tri),'boundaryControls':len(boundary),'boundSkinVertices':len(active),'assetBytes':path.stat().st_size,'sourceSha256':data['sourceSha256']}))
