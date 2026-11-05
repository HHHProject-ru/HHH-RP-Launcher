
const navButtons = document.querySelectorAll(".nav-button");
const pageButtons = document.querySelectorAll("[data-page]");
const pages = document.querySelectorAll(".page");

function openPage(pageName) {
    pages.forEach(page => {
        page.classList.toggle("active", page.id === pageName);
    });

    navButtons.forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === pageName
        );
    });
}

pageButtons.forEach(button => {
    button.addEventListener("click", () => {
        openPage(button.dataset.page);
    });
});

const playButton = document.querySelector('.play-button');
const syncStatus = document.querySelector('#sync-status');

window.launcher.onSyncStatus((message) => {
    syncStatus.textContent = message;
    syncStatus.classList.add('visible');
});

window.launcher.onBeamMPExit(() => {
    playButton.disabled = false;
});

playButton.addEventListener('click', async () => {
    playButton.disabled = true;
    syncStatus.textContent = 'Докачиваем моды, пожалуйста подождите!';
    syncStatus.classList.add('visible');

    try {
        await window.launcher.launchBeamMP();
    } catch (error) {
        syncStatus.textContent = 'Ошибка: ' + error.message;
        playButton.disabled = false;
        console.error(error);
    }
});

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

document.querySelectorAll('[data-community-link]').forEach(button => {
    button.addEventListener('click', async () => {
        try {
            await window.launcher.openCommunityLink(button.dataset.communityLink);
        } catch (error) {
            console.error('Не удалось открыть ссылку сообщества:', error);
        }
    });
});

const modsButton = document.querySelector('#open-mods-link');

modsButton.addEventListener('click', async () => {
    try {
        await window.launcher.openModsLink();
    } catch (error) {
        console.error(error);
    }
});


// Внутренние вкладки страницы настроек
const settingsTabs = document.querySelectorAll('[data-settings-tab]');
const settingsPanels = document.querySelectorAll('[data-settings-panel]');
settingsTabs.forEach(tab => tab.addEventListener('click', () => {
    settingsTabs.forEach(item => item.classList.toggle('active', item === tab));
    settingsPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === tab.dataset.settingsTab));
}));

const preferenceInputs = document.querySelectorAll('[data-pref]');
const maintenanceStatus = document.querySelector('#maintenance-status');
let launcherPrefs = {};

async function savePreferenceChanges() {
    const next = { ...launcherPrefs };
    preferenceInputs.forEach(input => { next[input.dataset.pref] = input.checked; });
    try {
        launcherPrefs = await window.launcher.saveLauncherPrefs(next);
        maintenanceStatus.textContent = 'Настройки сохранены.';
        maintenanceStatus.className = 'settings-status success';
    } catch (error) {
        maintenanceStatus.textContent = 'Не удалось сохранить настройки: ' + error.message;
        maintenanceStatus.className = 'settings-status warning';
    }
}

async function loadLauncherPreferences() {
    try {
        const saved = await window.launcher.getSettings();
        launcherPrefs = saved.launcherPrefs || {};
        preferenceInputs.forEach(input => { input.checked = !!launcherPrefs[input.dataset.pref]; });
    } catch (error) {
        maintenanceStatus.textContent = 'Не удалось загрузить настройки: ' + error.message;
        maintenanceStatus.className = 'settings-status warning';
    }
}
preferenceInputs.forEach(input => input.addEventListener('change', savePreferenceChanges));
loadLauncherPreferences();

document.querySelector('#open-launcher-folder').addEventListener('click', async () => {
    try { await window.launcher.openMaintenanceLocation('launcher'); maintenanceStatus.textContent = ''; }
    catch (error) { maintenanceStatus.textContent = error.message; maintenanceStatus.className = 'settings-status warning'; }
});
document.querySelector('#open-launcher-logs').addEventListener('click', async () => {
    try { await window.launcher.openMaintenanceLocation('logs'); maintenanceStatus.textContent = ''; }
    catch (error) { maintenanceStatus.textContent = error.message; maintenanceStatus.className = 'settings-status warning'; }
});
document.querySelector('#reset-launcher-preferences').addEventListener('click', async () => {
    if (!confirm('Сбросить параметры поведения и уведомлений? Пути к играм останутся без изменений.')) return;
    try {
        launcherPrefs = await window.launcher.resetLauncherPrefs();
        preferenceInputs.forEach(input => { input.checked = !!launcherPrefs[input.dataset.pref]; });
        maintenanceStatus.textContent = 'Параметры лаунчера сброшены. Пути к играм не изменены.';
        maintenanceStatus.className = 'settings-status success';
    } catch (error) { maintenanceStatus.textContent = error.message; maintenanceStatus.className = 'settings-status warning'; }
});

// Настройки путей
const settingsStatus = document.querySelector('#settings-status');

const pathElements = {
    beammpPath: document.querySelector('#beammp-path'),
    beammpModsPath: document.querySelector('#mods-path'),
    beamngPath: document.querySelector('#beamng-path')
};

let currentSettings = null;

function showSettings(settings) {
    currentSettings = settings;

    pathElements.beammpPath.textContent =
        settings.beammpPath || 'Не выбрана';

    pathElements.beammpModsPath.textContent =
        settings.beammpModsPath || 'Не выбрана';

    pathElements.beamngPath.textContent =
        settings.beamngPath || 'Не найдена';

    const status = settings.status;

    if (
        status.beammpPathValid &&
        status.modsPathValid &&
        status.beamngPathValid
    ) {
        settingsStatus.textContent = 'Все пути настроены правильно.';
        settingsStatus.className = 'settings-status success';
    } else {
        const problems = [];

        if (!status.beammpPathValid) {
            problems.push('Не найдена папка BeamMP');
        }

        if (!status.modsPathValid) {
            problems.push('Не найдена папка Resources');
        }

        if (!status.beamngPathValid) {
            problems.push('Не найдена установка BeamNG.drive');
        }

        settingsStatus.textContent = problems.join('. ') + '.';
        settingsStatus.className = 'settings-status warning';
    }
}

async function loadSettings() {
    try {
        const settings = await window.launcher.getSettings();
        showSettings(settings);
    } catch (error) {
        settingsStatus.textContent =
            'Ошибка загрузки настроек: ' + error.message;
    }
}

document.querySelectorAll('[data-select-folder]').forEach(button => {
    button.addEventListener('click', async () => {
        const settingName = button.dataset.selectFolder;

        try {
            const folder = await window.launcher.selectFolder(settingName);

            if (!folder) return;

            const newSettings = {
                ...currentSettings,
                [settingName]: folder
            };

            settingsStatus.textContent = 'Сохраняем настройки...';

            const saved = await window.launcher.saveSettings(newSettings);
            showSettings(saved);
        } catch (error) {
            settingsStatus.textContent = error.message;
            settingsStatus.className = 'settings-status warning';
        }
    });
});

loadSettings();


// Авторизация BeamMP в профиле
const authUsername = document.querySelector('#beammp-username');
const authPassword = document.querySelector('#beammp-password');
const authStatus = document.querySelector('#beammp-auth-status');
const authSaveButton = document.querySelector('#save-beampm-auth');
const authClearButton = document.querySelector('#clear-beampm-auth');

async function refreshBeamMPAuthStatus() {
    try {
        const state = await window.launcher.getBeamMPAuthStatus();
        if (!state.encryptionAvailable) {
            authStatus.textContent = 'Защищённое хранилище Windows недоступно. Сохранение пароля отключено.';
            authStatus.className = 'auth-status warning';
            return;
        }
        if (state.saved) {
            authUsername.value = state.username;
            authStatus.textContent = 'Аккаунт сохранён: ' + state.username + '. Пароль зашифрован.';
            authStatus.className = 'auth-status success';
        } else {
            authStatus.textContent = 'Аккаунт BeamMP не настроен. Сохрани логин и пароль перед запуском.';
            authStatus.className = 'auth-status warning';
        }
    } catch (error) {
        authStatus.textContent = 'Ошибка проверки аккаунта: ' + error.message;
        authStatus.className = 'auth-status warning';
    }
}

authSaveButton.addEventListener('click', async () => {
    authSaveButton.disabled = true;
    authStatus.textContent = 'Сохраняем данные в защищённом хранилище...';
    try {
        const result = await window.launcher.saveBeamMPCredentials({ username: authUsername.value, password: authPassword.value });
        authPassword.value = '';
        authUsername.value = result.username;
        authStatus.textContent = 'Аккаунт сохранён. Пароль зашифрован средствами Windows.';
        authStatus.className = 'auth-status success';
    } catch (error) {
        authStatus.textContent = error.message;
        authStatus.className = 'auth-status warning';
    } finally {
        authSaveButton.disabled = false;
    }
});

authClearButton.addEventListener('click', async () => {
    try {
        await window.launcher.clearBeamMPCredentials();
        authUsername.value = '';
        authPassword.value = '';
        authStatus.textContent = 'Сохранённые данные удалены.';
        authStatus.className = 'auth-status warning';
    } catch (error) {
        authStatus.textContent = error.message;
        authStatus.className = 'auth-status warning';
    }
});

refreshBeamMPAuthStatus();

// Настройки внешнего вида HHH RP

const appearanceColors = {
    red: {
        color: '#c93434',
        soft: 'rgba(201, 52, 52, .16)'
    },
    blue: {
        color: '#3985df',
        soft: 'rgba(57, 133, 223, .16)'
    },
    purple: {
        color: '#9560d9',
        soft: 'rgba(149, 96, 217, .16)'
    },
    orange: {
        color: '#df8539',
        soft: 'rgba(223, 133, 57, .16)'
    }
};

const appearanceButtons = document.querySelectorAll('[data-accent-color]');
const glowToggle = document.querySelector('#appearance-glow');
const animationsToggle = document.querySelector('#appearance-animations');

const appearanceStatus = document.querySelector('#appearance-status');

function applyAppearance(settings) {
    const selected = appearanceColors[settings.color]
        ? settings.color
        : 'red';

    const colors = appearanceColors[selected];

    document.documentElement.style.setProperty(
        '--accent-color',
        colors.color
    );

    document.documentElement.style.setProperty(
        '--accent-soft',
        colors.soft
    );

    document.documentElement.classList.toggle(
        'no-glow',
        settings.glow === false
    );

    document.documentElement.classList.toggle(
        'no-animations',
        settings.animations === false
    );

    appearanceButtons.forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.accentColor === selected
        );
    });

    glowToggle.checked = settings.glow !== false;
    animationsToggle.checked = settings.animations !== false;
}

function saveAppearance() {
    const selectedButton = document.querySelector(
        '.appearance-color.active'
    );

    const settings = {
        color: selectedButton
            ? selectedButton.dataset.accentColor
            : 'red',
        glow: glowToggle.checked,
        animations: animationsToggle.checked
    };

    try {
        localStorage.setItem(
            'hhhAppearance',
            JSON.stringify(settings)
        );

        applyAppearance(settings);

        appearanceStatus.textContent = 'Внешний вид сохранён.';
        appearanceStatus.className = 'settings-status success';
    } catch (error) {
        appearanceStatus.textContent =
            'Не удалось сохранить оформление: ' + error.message;

        appearanceStatus.className = 'settings-status warning';
    }
}

appearanceButtons.forEach(button => {
    button.addEventListener('click', () => {
        appearanceButtons.forEach(item =>
            item.classList.remove('active')
        );

        button.classList.add('active');
        saveAppearance();
    });
});

glowToggle.addEventListener('change', saveAppearance);
animationsToggle.addEventListener('change', saveAppearance);

// Загружаем сохранённое оформление
try {
    const savedAppearance = JSON.parse(
        localStorage.getItem('hhhAppearance') || '{}'
    );

    applyAppearance(savedAppearance);
} catch (error) {
    applyAppearance({});
}