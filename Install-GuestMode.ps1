# HHH RP — установка гостевого режима BeamMP
# Windows PowerShell 5.1+. Проверяет все фрагменты до записи и создаёт резервную копию.

$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupDir = Join-Path $Project "backup-guest-mode-$Stamp"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-ProjectFile([string]$Name) {
    $Path = Join-Path $Project $Name
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Не найден файл проекта: $Name"
    }
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Replace-ExactOnce([string]$Content, [string]$Old, [string]$New, [string]$Label) {
    if ([string]::IsNullOrEmpty($Old)) { throw "Пустой шаблон: $Label" }
    $count = 0
    $position = 0
    while (($position = $Content.IndexOf($Old, $position, [System.StringComparison]::Ordinal)) -ge 0) {
        $count++
        $position += $Old.Length
    }
    if ($count -ne 1) {
        throw "Проверка '$Label': найдено точных совпадений $count, ожидалось 1. Файлы проекта не изменены."
    }
    return $Content.Replace($Old, $New)
}

# Считываем исходники в память. Пока не пройдены проверки, ничего не записываем.
$main = Read-ProjectFile 'main.js'
$preload = Read-ProjectFile 'preload.js'
$luaRelativePath = 'lua\ge\extensions\HHHAuthBridge.lua'
$lua = Read-ProjectFile $luaRelativePath
$html = Read-ProjectFile 'index.html'
$ui = Read-ProjectFile 'ui.js'
$css = Read-ProjectFile 'style.css'

# Определяем IPC-канал запуска по preload.js и проверяем его наличие в main.js.
$preloadMatch = [regex]::Match($preload, "launchBeamMP:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'\),")
if (-not $preloadMatch.Success) {
    throw "Не найден вызов launchBeamMP в preload.js. Файлы проекта не изменены."
}
$launchChannel = $preloadMatch.Groups[1].Value
$oldHandler = "ipcMain.handle('$launchChannel', async () => {"
$newHandler = "ipcMain.handle('$launchChannel', async (_event, mode = 'account') => {"

# 1. main.js: гостевой запуск создаёт конфиг guest и не читает пароль.
$guestBranch = @'
async function startAuthBridge(mode = 'account') {
  if (mode === 'guest') {
    stopAuthBridge();
    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
    const extensionsDir = path.join(localAppData, 'BeamNG', 'BeamNG.drive', 'current', 'lua', 'ge', 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    authBridgeConfigFile = path.join(extensionsDir, 'HHHAuthBridgeConfig.lua');
    fs.writeFileSync(authBridgeConfigFile, 'return { mode = "guest" }' + '\n', { encoding: 'utf8', mode: 0o600 });
    return;
  }

  const credentials = readBeamMPCredentials();
'@
$main = Replace-ExactOnce $main "async function startAuthBridge() {`n  const credentials = readBeamMPCredentials();" $guestBranch 'startAuthBridge guest branch'
$main = Replace-ExactOnce $main "async function launchBeamMP() {" "async function launchBeamMP(mode = 'account') {" 'launchBeamMP mode'
$main = Replace-ExactOnce $main "try { await startAuthBridge(); }" "try { await startAuthBridge(mode); }" 'pass mode to auth bridge'
$main = Replace-ExactOnce $main $oldHandler $newHandler 'launch IPC handler'
$main = Replace-ExactOnce $main "      launchBeamMP().then(() => resolve(true)).catch((error) => {" "      launchBeamMP(mode).then(() => resolve(true)).catch((error) => {" 'pass mode to BeamMP launch'

# 2. preload.js: передаём режим через тот же канал, найденный выше.
$oldPreloadCall = "launchBeamMP: () => ipcRenderer.invoke('$launchChannel'),"
$newPreloadCall = "launchBeamMP: (mode = 'account') => ipcRenderer.invoke('$launchChannel', mode),"
$preload = Replace-ExactOnce $preload $oldPreloadCall $newPreloadCall 'preload launch mode'

# 3. HHHAuthBridge.lua: guest вызывает штатный MPCoreNetwork.login() без credentials.
$oldLuaConfig = @'
    local cfg = extensions and extensions.HHHAuthBridgeConfig
    if type(cfg) ~= "table" or not cfg.host or not cfg.port or not cfg.token then
        status = "config_error"
        logStatus("E", "Missing local bridge configuration")
        return
    end
'@
$newLuaConfig = @'
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
'@
$lua = Replace-ExactOnce $lua $oldLuaConfig $newLuaConfig 'Lua guest login branch'

# 4. index.html: кнопка гостевого запуска в профиле.
$oldHtml = '                <div id="beammp-auth-status" class="auth-status">Проверяем сохранённый аккаунт...</div>'
$newHtml = @'
                <div id="beammp-auth-status" class="auth-status">Проверяем сохранённый аккаунт...</div>
                <div class="guest-mode-block">
                    <h3>Гостевой режим</h3>
                    <p>Запуск без сохранённого логина и пароля BeamMP. Возможность входа гостем зависит от настроек сервера.</p>
                    <button class="auth-guest-button" id="guest-mode-button" type="button">Играть в гостевом режиме</button>
                </div>
'@
$html = Replace-ExactOnce $html $oldHtml $newHtml 'profile guest button'

# 5. ui.js: гостевая кнопка использует общий процесс проверки модов и запуска.
$oldUiAnchor = @'
const modsButton = document.querySelector('#open-mods-link');
'@
$newUiAnchor = @'
const guestModeButton = document.querySelector('#guest-mode-button');

guestModeButton.addEventListener('click', async () => {
    playButton.disabled = true;
    guestModeButton.disabled = true;
    syncStatus.textContent = 'Запускаем BeamMP в гостевом режиме...';
    syncStatus.classList.add('visible');

    try {
        await window.launcher.launchBeamMP('guest');
    } catch (error) {
        syncStatus.textContent = 'Ошибка гостевого запуска: ' + error.message;
        playButton.disabled = false;
        guestModeButton.disabled = false;
        console.error(error);
    }
});

window.launcher.onBeamMPExit(() => {
    guestModeButton.disabled = false;
});

const modsButton = document.querySelector('#open-mods-link');
'@
$ui = Replace-ExactOnce $ui $oldUiAnchor $newUiAnchor 'guest button behavior'

# 6. style.css: оформление гостевого блока.
$cssAppend = @'

/* Гостевой режим BeamMP */
.guest-mode-block {
    margin-top: 22px;
    padding: 18px;
    border: 1px solid #3b3b42;
    border-radius: 9px;
    background: #1b1b20;
}
.guest-mode-block h3 {
    margin-bottom: 8px;
    color: #f0f0f2;
    font-size: 16px;
}
.guest-mode-block p {
    margin-bottom: 14px;
    color: #b8b8c0;
    font-size: 13px;
    line-height: 1.5;
}
.auth-guest-button {
    padding: 11px 16px;
    border: 1px solid #a83232;
    border-radius: 7px;
    background: #292024;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
}
.auth-guest-button:hover { background: #3a2429; }
.auth-guest-button:disabled { opacity: .6; cursor: wait; }
'@
if ($css.Contains('/* Гостевой режим BeamMP */')) {
    throw "В style.css уже есть блок гостевого режима. Файлы проекта не изменены."
}
$css = $css + $cssAppend

# Все проверки завершены. Создаём резервные копии и только затем записываем файлы.
$changes = [ordered]@{
    'main.js' = $main
    'preload.js' = $preload
    'index.html' = $html
    'ui.js' = $ui
    'style.css' = $css
}
$changes[$luaRelativePath] = $lua

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
foreach ($name in $changes.Keys) {
    $backupPath = Join-Path $BackupDir $name
    $backupParent = Split-Path -Parent $backupPath
    if (-not (Test-Path -LiteralPath $backupParent)) { New-Item -ItemType Directory -Path $backupParent -Force | Out-Null }
    Copy-Item -LiteralPath (Join-Path $Project $name) -Destination $backupPath -Force
}

try {
    foreach ($name in $changes.Keys) {
        [System.IO.File]::WriteAllText((Join-Path $Project $name), [string]$changes[$name], $Utf8NoBom)
    }
} catch {
    foreach ($name in $changes.Keys) {
        $backup = Join-Path $BackupDir $name
        if (Test-Path -LiteralPath $backup) {
            $restorePath = Join-Path $Project $name
            $restoreParent = Split-Path -Parent $restorePath
            if (-not (Test-Path -LiteralPath $restoreParent)) { New-Item -ItemType Directory -Path $restoreParent -Force | Out-Null }
            Copy-Item -LiteralPath $backup -Destination $restorePath -Force
        }
    }
    throw "Ошибка записи. Исходники восстановлены из резервной копии: $BackupDir. Подробности: $($_.Exception.Message)"
}

Write-Host ''
Write-Host 'Гостевой режим добавлен.' -ForegroundColor Green
Write-Host "Резервная копия: $BackupDir"
Write-Host "IPC-канал запуска определён автоматически: $launchChannel"
Write-Host 'Изменены: main.js, preload.js, lua\ge\extensions\HHHAuthBridge.lua, index.html, ui.js, style.css'
Write-Host 'HHHTest.lua и HHHBootstrap.lua не изменялись.'
Write-Host 'Важно: возможность входа гостем зависит от настроек BeamMP-сервера.'
