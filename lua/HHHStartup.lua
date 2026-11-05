-- Loaded by BeamNG's documented -luafile command-line option.
log("I", "HHH_BOOTSTRAP", "HHH startup module executed")

local ok, err = pcall(function()
    if type(extensions) ~= "table" or type(extensions.load) ~= "function" then
        error("BeamNG extensions API is not ready")
    end

    extensions.load("HHHBootstrap")
end)

if not ok then
    log("E", "HHH_BOOTSTRAP", "Could not load HHHBootstrap: " .. tostring(err))
end

return true
