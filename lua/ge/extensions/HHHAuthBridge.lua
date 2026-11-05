local M = {}

local started = false
local attempted = false
local connectedAt = nil
local authDeadline = nil
local status = "waiting"

local function logStatus(level, message)
    log(level, "HHH_AUTH", message)
end

local function requestCredentials()
    if attempted then return end
    attempted = true

    local cfg = extensions and extensions.HHHAuthBridgeConfig
    if type(cfg) ~= "table" then
        status = "config_error"
        logStatus("E", "Missing local bridge configuration")
        return
    end

    if cfg.mode == "guest" then
        if type(MPCoreNetwork) ~= "table" or type(MPCoreNetwork.login) ~= "function" then
            status = "network_error"
            logStatus("E", "BeamMP login API is unavailable")
            return
        end

        local loginOk, loginErr = pcall(MPCoreNetwork.login)
        if not loginOk then
            status = "login_error"
            logStatus("E", "BeamMP guest login call failed: " .. tostring(loginErr))
            return
        end

        status = "auth_pending"
        authDeadline = os.clock() + 25
        logStatus("I", "BeamMP guest login requested; waiting for server authentication")
        return
    end

    if not cfg.host or not cfg.port or not cfg.token then
        status = "config_error"
        logStatus("E", "Missing local bridge configuration")
        return
    end

    local ok, socketLib = pcall(require, "socket")
    if not ok or type(socketLib) ~= "table" or type(socketLib.tcp) ~= "function" then
        status = "socket_error"
        logStatus("E", "LuaSocket is unavailable")
        return
    end

    local client = socketLib.tcp()
    client:settimeout(5)
    local connected, err = client:connect(cfg.host, tonumber(cfg.port))
    if not connected then
        client:close()
        status = "bridge_error"
        logStatus("E", "Local auth bridge connection failed: " .. tostring(err))
        return
    end

    local sent, sendErr = client:send(tostring(cfg.token) .. "\n")
    if not sent then
        client:close()
        status = "bridge_error"
        logStatus("E", "Could not request credentials: " .. tostring(sendErr))
        return
    end

    local line, receiveErr = client:receive("*l")
    client:close()
    if not line then
        status = "bridge_error"
        logStatus("E", "No response from local auth bridge: " .. tostring(receiveErr))
        return
    end

    local decodedOk, credentials = pcall(jsonDecode, line)
    if not decodedOk or type(credentials) ~= "table" or type(credentials.username) ~= "string" or type(credentials.password) ~= "string" then
        status = "credentials_error"
        logStatus("E", "Local auth bridge returned invalid credentials data")
        return
    end

    if type(MPCoreNetwork) ~= "table" or type(MPCoreNetwork.login) ~= "function" then
        status = "network_error"
        logStatus("E", "BeamMP login API is unavailable")
        return
    end

    local loginOk, loginErr = pcall(MPCoreNetwork.login, credentials)
    credentials.password = nil
    if not loginOk then
        status = "login_error"
        logStatus("E", "BeamMP login call failed: " .. tostring(loginErr))
        return
    end

    status = "auth_pending"
    authDeadline = os.clock() + 25
    logStatus("I", "BeamMP credentials submitted; waiting for server authentication")
end

function M.onExtensionLoaded()
    logStatus("I", "BeamMP auth bridge loaded")
end

function M.onUpdate(dt)
    if status == "auth_pending" then
        if type(MPCoreNetwork) == "table" and type(MPCoreNetwork.isLoggedIn) == "function" and MPCoreNetwork.isLoggedIn() then
            status = "authenticated"
            logStatus("I", "BeamMP authentication successful")
        elseif authDeadline and os.clock() > authDeadline then
            status = "auth_timeout"
            logStatus("E", "BeamMP authentication timed out or was rejected")
        end
        return
    end

    if attempted then return end
    if type(MPCoreNetwork) ~= "table" or type(MPCoreNetwork.isLauncherConnected) ~= "function" then return end
    if not MPCoreNetwork.isLauncherConnected() then
        connectedAt = nil
        return
    end

    if not connectedAt then connectedAt = os.clock() end
    -- Let BeamMP finish its native launcher-connected/auto-login handshake first.
    if os.clock() - connectedAt >= 2 then requestCredentials() end
end

function M.isAuthenticated()
    return status == "authenticated" or (type(MPCoreNetwork) == "table" and type(MPCoreNetwork.isLoggedIn) == "function" and MPCoreNetwork.isLoggedIn())
end

function M.getStatus()
    return status
end

return M
