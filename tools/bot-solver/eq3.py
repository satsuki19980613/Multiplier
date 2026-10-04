import numpy as np, numba as nb, time, sys
from hands import CB,CN
from evalnb import eval7

@nb.njit(parallel=True,cache=True)
def w3_table(CB,CN):
    """W3[i,j,k] = number of ordered combo triples (c1 in i, c2 in j, c3 in k) pairwise disjoint"""
    W=np.zeros((169,169,169),np.float32)
    for i in nb.prange(169):
        for j in range(169):
            for k in range(169):
                n=0
                for a in range(CN[i]):
                    a0=CB[i,a,0];a1=CB[i,a,1]
                    for b in range(CN[j]):
                        b0=CB[j,b,0];b1=CB[j,b,1]
                        if b0==a0 or b0==a1 or b1==a0 or b1==a1: continue
                        for c in range(CN[k]):
                            c0=CB[k,c,0];c1=CB[k,c,1]
                            if c0==a0 or c0==a1 or c1==a0 or c1==a1 or c0==b0 or c0==b1 or c1==b0 or c1==b1: continue
                            n+=1
                W[i,j,k]=n
    return W

@nb.njit(parallel=True,cache=True)
def eq3_sorted(CB,CN,W,N,seed):
    """equity (share) of each of 3 players for sorted triples i<=j<=k. returns array [169,169,169,3] sparse (only i<=j<=k filled)"""
    out=np.zeros((169,169,169,3),np.float32)
    for i in nb.prange(169):
        np.random.seed(seed+i)
        board=np.zeros(5,np.int64)
        for j in range(i,169):
            for k in range(j,169):
                if W[i,j,k]==0:
                    continue
                t0=0.0;t1=0.0;t2=0.0
                for t in range(N):
                    used=np.zeros(52,np.int64)
                    while True:
                        a=np.random.randint(0,CN[i]);a0=CB[i,a,0];a1=CB[i,a,1]
                        break
                    used[a0]=1;used[a1]=1
                    while True:
                        b=np.random.randint(0,CN[j]);b0=CB[j,b,0];b1=CB[j,b,1]
                        if used[b0]==0 and used[b1]==0: break
                    used[b0]=1;used[b1]=1
                    while True:
                        c=np.random.randint(0,CN[k]);c0=CB[k,c,0];c1=CB[k,c,1]
                        if used[c0]==0 and used[c1]==0: break
                    used[c0]=1;used[c1]=1
                    m=0
                    while m<5:
                        x=np.random.randint(0,52)
                        if used[x]==0:
                            used[x]=1;board[m]=x;m+=1
                    s0=eval7(a0,a1,board[0],board[1],board[2],board[3],board[4])
                    s1=eval7(b0,b1,board[0],board[1],board[2],board[3],board[4])
                    s2=eval7(c0,c1,board[0],board[1],board[2],board[3],board[4])
                    mx=max(s0,max(s1,s2))
                    nw=(s0==mx)+(s1==mx)+(s2==mx)
                    if s0==mx: t0+=1.0/nw
                    if s1==mx: t1+=1.0/nw
                    if s2==mx: t2+=1.0/nw
                out[i,j,k,0]=t0/N;out[i,j,k,1]=t1/N;out[i,j,k,2]=t2/N
    return out

def expand(S):
    """first-player equity tensor T[a,b,c] from sorted triple data S[i,j,k,:] (i<=j<=k)"""
    T=np.full((169,169,169),1/3,np.float32)
    I,J,K=np.meshgrid(np.arange(169),np.arange(169),np.arange(169),indexing='ij')
    mask=(I<=J)&(J<=K)
    ii,jj,kk=I[mask],J[mask],K[mask]
    vals=S[ii,jj,kk]   # [n,3]  equities of players holding classes ii,jj,kk
    import itertools
    for perm in itertools.permutations(range(3)):
        # place class (ii,jj,kk)[perm[0]] as 'first player'; others in any order
        cl=[ii,jj,kk]
        a=cl[perm[0]];b=cl[perm[1]];c=cl[perm[2]]
        T[a,b,c]=vals[:,perm[0]]
    return T

if __name__=="__main__":
    N=int(sys.argv[1])
    t=time.time()
    W=w3_table(CB,CN); np.save("W3.npy",W); print("W3",time.time()-t,flush=True)
    S=eq3_sorted(CB,CN,W,N,777)
    print("eq3",time.time()-t,flush=True)
    T=expand(S)
    np.save("T3.npy",T.astype(np.float16) if False else T)
    from hands import IDX
    print(T[IDX['AA'],IDX['KK'],IDX['QQ']],T[IDX['AA'],IDX['72o'],IDX['32o']],T[IDX['AKs'],IDX['QQ'],IDX['JTs']])
