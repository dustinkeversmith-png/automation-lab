
Expose navigation and window control over ADB 
1. Add a test page or way to entering into the automation-lab interaction section
2. Add or build the interface
3. Link the built interface to my current program


4. Need add the bring to front mechanism to chromium debuger
5. Resizing placement and fullscreen in the sidecar [done]
	1. "transformWindow" -> transformWindow Automation(cmd)
	2. The params should contain
		1. Width and Height Parameters
		2. Screen Sections like the auto fit
		3. position relative to the top left
		4. position relative to the center
		5. Minimize/open
		6. Bring to front

	add adb-transform tests for minimizing window, bring it to front and square type positiong

	
7. Updating the communication pattern with the sidecar [done not real]
	1. return a messageId from the sidecar.send, currently returns a promise with resolve or reject
	2. add a responsd function to the sidecare client.
	3. pass the pid to the adb transform settings

8. Adding web element selection for control over stuff 
	API [done]
		querySelector
		clickElement
		inputValue
		evaluateRawRuntime
		injectCss


	1. Create a new web element command for the chromium debugger
		1. the chromium debugger contacts the CDP client and will send commands over
		2. **The page interaction layer**: use CDP domains like `Runtime`, `DOM`, and `Input` to inspect the page, find elements, and interact with them.
		3. Use JavaScript in the page with `Runtime.evaluate`
		4. await client.send("Runtime.evaluate", {  
		expression: `document.querySelector("button")?.click()`,  
		returnByValue: true,  
		awaitPromise: true  
		});
		5. Use the real DOM/Input domains
		6. - `DOM.enable`
- `DOM.getDocument`
- `DOM.querySelector`
- `DOM.querySelectorAll`
- `DOM.describeNode`
- `DOM.getBoxModel`
- `DOM.resolveNode`
- `Input.dispatchMouseEvent`
- `Input.dispatchKeyEvent`
	1. Create a test page for the web element command debugger
		1. Create new chroimum debugger test page similar to previous
		2. Find a good test site and test elements to test these things on
		3. Pressing Play, waiting on loaders, changing the volumes or subtitles or something
		URL: https://9animetv.to/watch/dragon-ball-509?ep=10218
-  looks like its in a iframe
- #iframe-embed
https://rapid-cloud.co/embed-2/v2/e-1/3pPjnHq9WIV4?z=&autoPlay=undefined&oa=0


{
  "frameTree": {
    "frame": { "id": "TOP_FRAME", "url": "https://site.example" },
    "childFrames": [
      {
        "frame": {
          "id": "PLAYER_FRAME",
          "url": "https://player.example/embed/abc"
        }
      }
    ]
  }
}

sub layo

dub layout
.item .server-item data-type="dub" data-id="588033" data-server-id="4" Vidstreaming
.item .server-item data-type="dub" data-id="8569" data-server-id="1" Vidclioud
.item .server-item data-type="dub" data-id="1181512" data-server-id="6" DouVideo


sub
.item .server-item data-type="sub" data-id="588545" data-server-id="4" Vidstreaming
.item .server-item data-type="sub" data-id="9151" data-server-id="1" Vidclioud
.item .server-item data-type="sub" data-id="1182090" data-server-id="6" DouVideo


timed out on wait for document complete, why are these commands running asyncronously

return await this.evaluateRuntime
return await client.send("Runtime.evaluate", {expression, returnByValue, awaitPromise})
return (resolve, reject)


inspectIFrame

testIFrameInteractions
frameInfo = getFrameForSelector

this.querySelectorInFrame

timeout states probe, probe.found is not, true else resolve

returns
{"found":false}
iframeSelecto
what am I query selecting in frame

process.env.CHROME_TEST_IFRAME_SELECTOR


The added framed CDP client test Ill do invidually [done]

Frame Usage [done]
createFrameContext frameId ?? isolatedWorld
click create frame context

1. Push all of the CdpWebIFrame connection specificis into its own file,
2. Use the new CDP extension inside of the chromium debug adaptaer for connecting to the web frame
3. Add the test for gathering and connecting to a IFrame


Tests
1. Test the new Frame Capture Adapater 
2. Test the new sidecarw indow controls npm run adb-window-states

