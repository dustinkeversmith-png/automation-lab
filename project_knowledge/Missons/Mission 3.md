


Create a download manager [progress = testing]
	how the download manager works, it tracks downloads and their location
	need a file interaction manager as well, such as like piping files or download types
	call download (url, file Name, options)

1. Use a dummy state for starting and activating a download
2. Track its progress and add promises to when finished what to do with it
3. Add a test page for the new download adapter

downloadAdapterSmoke.ts
smoke:download



Create a torrent application interaction for handling torrents [progress = impl]

	Create a resolution protocol for handling a torrent download with a torrent application, track its progress and control the torrenting application stop seeding etc.

1. Need to devise the side car adapted control hooks for the bit torrent
2. Create Controller Base Class for different applications, and then use those within the program.cs

Create a thorium reader

	1. Add a test page for the Thorium Reader adapter
	2. Download thorium reader and add a test program for it
	3. Auto reader and auto controller modes
1. Add send keys to the thorium page processors


npm run -> smoke:thorium

# Testing
	1. Download manager
	2. Thorium
	3. Torrent
1. Compile the new side car
2. Build and fix errors in project
	

integration test
 -> download manage -> open with thorium when done
 -> torrent manga -> open with thorium when done



Create a retroarch thing controller


# Sidecar Extension

