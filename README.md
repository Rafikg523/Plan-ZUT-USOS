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
- Przy kierunku możesz ukryć lub pokazać wszystkie jego wykłady. Litery przy nazwie przedmiotu pokazują stan każdej formy: czerwony oznacza brak zaznaczonych grup, zielony jedną, a żółty więcej niż jedną.
- Wybór grup zapisuje się automatycznie w tej przeglądarce osobno dla każdego numeru albumu. Przyciski nad listą przedmiotów pozwalają zapisać go do czytelnego pliku TXT lub wgrać taki plik. Przy każdej formie plik pokazuje nazwę przedmiotu, kod oraz zmianę z grupy w planie USOS na wybrane grupy (również gdy forma została ukryta); można go wgrać tylko do planu tego samego numeru albumu.
- Po pobraniu własnego planu kalendarz jest od razu dostępny. Pozostałe grupy i ich terminy pobierają się równolegle w tle, a postęp jest widoczny nad listą przedmiotów.
- Podczas pobierania planu pasek pokazuje liczbę ukończonych tygodni; pobieranie grup i odtwarzanie wyboru pokazują liczbę ukończonych przedmiotów. Przy logowaniu i pojedynczych pobraniach widać animowany wskaźnik pracy.
- Zaznacz wybraną grupę, aby nałożyć jej terminy na kalendarz. Przełączanie grup i tygodni korzysta z danych w pamięci, bez kolejnego pobierania zajęć.
- Jeśli pobranie grup dla przedmiotu nie powiedzie się, ponów je przyciskiem w jego sekcji.
- W szczegółach zajęć można odczytać listę uczestników, jeśli zalogowane konto ma do niej dostęp w USOS.
- W zakładce „Generator i zapisane plany” zaznacz przedmioty i formy, na które chcesz chodzić. Przy wybranej formie możesz dopuścić jej kolizje z innymi zajęciami. Kliknij „Generuj plany”, aby zobaczyć do trzech wariantów z jedną grupą na formę. Generator najpierw ogranicza niedopuszczone kolizje, a potem pozostałe. Następnie porównuje długość okienek, liczbę dni z zajęciami i liczbę dni z pojedynczym spotkaniem w całym pobranym zakresie.
- Nadaj nazwę i zapisz widoczny plan. Zapisane plany są dostępne na stronie startowej i w sekcji generatora, także po ponownym uruchomieniu aplikacji. Są przechowywane w pamięci tej przeglądarki.

Kod kierunku jest odczytywany z kodu przedmiotu USOS (np. `IIN-S1`). Dzięki temu zajęcia z dwóch kierunków są rozdzielone nawet wtedy, gdy mają taką samą nazwę.
