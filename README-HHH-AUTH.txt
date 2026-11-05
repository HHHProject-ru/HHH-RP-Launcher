HHH RP Launcher — BeamMP account integration

INSTALLATION
1. Close HHH RP Launcher and BeamNG.drive.
2. Extract this archive OVER the existing HH-RP-Launcher project folder.
   Do not delete the existing project folder or its assets.
3. Keep the existing project files and assets. The archive includes updated
   index.html, style.css, ui.js, preload.js, main.js and a new lua folder.
4. Start the launcher with the usual npm start command.
5. Open Profile, enter your BeamMP username and password, and save the account.
6. Use the normal PLAY button. Mod synchronization and the existing server
   health check remain in the launch sequence.

SECURITY
- The account is encrypted with Electron safeStorage (Windows DPAPI-backed
  storage) in the launcher's Electron userData directory.
- The password is not stored in settings.json and is never put in command-line
  arguments or application logs.
- At game launch, the launcher opens a one-time TCP endpoint bound only to
  127.0.0.1. A random per-launch token is passed through the child-process
  environment. The Lua bridge requests the credentials once and then the
  endpoint closes.
- The launcher makes a backup of an existing HHHTest.lua as
  HHHTest.lua.hhh-backup before installing the updated version. It does not
  overwrite that backup on later launches.

IMPORTANT FIRST-RUN TEST
The bridge relies on the BeamMP Launcher passing its inherited environment
variables to BeamNG.drive. This is expected for a normal child-process launch,
but must be confirmed on the user's machine. If the BeamNG log reports
"Authentication bridge environment is unavailable", the BeamMP Launcher did
not pass those variables through and the bridge transport must be adapted.

The Profile status means the account is saved, not that BeamMP has already
accepted the credentials. The actual authentication result is checked by
MPCoreNetwork.isLoggedIn(); HHHTest will not connect to HHH RP until it returns
true.

The Lua bridge calls the BeamMP 4.23.1 MPCoreNetwork.login API. It does not
modify BeamMP.zip or other stock BeamMP files.
