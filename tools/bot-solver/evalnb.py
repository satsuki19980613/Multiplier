import numpy as np, numba as nb
# straight high-card lookup for 13-bit rank mask (bit0 = '2' ... bit12='A'); returns 0 if none else highest rank idx (3..12), wheel => 3
@nb.njit(cache=True)
def straight_high(mask):
    # wheel: A,2,3,4,5
    best=-1
    for hi in range(12,3,-1):
        m=0x1F<<(hi-4)
        if (mask&m)==m: return hi
    if (mask&0x100F)==0x100F: return 3
    return -1
@nb.njit(cache=True)
def top5(mask):
    # encode top 5 ranks of mask base 13
    v=0;n=0
    for r in range(12,-1,-1):
        if mask>>r&1:
            v=v*13+r; n+=1
            if n==5: break
    return v
@nb.njit(cache=True)
def eval7(c0,c1,c2,c3,c4,c5,c6):
    cnt=np.zeros(13,np.int64); sm=np.zeros(4,np.int64); sc=np.zeros(4,np.int64)
    cs=np.array([c0,c1,c2,c3,c4,c5,c6])
    for c in cs:
        r=c>>2; s=c&3
        cnt[r]+=1; sm[s]|=(1<<r); sc[s]+=1
    # flush
    for s in range(4):
        if sc[s]>=5:
            sh=straight_high(sm[s])
            if sh>=0: return 8*10000000+sh
            return 5*10000000+top5(sm[s])
    quad=-1;trips=[-1,-1];pairs=[-1,-1,-1];nt=0;np_=0;mask=0
    for r in range(12,-1,-1):
        k=cnt[r]
        if k>0: mask|=(1<<r)
        if k==4: quad=r
        elif k==3:
            if nt<2: trips[nt]=r
            nt+=1
        elif k==2:
            if np_<3: pairs[np_]=r
            np_+=1
    if quad>=0:
        kick=-1
        for r in range(12,-1,-1):
            if cnt[r]>0 and r!=quad: kick=r;break
        return 7*10000000+quad*13+kick
    if nt>=1 and (nt>=2 or np_>=1):
        p=trips[1] if nt>=2 else -1
        if np_>=1 and pairs[0]>p: p=pairs[0]
        return 6*10000000+trips[0]*13+p
    sh=straight_high(mask)
    if sh>=0: return 4*10000000+sh
    if nt==1:
        v=trips[0];n=0
        for r in range(12,-1,-1):
            if cnt[r]>0 and r!=trips[0]:
                v=v*13+r;n+=1
                if n==2:break
        return 3*10000000+v
    if np_>=2:
        v=pairs[0]*13+pairs[1]
        for r in range(12,-1,-1):
            if cnt[r]>0 and r!=pairs[0] and r!=pairs[1]:
                v=v*13+r;break
        return 2*10000000+v
    if np_==1:
        v=pairs[0];n=0
        for r in range(12,-1,-1):
            if cnt[r]>0 and r!=pairs[0]:
                v=v*13+r;n+=1
                if n==3:break
        return 1*10000000+v
    return top5(mask)
