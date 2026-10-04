import numpy as np, json, glob, re, os, gzip
from hands import NAMES
P=np.load("hu_P.npy");Q=np.load("hu_Q.npy");st=np.load("hu_stacks.npy")
q=lambda v:[int(round(float(x)*100)) for x in v]
hu={"hands":NAMES,"note":"HU chipEV push/fold Nash. push[k]= SB jam % per hand at effective stack stacks[k] (bb, SB total stack incl. blind). call[k]= BB call %.","stacks":[float(s) for s in st],"push":[q(r) for r in P],"call":[q(r) for r in Q]}
json.dump(hu,open("export/hu_pushfold.json","w"),separators=(',',':'))
tw={"hands":NAMES,"note":"3-handed (BTN/SB/BB) chipEV push/fold Nash, equal stacks s (bb). nodes: a=BTN push; sp=SB push after BTN fold; sc=SB call vs BTN push; b1=BB call vs SB push (BTN folded); b2=BB call vs BTN push (SB folded); b3=BB call vs BTN push+SB call. values = % per hand.","stacks":[],"tables":{}}
for f in sorted(glob.glob("nash3_*.npz"),key=lambda s:[float(x) for x in re.findall(r"nash3_([\d.]+)_([\d.]+)_([\d.]+)",s)[0]]):
    a,b,c=[float(x) for x in re.findall(r"nash3_([\d.]+)_([\d.]+)_([\d.]+)\.npz",f)[0]]
    if a==b==c:
        d=np.load(f); tw["stacks"].append(int(a)); tw["tables"][str(int(a))]={k:q(d[k]) for k in ['a','sp','sc','b1','b2','b3']}
json.dump(tw,open("export/threeway_equal_stacks.json","w"),separators=(',',':'))
asym={"note":"asymmetric stacks [BTN,SB,BB]","tables":{}}
for f in glob.glob("nash3_*.npz"):
    a,b,c=[float(x) for x in re.findall(r"nash3_([\d.]+)_([\d.]+)_([\d.]+)\.npz",f)[0]]
    if not(a==b==c):
        d=np.load(f); asym["tables"][f"{a:g},{b:g},{c:g}"]={k:q(d[k]) for k in ['a','sp','sc','b1','b2','b3']}
json.dump(asym,open("export/threeway_asym_examples.json","w"),separators=(',',':'))
for f in os.listdir("export"):
    p="export/"+f; raw=open(p,'rb').read(); print(f,len(raw),"bytes; gz",len(gzip.compress(raw)))
# binary compact: uint8 per hand per node
n=len(tw["stacks"]); print("equal stacks",tw["stacks"])
