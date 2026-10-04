import numpy as np, time
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
cfgs=[(5,5,5),(8,8,8),(10,10,10),(12,12,12),(15,15,15),(20,20,20),(12,8,5),(5,12,8),(8,5,12),(15,10,6)]
for c in cfgs:
    t=time.time()
    G=Game3(T3,W3,E2,*c)
    x,loss=solve(G,4000,verbose=False)
    np.savez(f"nash3_{c[0]:g}_{c[1]:g}_{c[2]:g}.npz",**x)
    print(c,"%.0fs expl %.2f mbb | BTN push %.1f SBpush %.1f SBcall %.1f BBcall(vsSB) %.1f BBcall(vsBTN) %.1f BBcall(vsBTN+SB) %.1f"%((time.time()-t,loss*1000)+tuple(pct(x[k]) for k in ['a','sp','sc','b1','b2','b3'])),flush=True)
