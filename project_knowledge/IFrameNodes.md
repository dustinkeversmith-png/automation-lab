The top page is on one origin, and the iframe navigates to `rapid-cloud.co`, which is a **different origin**. In Chromium, cross-origin iframes often become **out-of-process iframes (OOPIFs)**. When that happens:

- the iframe element still exists in the parent DOM
- but its live frame is no longer controlled by the **same CDP page session**
- so `Page.createIsolatedWorld({ frameId })` can start failing with  
    **`No frame for given id found`** after the navigation completes

The top page is on one origin, and the iframe navigates to `rapid-cloud.co`, which is a **different origin**. In Chromium, cross-origin iframes often become **out-of-process iframes (OOPIFs)**. When that happens:

- the iframe element still exists in the parent DOM
- but its live frame is no longer controlled by the **same CDP page session**
- so `Page.createIsolatedWorld({ frameId })` can start failing with  
    **`No frame for given id found`** after the navigation completes


That assumption breaks for cross-origin/OOPIF cases. Your current methods `getFrameIdForIframe`, `createFrameContext`, `evaluateInFrame`, `querySelectorInFrame`, and `waitForIframeReady` all rely on that assumption

That assumption breaks for cross-origin/OOPIF cases. Your current methods `getFrameIdForIframe`, `createFrameContext`, `evaluateInFrame`, `querySelectorInFrame`, and `waitForIframeReady` all rely on that assumption


## What you need to change

### Option A: handle OOPIF properly

This is the real fix.

You need to use the `Target` domain and auto-attach to child targets:

- `Target.setAutoAttach`
- `Target.attachedToTarget`
- maintain child `sessionId`s
- send `Runtime` / `Page` commands to the correct attached target session for the iframe