await adapter.send(sessionId, {  
  type: "querySelector",  
  payload: {  
    selector: 'input[type="range"]'  
  }  
});

### Click element

await adapter.send(sessionId, {  
  type: "clickElement",  
  payload: {  
    selector: "#play-button"  
  }  
});

### Input slider value

await adapter.send(sessionId, {  
  type: "inputValue",  
  payload: {  
    selector: 'input[type="range"][name="volume"]',  
    value: 0.5  
  }  
});

Or if the site expects 50 instead of 0.5:

await adapter.send(sessionId, {  
  type: "inputValue",  
  payload: {  
    selector: 'input[type="range"][name="volume"]',  
    value: 50  
  }  
});

### Raw runtime evaluate

await adapter.send(sessionId, {  
  type: "evaluateRawRuntime",  
  payload: {  
    expression: `  
      (() => {  
        return {  
          title: document.title,  
          href: location.href  
        };  
      })()  
    `,  
    returnByValue: true,  
    awaitPromise: true  
  }  
});


await adapter.send(sessionId, {
  type: "evaluateInFrame",
  payload: {
    iframeSelector: "#iframe-embed",
    expression: `
      document.querySelector("video")?.play()
    `
  }
});


await adapter.send(sessionId, {  
type: "evaluateInFrame",  
payload: {  
iframeSelector: "#iframe-embed",  
expression: `  
(() => {  
const v = document.querySelector("video");  
if (!v) return false;  
v.volume = 0.5;  
return v.volume;  
})()  
`  
}  
});

await adapter.send(sessionId, {  
type: "clickInFrame",  
payload: {  
iframeSelector: "#iframe-embed",  
selector: ".play-button"  
}  
});

await adapter.send(sessionId, {  
type: "inputInFrame",  
payload: {  
iframeSelector: "#iframe-embed",  
selector: 'input[type="range"]',  
value: 0.7  
}  
});