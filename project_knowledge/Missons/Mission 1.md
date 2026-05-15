
Sending CDP command: {
  id: 2,
  method: 'Page.navigate',
  params: { url: 'https://example.com' }
}

Registering pending CDP command with id 2




Page.navigate wasn't found
CDP command 3 sent successfully
Payload sending succeeded for CDP command 3, awaiting response...
Received CDP message: {"id":2,"error":{"code":-32601,"message":"'Page.navigate' wasn't found"}}
CDP command with id 2 failed: 'Page.navigate' wasn't found
Received CDP message: {"id":3,"error":{"code":-32601,"message":"'Runtime.evaluate' wasn't found"}}
CDP command with id 3 failed: 'Runtime.evaluate' wasn't found
CDP socket closed. code=1000 reason=



1. Explore how the side car can recognize applications and expose specific operations on said client


Debugging work platform of chrominum debug adapater (unit test) all timed out
	fails on conntects to /json/version and enables and routes navigate command to page.navigate both tests time out.
	33 - on client connect, and send.
	in send, there never is a error or success message, why is that, is this function even ever reached, that is because it is never called from the chromium, send Page.enable, and Runtime.enable on the cdp
	it does not even appear to use the side car, in what way does the chorimum debugger time out even, possibly the cdp client?
	chromium debug client never registers Page.enable or any of the commands [done]
	
CdpClient [done]
	build a new test page for the CdpClient to ensure that it is fine and ready
	Define the missing commands needed for the chromiumdebugadapter
	
	

Debugging vlc https adapater
	also fails after connect for each test
	39 uses a HttpJsonClient, then commits a wait, does this ever come back?
	18 attempts to get client requests/status.json, will this hold forever?

HttpClient [done] it fetchs
	17 fetches from url get and that is simply it, with auth user and password? in header
	so the vlc wants requests/status.json to exist, it then sends get requests with different commands etc. How does this request attempt to control vlc without any common VLC stuff?
	1. SMOKE_HTTP_BASE_URL

AdbAdapater
	will attempt to use the sidecar which suprisingly does work well
	

1. Extend the timeout on the test and add a timeout to the internal client structure instead of in the adapters.


How does the CDP command structure works and how can you implement more commands [done]
	listens for message command with structure {id, result, error} and currently only listens for these commands
	What kind of sending is this trying to do and also there should be a timeout for this.
	Essentially you would just register callbacks to commands from the outer super client
		1. Create a natural callback timeout and handle these errors gracefully with optional throws [done]
		2. ALso the pending commands seem to use number ids rather than maybe a command name. [done]

How does the HTTP command structure work and how can you implement more comands [done]
	17 fetches from url get and that is simply it, with auth user and password? in header
	so the vlc wants requests/status.json to exist, it then sends get requests with different commands etc. How does this request attempt to control vlc without any common VLC stuff?
how does the side command structure work and how can you implement more commands
	listens for stdout of chunk as feedback message.
	then uses the callback functions returned from the sidecar client oddly enough
	on send it will write into the stdin the payload and supposedly vice versa.
in the side car client it looks for the stdin payload and then looks for cmd.Method to trigger specific stuff, will return a response envelope and the reject will handle the error


1. Fix the ChromiumDebug adapater using the cdp and fix the cdp [done]
	1. Create a CDP unit test to test the CDP client specifically [done]
	2. View the complaints with the CDP and address any concerns [done]
	3. Test the new updated CDP test
	4. Update ChromiumDebugAdapter to use the new CDP
	5. Update the test 
2. Fix the VlcHttpAdapter test and add a unit test for the HttpJsonClient itself. [done]
	1. Include a sidecar client integration into the VlcHttpAdapter, so that the application starts and verified to start before attempting to communicate with it.
		1. The adapter should follow this pipeline:
		2. Read session metadata:
		    - `vlcExe`
		    - `sidecarExe`
		    - `httpPort`
		    - `httpPassword`
		3. Start the sidecar process.
		4. Ask the sidecar to launch VLC with the HTTP interface enabled.
		5. Probe `http://127.0.0.1:${port}/requests/status.json`.
		6. Validate the returned JSON looks like VLC.
		7. Mark the session ready.
		8. This version assumes the sidecar supports a method like
			launchProcess : send it the sidecar client data for updating
		9. ## Important prerequisite on the sidecar protocol
		
		For the adapter above to work, the sidecar must support a request shaped roughly like:
		
		{  
		  "id": 1,  
		  "method": "launchProcess",  
		  "params": {  
		    "exePath": "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",  
		    "args": [  
		      "--extraintf=http",  
		      "--http-host=127.0.0.1",  
		      "--http-port=8080",  
		      "--http-password=vlcpass"  
		    ],  
		    "detached": true  
		  }  
		}
		## Session metadata shape I’d expect

		Because this adapter now needs to launch VLC, I’d expect session metadata like:
		
		meta: {  
		  sidecarExe: "C:\\path\\to\\AutomationSidecar.exe",  
		  vlcExe: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",  
		  httpPort: 8080,  
		  httpPassword: "vlcpass"  
		}
	  **still need to provide this**
	2. Figure out how to setup VLC [done] authentication in VLC in order to use this.
		1. 127.0.0.1 + configured port + Basic Auth + status.json == VLC
		2. https://forums.ni.com/t5/LabVIEW/HTTP-Get-with-Authentication-for-VLC-Viewer-Web-API/td-p/3869387
	

VLC Logs




VLC HTTP probe failed (attempt 1/30), retrying... HttpError: GET http://127.0.0.1:8080/requests/status.json failed: fetch failed [done] opens stuff

Your input can't be opened:

VLC is unable to open the MRL 'file:///C:/Media/sample.mp4'. Check the log for details. [done]


3. Fix the AdbAdapter and use it with both the CDP and Sidecar
	1. It seems the Sidecar is neccessary to actually use along side the CDP, because otherwise the application never opens


For some reason the env expeccts me to have a pid

ignoring event without a nmeric ID, why does it not have a ID

Received CDP message: {"method":"Runtime.executionContextCreated","params":{"context":{"id":3,"origin":"chrome-extension://mhmppbegpeodobnjhnphebgdebdbpkhb","name":"","uniqueId":"-6545016103517103157.7916832173063650432","auxData":{"isDefault":true,"type":"default","frameId":"2ED0C12E3286D91F945EC752441BCF91"}}}} [done]


Add side car functionality to open up the application for remote debugging somehow debugging

Re Run All Tests and this mission is done


Adb browser trying to call process on 12345, remove this depeneency
it ensures browser, but sends adbPath as adb which is bad.

pid is undefined

kind of stuck on waiting in the adblock browser
the url passed is now start-server??

CDP bootstrap connect failed falling back to UIA
sidecar request timed out then findwindow by pid and no pid present [done]

possibly malformed payload

Sending message to sidecar: {"id":1,"method":"ensureAdbBrowserReady","Params":{"adbPath":"C:\\Users\\Cutie Magic 500\\AppData\\Local\\AdblockBrowser\\Application\\adblockbrowser.exe","packageName":"org.adblockplus.browser","debugPort":9222,"devtoolsSocket":"chrome_devtools_remote","bringToFront":true}}

how to populate the pid before you begin to send the pid back to the sidecar

it turns out the EnsureAdbBrowser ready is a bit twisted and looks for devices

navigateWindowByProcessId?

update the send to instead use the CDP connection [done]