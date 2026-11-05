local M = {}

local uiReady = false
local attempted = false

function M.onExtensionLoaded()
    uiReady = true -- Bootstrap loads this extension during game startup.
    log("I", "HHH_TEST", "Auto-connect extension loaded")
end

function M.onUIInitialised()
    uiReady = true
    log("I", "HHH_TEST", "BeamNG UI is ready")
end

function M.onUpdate(dt)
    if attempted or not uiReady then
        return
    end

    if type(MPCoreNetwork) ~= "table"
        or type(MPCoreNetwork.isLauncherConnected) ~= "function"
        or type(MPCoreNetwork.connectToServer) ~= "function" then
        return
    end

    if not MPCoreNetwork.isLauncherConnected() then
        return
    end

    -- Do not attempt the HHH RP connection until BeamMP confirms authentication.
    if type(MPCoreNetwork.isLoggedIn) ~= "function" or not MPCoreNetwork.isLoggedIn() then
        return
    end

    attempted = true

    log("I", "HHH_TEST", "Starting automatic connection to HHH RP")

    local ok, err = pcall(
        MPCoreNetwork.connectToServer,
        "26.53.75.232",
        30814,
        "HHH RP",
        false
    )

    if not ok then
        log("E", "HHH_TEST", "Connection error: " .. tostring(err))
    end
end

return M
