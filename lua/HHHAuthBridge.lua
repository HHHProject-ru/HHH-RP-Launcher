local M = {}

local attempted = false
local finished = false
local nextAttemptAt = 0

local function logInfo(message)
    log("I", "HHH_AUTH", message)
end

local function logError(message)
    log("E", "HHH_AUTH", message)
end

local function requestCredentials()
    local port = tonumber(os.getenv("HHH_AUTH_PORT") or "")
    local token = os.getenv("HHH_AUTH_TOKEN")
    if not port or not token or token == "" then
        logError("Authentication bridge environment is unavailable")
        finished = true
        return
    end

    local okSocket, socketLib = pcall(require, "socket")
    if not okSocket or type(socketLib.tcp) ~= "function" then
        logError("LuaSocket is unavailable")
        finished = true
        return
    end

    local client = socketLib.tcp()
    client:settimeout(3)
    local connected, connectError = client:connect("127.0.0.1", port)
    if not connected then
        client:close()
        logError("Could not connect to the local authentication bridge: " .. tostring(connectError))
        return false
    end

    local sent, sendError = client:send(token .. "\n")
    if not sent then
        client:close()
        logError("Could not request credentials: " .. tostring(sendError))
        finished = true
        return
    end

    local response, receiveError = client:receive("*l")
    client:close()
    if not response then
        logError("No credentials received: " .. tostring(receiveError))
        finished = true
        return
    end

    local decodedOk, credentials = pcall(jsonDecode, response)
    if not decodedOk or type(credentials) ~= "table"
        or type(credentials.username) ~= "string"
        or type(credentials.password) ~= "string" then
        logError("The local authentication response is invalid")
        finished = true
        return
    end

    if type(MPCoreNetwork) ~= "table" or type(MPCoreNetwork.login) ~= "function" then
        logError("BeamMP login API is unavailable")
        finished = true
        return
    end

    MPCoreNetwork.login({ username = credentials.username, password = credentials.password })
    credentials.password = nil
    credentials.username = nil
    logInfo("BeamMP login request sent")
    finished = true
    return true
end

function M.onExtensionLoaded()
    logInfo("Authentication bridge loaded")
end

function M.onUpdate(dt)
    if finished or attempted then return end
    if type(MPCoreNetwork) ~= "table"
        or type(MPCoreNetwork.isLauncherConnected) ~= "function"
        or not MPCoreNetwork.isLauncherConnected() then
        return
    end

    if os.clock() < nextAttemptAt then return end
    attempted = true
    local ok = requestCredentials()
    if ok == false then
        attempted = false
        nextAttemptAt = os.clock() + 2
    end
end

return M
