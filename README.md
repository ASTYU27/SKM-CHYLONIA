# Mój rozkład SKM

Webowa aplikacja PWA pokazująca najbliższe odjazdy SKM Trójmiasto dla Twoich tras. Działa offline, można zainstalować na telefonie.

## Trasy

1. **Z pracy do domu**: Gdańsk Oliwa → Gdynia Chylonia
2. **Z Przymorza do domu**: Gdańsk Przymorze-Uniwersytet → Gdynia Chylonia
3. **Na siłownię**: Gdańsk Przymorze-Uniwersytet → Gdańsk Zaspa

## Jak uruchomić lokalnie

W folderze projektu uruchom prosty serwer HTTP:

```bash
python -m http.server 8000
```

Lub w PowerShell jeśli masz Pythona:

```powershell
python -m http.server 8000
```

Następnie otwórz w przeglądarce: http://localhost:8000

**Uwaga**: Service Worker działa tylko przez HTTP/HTTPS, nie z pliku `file://`.

## Jak udostępnić online (za darmo)

### Opcja 1: Netlify Drop (najszybciej)

1. Wejdź na https://app.netlify.com/drop
2. Przeciągnij cały folder `skm-app` na stronę
3. Dostajesz darmowy URL typu `https://losowa-nazwa.netlify.app`

### Opcja 2: GitHub Pages

1. Stwórz repozytorium na GitHub (publiczne)
2. Wgraj wszystkie pliki:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/TWOJ_USER/skm-app.git
   git push -u origin main
   ```
3. W ustawieniach repo → Pages → Source: `main` branch, root folder
4. Aplikacja dostępna pod: `https://TWOJ_USER.github.io/skm-app`

## Jak zainstalować na telefonie

1. Otwórz URL aplikacji w przeglądarce na telefonie
2. **iPhone (Safari)**: kliknij "Udostępnij" → "Dodaj do ekranu początkowego"
3. **Android (Chrome)**: kliknij menu (3 kropki) → "Dodaj do ekranu głównego" / "Zainstaluj aplikację"

Po instalacji aplikacja działa jak natywna — ikona na ekranie, otwiera się bez paska adresu, działa offline.

## Jak zaktualizować rozkład

Rozkład jest w `schedule.json`. Zawiera **interwały** między pociągami w różnych przedziałach godzinowych dla dni roboczych, soboty i niedzieli.

Aplikacja generuje konkretne odjazdy na podstawie tych interwałów. To uproszczenie — rzeczywiste odjazdy SKM mogą się różnić o kilka minut. Dla dokładnego rozkładu użyj przycisku "Jakdojadę".

Aby zaktualizować, edytuj `schedule.json`:
- `intervals.weekday/saturday/sunday`: lista przedziałów godzinowych z interwałem (w minutach)
- `routes.X.duration`: czas przejazdu w minutach

Po zmianie service worker zacachuje starą wersję — zwiększ `CACHE_NAME` w `service-worker.js` (np. `skm-app-v2`), żeby wymusić odświeżenie u użytkowników.

## Struktura plików

```
skm-app/
├── index.html              # Główny plik HTML
├── style.css               # Style (light/dark mode)
├── app.js                  # Logika aplikacji
├── schedule.json           # Rozkład SKM (interwały)
├── manifest.json           # PWA manifest
├── service-worker.js       # Cache offline
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

## Stack

- HTML + CSS + Vanilla JavaScript (bez frameworków)
- PWA (Service Worker + Manifest)
- Mobile-first responsive design
- Light/dark mode (auto z systemu)
- Bez backendu

## Uwagi

Rozkład jest **orientacyjny** — bazuje na typowych interwałach SKM. Dla 100% pewności użyj Jakdojadę (przycisk w aplikacji). SKM Trójmiasto nie udostępnia publicznego API, więc nie da się pokazać dokładnych aktualnych odjazdów bez integracji z zewnętrznym serwisem.
