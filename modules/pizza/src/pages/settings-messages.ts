/**
 * Food → Settings' words (mockup 17, the admin control room's sheet 06), in English and Finnish;
 * messages.ts merges them into its catalogues. Each field's help line says what it is for in
 * people's words, as admin's declarations for Food do (modules/admin/declarations/pizza.yaml).
 */
export const SETTINGS_EN = {
  "settings.ordering": "Ordering",
  "settings.ordering_desc": "When and how people order",
  "settings.ordering_open": "People can order food",
  "settings.ordering_open_hint": "Off closes the Food page to new orders; open orders go on.",
  "settings.ordering_note": "Note while ordering is off",
  "settings.ordering_note_hint": "Shown on the Food page while ordering is off.",
  "settings.ordering_note_example": "e.g. Ordering opens again at 18:00",
  "settings.open_by": "Who may start an order",
  "settings.open_by_hint": "Anyone at the event, or only the crew.",
  "settings.anyone": "Anyone",
  "settings.crew_only": "Only crew",
  "settings.max_open_orders": "Orders open at once",
  "settings.max_open_orders_hint": "Two lets two pizzerias run side by side.",
  "settings.max_items_per_person": "Pizzas per person in one order",
  "settings.max_items_per_person_hint": "How many pizzas one person can add to one order.",
  "settings.times": "Times and forgotten orders",
  "settings.times_desc": "Reminders and closing on time",
  "settings.last_call_minutes": "Last call before the close",
  "settings.last_call_minutes_hint":
    "People in an order hear the last call this long before it closes.",
  "settings.remind_holder_minutes": "Remind a stalled holder after",
  "settings.remind_holder_minutes_hint":
    "A closed order that is not called in reminds its holder after this.",
  "settings.remind_crew_minutes": "Then remind the crew too, after",
  "settings.remind_crew_minutes_hint":
    "If it is still not called in, the crew hears about it after this.",
  "settings.release_after_minutes": "Release a stalled holder after",
  "settings.release_after_minutes_hint":
    "A holder who never calls the order in is released, so someone else can.",
  "settings.arrival_check_minutes": "Ask if it arrived, past the estimate",
  "settings.arrival_check_minutes_hint":
    "The holder is asked whether the food came, this long after the pizzeria's estimate.",
  "settings.arrival_check_no_estimate_minutes": "Without an estimate, ask after the call-in",
  "settings.arrival_check_no_estimate_minutes_hint":
    "When the pizzeria gave no estimate, the question comes this long after the call-in.",
  "settings.done_after_arrival_minutes": "Done after arrival",
  "settings.done_after_arrival_minutes_hint": "An order whose food came is marked done after this.",
  "settings.auto_close": "Close at the time",
  "settings.auto_close_hint": "An open order closes at its close time. Off: the holder closes it.",
  "settings.close_forgotten": "Close forgotten orders",
  "settings.close_forgotten_hint":
    "At 06:00: never called in is cancelled; called in but not done is done, flagged in the record.",
  "settings.settling_desc": "Who pays whom",
  "settings.reader_desc": "Receipts and menus read from photos",
  "settings.range": "From {min} to {max}.",
  "settings.default": "Default: {value}.",
  "settings.on": "on",
  "settings.off": "off",
  "settings.less": "Less",
  "settings.more": "More",
  "settings.min_unit": "min",
  "settings.read_only": "Only organisers change these.",
  "settings.saved_where": "Saved in the event's settings",
  "settings.cancel": "Discard",
  "settings.save": "Save changes",
  "settings.conflict": "Someone saved meanwhile: here are their settings. Make your change again.",
  "settings.failed": "Saving did not work. Try again.",
} as const;

export const SETTINGS_FI: Record<keyof typeof SETTINGS_EN, string> = {
  "settings.ordering": "Tilaaminen",
  "settings.ordering_desc": "Milloin ja miten tilataan",
  "settings.ordering_open": "Ruokaa voi tilata",
  "settings.ordering_open_hint":
    "Pois sulkee Ruoka-sivun uusilta tilauksilta; avoimet tilaukset jatkuvat.",
  "settings.ordering_note": "Viesti, kun tilaaminen on kiinni",
  "settings.ordering_note_hint": "Näkyy Ruoka-sivulla, kun tilaaminen on kiinni.",
  "settings.ordering_note_example": "esim. Tilaaminen aukeaa taas klo 18:00",
  "settings.open_by": "Kuka saa aloittaa tilauksen",
  "settings.open_by_hint": "Kuka tahansa tapahtumassa, tai vain crew.",
  "settings.anyone": "Kuka tahansa",
  "settings.crew_only": "Vain crew",
  "settings.max_open_orders": "Avoimia tilauksia kerralla",
  "settings.max_open_orders_hint": "Kaksi antaa kahden pizzerian tilaukset rinnakkain.",
  "settings.max_items_per_person": "Pizzoja per henkilö yhdessä tilauksessa",
  "settings.max_items_per_person_hint": "Montako pizzaa yksi henkilö voi lisätä yhteen tilaukseen.",
  "settings.times": "Ajat ja unohtuneet tilaukset",
  "settings.times_desc": "Muistutukset ja sulkeminen ajallaan",
  "settings.last_call_minutes": "Viimeinen kutsu ennen sulkemista",
  "settings.last_call_minutes_hint":
    "Tilauksessa olevat kuulevat viimeisen kutsun näin kauan ennen sulkemista.",
  "settings.remind_holder_minutes": "Muistuta jumittunutta hoitajaa, kun on kulunut",
  "settings.remind_holder_minutes_hint":
    "Suljettu tilaus, jota ei ole soitettu, muistuttaa hoitajaansa näin kauan.",
  "settings.remind_crew_minutes": "Sitten myös crew'ta, kun on kulunut",
  "settings.remind_crew_minutes_hint": "Jos tilausta ei vieläkään ole soitettu, crew kuulee siitä.",
  "settings.release_after_minutes": "Vapauta jumittunut hoitaja, kun on kulunut",
  "settings.release_after_minutes_hint":
    "Hoitaja, joka ei koskaan soita tilausta, vapautetaan, jotta joku muu voi.",
  "settings.arrival_check_minutes": "Kysy, onko perillä, arvion jälkeen",
  "settings.arrival_check_minutes_hint":
    "Hoitajalta kysytään, tuliko ruoka, näin kauan pizzerian arvion jälkeen.",
  "settings.arrival_check_no_estimate_minutes": "Ilman arviota, kysy soiton jälkeen",
  "settings.arrival_check_no_estimate_minutes_hint":
    "Kun pizzeria ei antanut arviota, kysymys tulee näin kauan soiton jälkeen.",
  "settings.done_after_arrival_minutes": "Valmis perille tulon jälkeen",
  "settings.done_after_arrival_minutes_hint":
    "Tilaus, jonka ruoka tuli, merkitään valmiiksi näin kauan.",
  "settings.auto_close": "Sulje ajallaan",
  "settings.auto_close_hint": "Avoin tilaus sulkeutuu sulkemisaikanaan. Pois: hoitaja sulkee sen.",
  "settings.close_forgotten": "Sulje unohtuneet tilaukset",
  "settings.close_forgotten_hint":
    "Klo 06: soittamaton perutaan; soitettu mutta kesken oleva valmistuu, merkittynä kirjanpitoon.",
  "settings.settling_desc": "Kuka maksaa kenelle",
  "settings.reader_desc": "Kuitit ja menut luetaan kuvista",
  "settings.range": "{min}–{max}.",
  "settings.default": "Oletus: {value}.",
  "settings.on": "päällä",
  "settings.off": "pois",
  "settings.less": "Vähemmän",
  "settings.more": "Enemmän",
  "settings.min_unit": "min",
  "settings.read_only": "Vain järjestäjät muuttavat näitä.",
  "settings.saved_where": "Tallennetaan tapahtuman asetuksiin",
  "settings.cancel": "Hylkää",
  "settings.save": "Tallenna muutokset",
  "settings.conflict": "Joku tallensi välissä: tässä hänen asetuksensa. Tee muutoksesi uudelleen.",
  "settings.failed": "Tallennus ei onnistunut. Yritä uudelleen.",
};
