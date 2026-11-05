
import os
import sys
import re
import json
import tempfile
import zipfile
from pathlib import Path

import requests
import gdown

FOLDER_URL = (
    "https://drive.google.com/drive/folders/"
    "1GDkKjoU9PQedH_xgI1WTly2WtmpPee68"
)

EXCLUDED_FILE = "mp_phone_rp_beammp_beamng039_v1_2_2.zip"

# Обходим системный прокси для Google Drive.
old_init = requests.Session.__init__

def patched_init(self, *args, **kwargs):
    old_init(self, *args, **kwargs)
    self.trust_env = False

requests.Session.__init__ = patched_init


def report(message, current=0, total=0):
    print(json.dumps({
        "message": message,
        "current": current,
        "total": total
    }, ensure_ascii=False), flush=True)


def is_excluded(filename):
    """Защита личного MP Phone RP, в том числе с суффиксом BeamMP."""
    excluded = Path(EXCLUDED_FILE)

    pattern = (
        re.escape(excluded.stem)
        + r"(?:-[0-9a-fA-F]{8})?"
        + re.escape(excluded.suffix)
    )

    return re.fullmatch(pattern, Path(filename).name, re.IGNORECASE) is not None


def same_version_exists(resources, filename):
    """
    Ищем локальный архив с тем же оригинальным именем и версией.
    BeamMP может добавлять к имени хеш из 8 символов.
    """
    original = Path(filename)

    if (resources / filename).is_file():
        return True

    pattern = re.compile(
        re.escape(original.stem)
        + r"-[0-9a-fA-F]{8}"
        + re.escape(original.suffix),
        re.IGNORECASE
    )

    return any(
        item.is_file() and pattern.fullmatch(item.name)
        for item in resources.iterdir()
    )


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("Не указан путь к папке Resources")

    resources = Path(sys.argv[1])
    resources.mkdir(parents=True, exist_ok=True)

    report(f"ПАПКА ЗАГРУЗКИ: {resources.resolve()}")

    report("Получаем список модов с Google Drive...")

    files = gdown.download_folder(
        url=FOLDER_URL,
        skip_download=True,
        quiet=True
    )

    if not files:
        raise RuntimeError("Google Drive не вернул список файлов")

    # Исключаем личный архив. mp_phone_client.zip остаётся в синхронизации.
    files = [
        file for file in files
        if not is_excluded(file.path)
    ]

    total = len(files)
    downloaded = 0

    for index, file in enumerate(files, 1):
        name = Path(file.path).name

        if same_version_exists(resources, name):
            report(f"Уже установлена: {name}", index, total)
            continue

        report(f"Докачиваем: {name}", index, total)

        destination = resources / name

        # Не перезаписываем старые архивы.
        if destination.exists():
            p = Path(name)
            destination = resources / f"{p.stem}-{file.id[:8]}{p.suffix}"

        if destination.exists():
            raise RuntimeError(
                f"Файл назначения уже существует: {destination.name}"
            )

        fd, temp_name = tempfile.mkstemp(
            prefix="hh_rp_",
            suffix=".part",
            dir=resources
        )
        os.close(fd)

        try:
            result = gdown.download(
                id=file.id,
                output=temp_name,
                quiet=True
            )

            if not result or not Path(temp_name).is_file():
                raise RuntimeError(f"Не удалось скачать {name}")

            if not zipfile.is_zipfile(temp_name):
                raise RuntimeError(f"Скачанный архив повреждён: {name}")

            if destination.exists():
                raise RuntimeError(
                    f"Файл уже существует: {destination.name}"
                )

            os.replace(temp_name, destination)
            downloaded += 1

        finally:
            if os.path.exists(temp_name):
                os.remove(temp_name)

        report(f"Загружен: {name}", index, total)

    report(
        f"Проверка завершена. Докачано архивов: {downloaded}",
        total,
        total
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        report(f"ОШИБКА: {error}")
        sys.exit(1)
