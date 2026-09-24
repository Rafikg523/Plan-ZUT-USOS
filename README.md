# Plan USOS ZUT

Lokalna aplikacja do pobierania własnego planu z USOSweb ZUT, przeglądania go w kalendarzu i porównywania terminów innych grup tego samego przedmiotu.

## Uruchomienie

1. Uruchom:

   ```bash
   npm start
   ```

2. Otwórz `http://127.0.0.1:4173` i kliknij „Zaloguj przez ZUT”. Program otworzy osobne okno z prawdziwą stroną USOSweb/SSO ZUT. Po zalogowaniu okno zamknie się automatycznie, a numer albumu zostanie odczytany z USOSweb.

Aplikacja nasłuchuje tylko na adresie lokalnym. Hasło jest wpisywane wyłącznie na oficjalnej domenie `login.zut.edu.pl`; lokalna aplikacja przejmuje po zalogowaniu tylko ciasteczka sesji USOSweb. Hasło nie jest zapisywane w plikach, `.env`, `localStorage` ani odpowiedziach API. Po ponownym uruchomieniu serwera trzeba zalogować się ponownie.

## Jak używać

- Zaloguj się przez ZUT i wybierz zakres albo kliknij „Ustaw cały semestr”. Numer albumu zostanie pobrany automatycznie.
- Nawiguj tygodniami w kalendarzu.
- Po prawej rozwiń kierunek, przedmiot i formę zajęć.
- Kliknij „Pokaż inne grupy w tym tygodniu”, a następnie wybraną grupę, aby nałożyć jej termin na kalendarz.

Kod kierunku jest odczytywany z kodu przedmiotu USOS (np. `IIN-S1`). Dzięki temu zajęcia z dwóch kierunków są rozdzielone nawet wtedy, gdy mają taką samą nazwę.
