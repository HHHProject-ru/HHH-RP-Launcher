local M = {}

log("I", "HHH_BOOTSTRAP", "HHH Bootstrap executing through require")

if type(extensions) ~= "table" or type(extensions.load) ~= "function" then
    log("E", "HHH_BOOTSTRAP", "BeamNG extensions API is not available")
    return M
end

local okConfig, configErr = pcall(extensions.load, "HHHAuthBridgeConfig")
if not okConfig then
    log("E", "HHH_BOOTSTRAP", "Could not load auth configuration: " .. tostring(configErr))
    return M
end

local okAuth, authErr = pcall(extensions.load, "HHHAuthBridge")
if not okAuth then
    log("E", "HHH_BOOTSTRAP", "Could not load auth bridge: " .. tostring(authErr))
    return M
end

local okTest, testErr = pcall(extensions.load, "HHHTest")
if not okTest then
    log("E", "HHH_BOOTSTRAP", "Could not load HHHTest: " .. tostring(testErr))
end

return M