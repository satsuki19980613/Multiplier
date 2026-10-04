import numpy as np
RANKS="23456789TJQKA"
def class_list():
    """169 classes, index = 0..168. returns names, list of (r1,r2,suited) with r1>=r2"""
    names=[];info=[]
    for r1 in range(12,-1,-1):
        for r2 in range(12,-1,-1):
            if r1==r2: names.append(RANKS[r1]*2); info.append((r1,r2,0))
            elif r1>r2: names.append(RANKS[r1]+RANKS[r2]+"s"); info.append((r1,r2,1))
            else: names.append(RANKS[r2]+RANKS[r1]+"o"); info.append((r2,r1,0))
    return names,info
NAMES,INFO=class_list()
IDX={n:i for i,n in enumerate(NAMES)}
def combos_of(i):
    r1,r2,s=INFO[i]
    out=[]
    if r1==r2:
        for a in range(4):
            for b in range(a+1,4): out.append((r1*4+a,r2*4+b))
    elif s:
        for a in range(4): out.append((r1*4+a,r2*4+a))
    else:
        for a in range(4):
            for b in range(4):
                if a!=b: out.append((r1*4+a,r2*4+b))
    return out
# padded combo array [169,12,2], count [169]
CB=np.zeros((169,12,2),dtype=np.int64); CN=np.zeros(169,dtype=np.int64)
for i in range(169):
    c=combos_of(i); CN[i]=len(c)
    for k,(a,b) in enumerate(c): CB[i,k]=(a,b)
