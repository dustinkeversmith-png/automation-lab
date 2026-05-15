npm install  
npm run dev

`electron-vite` is designed for this workflow, with `electron-vite dev` for development and `electron-vite build` for production builds.

If you want the full install flow from scratch, use this order:

# from the repo root  
npm install  
  
# optional: run tests  
npm test  
  
# start the Electron app  
npm run dev


cd sidecar/AutomationSidecar  
dotnet restore  
dotnet build  
dotnet run

If you want the compiled executable path after building, it will usually end up under something like:

sidecar/AutomationSidecar/bin/Debug/net8.0-windows/

and for Release:

dotnet build -c Release

or publish a cleaner output folder with:

dotnet publish -c Release -o ./publish

That uses the normal .NET CLI build/publish flow.

For VS Code, install these first:

- **C# Dev Kit**
- **C#**
- optionally **.NET Install Tool**

VS Code’s official C# docs recommend C# Dev Kit for the main experience.

A practical setup for your project would be:

# 1. clone or create the repo  
cd automation-lab  
  
# 2. install JS dependencies  
npm install  
  
# 3. run Electron app  
npm run dev  
  
# 4. in a second terminal, build the sidecar  
cd sidecar/AutomationSidecar  
dotnet restore  
dotnet build  
dotnet run

Then in your Electron config or test UI, point `sidecarExe` to the built sidecar executable when you want Electron to spawn it itself. During early testing, though, running it manually with `dotnet run` is simpler.

I recommend this workflow:

- use **VS Code** for both Electron and the sidecar
- use `npm run dev` for Electron
- use `dotnet run` for the sidecar during development
- only switch to built `.exe` paths once the JSON protocol is stable

One important note: your scaffold currently uses Windows UI Automation assemblies and targets `net8.0-windows`, so the sidecar is a **Windows-only** project as written. That fits your app-control use case.

A couple of useful commands you will probably want often:

# Electron  
npm install  
npm run dev  
npm test  
npm run build  
  
# Sidecar  
dotnet restore  
dotnet build  
dotnet run  
dotnet publish -c Release -o ./publish

If you want, I can turn this into a **copy-paste setup guide** with exact commands for your folder structure and a `README.md` section for “first run.”