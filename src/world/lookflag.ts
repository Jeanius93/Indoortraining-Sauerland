// Grafikstil, schon beim Aufbau der Welt bekannt.
// Standard: „sauerland“ (selbst gestalteter Boden, neu aufgebaute Häuser, üppige Vegetation).
// ?style=luftbild: bisheriger Stil mit Luftbildern und Gebäuden direkt aus LoD2.
export const LOOK = new URLSearchParams(location.search).get('style') === 'luftbild' ? 'luftbild' : 'sauerland';
export const ENS = LOOK === 'sauerland';
export const paint = { value: 0 };
