# HTML e CSS di Metrics Viewer

L’unico foglio caricato è `css/metrics.css`. Contiene fondamenta condivise (variabili, tipografia e controlli), componenti e varianti responsive. Non aggiungere framework o fogli sovrapposti per correggere singoli casi.

- HTML semantico per struttura e accessibilità; nessun attributo `style`.
- Modificare la regola del componente esistente anziché aggiungere override in fondo al file.
- Usare le variabili di colore esistenti e classi esplicite per gli stati.
- Pannelli: `details.disclosure`, un `summary` e un `.disclosure__body`. La spaziatura del contenuto appartiene al body, non ai suoi figli arbitrari.
- JavaScript modifica classi e stato. Stili dinamici ammessi solo per colori derivati dai dati e posizione del tooltip, dimensioni e posizione dei player flottanti e dimensioni dei pannelli regolate dai divisori. Gli attributi SVG descrivono la geometria dei grafici.
- Non usare selettori globali come `main details` per correggere componenti specifici.
- Prima di dichiarare un layout verificato, controllarlo nel browser a larghezza desktop e stretta, con pannelli aperti e chiusi. I test logici non sostituiscono questa verifica.
