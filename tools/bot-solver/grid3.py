import numpy as np, sys, time
from nash3 import *
T3=np.load("T3.npy"); W3=np.load("W3.npy"); E2=np.load("hu_eq.npy")
for s in sys.argv[1:]:
    S=float(s); t=time.time()
    G=Game3(T3,W3,E2,S,S,S)
    x,loss=solve(G,3000,verbose=False)
    np.savez(f"nash3_{S:g}_{S:g}_{S:g}.npz",**x)
    print(S,"%.0fs expl %.2f mbb | BTN %.1f SBp %.1f SBc %.1f b1 %.1f b2 %.1f b3 %.1f"%((time.time()-t,loss*1000)+tuple(pct(x[k]) for k in ['a','sp','sc','b1','b2','b3'])),flush=True)
