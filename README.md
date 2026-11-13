# Metrics Viewer

Viewer locale per metriche MATLAB, con stile derivato da TimeSeriesViewer del Behavior & Brain Lab. Nessun backend, nessun upload e nessuna dipendenza da CDN. Il campo `Fs` non viene utilizzato.

## Avvio

Aprire `index.html` nel browser, oppure eseguire `npm start` (Node.js) e aprire `http://127.0.0.1:8080`. Il pulsante **Prova un esempio** genera sei soggetti sintetici con durate e passi temporali differenti. I dati caricati rimangono in memoria fino alla chiusura/ricarica della pagina.

L'app ha due schede principali, **Time series** e **Riepilogo temporale**. Ognuna contiene **Visualizzazione** e **Analisi statistiche**. Normalizzazione, metrica, baseline e selezione soggetti sono condivise. Il selettore della singola epoca è nella scheda Time series; funzione di aggregazione e checkbox delle epoche sono nella scheda Riepilogo temporale. Questi controlli rimangono accessibili sia in Visualizzazione sia in Analisi statistiche. La selezione delle epoche tramite checkbox determina il confronto nel riepilogo e la famiglia di test statistici. La ricerca filtra le opzioni senza modificare la selezione. Nei selettori Epoca e Baseline il campo di ricerca è all’interno del menu aperto; frecce, Invio ed Escape permettono di operare da tastiera.

## Esportazione interattiva da MATLAB

Aggiungere la cartella `matlab` al percorso MATLAB e lanciare:

```matlab
exportMetricsJSON
```

1. Selezionare uno o più file MAT. Sono riconosciute variabili struct, array di struct e cell array di struct, incluso `cell_out`.
2. Scegliere nome e cartella del JSON. Tutti i soggetti caricati vengono inclusi senza una seconda selezione.

Annullare una finestra interrompe l'operazione senza scrivere file. Si deve scegliere una sola registrazione per soggetto. L'export conserva i campioni e i tempi, non applica normalizzazione o aggregazione.

Per partire da variabili già presenti nel workspace:

```matlab
exportMetricsJSON(S)                      % tutti i soggetti forniti e salvataggio
exportMetricsJSON({S1, S2, S3})           % nessun cellarray aggregato preliminare necessario
exportMetricsJSON(S, "subject.json")     % senza finestre
exportMetricsJSON(cell_out, "group.json") % senza finestre
D = exportMetricsJSON(S, "", Interactive=false); % restituisce il dataset, non salva
exportMetricsJSON(cell_out, "group.json", Interactive=true); % tutti i soggetti forniti
```

Richiede MATLAB R2021a o successivo, senza toolbox aggiuntivi. Verificato con R2025b.

## Formato JSON v1

```json
{
  "schema_version": 1,
  "time_unit": "s",
  "recordings": [
    {
      "id": "SBJ_01",
      "subject": "SBJ_01",
      "metadata": {"date": "06-NOV-2026"},
      "epochs": [
        {
          "id": "baseline",
          "metrics": {
            "AWI": {"time": [0, 0.5, 1], "values": [1, 2, 3]}
          }
        },
        {
          "id": "task1",
          "metrics": {
            "AWI": {"time": [0, 0.5, 1, 1.5], "values": [2, 4, null, 3]}
          }
        }
      ]
    }
  ]
}
```

- `recordings`, `epochs`, `time` e `values` sono sempre array, anche con un solo elemento.
- Ogni `id` di registrazione e ogni `subject` sono unici nel dataset importato. Ogni epoca ha un ID unico all'interno della registrazione. Più file vengono aggiunti in modo atomico: un errore non modifica il dataset esistente. Duplicati rifiutati, non sovrascritti.
- `time` contiene secondi dall'inizio dell'epoca, finiti, non negativi e strettamente crescenti. Non deve necessariamente contenere un campione a zero: il primo campione non viene spostato.
- `time` e `values` hanno la stessa lunghezza. Sono consentite serie vuote, metrica/epoca assente in un soggetto e durate/passaggi temporali differenti.
- `values` ammette numeri finiti e `null`. L'esportatore converte NaN/Inf in `null`, mantenendo i tempi e le posizioni; i tempi non finiti sono rifiutati.
- `metrics.<nome>{k}` e `metrics_time.<nome>{k}` della struct MATLAB sono associati a `epoch_id(k)`. Per ciascuna metrica devono esserci tante celle quante epoche.
- `Fs`, dati EEG grezzi, percorsi locali e canali non sono necessari per questo formato. Sono conservati come metadati solo `date` e `origin`, quando presenti.

Limiti dell'importazione: 100 MB per file; griglia fino a 50.000 istanti e 2 milioni di celle soggetto × tempo. Aumentare il passo per dataset più grandi.

## Normalizzazione e riepiloghi

Per la metrica selezionata, la normalizzazione viene precalcolata su tutte le epoche e tutti i soggetti e riutilizzata dalle due modalità. Cambiare epoca visualizzata, selezione dei soggetti, intervallo di analisi o griglia non ricalcola la normalizzazione. Cambiare dati, metrica, metodo, baseline, intervallo baseline o scala MAD invalida il risultato memorizzato.

Per ogni soggetto e metrica le statistiche sono stimate sui campioni originali della baseline selezionata, eventualmente limitata dall'intervallo baseline:

- z-score: `(x - mediaBaseline) / sdBaseline`, con deviazione standard campionaria, denominatore N−1.
- z-MAD: `(x - medianaBaseline) / MAD`, con MAD grezza oppure moltiplicata per 1,4826 (predefinita).
- Variazione percentuale: `100 * (x - mediaBaseline) / mediaBaseline`. Si conserva il segno della media baseline.

Campioni null esclusi dalle statistiche. Baseline mancante, vuota, con SD/MAD/media nulla o insufficienti campioni: serie non utilizzabile, con avviso; nessuna sostituzione silenziosa con zeri. Non vengono condivise baseline tra soggetti o metriche.

Il riepilogo temporale usa i campioni originali normalizzati nell'intervallo di analisi: media dei campioni, mediana, media pesata per durata, deviazione standard, minimo o massimo. La media pesata integra trapezi tra campioni validi, ritaglia i segmenti sui limiti dell'intervallo ed esclude lacune; riporta la durata valida nel CSV. Non richiede una griglia comune.

## Allineamento temporale

La griglia è ancorata allo zero dell'epoca. **Intervallo comune** usa la sovrapposizione delle coperture temporali; **intervallo completo** conserva le code, con null per i soggetti terminati e N effettivo a ogni istante.

Il passo automatico è il massimo dei passi mediani delle serie utilizzabili; il passo manuale è in secondi. Il metodo di interpolazione è lineare o più vicino. Non si estrapola. I null interrompono l'interpolazione; la soglia predefinita per le lacune è tre volte il passo mediano della singola serie, modificabile manualmente. La soglia lacune vale anche per le medie pesate.

Nel downsampling si usa un filtro boxcar temporale di larghezza pari al passo finale, integrato sui tempi nativi. Questo semplice filtro attenua le alte frequenze, ma non è un anti-aliasing ideale; le finestre ai bordi sono troncate. Se una finestra attraversa dati mancanti o lacune eccessive, il risultato è null. L'allineamento è in tempo reale, non in percentuale della durata.

## Outlier

I metodi puntuali sono recuperati da `TimeSeriesViewer/js/data.js` e conservati in `js/outliers.js`. Il confronto è sempre tra soggetti per la stessa metrica ed epoca, dopo normalizzazione. Le soglie usano tutti i soggetti caricati e utilizzabili, indipendentemente dalla selezione manuale, come nell'app originale.

**Time series**:

- IQR: limiti Q1−1,5×IQR / Q3+1,5×IQR a ciascun istante confrontabile.
- MAD: z robusto `0.6745 * abs(x - mediana) / MAD > 3.5`.
- Minimo 5 soggetti a ogni istante. Un soggetto è segnalato con almeno 3 istanti devianti e almeno il 10% degli istanti valutabili; N/D con meno di 3 istanti valutabili.
- Media temporale IQR: IQR tra medie pesate native, almeno 5 medie valide. Rispetto all'originale, le lacune ora sono escluse dall'integrale.
- Per passi differenti i confronti puntuali usano la griglia comune sull'unione delle coperture, limitata all'intervallo di analisi.

**Riepilogo temporale**:

- IQR o MAD sul valore individuale restituito dalla funzione di aggregazione selezionata, separatamente per ogni epoca.
- Almeno 5 riepiloghi validi. Non si applicano le soglie temporali del 10% e dei 3 istanti: ogni soggetto ha un valore per epoca.
- La tabella individuale e il CSV riportano un flag per soggetto × epoca. I badge laterali riassumono le epoche selezionate: Sì (N) se il soggetto è outlier in almeno un’epoca, No se non ci sono flag nelle epoche valutabili, N/D se nessuna epoca è valutabile. Il tooltip elenca epoche segnalate ed eventuali epoche non valutabili. Il selettore della singola epoca è visibile solo nelle time series.

MAD nulla: un valore diverso dalla mediana oltre la tolleranza numerica è segnalato; valori uguali non lo sono. I flag **non escludono automaticamente nessuno**. I controlli di selezione determinano chi contribuisce ai grafici e ai test. Nel pannello Campione, **◎** evidenzia una singola traccia e attenua le altre, come in TimeSeriesViewer. **Isola outlier (N)** evidenzia gli outlier tra i soggetti selezionati per la metrica/epoca corrente nelle time series; nel riepilogo considera l’unione degli outlier delle epoche selezionate. **Ripristina vista** annulla l’enfasi. Questi comandi sono solo visivi: non modificano selezione, medie, CSV o risultati statistici. Quando non ci sono outlier selezionati il pulsante collettivo è disabilitato. Cambiare metrica, epoca o impostazioni di calcolo ripristina la vista; deselezionare un soggetto isolato annulla l’isolamento.

## Analisi statistiche

Il motore deriva da `TimeSeriesViewer/js/permutation.js` e preserva:

- Test a un campione: statistica t contro un valore nullo, con sign-flipping dei residui per soggetto; test a due code.
- Gruppi indipendenti: F omnibus, con permutazione delle etichette dei soggetti e dimensioni dei gruppi conservate. Gruppi aggiungibili/rinominabili; almeno due soggetti per gruppo. Il test non identifica le coppie diverse.
- Stessa trasformazione del soggetto a tutti gli istanti/epoche in ogni permutazione, preservando la dipendenza entro soggetto.
- P-value puntuale e corretto max-|T| / max-F, con correzione Monte Carlo `(eccedenze + 1) / (permutazioni + 1)`.

Nel viewer temporale la famiglia comprende tutti gli istanti analizzati della metrica × epoca selezionata. Si mantengono solo istanti validi per tutti i soggetti con una serie utilizzabile; il numero di istanti omessi è riportato.

Nel riepilogo la famiglia comprende tutte le epoche selezionate della metrica corrente. Sono inclusi solo soggetti con riepiloghi validi per tutte queste epoche; gli esclusi sono elencati. Non è un test appaiato tra epoche: si testa ogni epoca contro il valore nullo o tra gruppi indipendenti.

La famiglia non comprende metriche diverse o esecuzioni separate. Sign-flipping richiede simmetria dei residui sotto il nullo; lo scambio di etichette richiede scambiabilità tra gruppi. La selezione manuale e i flag non correggono questi presupposti.

Novità: seed riproducibile, annullamento e invalidazione dei risultati quando cambiano dati/impostazioni; limite del carico di calcolo con messaggio esplicito. I grafici statistici mostrano medie per gruppo e IC 95% t (stessa tabella critica dell'originale), oltre ai p-value corretti. Il CSV riporta selezioni, normalizzazione, gruppi, seed e parametri del test. I grafici descrittivi mostrano invece media ± DS tra soggetti, come indicato in legenda.

## Sviluppo e verifica

```text
npm test
```

In ambienti che impediscono la creazione di processi Node:

```text
node --test --test-isolation=none tests/core.test.js tests/analysis.test.js
```

Test MATLAB:

```matlab
results = runtests("tests/ExportMetricsJSONTest.m");
assertSuccess(results)
```

I dati reali di ricerca non sono inclusi nella repository. `private-data/` e i MAT sono esclusi da Git.

L’esportatore parte dalla versione fornita dall’utente: usa `jsonencode` e mostra barre di avanzamento per lettura MAT, conversione e scrittura. Le barre si chiudono anche in caso di errore o annullamento; `Progress=false` le disabilita. Le misure della precedente implementazione non si applicano a questa versione.

## Avanzamento delle operazioni

Un popup modale indica le fasi di lettura e verifica dei JSON, preparazione dei grafici, ricerca outlier ed esportazione CSV. Le elaborazioni di dataset grandi (almeno 20.000 campioni della metrica o 100 registrazioni) mostrano anche le fasi di normalizzazione e allineamento. Il browser riceve tempo per disegnare il popup prima dei calcoli. I passaggi sincroni più costosi possono comunque occupare il thread principale; non viene mostrata una percentuale inventata.

Nei test statistici l’avanzamento mostra il numero effettivo di permutazioni completate. Il pulsante Annulla analisi (o Escape) interrompe il test al successivo blocco di permutazioni. Il popup si chiude anche in caso di errore e riporta il focus al controllo precedente.

L’esportatore include tutti i soggetti dei file selezionati, senza una seconda lista di selezione. Una metrica rappresentata da un singolo NaN (epoca troppo corta) viene esportata come serie vuota; se nell’epoca restano solo metriche non disponibili, l’epoca viene omessa per quel soggetto. I soggetti senza epoche restanti vengono omessi; se non rimane alcun soggetto, l’esportazione termina con un messaggio senza scrivere il file. Il numero di epoche omesse viene riportato nella Command Window.
