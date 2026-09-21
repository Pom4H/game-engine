import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image
import torch
import lpips

p=argparse.ArgumentParser()
p.add_argument('--production',required=True)
p.add_argument('--reference',required=True)
p.add_argument('--mask',required=True)
p.add_argument('--out',required=True)
args=p.parse_args()

def rgb(path):
    return np.asarray(Image.open(path).convert('RGB'),dtype=np.float32)/255.0

production,reference=rgb(args.production),rgb(args.reference)
mask=np.asarray(Image.open(args.mask).convert('L'),dtype=np.float32)/255.0>=.5
if production.shape!=reference.shape or production.shape[:2]!=mask.shape:
    raise ValueError('LPIPS image/mask dimensions differ')
ys,xs=np.where(mask)
if len(xs)<64: raise ValueError('LPIPS mask contains too few active pixels')
pad=16
x0=max(0,int(xs.min())-pad);x1=min(mask.shape[1],int(xs.max())+1+pad)
y0=max(0,int(ys.min())-pad);y1=min(mask.shape[0],int(ys.max())+1+pad)
production=production[y0:y1,x0:x1]
reference=reference[y0:y1,x0:x1]
local=mask[y0:y1,x0:x1,None]
# Make non-evaluation pixels identical, so LPIPS context sees the silhouette but
# cannot reward/penalize an unrelated captured background.
production=np.where(local,production,reference)
def tensor(image):
    return torch.from_numpy(image.transpose(2,0,1)).unsqueeze(0)*2.0-1.0

device='cuda' if torch.cuda.is_available() else 'cpu'
metric=lpips.LPIPS(net='alex').to(device).eval()
with torch.inference_mode():
    score=float(metric(tensor(production).to(device),tensor(reference).to(device)).item())
Path(args.out).parent.mkdir(parents=True,exist_ok=True)
Path(args.out).write_text(json.dumps({'lpips':score,'device':device,'crop':[x0,y0,x1,y1]},indent=2))
print(json.dumps({'lpips':score,'device':device}))
